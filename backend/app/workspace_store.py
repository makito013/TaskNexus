"""Workspace registry: workspaces, projects and their folders (V3, trilha 1).

Four NEW tables in the shared sessions.db; no existing table is touched (no
ALTER, no DROP) and nothing is ever deleted from the registry tables of
workspaces/projects: rows are archived instead (ADR-29). `project_folders`
rows are the one exception, because a project's folder list is replaced as a
whole on edit.

A registry key IS the legacy key: a seeded project keeps its `projeto_id`, a
seeded workspace keeps its `cliente_id`. Keys minted by the registry live in a
reserved namespace (see workspace_keys.py) and are generated inside the
transaction. Keys are immutable (I3), a project never changes workspace (I2),
and the first segment of a project key is its workspace key (I1).

Concurrency follows CardStore: one aiosqlite connection, WAL, busy_timeout and
a `_tx_lock` around EVERY write (transaction state is per connection, so a
commit from another coroutine would end an open transaction early). After each
commit the store rebuilds an immutable `RegistrySnapshot`; synchronous readers
(path resolution, the "same workspace" rule) use that snapshot and never touch
the database. One process owns the database, so the snapshot cannot go stale
behind its back.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Literal, Mapping, TypedDict

import aiosqlite

from app.agent_discovery import cliente_id_from_projeto_id
from app.models import Project
from app.workspace_keys import (
    has_reserved_segment,
    make_project_key,
    make_workspace_key,
    validate_key,
    workspace_key_of,
)

SEED_MARKER = "legacy_seed"
MAX_FOLDERS_PER_PROJECT = 10
_PENDING_KEY_PREFIX = "__pending__"

SCHEMA_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        origin      TEXT NOT NULL,
        created_at  REAL NOT NULL,
        updated_at  REAL NOT NULL,
        archived_at REAL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspace_projects (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        key          TEXT NOT NULL UNIQUE,
        workspace_id INTEGER NOT NULL,
        name         TEXT NOT NULL,
        origin       TEXT NOT NULL,
        created_at   REAL NOT NULL,
        updated_at   REAL NOT NULL,
        archived_at  REAL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS project_folders (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id     INTEGER NOT NULL,
        path           TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        is_primary     INTEGER NOT NULL DEFAULT 0,
        position       INTEGER NOT NULL,
        created_at     REAL NOT NULL,
        UNIQUE(project_id, canonical_path)
    )
    """,
    # Same pattern as board_columns.is_done: at most one primary per project.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_folders_primary "
    "ON project_folders(project_id) WHERE is_primary = 1",
    "CREATE INDEX IF NOT EXISTS idx_project_folders_canonical "
    "ON project_folders(canonical_path)",
    "CREATE INDEX IF NOT EXISTS idx_workspace_projects_workspace "
    "ON workspace_projects(workspace_id)",
    """
    CREATE TABLE IF NOT EXISTS workspace_registry_meta (
        name  TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
)


# -- errors -------------------------------------------------------------------


class RegistryValidationError(ValueError):
    """Structural problem with the input (maps to HTTP 400)."""

    def __init__(self, problems: list[dict]):
        self.problems = problems
        super().__init__("; ".join(str(p.get("message", p)) for p in problems))


class RegistryConflictError(Exception):
    """The request conflicts with the current registry state (maps to 409)."""

    def __init__(self, code: str, detail: dict | None = None):
        self.code = code
        self.detail = detail or {}
        super().__init__(code)


class RegistryNotFoundError(LookupError):
    """A referenced workspace or project does not exist (maps to 404)."""


class SeedError(RuntimeError):
    """The one-time legacy seed failed and was rolled back."""


# -- rows and snapshot ----------------------------------------------------------


@dataclass(frozen=True)
class WorkspaceRow:
    id: int
    key: str
    name: str
    origin: str
    created_at: float
    updated_at: float
    archived_at: float | None

    @property
    def archived(self) -> bool:
        return self.archived_at is not None


@dataclass(frozen=True)
class ProjectRow:
    id: int
    key: str
    workspace_id: int
    name: str
    origin: str
    created_at: float
    updated_at: float
    archived_at: float | None

    @property
    def archived(self) -> bool:
        return self.archived_at is not None


@dataclass(frozen=True)
class FolderRow:
    id: int
    project_id: int
    path: str
    canonical_path: str
    is_primary: bool
    position: int
    created_at: float


class FolderSpec(TypedDict, total=False):
    path: str
    canonical_path: str
    is_primary: bool


def _frozen_map(data: dict) -> Mapping:
    return MappingProxyType(data)


@dataclass(frozen=True)
class RegistrySnapshot:
    """Immutable view of the whole registry. Archived rows are included."""

    workspaces: tuple[WorkspaceRow, ...] = ()
    projects: tuple[ProjectRow, ...] = ()
    workspace_by_key: Mapping[str, WorkspaceRow] = field(default_factory=lambda: _frozen_map({}))
    workspace_by_id: Mapping[int, WorkspaceRow] = field(default_factory=lambda: _frozen_map({}))
    project_by_key: Mapping[str, ProjectRow] = field(default_factory=lambda: _frozen_map({}))
    project_by_id: Mapping[int, ProjectRow] = field(default_factory=lambda: _frozen_map({}))
    projects_by_workspace_id: Mapping[int, tuple[ProjectRow, ...]] = field(
        default_factory=lambda: _frozen_map({})
    )
    folders_by_project_id: Mapping[int, tuple[FolderRow, ...]] = field(
        default_factory=lambda: _frozen_map({})
    )
    # canonical_path -> ((project_id, folder_id), ...)
    folder_canonical_index: Mapping[str, tuple[tuple[int, int], ...]] = field(
        default_factory=lambda: _frozen_map({})
    )

    def primary_folder(self, project_id: int) -> FolderRow | None:
        for folder in self.folders_by_project_id.get(project_id, ()):
            if folder.is_primary:
                return folder
        return None


EMPTY_SNAPSHOT = RegistrySnapshot()


def build_snapshot(
    workspaces: list[WorkspaceRow],
    projects: list[ProjectRow],
    folders: list[FolderRow],
) -> RegistrySnapshot:
    by_workspace: dict[int, list[ProjectRow]] = {}
    for project in projects:
        by_workspace.setdefault(project.workspace_id, []).append(project)
    by_project: dict[int, list[FolderRow]] = {}
    canonical: dict[str, list[tuple[int, int]]] = {}
    for folder in sorted(folders, key=lambda f: (f.project_id, f.position, f.id)):
        by_project.setdefault(folder.project_id, []).append(folder)
        canonical.setdefault(folder.canonical_path, []).append((folder.project_id, folder.id))
    return RegistrySnapshot(
        workspaces=tuple(workspaces),
        projects=tuple(projects),
        workspace_by_key=_frozen_map({w.key: w for w in workspaces}),
        workspace_by_id=_frozen_map({w.id: w for w in workspaces}),
        project_by_key=_frozen_map({p.key: p for p in projects}),
        project_by_id=_frozen_map({p.id: p for p in projects}),
        projects_by_workspace_id=_frozen_map(
            {wid: tuple(rows) for wid, rows in by_workspace.items()}
        ),
        folders_by_project_id=_frozen_map(
            {pid: tuple(rows) for pid, rows in by_project.items()}
        ),
        folder_canonical_index=_frozen_map(
            {path: tuple(refs) for path, refs in canonical.items()}
        ),
    )


@dataclass(frozen=True)
class SeedResult:
    status: Literal["seeded", "already", "skipped"]
    workspaces: int = 0
    projects: int = 0
    reason: str | None = None


# -- store ------------------------------------------------------------------------


def _require_name(name: str | None) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise RegistryValidationError(
            [{"code": "empty_name", "message": "O nome não pode ficar vazio."}]
        )
    return cleaned


def _normalize_folders(folders: list[FolderSpec]) -> list[dict]:
    """Structural checks on an already-validated folder list (path safety is
    the API layer's job): 1..10 folders, exactly one primary (the first one
    when none is flagged), no duplicate canonical path."""
    if not folders:
        raise RegistryValidationError(
            [{"code": "no_folders", "message": "O projeto precisa de ao menos uma pasta."}]
        )
    if len(folders) > MAX_FOLDERS_PER_PROJECT:
        raise RegistryValidationError(
            [{
                "code": "too_many_folders",
                "message": f"No máximo {MAX_FOLDERS_PER_PROJECT} pastas por projeto.",
            }]
        )
    flagged = [i for i, f in enumerate(folders) if f.get("is_primary")]
    if len(flagged) > 1:
        raise RegistryValidationError(
            [{"code": "multiple_primary", "message": "Só uma pasta pode ser a principal."}]
        )
    primary_index = flagged[0] if flagged else 0
    seen: set[str] = set()
    normalized: list[dict] = []
    for index, folder in enumerate(folders):
        path = folder.get("path")
        canonical = folder.get("canonical_path")
        if not path or not canonical:
            raise RegistryValidationError(
                [{"code": "invalid_folder", "message": "Pasta sem caminho."}]
            )
        if canonical in seen:
            raise RegistryValidationError(
                [{
                    "path": path,
                    "code": "duplicate_in_project",
                    "message": "A mesma pasta aparece mais de uma vez no projeto.",
                }]
            )
        seen.add(canonical)
        normalized.append({
            "path": path,
            "canonical_path": canonical,
            "is_primary": index == primary_index,
            "position": index,
        })
    return normalized


class WorkspaceStore:
    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        # Guards every method that WRITES on this connection, same reasoning
        # as CardStore: transaction state is per connection, not per coroutine.
        # NOT reentrant: only the outermost writing method takes it.
        self._tx_lock = asyncio.Lock()
        self._snapshot: RegistrySnapshot = EMPTY_SNAPSHOT

    # -- lifecycle ----------------------------------------------------------

    async def initialize(self) -> None:
        if self._conn is not None:
            # A second call must not open a second connection: aiosqlite runs
            # each one on a non-daemon thread, and the overwritten first one
            # could never be closed (the interpreter would not exit).
            return
        self._conn = await aiosqlite.connect(self.db_path)
        try:
            await self._conn.execute("PRAGMA journal_mode=WAL")
        except aiosqlite.OperationalError:
            pass
        await self._conn.execute("PRAGMA busy_timeout=5000")
        for statement in SCHEMA_STATEMENTS:
            await self._conn.execute(statement)
        await self._conn.commit()
        self._snapshot = await self._rebuild_snapshot()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    @property
    def snapshot(self) -> RegistrySnapshot:
        """Synchronous, lock-free view. `EMPTY_SNAPSHOT` before initialize()."""
        return self._snapshot

    async def _rebuild_snapshot(self) -> RegistrySnapshot:
        async with self._conn.execute(
            "SELECT id, key, name, origin, created_at, updated_at, archived_at "
            "FROM workspaces ORDER BY id"
        ) as cursor:
            workspaces = [WorkspaceRow(*row) async for row in cursor]
        async with self._conn.execute(
            "SELECT id, key, workspace_id, name, origin, created_at, updated_at, "
            "archived_at FROM workspace_projects ORDER BY id"
        ) as cursor:
            projects = [ProjectRow(*row) async for row in cursor]
        async with self._conn.execute(
            "SELECT id, project_id, path, canonical_path, is_primary, position, "
            "created_at FROM project_folders ORDER BY project_id, position, id"
        ) as cursor:
            folders = [
                FolderRow(r[0], r[1], r[2], r[3], bool(r[4]), r[5], r[6])
                async for r in cursor
            ]
        return build_snapshot(workspaces, projects, folders)

    # -- seed marker ----------------------------------------------------------

    async def get_seed_marker(self) -> dict | None:
        async with self._conn.execute(
            "SELECT value FROM workspace_registry_meta WHERE name = ?", (SEED_MARKER,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        try:
            return json.loads(row[0])
        except ValueError:
            return None

    async def _insert_seed_marker(self, payload: dict) -> None:
        await self._conn.execute(
            "INSERT OR REPLACE INTO workspace_registry_meta (name, value) VALUES (?, ?)",
            (SEED_MARKER, json.dumps(payload)),
        )

    # -- seed ---------------------------------------------------------------

    async def seed_from_legacy_once(
        self, projects: list[Project] | None, root: str
    ) -> SeedResult:
        """Create workspaces/projects from the folder scan, once per database.

        Guarded by the marker row, not by "tables are empty". Without a scan
        (root missing, scan failed) or without eligible projects it does
        nothing and writes NO marker, so the next boot tries again. With the
        marker deleted by hand it runs in "complete" mode: only keys that do
        not exist are inserted; nothing is updated or unarchived.
        """
        marker = await self.get_seed_marker()
        if marker is not None:
            return SeedResult(
                "already",
                workspaces=int(marker.get("workspaces", 0)),
                projects=int(marker.get("projects", 0)),
            )
        if projects is None:
            return SeedResult("skipped", reason="scan_unavailable")
        eligible = sorted((p for p in projects if p.elegivel), key=lambda p: p.id)
        if not eligible:
            return SeedResult("skipped", reason="no_eligible_projects")

        async with self._tx_lock:
            now = time.time()
            await self._conn.execute("BEGIN")
            try:
                workspace_ids: dict[str, int] = {}
                for key in sorted({cliente_id_from_projeto_id(p.id) for p in eligible}):
                    await self._conn.execute(
                        "INSERT OR IGNORE INTO workspaces "
                        "(key, name, origin, created_at, updated_at) "
                        "VALUES (?, ?, 'legacy_seed', ?, ?)",
                        (key, key, now, now),
                    )
                    async with self._conn.execute(
                        "SELECT id FROM workspaces WHERE key = ?", (key,)
                    ) as cursor:
                        workspace_ids[key] = (await cursor.fetchone())[0]
                for project in eligible:
                    client = cliente_id_from_projeto_id(project.id)
                    name = project.id if project.id == client else project.id[len(client) + 1:]
                    cursor = await self._conn.execute(
                        "INSERT OR IGNORE INTO workspace_projects "
                        "(key, workspace_id, name, origin, created_at, updated_at) "
                        "VALUES (?, ?, ?, 'legacy_seed', ?, ?)",
                        (project.id, workspace_ids[client], name, now, now),
                    )
                    if cursor.rowcount != 1:
                        continue  # already registered: complete mode never edits
                    project_row_id = cursor.lastrowid
                    await self._conn.execute(
                        "INSERT OR IGNORE INTO project_folders "
                        "(project_id, path, canonical_path, is_primary, position, created_at) "
                        "VALUES (?, ?, ?, 1, 0, ?)",
                        (
                            project_row_id,
                            os.path.normpath(os.path.abspath(project.path)),
                            os.path.normcase(os.path.realpath(project.path)),
                            now,
                        ),
                    )
                async with self._conn.execute("SELECT COUNT(*) FROM workspaces") as cursor:
                    n_workspaces = (await cursor.fetchone())[0]
                async with self._conn.execute(
                    "SELECT COUNT(*) FROM workspace_projects"
                ) as cursor:
                    n_projects = (await cursor.fetchone())[0]
                await self._insert_seed_marker({
                    "at": now,
                    "root": root,
                    "workspaces": n_workspaces,
                    "projects": n_projects,
                })
            except Exception as exc:
                await self._conn.rollback()
                raise SeedError(f"legacy seed rolled back: {exc!r}") from exc
            await self._conn.commit()
            self._snapshot = await self._rebuild_snapshot()
        return SeedResult("seeded", workspaces=n_workspaces, projects=n_projects)

    # -- writes ---------------------------------------------------------------

    async def create_workspace(
        self, name: str, *, adopt_key: str | None = None, origin: str | None = None
    ) -> WorkspaceRow:
        cleaned = _require_name(name)
        if adopt_key is not None:
            try:
                validate_key(adopt_key)
            except ValueError as exc:
                raise RegistryValidationError(
                    [{"code": "invalid_key", "message": str(exc)}]
                ) from exc
            if has_reserved_segment(adopt_key) or "/" in adopt_key:
                raise RegistryValidationError([{
                    "code": "invalid_key",
                    "message": "A chave adotada precisa ser a de um cliente legado.",
                }])
        resolved_origin = origin or ("legacy_adopted" if adopt_key else "manual")
        async with self._tx_lock:
            now = time.time()
            if adopt_key is not None:
                async with self._conn.execute(
                    "SELECT id, archived_at FROM workspaces WHERE key = ?", (adopt_key,)
                ) as cursor:
                    existing = await cursor.fetchone()
                if existing is not None:
                    raise RegistryConflictError("adopt_conflict", {
                        "archived": existing[1] is not None,
                        "workspace_id": existing[0],
                    })
            await self._conn.execute("BEGIN")
            try:
                key = adopt_key or f"{_PENDING_KEY_PREFIX}{uuid.uuid4().hex}"
                cursor = await self._conn.execute(
                    "INSERT INTO workspaces (key, name, origin, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (key, cleaned, resolved_origin, now, now),
                )
                workspace_id = cursor.lastrowid
                if adopt_key is None:
                    await self._conn.execute(
                        "UPDATE workspaces SET key = ? WHERE id = ?",
                        (make_workspace_key(workspace_id), workspace_id),
                    )
            except Exception:
                await self._conn.rollback()
                raise
            await self._conn.commit()
            self._snapshot = await self._rebuild_snapshot()
            return self._snapshot.workspace_by_id[workspace_id]

    async def update_workspace(
        self,
        workspace_id: int,
        *,
        name: str | None = None,
        archived: bool | None = None,
    ) -> WorkspaceRow:
        cleaned = _require_name(name) if name is not None else None
        async with self._tx_lock:
            current = self._snapshot.workspace_by_id.get(workspace_id)
            if current is None:
                raise RegistryNotFoundError(f"workspace {workspace_id} not found")
            now = time.time()
            archived_at = current.archived_at
            if archived is True and archived_at is None:
                archived_at = now
            elif archived is False:
                archived_at = None
            await self._conn.execute("BEGIN")
            try:
                await self._conn.execute(
                    "UPDATE workspaces SET name = ?, archived_at = ?, updated_at = ? "
                    "WHERE id = ?",
                    (cleaned if cleaned is not None else current.name, archived_at, now, workspace_id),
                )
            except Exception:
                await self._conn.rollback()
                raise
            await self._conn.commit()
            self._snapshot = await self._rebuild_snapshot()
            return self._snapshot.workspace_by_id[workspace_id]

    async def create_project(
        self,
        workspace_id: int,
        name: str,
        folders: list[FolderSpec],
        *,
        adopt_key: str | None = None,
        origin: str | None = None,
    ) -> ProjectRow:
        cleaned = _require_name(name)
        normalized = _normalize_folders(folders)
        async with self._tx_lock:
            workspace = self._snapshot.workspace_by_id.get(workspace_id)
            if workspace is None:
                raise RegistryNotFoundError(f"workspace {workspace_id} not found")
            if workspace.archived:
                raise RegistryConflictError("workspace_archived", {"workspace_id": workspace_id})
            if adopt_key is not None:
                try:
                    validate_key(adopt_key)
                except ValueError as exc:
                    raise RegistryValidationError(
                        [{"code": "invalid_key", "message": str(exc)}]
                    ) from exc
                if has_reserved_segment(adopt_key):
                    raise RegistryValidationError([{
                        "code": "invalid_key",
                        "message": "A chave adotada precisa ser a de um projeto legado.",
                    }])
                # I1: the first segment of a project key is its workspace key.
                if workspace_key_of(adopt_key) != workspace.key:
                    raise RegistryValidationError([{
                        "code": "workspace_mismatch",
                        "message": "A chave adotada pertence a outro workspace.",
                    }])
                existing = self._snapshot.project_by_key.get(adopt_key)
                if existing is not None:
                    raise RegistryConflictError("adopt_conflict", {
                        "archived": existing.archived,
                        "project_id": existing.id,
                    })
            resolved_origin = origin or ("legacy_adopted" if adopt_key else "manual")
            now = time.time()
            await self._conn.execute("BEGIN")
            try:
                key = adopt_key or f"{_PENDING_KEY_PREFIX}{uuid.uuid4().hex}"
                cursor = await self._conn.execute(
                    "INSERT INTO workspace_projects "
                    "(key, workspace_id, name, origin, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (key, workspace_id, cleaned, resolved_origin, now, now),
                )
                project_id = cursor.lastrowid
                if adopt_key is None:
                    await self._conn.execute(
                        "UPDATE workspace_projects SET key = ? WHERE id = ?",
                        (make_project_key(workspace.key, project_id), project_id),
                    )
                await self._insert_folders(project_id, normalized, now)
            except Exception:
                await self._conn.rollback()
                raise
            await self._conn.commit()
            self._snapshot = await self._rebuild_snapshot()
            return self._snapshot.project_by_id[project_id]

    async def update_project(
        self,
        project_id: int,
        *,
        name: str | None = None,
        folders: list[FolderSpec] | None = None,
        archived: bool | None = None,
    ) -> ProjectRow:
        # `workspace_id` is deliberately not a parameter (I2) and `key` is never
        # updated (I3).
        cleaned = _require_name(name) if name is not None else None
        normalized = _normalize_folders(folders) if folders is not None else None
        async with self._tx_lock:
            current = self._snapshot.project_by_id.get(project_id)
            if current is None:
                raise RegistryNotFoundError(f"project {project_id} not found")
            now = time.time()
            archived_at = current.archived_at
            if archived is True and archived_at is None:
                archived_at = now
            elif archived is False:
                archived_at = None
            await self._conn.execute("BEGIN")
            try:
                await self._conn.execute(
                    "UPDATE workspace_projects SET name = ?, archived_at = ?, updated_at = ? "
                    "WHERE id = ?",
                    (cleaned if cleaned is not None else current.name, archived_at, now, project_id),
                )
                if normalized is not None:
                    await self._conn.execute(
                        "DELETE FROM project_folders WHERE project_id = ?", (project_id,)
                    )
                    await self._insert_folders(project_id, normalized, now)
            except Exception:
                await self._conn.rollback()
                raise
            await self._conn.commit()
            self._snapshot = await self._rebuild_snapshot()
            return self._snapshot.project_by_id[project_id]

    async def _insert_folders(self, project_id: int, folders: list[dict], now: float) -> None:
        for folder in folders:
            await self._conn.execute(
                "INSERT INTO project_folders "
                "(project_id, path, canonical_path, is_primary, position, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    folder["path"],
                    folder["canonical_path"],
                    1 if folder["is_primary"] else 0,
                    folder["position"],
                    now,
                ),
            )

    # -- reads ----------------------------------------------------------------

    async def list_registry(self, include_archived: bool) -> dict[str, Any]:
        """Contract-shaped dict of the registry (no `exists`/`primary_locked`:
        those are computed by the API layer)."""
        snapshot = self._snapshot
        workspaces: list[dict] = []
        for workspace in snapshot.workspaces:
            if workspace.archived and not include_archived:
                continue
            projects: list[dict] = []
            for project in snapshot.projects_by_workspace_id.get(workspace.id, ()):
                if project.archived and not include_archived:
                    continue
                projects.append({
                    "id": project.id,
                    "key": project.key,
                    "name": project.name,
                    "origin": project.origin,
                    "archived": project.archived,
                    "folders": [
                        {
                            "id": folder.id,
                            "path": folder.path,
                            "is_primary": folder.is_primary,
                            "position": folder.position,
                        }
                        for folder in snapshot.folders_by_project_id.get(project.id, ())
                    ],
                })
            workspaces.append({
                "id": workspace.id,
                "key": workspace.key,
                "name": workspace.name,
                "origin": workspace.origin,
                "archived": workspace.archived,
                "projects": projects,
            })
        return {"seeded": await self.get_seed_marker(), "workspaces": workspaces}
