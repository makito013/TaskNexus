"""ChatRuntime (ADR-39): one owner task, a command inbox, durable ordered events, approvals."""
from __future__ import annotations

import asyncio
import os

import pytest

from app.chat.engine import ConnectorPolicy, ResumeFailed, SpawnFailed
from app.chat.runtime import OVERFLOW, ChatCommandError, MAX_READERS, TooManyReaders
from tests.chat_fakes import KEY, SESSION_UUID, Rig, assistant_text, init_message, result_message

pytestmark = pytest.mark.asyncio


@pytest.fixture
def db(tmp_path):
    return tmp_path / "chat.db"


async def test_only_the_owner_task_ever_calls_the_process(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: not runtime.turn_running)
        await runtime.submit("set_model", model="sonnet")
        await runtime.submit("set_permission_mode", mode="plan")
        await runtime.submit("interrupt")
        await runtime.close("terminated")

    assert rig.engine.violations == []
    assert [c[0] for c in rig.engine.last.calls] == ["query", "set_model", "set_permission_mode", "interrupt", "close"]


async def test_the_user_message_is_in_the_log_before_the_query_goes_out(db):
    seen_at_query = []

    async with Rig(db) as rig:
        async def on_query(process, text):
            seen_at_query.append(await rig.kinds())

        rig.engine.on_query = on_query
        runtime = await rig.start()
        await runtime.submit("send", text="hello", client_msg_id="c1")

    assert seen_at_query == [["message.user"]]
    event = (await rig.events("message.user"))[0]
    assert event["payload"] == {"client_msg_id": "c1", "text": "hello", "origin": "ui"}


async def test_a_turn_produces_gapless_events_and_a_live_delta(db):
    async with Rig(db) as rig:
        reader, _ = await rig.hub.add_reader()
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: not runtime.turn_running)
        process = rig.engine.last
        process.push(init_message(SESSION_UUID))
        process.push(__import__("app.chat.engine", fromlist=["EngineMessage"]).EngineMessage(
            kind="text_delta", message_id="m", text="x"))
        await asyncio.sleep(0.05)

        events, last_seq, _ = await rig.store.events_since(KEY, 0, 100)

    assert [e["seq"] for e in events] == list(range(1, len(events) + 1)) and last_seq == len(events)
    assert [e["kind"] for e in events][:4] == ["message.user", "session.started", "message.assistant", "turn.ended"]
    assert all(e["kind"] != "message.delta" for e in events)
    frames = []
    while not reader.queue.empty():
        frames.append(reader.queue.get_nowait())
    assert any(f["type"] == "message.delta" and f["seq"] is None for f in frames)


async def test_two_readers_get_the_same_frames_and_a_slow_one_does_not_hold_the_other(db):
    async with Rig(db) as rig:
        fast, _ = await rig.hub.add_reader()
        slow, _ = await rig.hub.add_reader()
        # Fill the slow reader's queue; the fast one is drained as we go.
        for n in range(1100):
            await rig.hub.publish("system.notice", {"kind": "k", "text": str(n)})
            while not fast.queue.empty():
                fast.queue.get_nowait()
        remaining = []
        while not slow.queue.empty():
            remaining.append(slow.queue.get_nowait())

    assert remaining == [OVERFLOW]
    # the publisher never waited, and the log has everything
    assert (await rig.store.events_since(KEY, 0, 1))[1] == 1100


async def test_the_seventeenth_reader_is_refused(db):
    async with Rig(db) as rig:
        for _ in range(MAX_READERS):
            await rig.hub.add_reader()
        with pytest.raises(TooManyReaders):
            await rig.hub.add_reader()


