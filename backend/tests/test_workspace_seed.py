"""One-time legacy seed of the workspace registry."""
from __future__ import annotations

import os
import sqlite3

import pytest
import pytest_asyncio

from app.agent_discovery import scan_projects
from app.workspace_keys import workspace_key_of
from app.workspace_store import SeedError, WorkspaceStore
from registry_helpers import make_client, make_tree


@pytest_asyncio.fixture
async def store(tmp_path):
    s = WorkspaceStore(db_path=str(tmp_path / "seed.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    return make_tree(root)


async def _count(store, table):
    async with store._conn.execute(f"SELECT COUNT(*) FROM {table}") as cursor:
        return (await cursor.fetchone())[0]


@pytest.mark.asyncio
async def test_full_seed_builds_workspaces_projects_and_folders(store, tree):
    projects = scan_projects(str(tree))
    result = await store.seed_from_legacy_once(projects, str(tree))
    assert result.status == "seeded"
    snap = store.snapshot
    assert {w.key for w in snap.workspaces} == {"Pessoal", "podesubir", "projeto_2"}
    assert all(w.origin == "legacy_seed" and w.name == w.key for w in snap.workspaces)
    eligible = {p.id for p in projects if p.elegivel}
    assert {p.key for p in snap.projects} == eligible
    assert len(snap.projects) == 6
    names = {p.key: p.name for p in snap.projects}
    assert names["Pessoal/TaskNexus-publico"] == "TaskNexus-publico"
    assert names["Pessoal/TaskNexus-publico/frontend"] == "TaskNexus-publico/frontend"
    assert names["Pessoal/tn-sandbox"] == "tn-sandbox"
    assert names["podesubir"] == "podesubir"
    assert names["podesubir/site"] == "site"
    assert names["projeto_2"] == "projeto_2"
    assert (result.workspaces, result.projects) == (3, 6)


@pytest.mark.asyncio
async def test_synthetic_parent_without_eligible_child_is_not_a_workspace(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    assert "Vazio" not in store.snapshot.workspace_by_key
    assert "Vazio" not in store.snapshot.project_by_key


@pytest.mark.asyncio
async def test_parent_with_eligible_children_is_only_a_workspace(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    assert "Pessoal" in store.snapshot.workspace_by_key
    assert "Pessoal" not in store.snapshot.project_by_key


@pytest.mark.asyncio
async def test_client_that_is_also_a_project_gets_both(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    assert "podesubir" in store.snapshot.workspace_by_key
    assert "podesubir" in store.snapshot.project_by_key


@pytest.mark.asyncio
async def test_every_seeded_project_satisfies_i1(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    snap = store.snapshot
    for project in snap.projects:
        assert workspace_key_of(project.key) == snap.workspace_by_id[project.workspace_id].key


@pytest.mark.asyncio
async def test_seeded_folder_is_the_normalized_scan_path_and_primary(store, tree):
    projects = scan_projects(str(tree))
    await store.seed_from_legacy_once(projects, str(tree))
    snap = store.snapshot
    for scanned in (p for p in projects if p.elegivel):
        folders = snap.folders_by_project_id[snap.project_by_key[scanned.id].id]
        assert len(folders) == 1
        assert folders[0].is_primary
        assert folders[0].path == os.path.normpath(os.path.abspath(scanned.path))
        assert folders[0].canonical_path == os.path.normcase(os.path.realpath(scanned.path))


@pytest.mark.asyncio
async def test_seed_is_idempotent(store, tree):
    projects = scan_projects(str(tree))
    first = await store.seed_from_legacy_once(projects, str(tree))
    marker = await store.get_seed_marker()
    again = await store.seed_from_legacy_once(projects, str(tree))
    assert again.status == "already"
    assert (again.workspaces, again.projects) == (first.workspaces, first.projects)
    assert await store.get_seed_marker() == marker
    assert await _count(store, "workspace_projects") == first.projects


@pytest.mark.asyncio
async def test_marker_records_root_and_counts(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    marker = await store.get_seed_marker()
    assert marker["root"] == str(tree)
    assert (marker["workspaces"], marker["projects"]) == (3, 6)
    assert marker["at"] > 0


@pytest.mark.asyncio
async def test_missing_scan_skips_without_a_marker(store, tree):
    result = await store.seed_from_legacy_once(None, str(tree))
    assert result.status == "skipped"
    assert await store.get_seed_marker() is None
    assert await _count(store, "workspaces") == 0


@pytest.mark.asyncio
async def test_no_eligible_projects_skips_without_a_marker(store, tmp_path):
    empty = tmp_path / "empty"
    (empty / "plain").mkdir(parents=True)
    result = await store.seed_from_legacy_once(scan_projects(str(empty)), str(empty))
    assert result.status == "skipped"
    assert await store.get_seed_marker() is None
    assert await _count(store, "workspaces") == 0


@pytest.mark.asyncio
async def test_seed_does_not_reseed_after_everything_is_archived(store, tree):
    projects = scan_projects(str(tree))
    await store.seed_from_legacy_once(projects, str(tree))
    for project in store.snapshot.projects:
        await store.update_project(project.id, archived=True)
    again = await store.seed_from_legacy_once(projects, str(tree))
    assert again.status == "already"


@pytest.mark.asyncio
async def test_complete_mode_inserts_only_what_is_missing(store, tree):
    await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    sandbox = store.snapshot.project_by_key["Pessoal/tn-sandbox"]
    await store.update_project(sandbox.id, name="Renamed", archived=True)
    archived_at = store.snapshot.project_by_id[sandbox.id].archived_at
    # An administrator deletes the marker by hand and a new folder shows up.
    await store._conn.execute("DELETE FROM workspace_registry_meta")
    await store._conn.commit()
    (tree / "Pessoal" / "novo" / ".claude").mkdir(parents=True)
    result = await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    assert result.status == "seeded"
    snap = store.snapshot
    assert "Pessoal/novo" in snap.project_by_key
    assert snap.project_by_key["Pessoal/tn-sandbox"].name == "Renamed"
    assert snap.project_by_key["Pessoal/tn-sandbox"].archived_at == archived_at
    assert len(snap.projects) == 7
    assert len(snap.workspaces) == 3
    assert result.projects == 7
    for project in snap.projects:
        assert len(snap.folders_by_project_id[project.id]) == 1


@pytest.mark.asyncio
async def test_seed_is_all_or_nothing(store, tree, monkeypatch):
    async def boom(payload):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(store, "_insert_seed_marker", boom)
    with pytest.raises(SeedError):
        await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    for table in ("workspaces", "workspace_projects", "project_folders",
                  "workspace_registry_meta"):
        assert await _count(store, table) == 0
    assert store.snapshot.projects == ()
    # The failure left the connection usable: a later attempt succeeds.
    monkeypatch.undo()
    result = await store.seed_from_legacy_once(scan_projects(str(tree)), str(tree))
    assert result.status == "seeded"


# -- lifespan -------------------------------------------------------------------


def test_boot_seeds_the_registry(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    with make_client(tmp_path, root=root) as (_client, main_mod):
        snap = main_mod.workspace_store.snapshot
        assert len(snap.projects) == 6
        assert {w.key for w in snap.workspaces} == {"Pessoal", "podesubir", "projeto_2"}


def test_boot_survives_a_failing_scan_and_seeds_on_the_next_boot(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    db = tmp_path / "sessions.db"

    def break_scan(main_mod):
        def boom(*_args, **_kwargs):
            raise RuntimeError("scan exploded")
        main_mod.scan_projects = boom

    with make_client(tmp_path, root=root, before_boot=break_scan) as (client, main_mod):
        assert client.get("/api/workspaces").json()["seeded"] is None
        assert main_mod.workspace_store.snapshot.workspaces == ()
    conn = sqlite3.connect(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM workspace_registry_meta").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 0
    finally:
        conn.close()
    with make_client(tmp_path, root=root) as (client, main_mod):
        body = client.get("/api/workspaces").json()
        assert body["seeded"] is not None
        assert len(main_mod.workspace_store.snapshot.projects) == 6


def test_boot_with_a_missing_projects_root_does_not_seed(tmp_path):
    with make_client(tmp_path, root=tmp_path / "does-not-exist") as (client, main_mod):
        assert client.get("/api/workspaces").json() == {"seeded": None, "workspaces": []}
        assert main_mod.workspace_store.snapshot.projects == ()


def test_second_boot_does_not_scan_because_the_marker_exists(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    calls = []

    def spy(main_mod):
        real = main_mod.scan_projects

        def counting(*args, **kwargs):
            calls.append(args)
            return real(*args, **kwargs)

        main_mod.scan_projects = counting

    with make_client(tmp_path, root=root, before_boot=spy) as (client, _main):
        first = client.get("/api/workspaces").json()
    assert len(calls) == 1  # the seed scanned once
    assert first["seeded"] is not None

    calls.clear()
    with make_client(tmp_path, root=root, before_boot=spy) as (client, _main):
        second = client.get("/api/workspaces").json()
    assert calls == []  # marker present: no scan at all
    assert second == first


def test_boot_survives_a_seed_that_raises_and_leaves_no_marker(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)

    def exploding_seed(main_mod):
        async def boom(projects, root_path):
            raise RuntimeError("seed exploded")

        main_mod.workspace_store.seed_from_legacy_once = boom

    with make_client(tmp_path, root=root, before_boot=exploding_seed) as (client, _main):
        response = client.get("/api/workspaces")
        assert response.status_code == 200
        assert response.json() == {"seeded": None, "workspaces": []}
        assert client.get("/api/status").status_code == 200
    conn = sqlite3.connect(tmp_path / "sessions.db")
    try:
        assert conn.execute("SELECT COUNT(*) FROM workspace_registry_meta").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 0
    finally:
        conn.close()
