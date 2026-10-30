"""GET /api/folders/discover and POST /api/folders/inspect (read-only)."""
from __future__ import annotations

import os
import sqlite3

import pytest

from registry_helpers import make_client, make_tree

REGISTRY_TABLES = ("workspaces", "workspace_projects", "project_folders", "workspace_registry_meta")


@pytest.fixture
def world(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    folders = {}
    for name in ("a", "b"):
        folders[name] = tmp_path / "folders" / name
        folders[name].mkdir(parents=True)
    return {"root": root, "folders": folders, "tmp": tmp_path}


@pytest.fixture
def env(world):
    with make_client(world["tmp"], root=world["root"]) as (client, main_mod):
        yield client, main_mod, world


def _workspace_id(client, key):
    workspaces = client.get("/api/workspaces?include_archived=1").json()["workspaces"]
    return next(w["id"] for w in workspaces if w["key"] == key)


def _register(client, workspace_name, project_name, folder):
    workspace = client.post("/api/workspaces", json={"name": workspace_name}).json()["workspace"]
    response = client.post(f"/api/workspaces/{workspace['id']}/projects", json={
        "name": project_name, "folders": [{"path": str(folder)}],
    })
    assert response.status_code == 201, response.text
    return workspace, response.json()["project"]


def _counts(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in REGISTRY_TABLES}
    finally:
        conn.close()


def _entries(client):
    response = client.get("/api/folders/discover")
    assert response.status_code == 200
    return response.json(), {e["legacy_key"]: e for e in response.json()["entries"]}


# -- discover -------------------------------------------------------------------------


def test_discover_lists_only_eligible_folders_with_the_contract_shape(env):
    client, _, world = env
    body, entries = _entries(client)
    assert set(body) == {"root", "scanned_in_ms", "entries"}
    assert body["root"] == str(world["root"])
    assert isinstance(body["scanned_in_ms"], int) and body["scanned_in_ms"] >= 0
    assert list(entries) == [
        "Pessoal/TaskNexus-publico", "Pessoal/TaskNexus-publico/frontend", "Pessoal/tn-sandbox",
        "podesubir", "podesubir/site", "projeto_2",
    ]  # "Pessoal" and "Vazio/..." are not eligible
    entry = entries["Pessoal/tn-sandbox"]
    assert set(entry) == {
        "legacy_key", "name", "path", "client_key", "used_by", "adoptable_into_workspace_id",
    }
    assert (entry["name"], entry["client_key"]) == ("tn-sandbox", "Pessoal")
    assert os.path.normcase(entry["path"]) == os.path.normcase(
        str(world["root"] / "Pessoal" / "tn-sandbox")
    )


def test_discover_points_seeded_folders_at_their_projects(env):
    client, _, _ = env
    _, entries = _entries(client)
    sandbox = entries["Pessoal/tn-sandbox"]
    assert len(sandbox["used_by"]) == 1
    used = sandbox["used_by"][0]
    assert (used["project_name"], used["workspace_name"], used["archived"]) == (
        "tn-sandbox", "Pessoal", False,
    )
    assert sandbox["adoptable_into_workspace_id"] is None  # the key is already registered
    assert all(e["adoptable_into_workspace_id"] is None for e in entries.values())


def test_discover_offers_a_new_folder_to_the_workspace_that_owns_its_client(env):
    client, _, world = env
    (world["root"] / "Pessoal" / "Y" / ".claude").mkdir(parents=True)  # after the seed
    (world["root"] / "NewCo" / "Z" / ".claude").mkdir(parents=True)
    _, entries = _entries(client)
    assert entries["Pessoal/Y"]["used_by"] == []
    assert entries["Pessoal/Y"]["adoptable_into_workspace_id"] == _workspace_id(client, "Pessoal")
    assert entries["NewCo/Z"]["adoptable_into_workspace_id"] is None  # no workspace NewCo yet
    assert entries["NewCo/Z"]["client_key"] == "NewCo"

    client.post("/api/workspaces", json={"name": "NewCo", "adopt_legacy_key": "NewCo"})
    _, entries = _entries(client)
    assert entries["NewCo/Z"]["adoptable_into_workspace_id"] == _workspace_id(client, "NewCo")


def test_discover_stops_offering_a_folder_once_its_key_is_registered(env):
    client, _, world = env
    folder = world["root"] / "Pessoal" / "Y"
    (folder / ".claude").mkdir(parents=True)
    pessoal = _workspace_id(client, "Pessoal")
    response = client.post(f"/api/workspaces/{pessoal}/projects", json={
        "name": "Y", "folders": [{"path": str(folder)}],
    })
    assert response.json()["adopted_legacy_key"] == "Pessoal/Y"
    _, entries = _entries(client)
    assert entries["Pessoal/Y"]["adoptable_into_workspace_id"] is None
    assert [u["project_name"] for u in entries["Pessoal/Y"]["used_by"]] == ["Y"]


def test_discover_shows_a_manual_project_that_uses_a_scan_folder(env):
    client, _, world = env
    workspace, project = _register(
        client, "Manual", "same-folder", world["root"] / "projeto_2"
    )
    _, entries = _entries(client)
    names = {(u["workspace_name"], u["project_name"]) for u in entries["projeto_2"]["used_by"]}
    assert names == {("projeto_2", "projeto_2"), ("Manual", "same-folder")}


def test_discover_reports_archived_users(env):
    client, _, _ = env
    sandbox_id = next(
        p["id"]
        for w in client.get("/api/workspaces").json()["workspaces"] if w["key"] == "Pessoal"
        for p in w["projects"] if p["key"] == "Pessoal/tn-sandbox"
    )
    client.patch(f"/api/workspace-projects/{sandbox_id}", json={"archived": True})
    _, entries = _entries(client)
    assert entries["Pessoal/tn-sandbox"]["used_by"][0]["archived"] is True
    # the key is still registered (archived), so it is not "adoptable" either
    assert entries["Pessoal/tn-sandbox"]["adoptable_into_workspace_id"] is None


# -- inspect --------------------------------------------------------------------------


def test_inspect_answers_each_path_in_order_without_one_failure_dropping_the_rest(env):
    client, _, world = env
    _, project = _register(client, "QA", "qa-a", world["folders"]["a"])
    ok = str(world["folders"]["b"])
    denied = "\\\\host\\share"
    used = str(world["folders"]["a"])
    response = client.post("/api/folders/inspect", json={"paths": [ok, denied, used]})
    assert response.status_code == 200
    results = response.json()["results"]
    assert [r["input"] for r in results] == [ok, denied, used]

    assert results[0]["ok"] is True
    assert results[0]["problems"] == []
    assert results[0]["used_by"] == []
    assert results[0]["path"] == os.path.normpath(ok)

    assert results[1]["ok"] is False
    assert results[1]["path"] is None
    assert results[1]["problems"] == [{
        "code": "unc_or_device",
        "message": "Caminhos de rede (\\\\servidor) e de dispositivo (\\\\?\\) não são aceitos. "
                   "Use uma pasta local.",
    }]
    assert results[1]["used_by"] == [] and results[1]["nested_in"] == []

    assert results[2]["ok"] is True
    assert [u["project_id"] for u in results[2]["used_by"]] == [project["id"]]
    assert results[2]["in_this_project"] is False


def test_inspect_exclude_project_id_moves_the_own_project_to_in_this_project(env):
    client, _, world = env
    _, mine = _register(client, "QA", "mine", world["folders"]["a"])
    path = str(world["folders"]["a"])
    plain = client.post("/api/folders/inspect", json={"paths": [path]}).json()["results"][0]
    assert [u["project_id"] for u in plain["used_by"]] == [mine["id"]]
    own = client.post("/api/folders/inspect", json={
        "paths": [path], "exclude_project_id": mine["id"],
    }).json()["results"][0]
    assert own["used_by"] == [] and own["in_this_project"] is True and own["nested_in"] == []


def test_inspect_reports_overlapping_registered_folders(env):
    client, _, world = env
    _register(client, "QA", "qa-a", world["folders"]["a"])
    sub = world["folders"]["a"] / "sub"
    sub.mkdir()
    results = client.post("/api/folders/inspect", json={
        "paths": [str(sub), str(world["folders"]["a"].parent)],
    }).json()["results"]
    assert [(n["relation"], n["project_name"]) for n in results[0]["nested_in"]] == [
        ("inside", "qa-a"),
    ]
    assert results[0]["used_by"] == []
    assert ("contains", "qa-a") in [(n["relation"], n["project_name"]) for n in results[1]["nested_in"]]


def test_inspect_has_marker(env):
    client, _, world = env
    marked = world["folders"]["a"]
    (marked / ".codex").mkdir()
    results = client.post("/api/folders/inspect", json={
        "paths": [str(marked), str(world["folders"]["b"])],
    }).json()["results"]
    assert [r["has_marker"] for r in results] == [True, False]


def test_inspect_negatives_carry_their_code(env):
    client, _, world = env
    a_file = world["tmp"] / "f.txt"
    a_file.write_text("x")
    paths = [str(world["root"]), str(world["tmp"] / "missing"), str(a_file), "", "relative/x"]
    results = client.post("/api/folders/inspect", json={"paths": paths}).json()["results"]
    assert [r["problems"][0]["code"] for r in results] == [
        "projects_root_or_ancestor", "not_found", "not_a_directory", "empty", "not_absolute",
    ]
    assert not any(r["ok"] for r in results)


def test_inspect_has_no_side_effects(env):
    client, _, world = env
    _register(client, "QA", "qa-a", world["folders"]["a"])
    db = str(world["tmp"] / "sessions.db")
    before = _counts(db)
    client.post("/api/folders/inspect", json={"paths": [
        str(world["folders"]["a"]), str(world["folders"]["b"]), "\\\\host\\x", "nope",
    ]})
    client.get("/api/folders/discover")
    assert _counts(db) == before
    assert not (world["folders"]["b"] / ".escritorio").exists()


def test_a_backslash_in_the_json_body_is_not_blocked_by_the_url_middleware(env):
    client, _, _ = env
    response = client.post("/api/folders/inspect", json={"paths": ["D:\\projetos\\meu-app"]})
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["input"] == "D:\\projetos\\meu-app"  # echoed back untouched


def test_inspect_rejects_a_body_with_too_many_paths(env):
    client, _, _ = env
    response = client.post("/api/folders/inspect", json={"paths": ["x"] * 51})
    assert response.status_code == 422
    assert client.post("/api/folders/inspect", json={"paths": ["x"] * 50}).status_code == 200


def test_used_by_marks_a_project_of_an_archived_workspace_as_archived(env):
    client, _, world = env
    workspace, project = _register(client, "QA", "qa-a", world["folders"]["a"])
    path = str(world["folders"]["a"])
    first = client.post("/api/folders/inspect", json={"paths": [path]}).json()["results"][0]
    assert first["used_by"][0]["archived"] is False
    client.patch(f"/api/workspaces/{workspace['id']}", json={"archived": True})
    again = client.post("/api/folders/inspect", json={"paths": [path]}).json()["results"][0]
    assert [(u["project_id"], u["archived"]) for u in again["used_by"]] == [(project["id"], True)]
