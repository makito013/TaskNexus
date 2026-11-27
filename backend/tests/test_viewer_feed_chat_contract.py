"""The feed and a CHAT conversation (the scripted `FakeChatEngine`, no SDK, no binary: runs in both venvs).

A chat has no PTY socket, so before the feed an agent's `abrir_no_visualizador` / `publicar_artefato` could
never be `delivered` for it. Now `delivered` is true while a V3 reader is connected and false without one,
and the frame carries the session key of the conversation."""
from __future__ import annotations

import sqlite3

import pytest

# `env` is the fixture of the chat suite (the real app with the scripted engine); imported so it is collected here.
from tests.test_chat_endpoints import PROJECT, env, wait_until  # noqa: F401

CLAUDE_ID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def chat(env, monkeypatch):  # noqa: F811
    """A chat conversation whose `claude_session_id` is known, and a plan file in its project."""
    import app.viewer_api as viewer_api

    monkeypatch.setattr(viewer_api, "_is_loopback_host", lambda host: True)  # the TestClient is not a loopback IP
    (env.tmp_path / PROJECT / "docs").mkdir(parents=True, exist_ok=True)
    (env.tmp_path / PROJECT / "docs" / "plan.md").write_text("# Plan\n", encoding="utf-8")
    (env.tmp_path / PROJECT / "docs" / "notes.md").write_text("# Notes\n", encoding="utf-8")
    key = env.create()
    conn = sqlite3.connect(env.db)
    try:
        conn.execute("UPDATE sessions SET claude_session_id = ? WHERE session_key = ?", (CLAUDE_ID, key))
        conn.commit()
    finally:
        conn.close()
    env.key = key
    return env


def open_hook(chat, path="docs/plan.md", **body):
    response = chat.client.post("/api/hooks/viewer/open", json={"claude_session_id": CLAUDE_ID, "caminho": path, **body})
    assert response.status_code == 200 and response.json()["success"] is True, response.text
    return response.json()


def publish_hook(chat, path="docs/plan.md", **body):
    response = chat.client.post(
        "/api/hooks/artifacts/publish", json={"claude_session_id": CLAUDE_ID, "caminho": path, "abrir": True, **body},
    )
    assert response.status_code == 200 and response.json()["success"] is True, response.text
    return response.json()


def test_the_chat_session_is_a_chat_conversation_the_hook_can_resolve(chat):
    assert chat.sql("SELECT engine FROM sessions WHERE session_key = ?", (chat.key,)) == [("chat",)]
    assert chat.client.get("/api/sessions/active?engine=chat").status_code == 200


def test_abrir_no_visualizador_reaches_a_connected_reader_and_is_delivered(chat):
    with chat.client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}

        body = open_hook(chat, titulo="The plan", linha=3)
        frame = feed.receive_json()

    assert body["delivered"] is True
    assert frame["type"] == "viewer_open"
    assert frame["session_key"] == chat.key
    assert frame["reused"] is False and frame["evicted"] == []
    assert frame["item"] == {**body["item"], "opened_by": "agent"}
    assert frame["item"]["path"] == "docs/plan.md"
    assert frame["item"]["title"] == "The plan" and frame["item"]["line"] == 3


def test_without_a_reader_the_chat_is_not_delivered_but_the_tab_is_stored(chat):
    body = open_hook(chat)

    assert body["delivered"] is False
    items = chat.client.get(f"/api/sessions/{chat.key}/viewer").json()["items"]
    assert [item["path"] for item in items] == ["docs/plan.md"]


def test_delivered_follows_the_reader_that_comes_and_goes(chat):
    assert open_hook(chat, "docs/plan.md")["delivered"] is False

    with chat.client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}
        assert open_hook(chat, "docs/notes.md")["delivered"] is True
        assert feed.receive_json()["item"]["path"] == "docs/notes.md"

    wait_until(lambda: chat.main.viewer_feed.reader_count == 0)
    assert open_hook(chat, "docs/plan.md")["delivered"] is False


def test_publicar_artefato_with_abrir_publishes_the_artifact_and_announces_the_tab(chat):
    with chat.client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}

        body = publish_hook(chat)
        frame = feed.receive_json()

        assert body["opened"] is True and body["delivered"] is True
        assert frame["type"] == "viewer_open" and frame["session_key"] == chat.key
        assert frame["item"]["path"] == "docs/plan.md" and frame["item"]["opened_by"] == "agent"
        # The artifact is stored before the announcement (the V3 reloads the list on the signal).
        listed = chat.client.get("/api/artifacts").json()
        assert [artifact["path"] for artifact in listed["artifacts"]] == ["docs/plan.md"]


def test_publicar_artefato_without_abrir_announces_nothing(chat):
    with chat.client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}

        body = publish_hook(chat, abrir=False)
        assert body["opened"] is False and body["delivered"] is False
        open_hook(chat, "docs/notes.md")
        frame = feed.receive_json()  # the FIRST frame is the one of the later opening

    assert frame["item"]["path"] == "docs/notes.md"


def test_a_user_opening_of_the_chat_is_stored_and_not_announced(chat):
    with chat.client.websocket_connect("/ws/viewer") as feed:
        assert feed.receive_json() == {"type": "ready"}

        user = chat.client.post(f"/api/sessions/{chat.key}/viewer", json={"caminho": "docs/plan.md"}).json()
        assert user["success"] is True and user["delivered"] is False
        open_hook(chat, "docs/notes.md")
        frame = feed.receive_json()

    assert frame["item"]["path"] == "docs/notes.md"
