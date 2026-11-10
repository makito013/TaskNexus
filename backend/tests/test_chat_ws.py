"""WebSocket `/ws/chat/{session_key}`: replay, live frames, commands, close codes."""
from __future__ import annotations

import asyncio
import sqlite3

import pytest
from starlette.websockets import WebSocketDisconnect

from app.chat.availability import SdkStatus
from app.chat.engine import SpawnFailed
from app.chat.runtime import MAX_READERS
from tests.chat_fakes import KEY, Rig, init_message
from tests.test_chat_endpoints import PROJECT, StubResolver, env, wait_until  # noqa: F401 - fixtures

def read_until(ws, kind, limit=60):
    """Frames up to and including the first of `kind`."""
    frames = []
    for _ in range(limit):
        frame = ws.receive_json()
        frames.append(frame)
        if frame["type"] == kind:
            return frames
    raise AssertionError(f"no {kind} frame in {limit} frames: {[f['type'] for f in frames]}")


def closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        for _ in range(100):
            ws.receive_json()
    # checked at the moment of every close, so the result never depends on test order
    assert closed.value.code != 1008, "a socket was closed with 1008"
    return closed.value.code


def open_ws(env, key, since=0, **headers):
    return env.client.websocket_connect(f"/ws/chat/{key}?since={since}", headers=headers)


def test_connecting_never_spawns_and_the_first_frame_is_the_state(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")
    env.client.post(f"/api/chat/sessions/{key}/close")
    spawns = env.engine.spawns

    with open_ws(env, key) as ws:
        frames = read_until(ws, "replay.complete")

    assert env.engine.spawns == spawns
    state = frames[0]
    assert state["type"] == "session.state" and state["seq"] is None and state["engine"] == "chat"
    assert state["process"] == "stopped" and state["permission_mode"] == "default"
    assert frames[-1]["last_seq"] == env.events(key)["last_seq"]


def test_replay_from_since_then_live_frames_without_gap_or_duplicate(env):
    key = env.create(first_message="first")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    total = env.events(key)["last_seq"]

    with open_ws(env, key, since=2) as ws:
        replay = read_until(ws, "replay.complete")
        assert [f["seq"] for f in replay if f["seq"] is not None] == list(range(3, total + 1))
        ws.send_json({"type": "send", "client_msg_id": "c2", "text": "second"})
        live = read_until(ws, "turn.ended")

    assert [f["seq"] for f in live if f["seq"] is not None] == list(range(total + 1, total + 1 + len(
        [f for f in live if f["seq"] is not None])))
    assert live[0]["type"] == "message.user" and live[0]["text"] == "second" and live[0]["client_msg_id"] == "c2"
    assert env.engine.last.queries == ["first", "second"]


def test_two_sockets_see_the_same_live_frames(env):
    key = env.create(first_message="first")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    last = env.events(key)["last_seq"]

    with open_ws(env, key, since=last) as one, open_ws(env, key, since=last) as two:
        read_until(one, "replay.complete")
        read_until(two, "replay.complete")
        one.send_json({"type": "send", "text": "hello"})
        a = read_until(one, "turn.ended")
        b = read_until(two, "turn.ended")

    assert [f["seq"] for f in a] == [f["seq"] for f in b]


def test_unknown_session_closes_4404_and_a_foreign_origin_4403(env):
    with env.client.websocket_connect("/ws/chat/nope::claude::zzzzzz") as ws:
        assert closed_with(ws) == 4404
    key = env.create()
    with open_ws(env, key, Origin="http://evil.example") as ws:
        assert closed_with(ws) == 4403


def test_the_seventeenth_reader_is_closed_with_4429(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")
    sockets = []
    try:
        for _ in range(MAX_READERS):
            ws = open_ws(env, key).__enter__()
            read_until(ws, "replay.complete")
            sockets.append(ws)
        with open_ws(env, key) as extra:
            assert closed_with(extra) == 4429
    finally:
        for ws in sockets:
            ws.__exit__(None, None, None)


def test_a_key_with_slashes_and_double_colons_works_in_the_path(env):
    key = "Pessoal/tn-sandbox::claude::abc123"
    conn = sqlite3.connect(env.db)
    conn.execute("INSERT INTO sessions (session_key, claude_session_id, engine) VALUES (?, ?, 'chat')",
                 (key, "33333333-3333-4333-8333-333333333333"))
    conn.execute("INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, created_at, updated_at) "
                 "VALUES (?, 'Pessoal/tn-sandbox', 'claude', 'x', 1, 1)", (key,))
    conn.commit()
    conn.close()

    with open_ws(env, key) as ws:
        assert read_until(ws, "replay.complete")[0]["session_key"] == key


def test_without_the_sdk_the_socket_says_engine_unavailable_and_stays_open(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")
    env.client.post(f"/api/chat/sessions/{key}/close")  # no live process: a send would have to spawn
    env.main.chat_service.sdk_status = lambda: SdkStatus(False, None, "ImportError: x")

    with open_ws(env, key) as ws:
        frames = read_until(ws, "replay.complete")
        ws.send_json({"type": "send", "text": "hi"})
        rejected = read_until(ws, "status")

    assert any(f["type"] == "status" and f["code"] == "engine_unavailable" for f in frames)
    assert rejected[-1]["code"] == "engine_unavailable" and rejected[-1]["seq"] is None


def test_a_missing_binary_is_one_status_event_and_the_socket_never_reopens_it(env):
    env.resolver.resolve = lambda agent=None: __import__("app.chat.availability", fromlist=["CliInfo"]).CliInfo(
        None, None, False, "cli_not_found", "not found")
    key = env.create()
    wait_until(lambda: env.session(key)["status"] == "failed")

    with open_ws(env, key) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "send", "text": "hi"})
        ws.send_json({"type": "send", "text": "again"})
        import time
        time.sleep(0.4)
        ws.send_json({"type": "ack"})
    statuses = [e for e in env.events(key)["events"] if e["kind"] == "status"]

    assert env.engine.spawns == 0
    assert len(statuses) >= 1 and all(s["payload"]["reason"] == "cli_not_found" for s in statuses)


@pytest.mark.parametrize("frame,code", [
    ({"type": "nonsense"}, "invalid_frame"),
    ({"type": "send"}, "invalid_frame"),
    ({"type": "send", "text": "hi", "attachments": [{"name": "a.png"}]}, "attachments_unsupported"),
    ({"type": "set_model", "model": "--mcp-config=evil"}, "model_not_allowed"),
    ({"type": "set_permission_mode", "mode": "bypassPermissions"}, "mode_not_allowed"),
    ({"type": "permission.decide", "id": "ghost", "behavior": "allow"}, "permission_not_found"),
])
def test_bad_commands_are_rejected_with_the_request_id(env, frame, code):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({**frame, "request_id": "r1"})
        rejected = read_until(ws, "command.rejected")[-1]

    assert rejected["code"] == code and rejected["request_id"] == "r1" and rejected["seq"] is None


def test_a_frame_that_is_not_json_is_rejected_and_the_socket_lives_on(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")

    with open_ws(env, key) as ws:
        read_until(ws, "replay.complete")
        ws.send_text("{nope")
        rejected = read_until(ws, "command.rejected")[-1]
        ws.send_json({"type": "ack"})

    assert rejected["code"] == "invalid_frame"


def test_decisions_by_ws_win_once_and_the_rest_endpoint_then_says_already_decided(env):
    async def on_query(process, text):
        process.push(init_message(process.session_id))
        process.ask_permission("Write", {"file_path": "C:/tmp/x"})

    env.engine.on_query = on_query
    key = env.create(first_message="go")
    wait_until(lambda: any(e["kind"] == "permission.request" for e in env.events(key)["events"]))

    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        pid = next(e["payload"]["id"] for e in env.events(key)["events"] if e["kind"] == "permission.request")
        ws.send_json({"type": "permission.decide", "id": pid, "behavior": "allow", "scope": "session"})
        resolved = read_until(ws, "permission.resolved")[-1]
        rest = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "deny"})

    assert resolved["status"] == "allowed" and resolved["by"] == "ws" and resolved["scope"] == "session"
    assert rest.status_code == 409


