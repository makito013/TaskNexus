"""Property test: for legacy keys the registry-based "same workspace" rule is
exactly the old "same cliente" rule (opcoes2 section 3.4, ADR-24).

This is the security contract of the agent hooks (a P0 bug lived here once), so
the comparison runs over EVERY pair of keys of a tree that includes the
degenerate cases: client-as-project, nested projects, synthetic parent folders,
folders created after the seed, and orphan keys whose folder is gone.
"""
from __future__ import annotations

import itertools

import pytest
import pytest_asyncio

from app.agent_discovery import cliente_id_from_projeto_id, scan_projects
from app.workspace_keys import (
    is_synthetic_key,
    same_workspace,
    scope_workspace_key,
    workspace_scope_of,
)
from app.workspace_store import WorkspaceStore
from registry_helpers import folder_spec, make_tree


@pytest_asyncio.fixture
async def seeded(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    store = WorkspaceStore(db_path=str(tmp_path / "equivalence.db"))
    await store.initialize()
    try:
        await store.seed_from_legacy_once(scan_projects(str(root)), str(root))
        # Created on disk after the seed: legacy keys with no registry row.
        (root / "Pessoal" / "Y" / ".claude").mkdir(parents=True)
        (root / "NewCo" / "Z" / ".claude").mkdir(parents=True)
        yield store, root
    finally:
        await store.close()


def _legacy_keys(root) -> set[str]:
    scanned = {p.id for p in scan_projects(str(root))}
    return scanned | {
        "podesubir", "projeto_2", "Pessoal", "NewCo",  # client-level keys
        "Sumiu/x", "Sumiu", "Pessoal/removido",  # orphans: nothing on disk, nothing registered
        # dot segments that are NOT synthetic: the V2 treats them as plain keys
        "Pessoal/.hidden", "Pessoal/../podesubir", ".hidden/x", ".w1x", ".w1/.hidden",
    }


@pytest.mark.asyncio
async def test_same_workspace_equals_same_cliente_for_every_pair_of_legacy_keys(seeded):
    store, root = seeded
    snapshot = store.snapshot
    keys = _legacy_keys(root)
    assert {"Pessoal/Y", "NewCo/Z", "Sumiu/x"} <= keys  # post-seed and orphan keys are in
    pairs = list(itertools.product(sorted(keys), repeat=2))
    assert len(pairs) == len(keys) ** 2 and len(keys) >= 13
    for a, b in pairs:
        expected = cliente_id_from_projeto_id(a) == cliente_id_from_projeto_id(b)
        assert same_workspace(a, b, snapshot) is expected, (a, b)


@pytest.mark.asyncio
async def test_scope_workspace_key_is_the_first_segment_for_every_legacy_key(seeded):
    store, root = seeded
    snapshot = store.snapshot
    for key in _legacy_keys(root):
        assert scope_workspace_key(key, snapshot) == cliente_id_from_projeto_id(key), key


@pytest.mark.asyncio
async def test_equivalence_still_holds_after_archiving_a_seeded_workspace_and_project(seeded):
    store, root = seeded
    await store.update_workspace(store.snapshot.workspace_by_key["podesubir"].id, archived=True)
    await store.update_project(store.snapshot.project_by_key["Pessoal/tn-sandbox"].id, archived=True)
    snapshot = store.snapshot
    keys = _legacy_keys(root)
    for a, b in itertools.product(sorted(keys), repeat=2):
        expected = cliente_id_from_projeto_id(a) == cliente_id_from_projeto_id(b)
        assert same_workspace(a, b, snapshot) is expected, (a, b)


@pytest.mark.asyncio
async def test_a_legacy_key_never_shares_a_scope_with_a_synthetic_workspace(seeded, tmp_path):
    store, root = seeded
    created = tmp_path / "created"
    created.mkdir()
    workspace = await store.create_workspace("Fresh")
    project = await store.create_project(workspace.id, "P", [folder_spec(created, primary=True)])
    snapshot = store.snapshot
    synthetic = {workspace.key, project.key, "Pessoal/.p9", ".w99/.p99"}
    for legacy in _legacy_keys(root):
        for key in synthetic:
            assert not same_workspace(legacy, key, snapshot), (legacy, key)
            assert not same_workspace(key, legacy, snapshot), (legacy, key)
    # The registered pair does share a scope (the positive control of the loop above).
    assert same_workspace(workspace.key, project.key, snapshot)


@pytest.mark.asyncio
async def test_unknown_synthetic_key_is_only_equal_to_itself(seeded):
    store, _ = seeded
    snapshot = store.snapshot
    assert workspace_scope_of(".w404/.p404", snapshot) == "unknown:.w404/.p404"
    assert same_workspace(".w404/.p404", ".w404/.p404", snapshot)
    assert not same_workspace(".w404/.p404", ".w404/.p405", snapshot)
    assert not same_workspace(".w404/.p404", ".w404", snapshot)


@pytest.mark.asyncio
async def test_synthetic_project_under_a_seeded_workspace_shares_its_scope(seeded, tmp_path):
    store, _ = seeded
    created = tmp_path / "under-pessoal"
    created.mkdir()
    pessoal = store.snapshot.workspace_by_key["Pessoal"]
    project = await store.create_project(pessoal.id, "Extra", [folder_spec(created, primary=True)])
    snapshot = store.snapshot
    assert project.key.startswith("Pessoal/.p")
    assert same_workspace(project.key, "Pessoal/tn-sandbox", snapshot)
    assert same_workspace(project.key, "Pessoal/Y", snapshot)  # legacy, not registered yet
    assert same_workspace(project.key, "Pessoal", snapshot)
    assert not same_workspace(project.key, "podesubir/site", snapshot)
    assert scope_workspace_key(project.key, snapshot) == "Pessoal"


@pytest.mark.parametrize("key", ["Pessoal/.hidden", "Pessoal/../podesubir", ".hidden", ".w1x",
                                 ".w/.p", ".p", "Pessoal/.p", "Pessoal/.pX", ".p37", ".w1/.hidden",
                                 ".hidden/.p3", "a/b/.p3", ".w1/.p2/x", ".w1/.p2/", ".w1" + chr(10)])
def test_only_registry_shaped_dot_segments_are_synthetic(key):
    assert not is_synthetic_key(key)


@pytest.mark.parametrize("key", [".w1", "Pessoal/.p37", ".w12/.p38", "meu.projeto/.p5"])
def test_registry_shaped_dot_segments_are_synthetic(key):
    assert is_synthetic_key(key)


@pytest.mark.asyncio
async def test_unknown_synthetic_key_lists_only_itself(seeded):
    store, _ = seeded
    snapshot = store.snapshot
    assert scope_workspace_key(".w404/.p404", snapshot) == ".w404/.p404"
    assert scope_workspace_key("Pessoal/.p404", snapshot) == "Pessoal/.p404"
