"""Agent hooks (cards and tasks) under the registry-based "same workspace" rule.

Security contract: an agent only touches data of its own workspace. The
registry decides for synthetic keys; legacy keys keep the old first-segment
behaviour (proved separately by test_workspace_scope_equivalence.py). Error
texts keep saying "cliente" (S-6), so the literals below match the V2 tests.
"""
from __future__ import annotations

import functools
import sqlite3
from unittest.mock import patch

import pytest

from registry_helpers import (
    insert_registry_direct,
    make_client,
    make_tree,
    prepare_cards_db,
    register_session,
)

AGENT = "agente-teste"


@pytest.fixture
def world(tmp_path):
    """Registry (inserted before the boot) + legacy tree + cards.

    Workspaces: .w1 (project .w1/.p1, archived .w1/.p9), .w2 (project .w2/.p2)
    and Pessoal (seeded; also owns the manual project Pessoal/.p3).
    """
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    folders = {}
    for name in ("a", "b", "c", "d"):
        folders[name] = tmp_path / "folders" / name
        folders[name].mkdir(parents=True)
    db = str(tmp_path / "sessions.db")
    prepare_cards_db(db, [
        ".w2/.p2",  # 1: card of the other workspace
        ".w1/.p1",  # 2: card of the own project
        ".w1",  # 3: workspace-level card
        "Pessoal/tn-sandbox",  # 4: legacy card of the Pessoal workspace
        "Pessoal/.p3",  # 5: card of the synthetic project inside Pessoal
        "podesubir",  # 6: legacy card of another client
        ".w1/.p404",  # 7: orphan synthetic key under the .w1 prefix (no registry row)
        "Pessoal/.hidden",  # 8: legacy-shaped key with a dot segment (not synthetic)
    ])
    insert_registry_direct(
        db,
        workspaces=[(".w1", "W1"), (".w2", "W2"), ("Pessoal", "Pessoal")],
        projects=[
            (".w1/.p1", ".w1", "p1", folders["a"]),
            (".w2/.p2", ".w2", "p2", folders["b"]),
            ("Pessoal/.p3", "Pessoal", "p3", folders["c"]),
            (".w1/.p9", ".w1", "p9", folders["d"]),
        ],
    )
    return {"root": root, "db": db, "folders": folders, "tmp": tmp_path}


@pytest.fixture
def env(world):
    with make_client(world["tmp"], root=world["root"]) as (client, main_mod):
        snapshot = main_mod.workspace_store.snapshot
        client.portal.call(functools.partial(
            main_mod.workspace_store.update_project,
            snapshot.project_by_key[".w1/.p9"].id,
            archived=True,
        ))
        sessions = {
            "w1p1": register_session(client, f".w1/.p1::{AGENT}", ".w1/.p1"),
            "w2p2": register_session(client, f".w2/.p2::{AGENT}", ".w2/.p2"),
            "v2": register_session(client, f"Pessoal/tn-sandbox::{AGENT}", "Pessoal/tn-sandbox"),
            "pp3": register_session(client, f"Pessoal/.p3::{AGENT}", "Pessoal/.p3"),
        }
        yield client, main_mod, sessions, world


def _post(client, route, sid, **body):
    response = client.post(f"/api/hooks/{route}", json={"claude_session_id": sid, **body})
    assert response.status_code == 200
    return response.json()


def _card_row(db, card_id):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    finally:
        conn.close()


def _card_count(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    finally:
        conn.close()


# -- negatives: nothing crosses the workspace boundary --------------------------


def test_top_level_card_in_another_synthetic_workspace_is_refused(env):
    client, _, sessions, world = env
    before = _card_count(world["db"])
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=".w2/.p2")
    assert result == {"success": False, "error": "Projeto '.w2/.p2' pertence a outro cliente"}
    assert _card_count(world["db"]) == before


def test_top_level_card_in_a_seeded_project_of_another_workspace_is_refused(env):
    client, _, sessions, world = env
    before = _card_count(world["db"])
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x",
                   projeto_id="Pessoal/tn-sandbox")
    assert result == {"success": False,
                      "error": "Projeto 'Pessoal/tn-sandbox' pertence a outro cliente"}
    assert _card_count(world["db"]) == before


