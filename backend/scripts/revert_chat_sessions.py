"""Hand conversations of the V3 chat back to the terminal (PTY) before a rollback.

Run it with the backend STOPPED and BEFORE reverting the code (the script lives
in the version that has the chat; it is stdlib-only and imports nothing from the
app, so it can be run from any checkout):

    backend\\.venv\\Scripts\\python.exe backend\\scripts\\revert_chat_sessions.py ^
        --db backend\\sessions.db [--archive chat-archive.json] [--dry-run]

What it does, in one transaction:
  1. archives the chat rows (chat_sessions, chat_events, permission_requests) of
     every conversation whose `sessions.engine` is 'chat' into a JSON file;
  2. sets `sessions.engine = 'pty'` for them (claude_session_id, display_name,
     needs_attention stay as they are, so the old code resumes them in the PTY);
  3. deletes those chat rows.
chat_commands, chat_models, agent_chat_settings and session_claude_ids are kept
(harmless configuration). It is idempotent: a second run reports zeros.

Exit codes: 0 done (or nothing to do), 2 refused because a chat process is still
alive (runtime_owner_pid), 1 error.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_PROCESS_ALIVE = 2

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259
_ERROR_ACCESS_DENIED = 5

# Tables archived and then cleaned, in deletion order.
_CHAT_TABLES = ("chat_events", "permission_requests", "chat_sessions")


def pid_is_alive(pid: int | None) -> bool:
    """Whether a process with this PID is running.

    On Windows `os.kill(pid, 0)` TERMINATES the process, so it must never be
    used there: OpenProcess/GetExitCodeProcess is the safe probe (exit code 259
    means still active).
    """
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            # Access denied means the process exists but belongs to someone else.
            return ctypes.get_last_error() == _ERROR_ACCESS_DENIED
        try:
            exit_code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return True  # cannot tell: refuse rather than risk it
            return exit_code.value == _STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _marks(values: list) -> str:
    return ", ".join("?" for _ in values)


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(r[1] == column for r in conn.execute(f"PRAGMA table_info({table})"))


def _live_owner_pids(conn: sqlite3.Connection) -> list[tuple[str, int]]:
    if not _table_exists(conn, "chat_sessions"):
        return []
    rows = conn.execute(
        "SELECT session_key, runtime_owner_pid FROM chat_sessions "
        "WHERE runtime_owner_pid IS NOT NULL"
    ).fetchall()
    return [(key, pid) for key, pid in rows if pid_is_alive(pid)]


def _collect(conn: sqlite3.Connection, keys: list[str]) -> dict[str, list[dict]]:
    """Rows of the chat tables that belong to the given session keys."""
    collected: dict[str, list[dict]] = {}
    for table in _CHAT_TABLES:
        collected[table] = []
        if not keys or not _table_exists(conn, table):
            continue
        for start in range(0, len(keys), 500):
            chunk = keys[start:start + 500]
            cursor = conn.execute(
                f"SELECT * FROM {table} WHERE session_key IN ({_marks(chunk)})", chunk
            )
            names = [d[0] for d in cursor.description]
            collected[table].extend(dict(zip(names, row)) for row in cursor.fetchall())
    return collected


def _archive_refusal(db_path: Path, archive_path: Path) -> str | None:
    """Why the archive file cannot be used, or None. It must never be the database
    itself (or its WAL/SHM side files) and never a file that already exists."""
    def normal(path: Path) -> str:
        return os.path.normcase(os.path.realpath(path))

    protected = {normal(db_path)} | {normal(Path(f"{db_path}{suffix}")) for suffix in ("-wal", "-shm")}
    if normal(archive_path) in protected:
        return f"--archive must not be the database or its -wal/-shm files: {archive_path}"
    if os.path.lexists(archive_path):
        return f"--archive already exists, refusing to overwrite it: {archive_path}"
    return None


def revert(db_path: Path, archive_path: Path | None, dry_run: bool) -> int:
    if not db_path.exists():
        print(f"erro: banco nao encontrado: {db_path}", file=sys.stderr)
        return EXIT_ERROR

    conn = sqlite3.connect(db_path, timeout=5, isolation_level=None)
    try:
        if not _table_exists(conn, "sessions") or not _column_exists(conn, "sessions", "engine"):
            print("nada a fazer: o banco nao tem a coluna engine.")
            return EXIT_OK

        alive = _live_owner_pids(conn)
        if alive:
            for key, pid in alive:
                print(f"recusado: {key} tem processo de chat vivo (PID {pid}). "
                      "Pare o backend e rode de novo.", file=sys.stderr)
            return EXIT_PROCESS_ALIVE

        keys = [r[0] for r in conn.execute("SELECT session_key FROM sessions WHERE engine = 'chat'")]
        rows = _collect(conn, keys)

        if keys and not dry_run:
            archive_path = archive_path or db_path.with_name(
                f"{db_path.name}.chat-archive-{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}.json"
            )
            refusal = _archive_refusal(db_path, archive_path)
            if refusal:
                print(f"erro: {refusal}", file=sys.stderr)
                return EXIT_ERROR
            # The archive is on disk before anything is changed. Mode "x": it can never
            # replace a file that is already there (the rows it holds leave the database).
            with open(archive_path, "x", encoding="utf-8") as archive_file:
                archive_file.write(
                    json.dumps({"session_keys": keys, **rows}, ensure_ascii=False, indent=2)
                )
            conn.execute("BEGIN IMMEDIATE")
            try:
                for start in range(0, len(keys), 500):
                    chunk = keys[start:start + 500]
                    conn.execute(
                        f"UPDATE sessions SET engine = 'pty' WHERE session_key IN ({_marks(chunk)})",
                        chunk,
                    )
                    for table in _CHAT_TABLES:
                        if _table_exists(conn, table):
                            conn.execute(
                                f"DELETE FROM {table} WHERE session_key IN ({_marks(chunk)})",
                                chunk,
                            )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

        prefix = "[dry-run] " if dry_run else ""
        print(f"{prefix}sessions migradas: {len(keys)}")
        print(f"{prefix}eventos arquivados: {len(rows['chat_events'])}")
        print(f"{prefix}pedidos de permissao arquivados: {len(rows['permission_requests'])}")
        print(f"{prefix}sessoes de chat arquivadas: {len(rows['chat_sessions'])}")
        if keys and not dry_run:
            print(f"arquivo: {archive_path}")
        return EXIT_OK
    except (sqlite3.Error, OSError) as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return EXIT_ERROR
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, type=Path, help="path to sessions.db")
    parser.add_argument("--archive", type=Path,
                        help="archive file (default: <db>.chat-archive-<timestamp>.json)")
    parser.add_argument("--dry-run", action="store_true", help="report counts, change nothing")
    args = parser.parse_args(argv)
    return revert(args.db, args.archive, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
