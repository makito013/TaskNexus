"""`engine` filter on /api/sessions/persisted and /api/sessions/active.

The V2 contract: without the parameter both endpoints answer exactly the bytes
c4c5dee produced for the same rows. The expected bodies live in
`fixtures/v2_sessions_c4c5dee.json`, generated from the OLD code by
`fixtures/gen_v2_sessions_fixture.py` (never written by hand).
"""
from __future__ import annotations

import importlib
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "v2_sessions_c4c5dee.json").read_text(encoding="utf-8")
)
COLUMNS = (
    "session_key",
    "claude_session_id",
    "updated_at",
    "display_name",
    "needs_attention",
    "last_activity_seen_at",
    "push_notified",
)


def _chat_key(pty_key: str) -> str:
    return f"{pty_key}::abc123"


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
            yield client, main_mod, tmp_path / "sessions.db"


def _seed(db_path: Path, *, with_chat_rows: bool) -> None:
    """Insert the fixture rows; chat rows are interleaved between them."""
    marks = ", ".join("?" for _ in COLUMNS)
    conn = sqlite3.connect(db_path)
    for row in FIXTURE["seed_rows"]:
        conn.execute(
            f"INSERT INTO sessions ({', '.join(COLUMNS)}) VALUES ({marks})",
            tuple(row[col] for col in COLUMNS),
        )
        if with_chat_rows:
            conn.execute(
                "INSERT INTO sessions (session_key, claude_session_id, updated_at, "
                "display_name, needs_attention, push_notified, engine) "
                "VALUES (?, ?, ?, ?, 0, 0, 'chat')",
                (_chat_key(row["session_key"]), "", row["updated_at"], f"chat of {row['session_key']}"),
            )
    conn.commit()
    conn.close()


def _fake_pty_manager(main_mod):
    """Same deterministic fake the generator used against the old code."""
    fakes = {
        key: SimpleNamespace(last_activity=float("inf") if mode == "running" else -1e9)
        for key, mode in FIXTURE["active_fakes"].items()
    }
    connected = {
        key: object() for key, mode in FIXTURE["active_fakes"].items() if mode != "disconnected"
    }
    return (
        patch.object(main_mod.pty_manager, "active_sessions", lambda: dict(fakes)),
        patch.dict(main_mod._active_connections, connected),
    )


def test_persisted_without_parameter_is_byte_identical_to_c4c5dee(env):
    client, _main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)

    response = client.get("/api/sessions/persisted")

    assert response.status_code == 200
    assert response.content == FIXTURE["persisted_body"].encode("utf-8")


def test_persisted_is_byte_identical_when_there_are_no_chat_rows(env):
    client, _main_mod, db_path = env
    _seed(db_path, with_chat_rows=False)

    assert client.get("/api/sessions/persisted").content == FIXTURE["persisted_body"].encode("utf-8")


def test_active_without_parameter_is_byte_identical_to_c4c5dee(env):
    client, main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)
    assert FIXTURE["active_body"] != "{}"

    patch_sessions, patch_connections = _fake_pty_manager(main_mod)
    with patch_sessions, patch_connections:
        response = client.get("/api/sessions/active")

    assert response.status_code == 200
    assert response.content == FIXTURE["active_body"].encode("utf-8")


def test_persisted_engine_all_lists_chat_rows_with_their_engine(env):
    client, _main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)

    body = client.get("/api/sessions/persisted", params={"engine": "all"}).json()

    pty_keys = [row["session_key"] for row in FIXTURE["seed_rows"]]
    assert set(body) == set(pty_keys) | {_chat_key(key) for key in pty_keys}
    assert all(body[key]["engine"] == "pty" for key in pty_keys)
    assert all(body[_chat_key(key)]["engine"] == "chat" for key in pty_keys)
    # the V2 fields are still there, unchanged
    first = FIXTURE["seed_rows"][0]
    assert body[first["session_key"]]["display_name"] == first["display_name"]
    assert body[first["session_key"]]["needs_attention"] is True


def test_persisted_engine_chat_lists_only_chat_rows(env):
    client, _main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)

    body = client.get("/api/sessions/persisted", params={"engine": "chat"}).json()

    assert body and all(key.endswith("::abc123") for key in body)
    assert all(entry["engine"] == "chat" for entry in body.values())


def test_persisted_engine_pty_keeps_the_v2_order_and_tags_entries(env):
    client, _main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)

    body = client.get("/api/sessions/persisted", params={"engine": "pty"}).json()

    assert list(body) == [row["session_key"] for row in FIXTURE["seed_rows"]]
    assert all(entry["engine"] == "pty" for entry in body.values())


def test_active_with_engine_tags_the_pty_entries(env):
    client, main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)
    expected = json.loads(FIXTURE["active_body"])

    patch_sessions, patch_connections = _fake_pty_manager(main_mod)
    with patch_sessions, patch_connections:
        for engine in ("pty", "all"):
            body = client.get("/api/sessions/active", params={"engine": engine}).json()
            assert body == {key: {**entry, "engine": "pty"} for key, entry in expected.items()}
        assert client.get("/api/sessions/active", params={"engine": "chat"}).json() == {}


@pytest.mark.parametrize("path", ["/api/sessions/persisted", "/api/sessions/active"])
def test_unknown_engine_value_is_rejected(env, path):
    client, _main_mod, _db_path = env

    assert client.get(path, params={"engine": "bogus"}).status_code == 422


# -- O9: with chat bookkeeping and a LIVE chat runtime around, the V2 bytes do not move ----------------------


def _add_chat_bookkeeping(db_path: Path) -> None:
    """`chat_sessions` rows for every chat row, so the chat tables are not empty."""
    conn = sqlite3.connect(db_path)
    for row in FIXTURE["seed_rows"]:
        conn.execute(
            "INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, status, created_at, updated_at) "
            "VALUES (?, 'proj', 'claude', 'C:/x', 'running', 1, 1)",
            (_chat_key(row["session_key"]),),
        )
    conn.commit()
    conn.close()


def test_v2_bodies_do_not_move_with_chat_sessions_rows_and_a_live_chat_runtime(env):
    client, main_mod, db_path = env
    _seed(db_path, with_chat_rows=True)
    _add_chat_bookkeeping(db_path)
    live_key = _chat_key(FIXTURE["seed_rows"][0]["session_key"])
    runtime = SimpleNamespace(alive=True, pending={}, turn_running=True, idle=False)
    main_mod.chat_manager._runtimes[live_key] = runtime

    patch_sessions, patch_connections = _fake_pty_manager(main_mod)
    try:
        with patch_sessions, patch_connections:
            persisted = client.get("/api/sessions/persisted")
            active = client.get("/api/sessions/active")
            with_chat = client.get("/api/sessions/active?engine=chat")
    finally:
        main_mod.chat_manager._runtimes.clear()

    assert persisted.content == FIXTURE["persisted_body"].encode("utf-8")
    assert active.content == FIXTURE["active_body"].encode("utf-8")
    assert live_key in with_chat.json() and with_chat.json()[live_key]["engine"] == "chat"