def test_v2_session_cannot_target_a_synthetic_project_of_another_workspace(env):
    client, _, sessions, world = env
    before = _card_count(world["db"])
    result = _post(client, "cards/create", sessions["v2"], titulo="x", projeto_id=".w1/.p1")
    assert result == {"success": False, "error": "Projeto '.w1/.p1' pertence a outro cliente"}
    assert _card_count(world["db"]) == before


def test_subcard_under_a_card_of_another_workspace_is_refused_and_nothing_is_written(env):
    client, _, sessions, world = env
    before = _card_count(world["db"])
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x", parent_id=1)
    assert result == {"success": False, "error": "Card pai 1 pertence a outro cliente"}
    assert _card_count(world["db"]) == before


@pytest.mark.parametrize("route, extra", [
    ("cards/move", {"novo_status": "feito"}),
    ("cards/update", {"titulo": "hacked"}),
    ("cards/delete", {}),
    ("cards/get", {}),
])
def test_card_of_another_workspace_is_refused_before_it_is_touched(env, route, extra):
    client, _, sessions, world = env
    before = _card_row(world["db"], 1)
    result = _post(client, route, sessions["w1p1"], card_id=1, **extra)
    assert result == {"success": False, "error": "Card 1 pertence a outro cliente"}
    assert _card_row(world["db"], 1) == before  # row intact, including atualizado_em


def test_list_without_projeto_id_never_returns_cards_of_another_workspace(env):
    client, _, sessions, _ = env
    for key in ("w1p1", "w2p2", "v2", "pp3"):
        result = _post(client, "cards/list", sessions[key])
        assert result["success"] is True
        projects = {c["projeto_id"] for c in result["cards"]}
        if key == "w1p1":
            # Includes the orphan ".w1/.p404" card: listing is by prefix of the own workspace.
            assert projects == {".w1/.p1", ".w1", ".w1/.p404"}
        elif key == "w2p2":
            assert projects == {".w2/.p2"}
        else:
            assert projects == {"Pessoal/tn-sandbox", "Pessoal/.p3", "Pessoal/.hidden"}


def test_list_with_projeto_id_of_another_workspace_is_refused(env):
    client, _, sessions, _ = env
    result = _post(client, "cards/list", sessions["w1p1"], projeto_id=".w2/.p2")
    assert result == {"success": False, "error": "Projeto '.w2/.p2' pertence a outro cliente"}
    result = _post(client, "cards/list", sessions["w1p1"], projeto_id="podesubir")
    assert result == {"success": False, "error": "Projeto 'podesubir' pertence a outro cliente"}


def test_delete_task_of_another_workspace_is_refused_and_the_task_survives(env):
    client, _, sessions, _ = env
    created = client.post(f"/api/sessions/.w2/.p2::{AGENT}/tasks", json={
        "titulo": "t", "descricao_markdown": "d",
    })
    assert created.status_code == 201
    task_id = created.json()["id"]
    result = _post(client, "task/delete", sessions["w1p1"], task_id=task_id)
    assert result == {"success": False, "error": f"Tarefa {task_id} pertence a outro cliente"}
    remaining = client.get(f"/api/sessions/.w2/.p2::{AGENT}/tasks").json()
    assert [t["id"] for t in remaining] == [task_id]


def test_create_task_targeting_another_workspace_is_refused(env):
    client, _, sessions, _ = env
    result = _post(client, "task", sessions["w1p1"], titulo="t", descricao_markdown="d",
                   projeto_id=".w2/.p2")
    assert result == {"success": False, "error": "Projeto '.w2/.p2' pertence a outro cliente"}


def test_archived_registry_project_is_not_a_target(env):
    client, _, sessions, _ = env
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=".w1/.p9")
    assert result == {"success": False, "error": "Projeto '.w1/.p9' não existe"}
    result = _post(client, "cards/list", sessions["w1p1"], projeto_id=".w1/.p9")
    assert result == {"success": False, "error": "Projeto '.w1/.p9' não existe"}


def test_unregistered_synthetic_key_does_not_exist(env):
    client, _, sessions, _ = env
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=".w1/.p404")
    assert result == {"success": False, "error": "Projeto '.w1/.p404' não existe"}


def test_legacy_key_missing_from_the_scan_does_not_exist(env):
    client, _, sessions, _ = env
    result = _post(client, "cards/create", sessions["v2"], titulo="x", projeto_id="Pessoal/removido")
    assert result == {"success": False, "error": "Projeto 'Pessoal/removido' não existe"}


