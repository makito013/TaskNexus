"""`WS /ws/viewer` on the real app: the handshake behind the origin guard, delivery of what an agent opens, the
PTY notice that must not change, and the limits. The queue and route logic is in test_viewer_feed.py."""
from __future__ import annotations

import json
import sys
import time
import uuid as uuid_mod
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

import pytest
from starlette.websockets import WebSocketDisconnect

from app.viewer_feed import MAX_READERS, WS_TOO_MANY
from tests.test_request_guard_app import ATTACKS, LOOPBACK, POLICY_CLOSE, _close_code, booted

SK = "meu-projeto::claude"
PTY_VOLATILE = {"item_id", "updated_at", "created_at", "path", "title"}


@pytest.fixture
def booted_app(tmp_path, monkeypatch):
    import app.viewer_api as viewer_api

    monkeypatch.setattr(viewer_api, "_is_loopback_host", lambda host: True)  # the TestClient is not a loopback IP
    docs = tmp_path / "meu-projeto" / "docs"
    docs.mkdir(parents=True)
    for name in ("a", "b", "c"):
        (docs / f"{name}.md").write_text(f"# {name}\n", encoding="utf-8")
    with booted(tmp_path, monkeypatch) as pair:
        yield pair


def poll(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


@contextmanager
def idle_pty(client, main_mod, fixed_uuid):
    """A PTY socket open on `SK` whose process prints nothing, so the only text frame is the `viewer_open`."""
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with ExitStack() as stack:
        stack.enter_context(patch("app.main._build_pty_cmd", return_value=fake_cmd))
        stack.enter_context(patch("app.main.uuid.uuid4", return_value=fixed_uuid))
        ws = stack.enter_context(client.websocket_connect(f"/ws/pty/{SK}"))
        ws.send_text(json.dumps({"type": "init", "project_id": "meu-projeto", "agent_id": None, "cols": 80, "rows": 24}))
        assert poll(lambda: SK in main_mod.pty_manager.active_sessions())
        yield ws


def next_pty_text(ws):
    while True:
        message = ws.receive()
        if message.get("text") is not None:
            return json.loads(message["text"])


def agent_opens(client, claude_session_id, path):
    response = client.post("/api/hooks/viewer/open", json={"claude_session_id": claude_session_id, "caminho": path})
    assert response.status_code == 200 and response.json()["success"] is True, response.text
    return response.json()


def stripped(item):
    return {key: value for key, value in item.items() if key not in PTY_VOLATILE}


# -- the handshake -------------------------------------------------------------------------------------


def test_the_first_frame_is_ready_and_leaving_frees_the_reader(booted_app):
    main_mod, client = booted_app

    with client.websocket_connect("/ws/viewer") as ws:
        assert ws.receive_json() == {"type": "ready"}
        assert poll(lambda: main_mod.viewer_feed.reader_count == 1)

    assert poll(lambda: main_mod.viewer_feed.reader_count == 0)


def test_the_route_is_registered_before_the_spa_catch_all(booted_app):
    main_mod, _ = booted_app
    paths = [getattr(route, "path", None) for route in main_mod.app.routes]

    assert "/{full_path:path}" in paths
    assert paths.index("/ws/viewer") < paths.index("/{full_path:path}")


@pytest.mark.parametrize("attack", sorted(ATTACKS))
def test_a_hostile_origin_null_origin_or_rebinding_host_is_closed_with_1008(booted_app, attack):
    main_mod, client = booted_app

    assert _close_code(client, "/ws/viewer", dict(ATTACKS[attack])) == POLICY_CLOSE == 1008
    assert main_mod.viewer_feed.reader_count == 0


def test_the_same_origin_and_a_client_without_origin_connect(booted_app):
    _, client = booted_app

    for headers in ({"Host": LOOPBACK}, {"Host": LOOPBACK, "Origin": "http://" + LOOPBACK}):
        with client.websocket_connect("/ws/viewer", headers=dict(headers)) as ws:
            assert ws.receive_json() == {"type": "ready"}


def test_what_a_talkative_client_sends_is_ignored(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        feed.send_text(json.dumps({"type": "viewer_open", "session_key": SK}))
        feed.send_bytes(b"\x00\x01\x02")
        feed.send_text("not json")
        with idle_pty(client, main_mod, fixed):
            agent_opens(client, str(fixed), "docs/a.md")
        frame = feed.receive_json()

    assert frame["type"] == "viewer_open" and frame["item"]["path"] == "docs/a.md"


def test_the_33rd_reader_is_closed_with_4429_without_a_ready(booted_app):
    main_mod, client = booted_app

    with ExitStack() as stack:
        for _ in range(MAX_READERS):
            assert stack.enter_context(client.websocket_connect("/ws/viewer")).receive_json() == {"type": "ready"}
        assert main_mod.viewer_feed.reader_count == MAX_READERS

        with pytest.raises(WebSocketDisconnect) as refused:
            with client.websocket_connect("/ws/viewer") as extra:
                extra.receive_json()
        assert refused.value.code == WS_TOO_MANY == 4429
        assert main_mod.viewer_feed.reader_count == MAX_READERS

    assert poll(lambda: main_mod.viewer_feed.reader_count == 0)


# -- delivery ------------------------------------------------------------------------------------------


def test_an_agent_opening_reaches_the_feed_as_a_viewer_open_frame_of_the_agent(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        with idle_pty(client, main_mod, fixed):
            body = agent_opens(client, str(fixed), "docs/a.md")
        frame = feed.receive_json()

    assert frame["type"] == "viewer_open"
    assert frame["session_key"] == SK
    assert frame["reused"] is False and frame["evicted"] == []
    assert frame["item"] == {**body["item"], "opened_by": "agent"}
    assert frame["item"]["path"] == "docs/a.md"


def test_a_reused_tab_is_announced_as_the_agent_even_when_the_user_opened_it_first(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        with idle_pty(client, main_mod, fixed):
            first = client.post(f"/api/sessions/{SK}/viewer", json={"caminho": "docs/a.md"}).json()
            assert first["item"]["opened_by"] == "user"
            again = agent_opens(client, str(fixed), "docs/a.md")
        frame = feed.receive_json()

    assert again["reused"] is True and again["item"]["opened_by"] == "user"  # the row keeps the first opener
    assert frame["reused"] is True and frame["item"]["opened_by"] == "agent"  # the frame is a copy
    assert client.get(f"/api/sessions/{SK}/viewer").json()["items"][0]["opened_by"] == "user"


def test_a_user_opening_publishes_nothing_to_the_feed(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        with idle_pty(client, main_mod, fixed):
            user = client.post(f"/api/sessions/{SK}/viewer", json={"caminho": "docs/a.md"}).json()
            agent_opens(client, str(fixed), "docs/b.md")
        frame = feed.receive_json()  # the FIRST frame the feed gets is the agent's, not the user's

    assert user["success"] is True
    assert frame["item"]["path"] == "docs/b.md"


def test_the_pty_frame_and_delivered_are_the_same_with_the_feed_connected_and_without(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with idle_pty(client, main_mod, fixed) as pty:
        without_feed = agent_opens(client, str(fixed), "docs/a.md")
        pty_without = next_pty_text(pty)

        with client.websocket_connect("/ws/viewer") as feed:
            assert feed.receive_json() == {"type": "ready"}
            with_feed = agent_opens(client, str(fixed), "docs/b.md")
            pty_with = next_pty_text(pty)
            feed_frame = feed.receive_json()

    assert without_feed["delivered"] is True and with_feed["delivered"] is True
    assert pty_without["type"] == pty_with["type"] == "viewer_open"
    assert set(pty_without) == set(pty_with) == {"type", "item", "reused", "evicted"}
    assert pty_without["reused"] is pty_with["reused"] is False
    assert pty_without["evicted"] == pty_with["evicted"] == []
    assert stripped(pty_without["item"]) == stripped(pty_with["item"])
    assert pty_with["item"] == with_feed["item"]  # what the PTY gets is what the response carries
    assert feed_frame["item"] == pty_with["item"]  # and the feed carries the same item


def test_a_pty_session_without_a_terminal_open_is_not_delivered_even_with_a_feed(booted_app):
    main_mod, client = booted_app
    fixed = uuid_mod.uuid4()

    with idle_pty(client, main_mod, fixed):
        pass  # registers the session, then the PTY socket closes
    with client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        body = agent_opens(client, str(fixed), "docs/a.md")
        frame = feed.receive_json()

    assert body["delivered"] is False  # only a chat conversation can be delivered by the feed
    assert frame["item"]["path"] == "docs/a.md"  # but the file is announced for any conversation
