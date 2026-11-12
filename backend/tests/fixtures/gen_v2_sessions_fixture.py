"""Generate `v2_sessions_c4c5dee.json`: the V2 session endpoints, byte for byte.

The fixture holds what `/api/sessions/persisted` and `/api/sessions/active`
returned at commit c4c5dee (before the chat engine existed), produced by that
very code, never by hand. `tests/test_sessions_engine_filter.py` replays the
same seed against the current code and demands identical bytes.

Manual tool, not a test. It exports the commit with `git archive`, then runs the
old backend in a child process (the old `app` package cannot share a process
with the current one) using a venv WITHOUT the new dependencies.

Exact command (Git Bash, from the repository root; the environment is cleaned
inside the script, so the CLAUDE* variables and HOOK_LOOPBACK_PORT never leak
into the old app, and every path the app lifespan touches points into a fresh
temporary folder, never at ~/.claude.json, D:\\projetos or port 8765):

    C:/tmp/tn-v3-t2/venv-nosdk/Scripts/python.exe \\
        backend/tests/fixtures/gen_v2_sessions_fixture.py \\
        --python C:/tmp/tn-v3-t2/venv-nosdk/Scripts/python.exe \\
        --work-dir C:/tmp/tn-v3-t2

The script writes `backend/tests/fixtures/v2_sessions_c4c5dee.json`:

    {"seed_rows": [...], "active_fakes": {...},
     "persisted_body": "<exact text>", "active_body": "<exact text>",
     "source_commit": "c4c5dee"}

`active_fakes` maps a session key to how the fake PTY manager presents it
(`running`, `idle` or `disconnected`), identically here and in the test, so the
`/active` body is not a trivial `{}`.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SOURCE_COMMIT = "c4c5dee"
FIXTURE_PATH = Path(__file__).resolve().parent / "v2_sessions_c4c5dee.json"
REPO_ROOT = Path(__file__).resolve().parents[3]

SESSION_COLUMNS = (
    "session_key",
    "claude_session_id",
    "updated_at",
    "display_name",
    "needs_attention",
    "last_activity_seen_at",
    "push_notified",
)

# Deterministic rows: accented and NULL display_name, needs_attention 0/1,
# push_notified 0/1, empty and filled claude_session_id, fixed updated_at.
SEED_ROWS = [
    {
        "session_key": "proj-a::claude",
        "claude_session_id": "11111111-1111-4111-8111-111111111111",
        "updated_at": 1700000000.0,
        "display_name": "Revisão do módulo",
        "needs_attention": 1,
        "last_activity_seen_at": None,
        "push_notified": 1,
    },
    {
        "session_key": "proj-b::claude",
        "claude_session_id": "",
        "updated_at": 1700000100.0,
        "display_name": None,
        "needs_attention": 0,
        "last_activity_seen_at": 1700000050.0,
        "push_notified": 0,
    },
    {
        "session_key": "proj-c::codex",
        "claude_session_id": "33333333-3333-4333-8333-333333333333",
        "updated_at": 1700000200.0,
        "display_name": "Análise crítica",
        "needs_attention": 0,
        "last_activity_seen_at": None,
        "push_notified": 1,
    },
    {
        "session_key": "proj-d::claude",
        "claude_session_id": "44444444-4444-4444-8444-444444444444",
        "updated_at": 1700000300.0,
        "display_name": None,
        "needs_attention": 1,
        "last_activity_seen_at": None,
        "push_notified": 0,
    },
    {
        "session_key": "proj-e::terminal",
        "claude_session_id": "",
        "updated_at": 1700000400.0,
        "display_name": "Terminal avulso",
        "needs_attention": 0,
        "last_activity_seen_at": 1700000350.0,
        "push_notified": 0,
    },
    {
        "session_key": "proj-f::claude",
        "claude_session_id": "66666666-6666-4666-8666-666666666666",
        "updated_at": 1700000500.0,
        "display_name": "Ação pendente",
        "needs_attention": 1,
        "last_activity_seen_at": None,
        "push_notified": 1,
    },
]

# Inserted OUT of key order on purpose. /persisted answers in the order SQLite scans
# the table (insertion order), so seeding the rows alphabetically would make
# "insertion order" and "key order" the same thing and a regression that sorted
# the result (ORDER BY, an index) would go unseen by the byte-for-byte test.
SEED_ROWS = [SEED_ROWS[index] for index in (3, 0, 5, 1, 4, 2)]

# How the fake PTY manager presents some of the keys to /active.
ACTIVE_FAKES = {
    "proj-a::claude": "running",
    "proj-b::claude": "idle",
    "proj-d::claude": "disconnected",
}


def _export_old_backend(work_dir: Path) -> Path:
    """`git archive` the old commit and expand it; returns `<dir>/backend`."""
    target = work_dir / f"base-{SOURCE_COMMIT}"
    archive = work_dir / f"base-{SOURCE_COMMIT}.zip"
    if target.exists():
        shutil.rmtree(target)
    subprocess.run(
        ["git", "-C", str(REPO_ROOT), "archive", "--format=zip",
         "-o", str(archive), SOURCE_COMMIT, "backend"],
        check=True,
    )
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(target)
    return target / "backend"


def _clean_env(scratch: Path) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("CLAUDE") and key != "HOOK_LOOPBACK_PORT"
    }
    env.update(
        {
            "PROJECTS_ROOT": str(scratch / "projects"),
            "SESSIONS_DB": str(scratch / "sessions.db"),
            "CLAUDE_CONFIG_PATH": str(scratch / "claude.json"),
            "BOARD_UPLOADS_ROOT": str(scratch / "uploads"),
            "BOARD_ATTACHMENTS_ROOT": str(scratch / "attachments"),
            "CLEANUP_DELAY": "0.1",
        }
    )
    return env


def _capture(out_path: Path) -> None:
    """Child mode: runs inside the OLD backend directory and old venv."""
    from types import SimpleNamespace
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    sys.path.insert(0, os.getcwd())
    import app.main as main_mod

    db_path = os.environ["SESSIONS_DB"]
    (Path(os.environ["PROJECTS_ROOT"]) / "meu-projeto" / ".claude").mkdir(parents=True)

    fakes = {}
    for key, mode in ACTIVE_FAKES.items():
        fakes[key] = SimpleNamespace(
            last_activity=float("inf") if mode == "running" else -1e9
        )
    connected = {key for key, mode in ACTIVE_FAKES.items() if mode != "disconnected"}

    with TestClient(main_mod.app) as client:
        # The lifespan created the schema; seed through a second connection.
        conn = sqlite3.connect(db_path)
        marks = ", ".join("?" for _ in SESSION_COLUMNS)
        for row in SEED_ROWS:
            conn.execute(
                f"INSERT INTO sessions ({', '.join(SESSION_COLUMNS)}) VALUES ({marks})",
                tuple(row[col] for col in SESSION_COLUMNS),
            )
        conn.commit()
        conn.close()

        with patch.object(main_mod.pty_manager, "active_sessions", lambda: dict(fakes)), \
                patch.dict(main_mod._active_connections, {k: object() for k in connected}):
            persisted = client.get("/api/sessions/persisted")
            active = client.get("/api/sessions/active")

    assert persisted.status_code == 200 and active.status_code == 200
    out_path.write_text(
        json.dumps(
            {
                "persisted_body": persisted.content.decode("utf-8"),
                "active_body": active.content.decode("utf-8"),
            }
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--python", help="interpreter of the venv WITHOUT the new packages")
    parser.add_argument("--work-dir", default="C:/tmp/tn-v3-t2")
    parser.add_argument("--capture", metavar="OUT", help="internal: child mode")
    args = parser.parse_args()

    if args.capture:
        _capture(Path(args.capture))
        return
    if not args.python:
        parser.error("--python is required")

    work_dir = Path(args.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    old_backend = _export_old_backend(work_dir)
    scratch = Path(tempfile.mkdtemp(prefix="v2-fixture-", dir=work_dir))
    out_path = scratch / "capture.json"
    try:
        subprocess.run(
            [args.python, str(Path(__file__).resolve()), "--capture", str(out_path)],
            cwd=old_backend,
            env=_clean_env(scratch),
            check=True,
        )
        captured = json.loads(out_path.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    if captured["active_body"].strip() == "{}":
        raise SystemExit("active_body is empty: the fake PTY manager did not take effect")

    FIXTURE_PATH.write_text(
        json.dumps(
            {
                "seed_rows": SEED_ROWS,
                "active_fakes": ACTIVE_FAKES,
                "persisted_body": captured["persisted_body"],
                "active_body": captured["active_body"],
                "source_commit": SOURCE_COMMIT,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