async def test_interrupt_is_served_while_a_turn_is_still_running(db):
    async with Rig(db) as rig:
        async def long_turn(process, text):
            process.push(init_message(process.session_id))  # the turn never finishes by itself

        rig.engine.on_query = long_turn
        runtime = await rig.start()
        await runtime.submit("send", text="count to 300")
        assert runtime.turn_running

        await asyncio.wait_for(runtime.submit("interrupt"), 2)
        await rig.wait_for(lambda: not runtime.turn_running)

    ended = (await rig.events("turn.ended"))[0]["payload"]
    assert ended["subtype"] == "error_during_execution" and rig.engine.interrupts == 1


async def test_a_permission_request_waits_and_the_first_decision_wins(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {"file_path": "a.txt"})
        await rig.wait_for(lambda: rig.pending_calls)
        pid = next(iter(runtime.pending))
        assert (await rig.store.get_permission(pid))["status"] == "pending"
        assert rig.pending_calls == [KEY]
        request = (await rig.events("permission.request"))[0]["payload"]
        assert request["id"] == pid and request["kind"] == "tool" and request["allow_session"] is True

        status = await runtime.decide(pid, behavior="allow", by="rest")
        with pytest.raises(ChatCommandError) as second:
            await runtime.decide(pid, behavior="deny", by="ws")
        result = await asyncio.wait_for(waiting, 2)
        await rig.wait_for(lambda: rig.all_decided)

    assert status == "allowed" and result.behavior == "allow"
    assert second.value.code == "already_decided"
    resolved = (await rig.events("permission.resolved"))
    assert len(resolved) == 1 and resolved[0]["payload"]["by"] == "rest"
    assert rig.all_decided == [KEY]


