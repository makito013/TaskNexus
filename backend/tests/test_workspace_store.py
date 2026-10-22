"""WorkspaceStore: schema, writes, invariants and snapshot."""
from __future__ import annotations

import asyncio
import dataclasses
import sqlite3

import pytest
import pytest_asyncio

from app.workspace_store import (
    EMPTY_SNAPSHOT,
    RegistryConflictError,
    RegistryNotFoundError,
    RegistryValidationError,
    WorkspaceStore,
)
from registry_helpers import folder_spec


@pytest_asyncio.fixture
async def store(tmp_path):
    s = WorkspaceStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.fixture
def dirs(tmp_path):
    made = {}
    for name in ("a", "b", "c"):
        path = tmp_path / "folders" / name
        path.mkdir(parents=True)
        made[name] = path
    return made


def _legacy_dump(db_path):
    conn = sqlite3.connect(db_path)
    try:
        dump = {}
        for table in ("cards", "sessions", "tasks"):
            dump[table] = (
                conn.execute(f"PRAGMA table_info({table})").fetchall(),
                conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall(),
            )
        return dump
    finally:
        conn.close()


# -- schema -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initialize_creates_the_four_tables(store):
    async with store._conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ) as cursor:
        names = {row[0] async for row in cursor}
    assert {"workspaces", "workspace_projects", "project_folders",
            "workspace_registry_meta"} <= names


@pytest.mark.asyncio
async def test_initialize_twice_is_a_noop(tmp_path):
    s = WorkspaceStore(db_path=str(tmp_path / "t.db"))
    try:
        await s.initialize()
        ws = await s.create_workspace("One")
    finally:
        await s.close()
    s2 = WorkspaceStore(db_path=str(tmp_path / "t.db"))
    try:
        await s2.initialize()
        first_connection = s2._conn
        await s2.initialize()
        assert s2._conn is first_connection  # no second (leaked) connection
        assert [w.key for w in s2.snapshot.workspaces] == [ws.key]
    finally:
        await s2.close()


