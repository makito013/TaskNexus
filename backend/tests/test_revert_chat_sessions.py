"""backend/scripts/revert_chat_sessions.py: hand chat conversations back to the PTY."""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.chat.store import ChatStore
from app.conversation_store import ConversationStore

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "revert_chat_sessions.py"

PTY_KEY = "proj::claude"
CHAT_KEY = "proj::claude::abc123"
SWITCHED_KEY = "proj::claude::def456"

# get_all_meta() exactly as c4c5dee ran it: the V2 contract after a rollback.
OLD_GET_ALL_META = (
    "SELECT session_key, display_name, needs_attention, push_notified FROM sessions"
)


def _build_db(db_path: Path, *, owner_pid: int | None = None) -> None:
    async def build() -> None:
        sessions = ConversationStore(db_path=str(db_path))
        await sessions.initialize()
        chat = ChatStore(db_path=str(db_path))
        await chat.initialize()
        try:
            await sessions.set(PTY_KEY, "pty-uuid")
            await sessions.create_if_absent(CHAT_KEY, "chat-uuid", "chat")
            await sessions.rename(CHAT_KEY, "My chat")
            await sessions.create_if_absent(SWITCHED_KEY, "switched-uuid", "pty")
            for key in (CHAT_KEY, SWITCHED_KEY):
                await chat.create_chat_session({
                    "session_key": key, "project_ref": "proj", "agent_id": "claude",
                    "cwd": "C:/work", "runtime_owner_pid": owner_pid if key == CHAT_KEY else None,
                })
            for n in range(3):
                await chat.append_event(CHAT_KEY, "message.user", {"n": n})
            await chat.append_event(SWITCHED_KEY, "message.user", {"n": 99})
            await chat.create_permission({
                "id": "perm-1", "session_key": CHAT_KEY, "kind": "tool", "tool_name": "Write",
            })
        finally:
            await sessions.close()
            await chat.close()

    asyncio.run(build())


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=60
    )


def _rows(db_path: Path, sql: str) -> list[tuple]:
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def _dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


def test_chat_rows_become_pty_and_chat_data_is_archived(tmp_path):
    db_path = tmp_path / "sessions.db"
    archive = tmp_path / "archive.json"
    _build_db(db_path, owner_pid=_dead_pid())  # an orphan row (dead PID) must pass

    result = _run("--db", str(db_path), "--archive", str(archive))

    assert result.returncode == 0, result.stderr
    assert "sessions migradas: 1" in result.stdout
    assert "eventos arquivados: 3" in result.stdout
    assert _rows(db_path, "SELECT engine, claude_session_id FROM sessions WHERE session_key = '%s'" % CHAT_KEY) == [
        ("pty", "chat-uuid")
    ]
    # the V2 of c4c5dee lists the key exactly once, with its name intact
    listed = _rows(db_path, OLD_GET_ALL_META)
    assert [row[0] for row in listed].count(CHAT_KEY) == 1
    assert dict((r[0], r[1]) for r in listed)[CHAT_KEY] == "My chat"
    # chat rows of the migrated key are gone; the switched conversation's log stays
    assert _rows(db_path, "SELECT COUNT(*) FROM chat_events WHERE session_key = '%s'" % CHAT_KEY) == [(0,)]
    assert _rows(db_path, "SELECT COUNT(*) FROM permission_requests") == [(0,)]
    assert _rows(db_path, "SELECT session_key FROM chat_sessions") == [(SWITCHED_KEY,)]
    assert _rows(db_path, "SELECT COUNT(*) FROM chat_events WHERE session_key = '%s'" % SWITCHED_KEY) == [(1,)]
    # the archive holds what was removed
    data = json.loads(archive.read_text(encoding="utf-8"))
    assert data["session_keys"] == [CHAT_KEY]
    assert [e["seq"] for e in data["chat_events"]] == [1, 2, 3]
    assert [p["id"] for p in data["permission_requests"]] == ["perm-1"]
    assert [s["session_key"] for s in data["chat_sessions"]] == [CHAT_KEY]