# -- positives: the same workspace works in every direction -----------------------


def test_v2_session_creates_a_card_in_a_synthetic_project_of_its_workspace(env):
    client, _, sessions, world = env
    result = _post(client, "cards/create", sessions["v2"], titulo="x", projeto_id="Pessoal/.p3")
    assert result["success"] is True
    assert _card_row(world["db"], result["card_id"])[2] == "Pessoal/.p3"


def test_synthetic_session_creates_a_card_in_a_legacy_project_of_its_workspace(env):
    client, _, sessions, world = env
    result = _post(client, "cards/create", sessions["pp3"], titulo="x",
                   projeto_id="Pessoal/tn-sandbox")
    assert result["success"] is True
    assert _card_row(world["db"], result["card_id"])[2] == "Pessoal/tn-sandbox"


def test_card_for_the_workspace_itself_is_a_valid_target(env):
    client, _, sessions, world = env
    result = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=".w1")
    assert result["success"] is True
    assert _card_row(world["db"], result["card_id"])[2] == ".w1"


def test_create_task_for_the_workspace_itself_is_allowed(env):
    client, _, sessions, _ = env
    result = _post(client, "task", sessions["w1p1"], titulo="t", descricao_markdown="d",
                   projeto_id=".w1")
    assert result["success"] is True


def test_agent_can_move_get_and_delete_cards_of_its_own_workspace(env):
    client, _, sessions, _ = env
    # card 3 is the workspace-level card ".w1"; card 2 belongs to .w1/.p1.
    moved = _post(client, "cards/move", sessions["w1p1"], card_id=3, novo_status="feito")
    assert moved["success"] is True
    got = _post(client, "cards/get", sessions["w1p1"], card_id=2)
    assert got["success"] is True and got["card"]["projeto_id"] == ".w1/.p1"
    deleted = _post(client, "cards/delete", sessions["w1p1"], card_id=2)
    assert deleted["success"] is True


def test_subcard_under_a_card_of_the_same_workspace_is_created(env):
    client, _, sessions, _ = env
    result = _post(client, "cards/create", sessions["pp3"], titulo="sub", parent_id=4)
    assert result["success"] is True


def test_delete_task_of_the_same_workspace_succeeds(env):
    client, _, sessions, _ = env
    created = client.post(f"/api/sessions/Pessoal/tn-sandbox::{AGENT}/tasks", json={
        "titulo": "t", "descricao_markdown": "d",
    })
    task_id = created.json()["id"]
    result = _post(client, "task/delete", sessions["pp3"], task_id=task_id)
    assert result == {"success": True}


# -- no needless disk scans ----------------------------------------------------------


def test_synthetic_targets_never_scan_the_disk(env):
    client, _, sessions, _ = env
    with patch("app.main.scan_projects", side_effect=AssertionError("unneeded scan")):
        created = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=".w1")
        listed = _post(client, "cards/list", sessions["w1p1"], projeto_id=".w1/.p1")
        refused = _post(client, "cards/list", sessions["w1p1"], projeto_id=".w2/.p2")
        no_target = _post(client, "cards/create", sessions["w1p1"], titulo="y")
        listed_all = _post(client, "cards/list", sessions["w1p1"])
    assert created["success"] is True and listed["success"] is True
    assert refused["success"] is False
    assert no_target["success"] is True and listed_all["success"] is True


def test_legacy_target_scans_the_disk_exactly_once(env):
    client, main_mod, sessions, _ = env
    real_scan = main_mod.scan_projects
    calls = []

    def spy(*args, **kwargs):
        calls.append(1)
        return real_scan(*args, **kwargs)

    with patch("app.main.scan_projects", side_effect=spy):
        result = _post(client, "cards/list", sessions["v2"], projeto_id="Pessoal/tn-sandbox")
    assert result["success"] is True
    assert len(calls) == 1


# -- orphan synthetic keys: the registry rule is NOT the first-segment rule -----------
# `.w1/.p404` has the prefix of workspace .w1 but no registry row, so its scope is
# "unknown:" and only equal to itself. These tests kill the mutants that bring a
# site back to the old first-segment rule.