async def test_a_decision_for_an_unknown_or_foreign_permission_is_not_found(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        other_key = "other::claude::zzz"
        await rig.store.create_chat_session({
            "session_key": other_key, "project_ref": "other", "agent_id": "claude", "cwd": "C:/x"})
        await rig.store.create_permission({
            "id": "foreign-id", "session_key": other_key, "tool_use_id": None, "kind": "tool",
            "tool_name": "Write", "input": {}, "suggestions": [], "connector": None})
        with pytest.raises(ChatCommandError) as unknown:
            await runtime.decide("nope", behavior="allow")
        # the id exists, but it belongs to another conversation: this runtime cannot decide it
        with pytest.raises(ChatCommandError) as foreign:
            await runtime.decide("foreign-id", behavior="allow", scope="session")
        foreign_row = await rig.store.get_permission("foreign-id")
        assert await rig.store.get_permission(pid, other_key) is None
        await runtime.decide(pid, behavior="deny", by="ws")
        await waiting

    assert unknown.value.code == "permission_not_found"
    assert foreign.value.code == "permission_not_found"
    assert foreign_row["status"] == "pending" and foreign_row["session_key"] == other_key


async def test_losing_the_decision_race_to_a_close_reports_expired_not_already_decided(db):
    """N6: `close` cancels the row between the read and the write of `decide`; the loser must
    get `permission_expired` (410), because the winner was the close, not another decision."""
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        real_decide = rig.store.decide_permission

        async def close_wins(*args, **kwargs):
            await rig.store.close_pending(KEY, "cancelled")  # the close lands first
            return await real_decide(*args, **kwargs)

        rig.store.decide_permission = close_wins
        with pytest.raises(ChatCommandError) as lost:
            await runtime.decide(pid, behavior="allow", by="rest")
        rig.store.decide_permission = real_decide
        row = await rig.store.get_permission(pid)
        await runtime.close("terminated")
        await waiting

    assert lost.value.code == "permission_expired"
    assert row["status"] == "cancelled"


async def test_losing_the_decision_race_to_another_decision_still_reports_already_decided(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        real_decide = rig.store.decide_permission

        async def other_wins(*args, **kwargs):
            await real_decide(pid, "denied", {"behavior": "deny"}, "ws")
            return await real_decide(*args, **kwargs)

        rig.store.decide_permission = other_wins
        with pytest.raises(ChatCommandError) as lost:
            await runtime.decide(pid, behavior="allow", by="rest")
        rig.store.decide_permission = real_decide
        await runtime.close("terminated")
        await waiting

    assert lost.value.code == "already_decided"


async def test_scope_session_is_refused_for_a_connector_tool(db):
    policy = ConnectorPolicy(allowed=("claude.ai Claude Docs",), known=(
        {"name": "claude.ai Claude Docs", "tool_prefix": "mcp__claude_ai_Claude_Docs__"},))
    async with Rig(db, connector_policy=policy) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("mcp__claude_ai_Claude_Docs__guide", {})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        request = (await rig.events("permission.request"))[0]["payload"]
        with pytest.raises(ChatCommandError) as refused:
            await runtime.decide(pid, behavior="allow", scope="session")
        await runtime.decide(pid, behavior="allow", scope="once")
        await waiting

    assert request["connector"] == "claude.ai Claude Docs" and request["allow_session"] is False
    assert refused.value.code == "scope_not_allowed"


async def test_scope_session_is_refused_for_bash_and_the_request_stays_pending_and_decidable(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Bash", {"command": "echo ok > C:/tmp/x.txt"})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        request = (await rig.events("permission.request"))[0]["payload"]
        with pytest.raises(ChatCommandError) as refused:
            await runtime.decide(pid, behavior="allow", scope="session")
        still_pending = (await rig.store.get_permission(pid))["status"]
        status = await runtime.decide(pid, behavior="allow", scope="once")
        result = await waiting

    assert request["allow_session"] is False
    assert refused.value.code == "scope_not_allowed" and still_pending == "pending"
    assert status == "allowed" and result.behavior == "allow" and result.updated_permissions == []


async def test_the_card_hides_allow_for_the_conversation_when_the_cli_suggestion_has_rule_content(db):
    suggestions = [{"type": "addRules", "rules": [{"toolName": "WebFetch", "ruleContent": "domain:example.com"}],
                    "behavior": "allow", "destination": "session"}]
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("WebFetch", {"url": "https://example.com"}, suggestions)
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        request = (await rig.events("permission.request"))[0]["payload"]
        with pytest.raises(ChatCommandError) as refused:
            await runtime.decide(pid, behavior="allow", scope="session")
        await runtime.decide(pid, behavior="deny")
        await waiting

    assert request["allow_session"] is False and request["suggestions_available"] is True
    assert refused.value.code == "scope_not_allowed"


async def test_edit_keeps_allow_for_the_conversation_with_a_session_rule_without_content(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Edit", {"file_path": "C:/tmp/x.txt"})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        request = (await rig.events("permission.request"))[0]["payload"]
        await runtime.decide(pid, behavior="allow", scope="session")
        result = await waiting

    assert request["allow_session"] is True
    assert result.updated_permissions[0]["rules"] == [{"toolName": "Edit", "ruleContent": None}]
    assert result.updated_permissions[0]["destination"] == "session"


async def test_closing_with_a_pending_approval_cancels_it_in_the_database_before_the_future(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {"file_path": "a"})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        status_when_told = []

        async def observe():
            decision = await waiting
            status_when_told.append((await rig.store.get_permission(pid))["status"])
            return decision

        observer = asyncio.ensure_future(observe())
        await runtime.close("terminated")
        decision = await asyncio.wait_for(observer, 2)

    assert status_when_told == ["cancelled"]
    assert (decision.behavior, decision.message, decision.interrupt) == ("deny", "cancelled", True)
    resolved = (await rig.events("permission.resolved"))[0]["payload"]
    assert resolved["status"] == "cancelled" and resolved["by"] == "system"


async def test_closing_for_idleness_expires_the_pending_approval(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        rig.engine.last.ask_permission("Write", {})
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        await runtime.close("expired")

    assert (await rig.store.get_permission(pid))["status"] == "expired"


async def test_a_cancelled_decision_with_the_commit_in_flight_still_resolves_the_future(db):
    """O13 end to end, real commit: the caller is cancelled right after the commit was
    dispatched; the decision is on disk, so the waiting future is resolved and announced."""
    async with Rig(db) as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission("Write", {"file_path": "a"})
        await rig.wait_for(lambda: rig.pending_calls)  # the request is fully published
        pid = next(iter(runtime.pending))

        real_commit = rig.store._conn.commit
        dispatched = asyncio.Event()

        async def spy():
            dispatched.set()
            await real_commit()

        rig.store._conn.commit = spy
        try:
            decider = asyncio.ensure_future(runtime.decide(pid, behavior="allow", by="ws"))
            await asyncio.wait_for(dispatched.wait(), 2)
            decider.cancel()
            await asyncio.gather(decider, return_exceptions=True)
        finally:
            rig.store._conn.commit = real_commit

        result = await asyncio.wait_for(waiting, 2)
        await rig.wait_for(lambda: rig.all_decided)

    assert result.behavior == "allow"
    assert (await rig.store.get_permission(pid))["status"] == "allowed"
    assert len(await rig.events("permission.resolved")) == 1


async def test_stop_hook_reaches_the_service(db):
    async with Rig(db) as rig:
        await rig.start()
        await rig.engine.last.fire_stop()

    assert [key for key, _ in rig.stops] == [KEY]


async def test_the_owner_pid_is_written_when_the_process_is_up_and_cleared_when_it_ends(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        up = await rig.store.get_chat_session(KEY)
        await runtime.close("terminated")
        down = await rig.store.get_chat_session(KEY)

    assert up["runtime_owner_pid"] == os.getpid() and up["status"] == "idle"
    assert down["runtime_owner_pid"] is None and down["status"] == "stopped"
    assert rig.closed == [KEY]
    status = (await rig.events("status"))[-1]["payload"]
    assert status == {"code": "closed", "reason": "terminated"}


async def test_a_process_that_dies_by_itself_ends_the_runtime_cleanly(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        rig.engine.last.die()
        await rig.wait_for(lambda: rig.closed)

    assert (await rig.store.get_chat_session(KEY))["runtime_owner_pid"] is None
    assert (await rig.events("status"))[-1]["payload"]["reason"] == "process_exit"
    with pytest.raises(ChatCommandError):
        await runtime.submit("send", text="late")


async def test_new_session_id_is_reported_to_the_service_and_logged(db):
    other = "22222222-2222-4222-8222-222222222222"
    async with Rig(db) as rig:
        runtime = await rig.start()
        await runtime.submit("send", text="hello")
        await rig.wait_for(lambda: not runtime.turn_running)
        rig.engine.last.push(init_message(other))
        await rig.wait_for(lambda: rig.id_changes)

    assert rig.id_changes == [(KEY, SESSION_UUID, other)]
    assert (await rig.events("session.id_changed"))[0]["payload"] == {"previous": SESSION_UUID, "current": other}


@pytest.mark.parametrize("text", ["", "x" * 100_001], ids=["empty", "too-long"])
async def test_send_text_outside_the_limits_is_rejected_and_not_logged(db, text):
    async with Rig(db) as rig:
        runtime = await rig.start()
        with pytest.raises(ChatCommandError) as refused:
            await runtime.submit("send", text=text)

    assert refused.value.code == "invalid_frame"
    assert await rig.events("message.user") == [] and rig.engine.last.queries == []


async def test_a_model_that_looks_like_an_option_is_refused_before_the_process(db):
    async with Rig(db) as rig:
        runtime = await rig.start()
        with pytest.raises(ChatCommandError) as refused:
            await runtime.submit("set_model", model="--mcp-config=evil")
        with pytest.raises(ChatCommandError) as mode:
            await runtime.submit("set_permission_mode", mode="bypassPermissions")

    assert refused.value.code == "model_not_allowed" and mode.value.code == "mode_not_allowed"
    assert rig.engine.last.calls == [("close",)]


# -- spawning --------------------------------------------------------------------------------------------


async def test_spawn_failure_reaches_the_starter_and_leaves_nothing_running(db):
    async with Rig(db) as rig:
        rig.engine.fail_with = SpawnFailed("process_error", "boom")
        with pytest.raises(SpawnFailed):
            await rig.start()

    assert rig.runtime.alive is False and rig.closed == [KEY]
    assert (await rig.store.get_chat_session(KEY))["runtime_owner_pid"] is None


async def test_a_spawn_that_never_connects_times_out_as_process_error(db):
    async with Rig(db, connect_timeout=0.2) as rig:
        rig.engine.hang = True
        with pytest.raises(SpawnFailed) as failure:
            await rig.start()

    assert failure.value.reason == "process_error"


async def test_a_resume_that_never_connects_times_out_as_resume_failed(db):
    async with Rig(db, resume=SESSION_UUID, connect_timeout=0.2) as rig:
        rig.engine.hang = True
        with pytest.raises(ResumeFailed):
            await rig.start()


async def test_connectors_still_loaded_before_the_first_query_close_the_process(db):
    async with Rig(db) as rig:
        rig.engine.mcp_status = {"mcpServers": [
            {"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "pending"}]}
        with pytest.raises(SpawnFailed) as failure:
            await rig.start()

    assert failure.value.reason == "connector_exposed"
    assert rig.engine.last.closed and rig.engine.last.queries == []


async def test_connector_tools_in_the_init_close_the_process_and_say_so(db):
    async with Rig(db) as rig:
        async def exposed_init(process, text):
            process.push(init_message(process.session_id, tools=["Read", "mcp__claude_ai_Google_Drive__search_files"]))

        rig.engine.on_query = exposed_init
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: rig.closed)

    status = [e["payload"] for e in await rig.events("status")]
    assert status[0]["code"] == "spawn_failed" and status[0]["reason"] == "connector_exposed"
    assert rig.engine.last.closed
    assert (await rig.store.get_chat_session(KEY))["status"] == "failed"


async def test_with_an_allowlist_the_first_query_waits_for_the_connectors_to_leave_pending(db):
    policy = ConnectorPolicy(allowed=("claude.ai Claude Docs",), known=(
        {"name": "claude.ai Claude Docs", "tool_prefix": "mcp__claude_ai_Claude_Docs__"},))
    polls = []
    async with Rig(db, connector_policy=policy) as rig:
        states = iter(["pending", "pending", "connected"])

        class Engine(type(rig.engine)):
            async def spawn(self, spec, callbacks):
                process = await super().spawn(spec, callbacks)

                async def get_mcp_status():
                    state = next(states, "connected")
                    polls.append(state)
                    return {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": state}]}

                process.get_mcp_status = get_mcp_status
                return process

        rig.engine.__class__ = Engine
        runtime = await rig.start()

    assert polls[:3] == ["pending", "pending", "connected"] and runtime is not None


# -- rework of the 1b review (B1, B7, B8, L1#8) ------------------------------------------------------------


async def test_clear_as_the_first_message_of_a_resumed_process_moves_the_stored_id(db):
    """B1: the very first `init` of the process already carries the new id."""
    async with Rig(db, resume=SESSION_UUID) as rig:
        runtime = await rig.start()
        await runtime.submit("send", text="/clear")
        await rig.wait_for(lambda: not runtime.turn_running)

    new_id = rig.engine.last.session_id
    assert new_id != SESSION_UUID
    assert rig.id_changes == [(KEY, SESSION_UUID, new_id)]
    kinds = await rig.kinds()
    assert kinds.index("session.resumed") < kinds.index("session.id_changed")


async def test_every_live_state_frame_has_the_full_shape_and_the_current_values(db):
    """B7: one producer; `set_permission_mode` and `set_model` are reflected, `turn` is idle at rest."""
    full = {"engine", "process", "turn", "model", "permission_mode", "cwd", "add_dirs",
            "pending_permissions", "status", "last_error", "last_seq"}
    async with Rig(db, model="haiku") as rig:
        reader, _ = await rig.hub.add_reader()
        runtime = await rig.start()
        await runtime.submit("set_permission_mode", mode="plan")
        await runtime.submit("set_model", model="sonnet")
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: not runtime.turn_running)
        frames = []

        def drain():
            while not reader.queue.empty():
                frame = reader.queue.get_nowait()
                if frame["type"] == "session.state":
                    frames.append(frame)
            return frames and frames[-1]["turn"] == "idle"

        await rig.wait_for(drain)

    assert frames and all(full <= set(frame) for frame in frames)
    assert frames[-1]["permission_mode"] == "plan" and frames[-1]["model"] == "sonnet"
    assert frames[-1]["turn"] == "idle" and frames[-1]["process"] == "running"
    assert any(f["turn"] == "running" for f in frames)


async def test_a_process_that_dies_mid_turn_sends_a_last_state_that_is_stopped_and_idle(db):
    async with Rig(db) as rig:
        reader, _ = await rig.hub.add_reader()

        async def hang(process, text):
            return None

        rig.engine.on_query = hang
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        rig.engine.last.die()
        await rig.wait_for(lambda: not runtime.alive)
        await rig.wait_for(lambda: rig.closed)
        states = []
        while not reader.queue.empty():
            frame = reader.queue.get_nowait()
            if frame["type"] == "session.state":
                states.append(frame)

    assert states[-1]["process"] == "stopped" and states[-1]["turn"] == "idle"
    assert states[-1]["status"] == "stopped"


async def test_set_model_is_answered_without_an_init_and_the_next_turn_announces_it(db):
    async with Rig(db, model="haiku") as rig:
        runtime = await rig.start()
        await runtime.submit("send", text="one")
        await rig.wait_for(lambda: not runtime.turn_running)
        await runtime.submit("set_model", model="sonnet")
        assert await rig.events("model.changed") == []
        await runtime.submit("send", text="two")
        await rig.wait_for(lambda: not runtime.turn_running)

    assert [e["payload"]["model"] for e in await rig.events("model.changed")] == ["sonnet"]


async def test_an_approval_the_cli_withdraws_is_closed_announced_and_acked(db):
    """B8: the CLI cancels the `can_use_tool` task (the other parallel call after an interrupt)."""
    async with Rig(db) as rig:
        runtime = await rig.start()
        process = rig.engine.last
        first = process.ask_permission("Read", {"file_path": "C:/a"}, tool_use_id="t1")
        second = process.ask_permission("Read", {"file_path": "C:/b"}, tool_use_id="t2")
        await rig.wait_for(lambda: len(runtime.pending) == 2)
        ids = list(runtime.pending)
        await runtime.decide(ids[0], behavior="deny", interrupt=True)
        process.withdraw_permission(second)
        await rig.wait_for(lambda: not runtime.pending)
        await rig.wait_for(lambda: rig.all_decided)

        rows = {i: (await rig.store.get_permission(i))["status"] for i in ids}
        resolved = [(e["payload"]["id"], e["payload"]["status"]) for e in await rig.events("permission.resolved")]
        assert (await first).behavior == "deny"
        with pytest.raises(asyncio.CancelledError):
            await second

    assert rows[ids[0]] == "denied" and rows[ids[1]] == "cancelled"
    assert (ids[1], "cancelled") in resolved and (ids[0], "denied") in resolved
    assert rig.all_decided == [KEY]


async def test_an_error_after_connect_is_a_failed_start_not_an_unhandled_error(db):
    async with Rig(db) as rig:
        async def broken_status():
            raise RuntimeError("status exploded")

        original = rig.engine.spawn

        async def spawn(spec, callbacks):
            process = await original(spec, callbacks)
            process.get_mcp_status = broken_status
            return process

        rig.engine.spawn = spawn
        with pytest.raises(SpawnFailed) as caught:
            await rig.start()

    assert caught.value.reason == "process_error"
    assert rig.engine.last.closed