def test_a_socket_cannot_decide_an_approval_of_another_conversation(env):
    async def on_query(process, text):
        process.push(init_message(process.session_id))
        process.ask_permission("Write", {})

    env.engine.on_query = on_query
    victim = env.create(first_message="go")
    wait_until(lambda: any(e["kind"] == "permission.request" for e in env.events(victim)["events"]))
    pid = next(e["payload"]["id"] for e in env.events(victim)["events"] if e["kind"] == "permission.request")
    other = env.create()
    wait_until(lambda: env.session(other)["status"] != "new")

    with open_ws(env, other) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "permission.decide", "id": pid, "behavior": "allow", "request_id": "x"})
        rejected = read_until(ws, "command.rejected")[-1]

    assert rejected["code"] == "permission_not_found"
    assert env.session(victim)["pending_permissions"] == 1


def test_interrupt_and_set_model_go_through_the_runtime_and_ack_clears_attention(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    env.client.post(f"/api/sessions/{key}/ack")

    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "set_model", "model": "sonnet"})
        # The real CLI announces the new model in the `init` of the NEXT turn (the fake does too).
        ws.send_json({"type": "send", "text": "next turn"})
        read_until(ws, "model.changed")
        ws.send_json({"type": "set_permission_mode", "mode": "plan"})
        read_until(ws, "mode.changed")
        ws.send_json({"type": "interrupt"})
        ws.send_json({"type": "ack"})

    assert ("set_model", "sonnet") in env.engine.last.calls and ("set_permission_mode", "plan") in env.engine.last.calls
    wait_until(lambda: env.engine.interrupts == 1)


@pytest.mark.asyncio
async def test_an_event_published_while_a_reader_attaches_is_neither_lost_nor_duplicated(tmp_path):
    async with Rig(tmp_path / "chat.db") as rig:
        for n in range(5):
            await rig.hub.publish("system.notice", {"kind": "k", "text": f"old{n}"})

        async def producer():
            for n in range(40):
                await rig.hub.publish("system.notice", {"kind": "k", "text": f"new{n}"})
                await asyncio.sleep(0)

        task = asyncio.ensure_future(producer())
        await asyncio.sleep(0.001)
        reader, cutoff = await rig.hub.add_reader()
        await task

        replay, _, _ = await rig.store.events_since(KEY, 0, 1000)
        replayed = [e["seq"] for e in replay if e["seq"] <= cutoff]
        live = []
        while not reader.queue.empty():
            frame = reader.queue.get_nowait()
            if frame["seq"] > cutoff:
                live.append(frame["seq"])

    assert replayed + live == list(range(1, 46))