@pytest.mark.parametrize("route, extra", [
    ("cards/get", {}),
    ("cards/move", {"novo_status": "feito"}),
    ("cards/update", {"titulo": "hacked"}),
    ("cards/delete", {}),
])
def test_card_with_an_orphan_synthetic_key_is_refused_before_it_is_touched(env, route, extra):
    client, _, sessions, world = env
    before = _card_row(world["db"], 7)
    result = _post(client, route, sessions["w1p1"], card_id=7, **extra)
    assert result == {"success": False, "error": "Card 7 pertence a outro cliente"}
    assert _card_row(world["db"], 7) == before


def test_subcard_under_a_card_with_an_orphan_synthetic_key_is_refused(env):
    client, _, sessions, world = env
    before = _card_count(world["db"])
    result = _post(client, "cards/create", sessions["w1p1"], titulo="sub", parent_id=7)
    assert result == {"success": False, "error": "Card pai 7 pertence a outro cliente"}
    assert _card_count(world["db"]) == before


def test_task_of_an_orphan_synthetic_key_cannot_be_deleted_by_a_sibling_project(env):
    client, _, sessions, _ = env
    created = client.post(f"/api/sessions/.w1/.p404::{AGENT}/tasks", json={
        "titulo": "t", "descricao_markdown": "d",
    })
    assert created.status_code == 201
    task_id = created.json()["id"]
    result = _post(client, "task/delete", sessions["w1p1"], task_id=task_id)
    assert result == {"success": False, "error": f"Tarefa {task_id} pertence a outro cliente"}
    assert [t["id"] for t in client.get(f"/api/sessions/.w1/.p404::{AGENT}/tasks").json()] == [task_id]


def test_orphan_synthetic_session_lists_only_its_own_cards(env):
    client, _, _, _ = env
    orphan = register_session(client, f".w1/.p404::{AGENT}", ".w1/.p404")
    result = _post(client, "cards/list", orphan)
    assert result["success"] is True
    assert {c["projeto_id"] for c in result["cards"]} == {".w1/.p404"}


# -- a project inside an archived workspace is not a write target (S-4, ADR-29) -------


def test_project_inside_an_archived_workspace_is_not_a_target_but_still_resolves(env):
    client, main_mod, sessions, _ = env
    store = main_mod.workspace_store
    client.portal.call(functools.partial(
        store.update_workspace, store.snapshot.workspace_by_key[".w1"].id, archived=True,
    ))
    for target in (".w1/.p1", ".w1"):
        created = _post(client, "cards/create", sessions["w1p1"], titulo="x", projeto_id=target)
        assert created == {"success": False, "error": f"Projeto '{target}' não existe"}
        listed = _post(client, "cards/list", sessions["w1p1"], projeto_id=target)
        assert listed == {"success": False, "error": f"Projeto '{target}' não existe"}
    # Existing data and cwd/root keep resolving: only NEW writes by an agent are refused.
    assert _post(client, "cards/get", sessions["w1p1"], card_id=2)["success"] is True
    assert main_mod._registry_root_for(".w1/.p1") is not None
    assert main_mod._registry_project(".w1/.p1") is not None
    # Without a target the agent still writes in its own (conversation) project.
    assert _post(client, "cards/create", sessions["w1p1"], titulo="own")["success"] is True


# -- dot-segment keys that are not synthetic behave exactly like the V2 ---------------


def test_legacy_shaped_key_with_a_dot_segment_follows_the_first_segment_rule(env):
    client, _, sessions, _ = env
    # Card 8 is "Pessoal/.hidden": same cliente as the V2 session Pessoal/tn-sandbox.
    got = _post(client, "cards/get", sessions["v2"], card_id=8)
    assert got["success"] is True and got["card"]["projeto_id"] == "Pessoal/.hidden"
    assert _post(client, "cards/move", sessions["v2"], card_id=8, novo_status="feito")["success"] is True
    # ...and still another cliente for a session of a different workspace.
    assert _post(client, "cards/get", sessions["w1p1"], card_id=8) == {
        "success": False, "error": "Card 8 pertence a outro cliente"}
    # As a target it does not exist (the scan never lists dot folders), like in the V2.
    assert _post(client, "cards/create", sessions["v2"], titulo="x", projeto_id="Pessoal/.hidden") == {
        "success": False, "error": "Projeto 'Pessoal/.hidden' não existe"}