def test_second_run_reports_zeros_and_changes_nothing(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    _run("--db", str(db_path), "--archive", str(tmp_path / "first.json"))
    before = _rows(db_path, "SELECT * FROM sessions ORDER BY session_key")

    second = _run("--db", str(db_path), "--archive", str(tmp_path / "second.json"))

    assert second.returncode == 0
    assert "sessions migradas: 0" in second.stdout and "eventos arquivados: 0" in second.stdout
    assert _rows(db_path, "SELECT * FROM sessions ORDER BY session_key") == before
    assert not (tmp_path / "second.json").exists()


def test_dry_run_changes_and_writes_nothing(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    before = _rows(db_path, "SELECT session_key, engine FROM sessions ORDER BY session_key")

    result = _run("--db", str(db_path), "--dry-run")

    assert result.returncode == 0
    assert "[dry-run] sessions migradas: 1" in result.stdout
    assert _rows(db_path, "SELECT session_key, engine FROM sessions ORDER BY session_key") == before
    assert _rows(db_path, "SELECT COUNT(*) FROM chat_events") == [(4,)]
    assert list(tmp_path.glob("*.json")) == []


def test_default_archive_sits_next_to_the_database(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)

    assert _run("--db", str(db_path)).returncode == 0

    assert len(list(tmp_path.glob("sessions.db.chat-archive-*.json"))) == 1


def test_database_without_the_engine_column_exits_zero_and_is_untouched(tmp_path):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE sessions (session_key TEXT PRIMARY KEY, claude_session_id TEXT NOT NULL)")
    conn.execute("INSERT INTO sessions VALUES ('k', 'id')")
    conn.commit()
    conn.close()

    result = _run("--db", str(db_path))

    assert result.returncode == 0
    assert _rows(db_path, "SELECT * FROM sessions") == [("k", "id")]


def test_live_runtime_owner_refuses_with_exit_two_and_changes_nothing(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path, owner_pid=os.getpid())  # this very process is alive
    before = _rows(db_path, "SELECT session_key, engine FROM sessions ORDER BY session_key")

    result = _run("--db", str(db_path))

    assert result.returncode == 2
    assert str(os.getpid()) in result.stderr
    assert _rows(db_path, "SELECT session_key, engine FROM sessions ORDER BY session_key") == before
    assert _rows(db_path, "SELECT COUNT(*) FROM chat_events") == [(4,)]
    assert list(tmp_path.glob("*.json")) == []


def test_missing_database_is_an_error(tmp_path):
    result = _run("--db", str(tmp_path / "nope.db"))

    assert result.returncode == 1
    assert not (tmp_path / "nope.db").exists()


def test_script_imports_nothing_from_the_app():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "import app" not in text and "from app" not in text


def test_archive_equal_to_the_database_is_refused_and_the_database_survives(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    before = db_path.read_bytes()

    result = _run("--db", str(db_path), "--archive", str(db_path))

    assert result.returncode == 1
    assert "must not be the database" in result.stderr
    assert db_path.read_bytes() == before
    assert _rows(db_path, "SELECT engine FROM sessions WHERE session_key = 'proj::claude::abc123'") == [("chat",)]


@pytest.mark.parametrize("suffix", ["-wal", "-shm"])
def test_archive_equal_to_a_wal_or_shm_side_file_is_refused(tmp_path, suffix):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    side_file = Path(f"{db_path}{suffix}")

    result = _run("--db", str(db_path), "--archive", str(side_file))

    # SQLite owns these files (it may create or remove them), so the proof is the refusal
    # and an untouched database, not the bytes of the side file.
    assert result.returncode == 1
    assert "must not be the database" in result.stderr
    assert _rows(db_path, "SELECT engine FROM sessions WHERE session_key = 'proj::claude::abc123'") == [("chat",)]


def test_an_existing_archive_file_is_never_overwritten(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    archive = tmp_path / "archive.json"
    archive.write_text("precious", encoding="utf-8")

    result = _run("--db", str(db_path), "--archive", str(archive))

    assert result.returncode == 1
    assert "already exists" in result.stderr
    assert archive.read_text(encoding="utf-8") == "precious"
    # Nothing was changed either: the rows that would have been archived are still there.
    assert _rows(db_path, "SELECT engine FROM sessions WHERE session_key = 'proj::claude::abc123'") == [("chat",)]
    assert _rows(db_path, "SELECT COUNT(*) FROM chat_events")[0][0] == 4


def test_archive_given_through_a_different_spelling_of_the_database_path_is_refused(tmp_path):
    db_path = tmp_path / "sessions.db"
    _build_db(db_path)
    sneaky = tmp_path / "." / "sessions.db"

    result = _run("--db", str(db_path), "--archive", str(sneaky))

    assert result.returncode == 1
    assert "must not be the database" in result.stderr