@pytest.mark.asyncio
async def test_initialize_leaves_legacy_tables_untouched(tmp_path):
    db = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE cards (id INTEGER PRIMARY KEY, titulo TEXT, projeto_id TEXT);
        CREATE TABLE sessions (session_key TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, session_key TEXT);
        INSERT INTO cards VALUES (1, 'x', 'Pessoal/tn');
        INSERT INTO sessions VALUES ('Pessoal/tn::claude', 'Pessoal/tn');
        INSERT INTO tasks VALUES (1, 'Pessoal/tn::claude');
        """
    )
    conn.commit()
    conn.close()
    before = _legacy_dump(db)
    s = WorkspaceStore(db_path=db)
    try:
        await s.initialize()
        await s.create_workspace("W")
    finally:
        await s.close()
    assert _legacy_dump(db) == before


@pytest.mark.asyncio
async def test_snapshot_is_empty_before_initialize(tmp_path):
    s = WorkspaceStore(db_path=str(tmp_path / "x.db"))
    assert s.snapshot is EMPTY_SNAPSHOT


# -- workspaces -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_workspace_mints_a_synthetic_key(store):
    ws = await store.create_workspace("  Acme  ")
    assert ws.key == f".w{ws.id}"
    assert ws.name == "Acme"
    assert ws.origin == "manual"
    assert "__pending__" not in ws.key


@pytest.mark.asyncio
async def test_create_workspace_adopting_a_legacy_key(store):
    ws = await store.create_workspace("NewCo", adopt_key="NewCo")
    assert ws.key == "NewCo"
    assert ws.origin == "legacy_adopted"


@pytest.mark.asyncio
async def test_adopting_the_same_key_twice_conflicts(store):
    await store.create_workspace("NewCo", adopt_key="NewCo")
    with pytest.raises(RegistryConflictError) as info:
        await store.create_workspace("Again", adopt_key="NewCo")
    assert info.value.code == "adopt_conflict"
    assert info.value.detail["archived"] is False


@pytest.mark.asyncio
async def test_adopting_an_archived_key_reports_archived(store):
    ws = await store.create_workspace("NewCo", adopt_key="NewCo")
    await store.update_workspace(ws.id, archived=True)
    with pytest.raises(RegistryConflictError) as info:
        await store.create_workspace("Again", adopt_key="NewCo")
    assert info.value.detail["archived"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_key", [".w9", "a/b", "a::b", ""])
async def test_adopting_an_invalid_workspace_key_is_rejected(store, bad_key):
    with pytest.raises(RegistryValidationError):
        await store.create_workspace("X", adopt_key=bad_key)


@pytest.mark.asyncio
async def test_empty_name_is_rejected(store):
    with pytest.raises(RegistryValidationError):
        await store.create_workspace("   ")


@pytest.mark.asyncio
async def test_update_workspace_renames_and_archives_without_touching_the_key(store):
    ws = await store.create_workspace("Old")
    renamed = await store.update_workspace(ws.id, name="New")
    assert (renamed.key, renamed.name) == (ws.key, "New")
    archived = await store.update_workspace(ws.id, archived=True)
    assert archived.archived and archived.archived_at is not None
    restored = await store.update_workspace(ws.id, archived=False)
    assert not restored.archived


@pytest.mark.asyncio
async def test_update_unknown_workspace_is_not_found(store):
    with pytest.raises(RegistryNotFoundError):
        await store.update_workspace(999, name="x")


# -- projects -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_project_mints_a_key_prefixed_by_its_workspace(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    assert project.key == f"{ws.key}/.p{project.id}"
    assert "__pending__" not in project.key
    assert project.origin == "manual"
    assert project.workspace_id == ws.id


@pytest.mark.asyncio
async def test_first_folder_is_primary_by_default(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(
        ws.id, "Site", [folder_spec(dirs["a"]), folder_spec(dirs["b"])]
    )
    folders = store.snapshot.folders_by_project_id[project.id]
    assert [f.is_primary for f in folders] == [True, False]
    assert [f.position for f in folders] == [0, 1]
    assert store.snapshot.primary_folder(project.id) == folders[0]


@pytest.mark.asyncio
async def test_explicit_primary_is_honoured(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(
        ws.id, "Site",
        [folder_spec(dirs["a"]), folder_spec(dirs["b"], primary=True)],
    )
    assert store.snapshot.primary_folder(project.id).path == folder_spec(dirs["b"])["path"]


@pytest.mark.asyncio
async def test_project_without_folders_is_rejected(store):
    ws = await store.create_workspace("Acme")
    with pytest.raises(RegistryValidationError) as info:
        await store.create_project(ws.id, "Site", [])
    assert info.value.problems[0]["code"] == "no_folders"


@pytest.mark.asyncio
async def test_two_primary_folders_are_rejected(store, dirs):
    ws = await store.create_workspace("Acme")
    with pytest.raises(RegistryValidationError) as info:
        await store.create_project(
            ws.id, "Site",
            [folder_spec(dirs["a"], primary=True), folder_spec(dirs["b"], primary=True)],
        )
    assert info.value.problems[0]["code"] == "multiple_primary"


@pytest.mark.asyncio
async def test_eleven_folders_are_rejected_and_ten_are_accepted(store, tmp_path):
    ws = await store.create_workspace("Acme")
    specs = []
    for i in range(11):
        path = tmp_path / "many" / str(i)
        path.mkdir(parents=True)
        specs.append(folder_spec(path))
    with pytest.raises(RegistryValidationError) as info:
        await store.create_project(ws.id, "Big", specs)
    assert info.value.problems[0]["code"] == "too_many_folders"
    project = await store.create_project(ws.id, "Big", specs[:10])
    assert len(store.snapshot.folders_by_project_id[project.id]) == 10


@pytest.mark.asyncio
async def test_same_canonical_folder_twice_in_a_project_is_rejected(store, dirs):
    ws = await store.create_workspace("Acme")
    with pytest.raises(RegistryValidationError) as info:
        await store.create_project(
            ws.id, "Site", [folder_spec(dirs["a"]), folder_spec(dirs["a"])]
        )
    assert info.value.problems[0]["code"] == "duplicate_in_project"


@pytest.mark.asyncio
async def test_adopted_key_must_belong_to_the_workspace_i1(store, dirs):
    ws = await store.create_workspace("Pessoal", adopt_key="Pessoal")
    with pytest.raises(RegistryValidationError) as info:
        await store.create_project(
            ws.id, "X", [folder_spec(dirs["a"])], adopt_key="Outro/x"
        )
    assert info.value.problems[0]["code"] == "workspace_mismatch"
    project = await store.create_project(
        ws.id, "Y", [folder_spec(dirs["a"])], adopt_key="Pessoal/y"
    )
    assert (project.key, project.origin) == ("Pessoal/y", "legacy_adopted")


@pytest.mark.asyncio
async def test_adopting_an_existing_project_key_conflicts(store, dirs):
    ws = await store.create_workspace("Pessoal", adopt_key="Pessoal")
    first = await store.create_project(
        ws.id, "Y", [folder_spec(dirs["a"])], adopt_key="Pessoal/y"
    )
    with pytest.raises(RegistryConflictError) as info:
        await store.create_project(
            ws.id, "Y2", [folder_spec(dirs["b"])], adopt_key="Pessoal/y"
        )
    assert info.value.code == "adopt_conflict"
    assert info.value.detail == {"archived": False, "project_id": first.id}


@pytest.mark.asyncio
async def test_synthetic_adopt_key_is_rejected(store, dirs):
    ws = await store.create_workspace("Acme")
    with pytest.raises(RegistryValidationError):
        await store.create_project(
            ws.id, "X", [folder_spec(dirs["a"])], adopt_key=f"{ws.key}/.p77"
        )


@pytest.mark.asyncio
async def test_create_project_in_an_archived_workspace_conflicts(store, dirs):
    ws = await store.create_workspace("Acme")
    await store.update_workspace(ws.id, archived=True)
    with pytest.raises(RegistryConflictError) as info:
        await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    assert info.value.code == "workspace_archived"


@pytest.mark.asyncio
async def test_create_project_in_unknown_workspace_is_not_found(store, dirs):
    with pytest.raises(RegistryNotFoundError):
        await store.create_project(404, "Site", [folder_spec(dirs["a"])])


@pytest.mark.asyncio
async def test_create_project_without_folders_is_rejected_before_writing(store, dirs):
    # Structural validation runs before BEGIN; this does NOT exercise rollback
    # (see test_create_project_rolls_back_when_the_folder_insert_fails).
    ws = await store.create_workspace("Acme")
    with pytest.raises(RegistryValidationError):
        await store.create_project(ws.id, "Site", [])
    assert store.snapshot.projects == ()
    async with store._conn.execute("SELECT COUNT(*) FROM workspace_projects") as cursor:
        assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_update_project_rename_changes_only_the_name(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    renamed = await store.update_project(project.id, name="Portal")
    assert renamed.name == "Portal"
    assert (renamed.key, renamed.workspace_id) == (project.key, project.workspace_id)
    assert len(store.snapshot.folders_by_project_id[project.id]) == 1


@pytest.mark.asyncio
async def test_update_project_folders_replaces_the_whole_list(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(
        ws.id, "Site", [folder_spec(dirs["a"]), folder_spec(dirs["b"])]
    )
    await store.update_project(
        project.id,
        folders=[folder_spec(dirs["c"]), folder_spec(dirs["a"], primary=True)],
    )
    folders = store.snapshot.folders_by_project_id[project.id]
    assert [f.path for f in folders] == [
        folder_spec(dirs["c"])["path"], folder_spec(dirs["a"])["path"],
    ]
    assert [f.position for f in folders] == [0, 1]
    assert store.snapshot.primary_folder(project.id).path == folder_spec(dirs["a"])["path"]


@pytest.mark.asyncio
async def test_update_project_archive_and_restore(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    assert (await store.update_project(project.id, archived=True)).archived
    assert not (await store.update_project(project.id, archived=False)).archived


@pytest.mark.asyncio
async def test_update_project_cannot_change_workspace(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    with pytest.raises(TypeError):
        await store.update_project(project.id, workspace_id=2)


@pytest.mark.asyncio
async def test_update_unknown_project_is_not_found(store):
    with pytest.raises(RegistryNotFoundError):
        await store.update_project(404, name="x")


@pytest.mark.asyncio
async def test_update_project_with_empty_folders_is_rejected_and_keeps_folders(store, dirs):
    # Validation-only (before BEGIN); atomicity is proven by the rollback tests below.
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    with pytest.raises(RegistryValidationError):
        await store.update_project(project.id, folders=[])
    assert len(store.snapshot.folders_by_project_id[project.id]) == 1


# -- atomicity (failure AFTER BEGIN) -------------------------------------------


async def _rows(store, sql):
    async with store._conn.execute(sql) as cursor:
        return await cursor.fetchall()



@pytest.mark.asyncio
async def test_update_project_rolls_back_when_the_folder_insert_fails(store, dirs, monkeypatch):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    folders_before = await _rows(store, "SELECT id, path, is_primary FROM project_folders")
    snapshot_before = store.snapshot

    async def boom(*_args, **_kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "_insert_folders", boom)
    with pytest.raises(sqlite3.OperationalError):
        await store.update_project(project.id, name="Renamed", folders=[folder_spec(dirs["b"])])
    monkeypatch.undo()

    # DELETE of the old folders and the rename were both undone.
    assert await _rows(store, "SELECT id, path, is_primary FROM project_folders") == folders_before
    assert await _rows(store, "SELECT name FROM workspace_projects") == [("Site",)]
    assert store.snapshot is snapshot_before
    assert store.snapshot.project_by_id[project.id].name == "Site"
    # The connection is still usable (no dangling transaction).
    later = await store.create_project(ws.id, "Later", [folder_spec(dirs["b"])])
    assert later.key.startswith(f"{ws.key}/.p")


@pytest.mark.asyncio
async def test_create_project_rolls_back_when_the_folder_insert_fails(store, dirs, monkeypatch):
    ws = await store.create_workspace("Acme")
    snapshot_before = store.snapshot

    async def boom(*_args, **_kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "_insert_folders", boom)
    with pytest.raises(sqlite3.OperationalError):
        await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    monkeypatch.undo()

    assert await _rows(store, "SELECT COUNT(*) FROM workspace_projects") == [(0,)]
    assert await _rows(store, "SELECT COUNT(*) FROM project_folders") == [(0,)]
    assert store.snapshot is snapshot_before
    later = await store.create_project(ws.id, "Later", [folder_spec(dirs["a"])])
    assert "__pending__" not in later.key


# -- concurrency (_tx_lock) ------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_writes_keep_keys_unique_and_one_primary_per_project(store, tmp_path):
    workspaces = await asyncio.gather(*[store.create_workspace(f"W{i}") for i in range(20)])
    assert len({w.key for w in workspaces}) == 20
    assert all(w.key == f".w{w.id}" for w in workspaces)

    target = workspaces[0]
    specs = []
    for i in range(20):
        path = tmp_path / "conc" / str(i)
        path.mkdir(parents=True)
        specs.append([folder_spec(path), folder_spec(tmp_path / "conc")])
    reads = []

    async def reader():
        for _ in range(10):
            reads.append(await store.list_registry(include_archived=True))
            await asyncio.sleep(0)

    created, *_ = await asyncio.gather(
        asyncio.gather(*[store.create_project(target.id, f"P{i}", specs[i]) for i in range(20)]),
        reader(),
    )
    assert len({p.key for p in created}) == 20
    assert all("__pending__" not in p.key for p in created)
    # The interleaved reader must never see a half-written project: a pending
    # key, or a project without exactly one primary folder.
    assert len(reads) == 10
    for registry in reads:
        for workspace in registry["workspaces"]:
            assert "__pending__" not in workspace["key"]
            for project in workspace["projects"]:
                assert "__pending__" not in project["key"]
                assert sum(1 for f in project["folders"] if f["is_primary"]) == 1

    await asyncio.gather(*[store.update_project(p.id, archived=True) for p in created])
    assert all(store.snapshot.project_by_id[p.id].archived for p in created)

    primaries = await _rows(
        store, "SELECT project_id, SUM(is_primary) FROM project_folders GROUP BY project_id"
    )
    assert len(primaries) == 20
    assert all(total == 1 for _, total in primaries)
    assert await _rows(store, "SELECT COUNT(*) FROM workspaces WHERE key LIKE '%pending%'") == [(0,)]


# -- snapshot ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_snapshot_is_rebuilt_after_every_write(store, dirs):
    before = store.snapshot
    ws = await store.create_workspace("Acme")
    after_ws = store.snapshot
    assert after_ws is not before
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    after_project = store.snapshot
    assert after_project is not after_ws
    await store.update_project(project.id, name="Portal")
    assert store.snapshot is not after_project
    assert store.snapshot.project_by_id[project.id].name == "Portal"


@pytest.mark.asyncio
async def test_snapshot_is_immutable(store):
    await store.create_workspace("Acme")
    with pytest.raises(dataclasses.FrozenInstanceError):
        store.snapshot.workspaces = ()
    with pytest.raises(dataclasses.FrozenInstanceError):
        store.snapshot.workspaces[0].name = "x"
    with pytest.raises(TypeError):
        store.snapshot.workspace_by_key["hack"] = None


@pytest.mark.asyncio
async def test_snapshot_indexes(store, dirs):
    ws = await store.create_workspace("Acme")
    p1 = await store.create_project(ws.id, "One", [folder_spec(dirs["a"])])
    p2 = await store.create_project(ws.id, "Two", [folder_spec(dirs["a"]), folder_spec(dirs["b"])])
    snap = store.snapshot
    assert snap.workspace_by_key[ws.key] is snap.workspace_by_id[ws.id]
    assert snap.project_by_key[p1.key] is snap.project_by_id[p1.id]
    assert [p.id for p in snap.projects_by_workspace_id[ws.id]] == [p1.id, p2.id]
    shared = snap.folder_canonical_index[folder_spec(dirs["a"])["canonical_path"]]
    assert {project_id for project_id, _ in shared} == {p1.id, p2.id}
    assert len(snap.folder_canonical_index[folder_spec(dirs["b"])["canonical_path"]]) == 1


@pytest.mark.asyncio
async def test_archived_rows_stay_in_the_snapshot(store, dirs):
    ws = await store.create_workspace("Acme")
    project = await store.create_project(ws.id, "Site", [folder_spec(dirs["a"])])
    await store.update_project(project.id, archived=True)
    await store.update_workspace(ws.id, archived=True)
    assert store.snapshot.project_by_key[project.key].archived
    assert store.snapshot.workspace_by_key[ws.key].archived


@pytest.mark.asyncio
async def test_list_registry_hides_archived_unless_asked(store, dirs):
    ws = await store.create_workspace("Acme")
    keep = await store.create_project(ws.id, "Keep", [folder_spec(dirs["a"])])
    gone = await store.create_project(ws.id, "Gone", [folder_spec(dirs["b"])])
    await store.update_project(gone.id, archived=True)
    hidden = await store.list_registry(include_archived=False)
    assert [p["key"] for p in hidden["workspaces"][0]["projects"]] == [keep.key]
    shown = await store.list_registry(include_archived=True)
    assert {p["key"] for p in shown["workspaces"][0]["projects"]} == {keep.key, gone.key}
    assert hidden["seeded"] is None


# -- adoption never accepts a key with a reserved ("." prefixed) segment ----------------


@pytest.mark.asyncio
async def test_workspace_adoption_refuses_dot_prefixed_keys(store):
    with pytest.raises(RegistryValidationError) as excinfo:
        await store.create_workspace("Evil", adopt_key=".p5")
    assert excinfo.value.problems[0]["code"] == "invalid_key"
    assert store.snapshot.workspaces == ()


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace_name, adopt_workspace, key", [
    ("W", None, ".w1/x"),
    ("W", None, ".w1/.p2/x"),
    ("W", None, ".w1/.hidden"),
    ("Pessoal", "Pessoal", "Pessoal/.p3/x"),
    ("Pessoal", "Pessoal", "Pessoal/x/.p3"),
    ("Pessoal", "Pessoal", "Pessoal/.w3"),
    ("Pessoal", "Pessoal", "Pessoal/.p3"),
])
async def test_project_adoption_refuses_keys_with_a_reserved_segment(
    store, dirs, workspace_name, adopt_workspace, key,
):
    workspace = await store.create_workspace(workspace_name, adopt_key=adopt_workspace)
    with pytest.raises(RegistryValidationError) as excinfo:
        await store.create_project(
            workspace.id, "P", [folder_spec(dirs["a"], primary=True)], adopt_key=key,
        )
    assert excinfo.value.problems[0]["code"] == "invalid_key"
    assert store.snapshot.projects == ()
