"""A conversation owned by the chat engine never gets a PTY.

`_ensure_pty_locked` refuses (OSError) when `sessions.engine == 'chat'`; the
callers already turn that into `spawn_failed` (/ws/pty) and
`provisioning_failed` (/continue and /paste).
"""
from __future__ import annotations

import importlib
import sqlite3
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

CHAT_KEY = "meu-projeto::abc123"


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    monkeypatch.delenv("HOOK_LOOPBACK_PORT", raising=False)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "BOARD_UPLOADS_ROOT": str(tmp_path / "uploads"),
        "BOARD_ATTACHMENTS_ROOT": str(tmp_path / "attachments"),
        "CLEANUP_DELAY": "0.1",
    }):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            conn = sqlite3.connect(tmp_path / "sessions.db")
            conn.execute(
                "INSERT INTO sessions (session_key, claude_session_id, engine) "
                "VALUES (?, 'cid', 'chat')",
                (CHAT_KEY,),
            )
            conn.commit()
            conn.close()
            yield client, main_mod


def test_websocket_pty_answers_spawn_failed_and_never_spawns_for_a_chat_row(env):
    client, main_mod = env

    with patch.object(main_mod.pty_manager, "spawn") as spawn, \
            patch("app.main.provision_session_id", new=AsyncMock(return_value="x")) as provision:
        with client.websocket_connect(f"/ws/pty/{CHAT_KEY}") as ws:
            ws.send_json({"type": "init", "project_id": "meu-projeto", "agent_id": None,
                          "cols": 80, "rows": 24})
            frame = ws.receive_json()

    assert frame["type"] == "spawn_failed"
    assert "chat engine" in frame["detail"]
    spawn.assert_not_called()
    provision.assert_not_called()


def test_continue_and_paste_report_provisioning_failed_for_a_chat_row(env):
    client, main_mod = env

    with patch.object(main_mod.pty_manager, "spawn") as spawn:
        continued = client.post(f"/api/sessions/{CHAT_KEY}/continue")
        pasted = client.post(f"/api/sessions/{CHAT_KEY}/paste", json={"text": "x"})

    for response in (continued, pasted):
        assert response.status_code == 200
        assert response.json()["status"] == "provisioning_failed"
    spawn.assert_not_called()


# -- O9: the two engines never both own a key (ADR-33/45) ------------------------------------------------------


def _wire_chat(main_mod):
    from app.chat.availability import CliInfo, SdkStatus
    from tests.chat_fakes import FakeChatEngine

    engine = FakeChatEngine()
    service = main_mod.chat_service
    service.engine_factory = lambda: engine
    service.sdk_status = lambda: SdkStatus(True, "0.1.69", None)
    service.cli_resolver = type("R", (), {
        "min_version": "2.1.317", "resolve": lambda self, agent=None: CliInfo("C:/bin/claude.exe", "2.1.317", True)})()
    return engine


def _db_of(client):
    import os
    return os.environ["SESSIONS_DB"]


def test_open_of_a_chat_is_409_while_a_pty_is_alive_and_gather_never_gives_a_key_two_engines(env):
    import asyncio

    client, main_mod = env
    engine = _wire_chat(main_mod)
    conn = sqlite3.connect(_db_of(client))
    conn.execute("INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, created_at, updated_at) "
                 "VALUES (?, 'meu-projeto', 'claude', ?, 1, 1)", (CHAT_KEY, str(main_mod.PROJECTS_ROOT)))
    conn.execute("UPDATE sessions SET claude_session_id = '11111111-1111-4111-8111-111111111111' WHERE session_key = ?",
                 (CHAT_KEY,))
    conn.commit()
    conn.close()
    client.post("/api/agents", json={"id": "claude", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})

    # 1. a PTY alive for the key: the chat refuses
    with patch.object(main_mod.pty_manager, "get", return_value=type("P", (), {"active": True})()):
        refused = client.post(f"/api/chat/sessions/{CHAT_KEY}/open")
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "engine_conflict"

    # 2. both paths at the same time on a chat row: exactly one engine, and it is the chat's
    async def race():
        return await asyncio.gather(
            main_mod.chat_service.ensure_runtime(CHAT_KEY),
            main_mod._ensure_pty(CHAT_KEY, "meu-projeto", "claude", 80, 24),
            return_exceptions=True,
        )

    with patch.object(main_mod.pty_manager, "spawn") as spawn:
        chat_result, pty_result = client.portal.call(race)

    assert engine.spawns == 1 and not isinstance(chat_result, BaseException)
    assert isinstance(pty_result, OSError) and "chat engine" in str(pty_result)
    spawn.assert_not_called()
    client.post(f"/api/chat/sessions/{CHAT_KEY}/close")


def test_gather_on_a_terminal_row_gives_the_pty_and_refuses_the_chat(env):
    import asyncio

    client, main_mod = env
    engine = _wire_chat(main_mod)
    key = "meu-projeto::pty001"
    conn = sqlite3.connect(_db_of(client))
    conn.execute("INSERT INTO sessions (session_key, claude_session_id, engine) VALUES (?, '', 'pty')", (key,))
    conn.execute("INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, created_at, updated_at) "
                 "VALUES (?, 'meu-projeto', 'claude', 'x', 1, 1)", (key,))
    conn.commit()
    conn.close()
    client.post("/api/agents", json={"id": "claude", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})

    async def race():
        return await asyncio.gather(
            main_mod.chat_service.ensure_runtime(key), asyncio.sleep(0), return_exceptions=True,
        )

    chat_result, _ = client.portal.call(race)

    assert engine.spawns == 0
    assert getattr(chat_result, "code", None) == "engine_conflict"
