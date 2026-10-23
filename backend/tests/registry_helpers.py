"""Shared helpers for the workspace registry tests (not a test module).

`tests/` has no __init__.py or conftest.py, so these helpers are imported by
plain module name (pytest puts this directory on sys.path).
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sqlite3
import sys
import time
import uuid as uuid_mod
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from app.workspace_store import SCHEMA_STATEMENTS, WorkspaceStore


def make_tree(tmp_path: Path) -> Path:
    """Standard fixture tree used by the registry tests."""
    for relative in (
        "Pessoal/TaskNexus-publico/.claude",
        "Pessoal/TaskNexus-publico/frontend/.claude",  # nested eligible project
        "Pessoal/tn-sandbox/.claude",
        "podesubir/.claude",  # client that is also a project
        "podesubir/site/.claude",
        "projeto_2/.claude",  # loose project at the root
        "Vazio/semmarcador",  # synthetic parent without any eligible child
    ):
        (tmp_path / relative).mkdir(parents=True)
    return tmp_path


@contextmanager
def make_client(tmp_path: Path, *, env_extra: dict | None = None, before_boot=None,
                db_name: str = "sessions.db", root: Path | None = None):
    """Boot the app (lifespan included) against an isolated tree and database.

    `before_boot(main_mod)` runs after the module reload and before the
    lifespan starts, so tests can patch things the boot depends on.
    Yields (client, main_mod).
    """
    env = {
        "PROJECTS_ROOT": str(root or tmp_path),
        "SESSIONS_DB": str(tmp_path / db_name),
        "BOARD_UPLOADS_ROOT": str(tmp_path / "board_uploads"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }
    env.update(env_extra or {})
    with patch.dict("os.environ", env):
        os.environ.pop("HOOK_CALLBACK_BASE_URL", None)
        # The developer shell may carry the production hook port; never let a
        # test boot try to open it (an explicit env_extra value still wins).
        if "HOOK_LOOPBACK_PORT" not in env:
            os.environ.pop("HOOK_LOOPBACK_PORT", None)
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        if before_boot is not None:
            before_boot(main_mod)
        with TestClient(main_mod.app) as client:
            yield client, main_mod


def register_session(client, session_key: str, project_id: str,
                     fixed_uuid: uuid_mod.UUID | None = None) -> str:
    """Map session_key -> claude_session_id without spawning a real agent."""
    fixed_uuid = fixed_uuid or uuid_mod.uuid4()
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=fixed_uuid):
            with client.websocket_connect(f"/ws/pty/{session_key}") as ws:
                ws.send_json({
                    "type": "init", "project_id": project_id, "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                time.sleep(0.2)
    return str(fixed_uuid)


def insert_card_direct(db_path: str, **cols) -> int:
    """Write a `cards` row through a separate synchronous connection."""
    now = time.time()
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO cards (titulo, projeto_id, parent_id, status, origem, "
            "ultima_atualizacao_por, descricao, session_key, criado_em, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                cols.get("titulo", "Card"), cols.get("projeto_id", "meu-projeto"),
                cols.get("parent_id"), cols.get("status", "a_fazer"),
                cols.get("origem", "bruno"), cols.get("ultima_atualizacao_por", "bruno"),
                cols.get("descricao"), cols.get("session_key"), now, now,
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def insert_registry_direct(db_path: str, *, workspaces=(), projects=()) -> None:
    """Create the registry tables and insert rows BEFORE the app boots.

    workspaces: iterable of (key, name); projects: iterable of
    (key, workspace_key, name, folder_path).
    """
    now = time.time()
    conn = sqlite3.connect(db_path)
    try:
        for statement in SCHEMA_STATEMENTS:
            conn.execute(statement)
        ids = {}
        for key, name in workspaces:
            cur = conn.execute(
                "INSERT INTO workspaces (key, name, origin, created_at, updated_at) "
                "VALUES (?, ?, 'manual', ?, ?)", (key, name, now, now))
            ids[key] = cur.lastrowid
        for key, workspace_key, name, folder_path in projects:
            cur = conn.execute(
                "INSERT INTO workspace_projects (key, workspace_id, name, origin, "
                "created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, ?)",
                (key, ids[workspace_key], name, now, now))
            conn.execute(
                "INSERT INTO project_folders (project_id, path, canonical_path, "
                "is_primary, position, created_at) VALUES (?, ?, ?, 1, 0, ?)",
                (cur.lastrowid, os.path.normpath(os.path.abspath(folder_path)),
                 os.path.normcase(os.path.realpath(folder_path)), now))
        conn.commit()
    finally:
        conn.close()


def snapshot_of(db_path: str):
    """Read the registry snapshot of a database from synchronous test code."""
    async def _read():
        store = WorkspaceStore(db_path=db_path)
        await store.initialize()
        try:
            return store.snapshot
        finally:
            await store.close()
    return asyncio.run(_read())


def folder_spec(path: Path | str, *, primary: bool = False) -> dict:
    """FolderSpec for a real directory, canonicalized like the store expects."""
    return {
        "path": os.path.normpath(os.path.abspath(path)),
        "canonical_path": os.path.normcase(os.path.realpath(path)),
        "is_primary": primary,
    }


def prepare_cards_db(db_path: str, projeto_ids) -> list[int]:
    """Create the legacy `cards` schema in a fresh database and insert one card
    per `projeto_id`, BEFORE the app boots (so the boot sees existing V2 data)."""
    from app.card_store import CardStore

    async def _init():
        store = CardStore(db_path=db_path)
        try:
            await store.initialize()
        finally:
            await store.close()

    asyncio.run(_init())
    return [
        insert_card_direct(db_path, titulo=f"Card {i}", projeto_id=projeto_id)
        for i, projeto_id in enumerate(projeto_ids)
    ]


def prepare_artifacts_db(db_path: str, rows) -> None:
    """Create the legacy `artifacts` schema and insert one artifact per
    (project_id, path) pair, BEFORE the app boots."""
    from app.artifact_store import ArtifactStore

    async def _init():
        store = ArtifactStore(db_path=db_path)
        try:
            await store.initialize()
        finally:
            await store.close()

    asyncio.run(_init())
    now = time.time()
    conn = sqlite3.connect(db_path)
    try:
        for project_id, path in rows:
            conn.execute(
                "INSERT INTO artifacts (artifact_id, project_id, cliente_id, path, kind, "
                "title, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'markdown', ?, 'agent', ?, ?)",
                (uuid_mod.uuid4().hex, project_id, project_id.split("/", 1)[0], path,
                 path, now, now),
            )
        conn.commit()
    finally:
        conn.close()
