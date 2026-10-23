"""Write routes of the workspace registry: workspaces, projects, folder
validation, warnings and legacy-key adoption (F3)."""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.models import ProjectCreateRequest, WorkspaceCreateRequest
from registry_helpers import make_client, make_tree, register_session

AGENT = "agente-teste"
SLEEP_CMD = [sys.executable, "-c", "import time; time.sleep(5)"]


@pytest.fixture
def world(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    folders = {}
    for name in ("a", "b", "c"):
        folders[name] = tmp_path / "folders" / name
        folders[name].mkdir(parents=True)
    return {"root": root, "folders": folders, "tmp": tmp_path}


@pytest.fixture
def env(world):
    with make_client(world["tmp"], root=world["root"]) as (client, main_mod):
        yield client, main_mod, world


# -- tiny API helpers ---------------------------------------------------------------


def _workspaces(client, include_archived=False):
    response = client.get(f"/api/workspaces?include_archived={int(include_archived)}")
    assert response.status_code == 200
    return response.json()["workspaces"]


def _workspace_id(client, key):
    return next(w["id"] for w in _workspaces(client, True) if w["key"] == key)


def _project(client, key):
    for workspace in _workspaces(client, True):
        for project in workspace["projects"]:
            if project["key"] == key:
                return project
    raise AssertionError(f"project {key} not found")


def _new_workspace(client, name="QA A", **extra):
    response = client.post("/api/workspaces", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()["workspace"]


def _folders(*paths, primary=None):
    return [
        {"path": str(p), **({"is_primary": True} if primary is not None and i == primary else {})}
        for i, p in enumerate(paths)
    ]


def _new_project(client, workspace_id, name, *paths, primary=None):
    response = client.post(
        f"/api/workspaces/{workspace_id}/projects",
        json={"name": name, "folders": _folders(*paths, primary=primary)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _post_project(client, workspace_id, name, folders):
    return client.post(
        f"/api/workspaces/{workspace_id}/projects", json={"name": name, "folders": folders}
    )


# -- workspaces ---------------------------------------------------------------------


def test_create_workspace_mints_a_synthetic_key(env):
    client, _, _ = env
    workspace = _new_workspace(client, "  QA A  ")
    assert workspace["key"] == f".w{workspace['id']}"
    assert workspace["name"] == "QA A"
    assert workspace["origin"] == "manual"
    assert workspace["archived"] is False
    assert workspace["projects"] == []
    assert any(w["key"] == workspace["key"] for w in _workspaces(client))


@pytest.mark.parametrize("name", ["", "   ", "a" * 81])
def test_create_workspace_rejects_invalid_names(env, name):
    client, _, _ = env
    response = client.post("/api/workspaces", json={"name": name})
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["problems"][0]["code"] == "invalid_name"
    assert detail["message"] == "Informe um nome com 1 a 80 caracteres."


def test_adopting_a_legacy_client_key_for_a_workspace(env):
    client, _, world = env
    (world["root"] / "NewCo" / "x" / ".claude").mkdir(parents=True)  # created after the seed
    response = client.post("/api/workspaces", json={"name": "NewCo", "adopt_legacy_key": "NewCo"})
    assert response.status_code == 201
    workspace = response.json()["workspace"]
    assert (workspace["key"], workspace["origin"]) == ("NewCo", "legacy_adopted")

    again = client.post("/api/workspaces", json={"name": "NewCo", "adopt_legacy_key": "NewCo"})
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "adopt_conflict"


def test_adoption_of_a_workspace_that_exists_archived_says_so(env):
    client, _, _ = env
    pessoal = _workspace_id(client, "Pessoal")
    assert client.patch(f"/api/workspaces/{pessoal}", json={"archived": True}).status_code == 200
    response = client.post("/api/workspaces", json={"name": "P", "adopt_legacy_key": "Pessoal"})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert (detail["code"], detail["archived"], detail["workspace_id"]) == (
        "adopt_conflict", True, pessoal,
    )


@pytest.mark.parametrize("key", ["Pessoal/x", ".w1", "a/b/c", ".hidden"])
def test_adopting_something_that_is_not_a_top_level_legacy_key_is_a_400(env, key):
    client, _, _ = env
    response = client.post("/api/workspaces", json={"name": "X", "adopt_legacy_key": key})
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == "invalid_key"


def test_adopting_a_client_the_scan_does_not_know_is_a_409(env):
    client, _, _ = env
    response = client.post("/api/workspaces", json={"name": "X", "adopt_legacy_key": "Nowhere"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "adopt_conflict"
    assert response.json()["detail"]["reason"] == "not_in_scan"
    # a parent folder without any eligible project is not a client either
    response = client.post("/api/workspaces", json={"name": "X", "adopt_legacy_key": "Vazio"})
    assert response.status_code == 409


def test_patch_workspace_renames_archives_and_unarchives(env):
    client, _, _ = env
    workspace = _new_workspace(client, "Old")
    url = f"/api/workspaces/{workspace['id']}"
    assert client.patch(url, json={"name": " New "}).json()["workspace"]["name"] == "New"
    archived = client.patch(url, json={"archived": True}).json()["workspace"]
    assert archived["archived"] is True and archived["name"] == "New"
    assert workspace["key"] not in [w["key"] for w in _workspaces(client)]
    assert workspace["key"] in [w["key"] for w in _workspaces(client, True)]
    assert client.patch(url, json={"archived": False}).json()["workspace"]["archived"] is False
    assert workspace["key"] in [w["key"] for w in _workspaces(client)]


def test_patch_workspace_errors(env):
    client, _, _ = env
    workspace = _new_workspace(client)
    assert client.patch("/api/workspaces/9999", json={"name": "x"}).status_code == 404
    assert client.patch(f"/api/workspaces/{workspace['id']}", json={"colour": "red"}).status_code == 422
    assert client.patch(f"/api/workspaces/{workspace['id']}", json={"name": ""}).status_code == 400
    assert client.patch(f"/api/workspaces/{workspace['id']}", json={"name": "a" * 81}).status_code == 400


# -- create project ------------------------------------------------------------------


def test_create_project_mints_a_key_and_defaults_the_primary_to_the_first_folder(env):
    client, _, world = env
    workspace = _new_workspace(client)
    body = _new_project(client, workspace["id"], " qa-a ", world["folders"]["a"], world["folders"]["b"])
    project = body["project"]
    assert project["key"] == f"{workspace['key']}/.p{project['id']}"
    assert project["name"] == "qa-a"
    assert project["origin"] == "manual"
    assert body["adopted_legacy_key"] is None
    assert body["warnings"] == []
    assert project["primary_locked"] is False
    assert [(f["is_primary"], f["position"], f["exists"]) for f in project["folders"]] == [
        (True, 0, True), (False, 1, True),
    ]
    listed = _project(client, project["key"])
    assert listed["folders"][0]["path"] == project["folders"][0]["path"]


def test_an_explicit_primary_is_honored(env):
    client, _, world = env
    workspace = _new_workspace(client)
    body = _new_project(
        client, workspace["id"], "p", world["folders"]["a"], world["folders"]["b"], primary=1
    )
    assert [f["is_primary"] for f in body["project"]["folders"]] == [False, True]


def test_two_primaries_zero_or_eleven_folders_are_400(env):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    a, b = str(world["folders"]["a"]), str(world["folders"]["b"])

    response = _post_project(client, ws, "p", [
        {"path": a, "is_primary": True}, {"path": b, "is_primary": True},
    ])
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == "multiple_primary"

    response = _post_project(client, ws, "p", [])
    assert response.json()["detail"]["problems"][0]["code"] == "no_folders"

    response = _post_project(client, ws, "p", [{"path": a}] * 11)
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == "too_many_folders"
    assert response.json()["detail"]["problems"][0]["message"] == (
        "Um projeto pode ter no máximo 10 pastas."
    )


def test_ten_folders_are_accepted(env):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    paths = []
    for i in range(10):
        folder = world["tmp"] / "many" / f"f{i}"
        folder.mkdir(parents=True)
        paths.append(folder)
    body = _new_project(client, ws, "ten", *paths)
    assert len(body["project"]["folders"]) == 10


def test_duplicate_folder_in_the_same_project_is_400_on_the_second_input(env):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    a = world["folders"]["a"]
    response = _post_project(client, ws, "p", [{"path": str(a)}, {"path": str(a) + "/"}])
    assert response.status_code == 400
    problems = response.json()["detail"]["problems"]
    assert [(p["code"], p["path"]) for p in problems] == [("duplicate_in_project", str(a) + "/")]


@pytest.mark.parametrize("raw, code", [
    ("\\\\host\\share", "unc_or_device"),
    ("\\\\?\\C:\\x", "unc_or_device"),
    ("//host/x", "unc_or_device"),
    ("projetos\\x", "not_absolute"),
    ("..\\..\\Windows", "not_absolute"),
    ("", "empty"),
    ("D:\\" + "a" * 2000, "too_long"),
])
def test_lexical_negatives_via_post_are_400_with_the_typed_path(env, raw, code):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    response = _post_project(client, ws, "p", [{"path": raw}])
    assert response.status_code == 400
    problem = response.json()["detail"]["problems"][0]
    assert (problem["code"], problem["path"]) == (code, raw)
    assert problem["message"]


def test_disk_negatives_via_post_are_400(env):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    a_file = world["tmp"] / "file.txt"
    a_file.write_text("x")
    cases = [
        (str(world["root"]), "projects_root_or_ancestor"),
        (str(world["tmp"]), "projects_root_or_ancestor"),
        (str(world["tmp"] / "missing"), "not_found"),
        (str(a_file), "not_a_directory"),
    ]
    import os
    drive_root = os.path.splitdrive(str(world["tmp"]))[0] + os.sep if sys.platform == "win32" else "/"
    cases.append((drive_root, "drive_root"))
    # "~" itself is covered by the unit tests: here the temp projects root sits
    # under the real home, which makes home an ancestor of the root instead.
    cases.append((os.path.join(os.path.expanduser("~"), ".ssh"), "sensitive_folder"))
    for raw, code in cases:
        response = _post_project(client, ws, "p", [{"path": raw}])
        assert response.status_code == 400, raw
        assert response.json()["detail"]["problems"][0]["code"] == code, raw


def test_every_bad_folder_is_reported_with_its_own_path_and_nothing_is_saved(env):
    client, _, world = env
    ws = _new_workspace(client)
    before = len(_workspaces(client)[-1]["projects"])
    response = _post_project(client, ws["id"], "", [
        {"path": str(world["folders"]["a"])},
        {"path": str(world["tmp"] / "missing")},
        {"path": "relative"},
    ])
    assert response.status_code == 400
    problems = response.json()["detail"]["problems"]
    assert {(p["code"], p["path"]) for p in problems} == {
        ("invalid_name", None),
        ("not_found", str(world["tmp"] / "missing")),
        ("not_absolute", "relative"),
    }
    assert len(_workspaces(client)[-1]["projects"]) == before == 0


def test_create_project_in_unknown_or_archived_workspace(env):
    client, _, world = env
    a = str(world["folders"]["a"])
    assert _post_project(client, 9999, "p", [{"path": a}]).status_code == 404
    ws = _new_workspace(client)
    client.patch(f"/api/workspaces/{ws['id']}", json={"archived": True})
    response = _post_project(client, ws["id"], "p", [{"path": a}])
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "workspace_archived"
    assert response.json()["detail"]["message"] == (
        "Este workspace está arquivado. Desarquive-o antes de adicionar projetos."
    )


def test_invalid_name_on_project(env):
    client, _, world = env
    ws = _new_workspace(client)["id"]
    for name in ("", "a" * 81):
        response = _post_project(client, ws, name, [{"path": str(world["folders"]["a"])}])
        assert response.status_code == 400
        assert response.json()["detail"]["problems"][0]["code"] == "invalid_name"


# -- warnings -------------------------------------------------------------------------


def test_a_folder_used_by_another_project_is_a_warning_not_an_error(env):
    client, _, world = env
    ws_a = _new_workspace(client, "QA A")
    ws_b = _new_workspace(client, "QA B")
    first = _new_project(client, ws_a["id"], "qa-a", world["folders"]["a"])["project"]
    body = _new_project(client, ws_b["id"], "qa-shared", world["folders"]["a"])
    assert body["warnings"] == [{
        "path": str(world["folders"]["a"]),
        "code": "already_used",
        "relation": None,
        "projects": [{
            "project_id": first["id"], "project_name": "qa-a",
            "workspace_id": ws_a["id"], "workspace_name": "QA A", "archived": False,
        }],
    }]
    assert _project(client, body["project"]["key"])["folders"][0]["exists"] is True


def test_an_archived_project_still_counts_for_already_used(env):
    client, _, world = env
    ws = _new_workspace(client)
    first = _new_project(client, ws["id"], "old", world["folders"]["a"])["project"]
    client.patch(f"/api/workspace-projects/{first['id']}", json={"archived": True})
    body = _new_project(client, ws["id"], "new", world["folders"]["a"])
    warning = body["warnings"][0]
    assert warning["code"] == "already_used"
    assert warning["projects"][0]["archived"] is True


def test_nested_folders_warn_in_both_directions(env):
    client, _, world = env
    ws = _new_workspace(client)
    first = _new_project(client, ws["id"], "qa-a", world["folders"]["a"])["project"]
    sub = world["folders"]["a"] / "sub"
    sub.mkdir()
    inside = _new_project(client, ws["id"], "inner", sub)["warnings"]
    assert [(w["code"], w["relation"]) for w in inside] == [("nested", "inside")]
    assert inside[0]["projects"][0]["project_id"] == first["id"]

    parent = _new_project(client, ws["id"], "outer", world["folders"]["a"].parent)["warnings"]
    contains = [w for w in parent if w["relation"] == "contains"]
    assert contains and contains[0]["code"] == "nested"
    assert {p["project_name"] for p in contains[0]["projects"]} == {"qa-a", "inner"}
    assert not [w for w in parent if w["code"] == "already_used"]


def test_a_homonym_project_in_the_workspace_warns_name_in_use(env):
    client, _, world = env
    ws = _new_workspace(client)
    _new_project(client, ws["id"], "Same", world["folders"]["a"])
    body = _new_project(client, ws["id"], "same", world["folders"]["b"])
    assert [(w["code"], w["path"]) for w in body["warnings"]] == [("name_in_use", None)]
    assert body["warnings"][0]["projects"][0]["project_name"] == "Same"
    # a homonym in ANOTHER workspace is fine
    other = _new_workspace(client, "Other")
    assert _new_project(client, other["id"], "Same", world["folders"]["c"])["warnings"] == []


# -- adoption of legacy keys -----------------------------------------------------------


def _mark(path):
    (path / ".claude").mkdir(parents=True)
    return path


def test_adoption_when_all_four_conditions_hold(env):
    client, _, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y")  # created after the seed
    pessoal = _workspace_id(client, "Pessoal")
    body = _new_project(client, pessoal, "Y", folder)
    assert body["adopted_legacy_key"] == "Pessoal/Y"
    project = body["project"]
    assert (project["key"], project["origin"], project["primary_locked"]) == (
        "Pessoal/Y", "legacy_adopted", True,
    )
    assert _project(client, "Pessoal/Y")["id"] == project["id"]


def test_no_adoption_without_the_claude_marker(env):
    client, _, world = env
    folder = world["root"] / "Pessoal" / "Plain"
    folder.mkdir(parents=True)
    body = _new_project(client, _workspace_id(client, "Pessoal"), "Plain", folder)
    assert body["adopted_legacy_key"] is None
    assert body["project"]["key"] == f"Pessoal/.p{body['project']['id']}"
    assert body["project"]["primary_locked"] is False


def test_no_adoption_into_a_workspace_that_does_not_own_the_key(env):
    client, _, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y2")
    other = _new_workspace(client)  # ".wN": I1 forbids "Pessoal/Y2" there
    body = _new_project(client, other["id"], "Y2", folder)
    assert body["adopted_legacy_key"] is None
    assert body["project"]["key"].startswith(f"{other['key']}/.p")
    # the legacy key stays free for the workspace that owns it
    assert all(p["key"] != "Pessoal/Y2" for w in _workspaces(client, True) for p in w["projects"])
    adopted = _new_project(client, _workspace_id(client, "Pessoal"), "Y2", folder)
    assert adopted["adopted_legacy_key"] == "Pessoal/Y2"


def test_no_adoption_when_an_active_project_owns_the_key(env):
    client, _, world = env
    sandbox = world["root"] / "Pessoal" / "tn-sandbox"
    body = _new_project(client, _workspace_id(client, "Pessoal"), "second", sandbox)
    assert body["adopted_legacy_key"] is None
    assert body["project"]["key"].startswith("Pessoal/.p")
    warning = body["warnings"][0]
    assert warning["code"] == "already_used"
    assert warning["projects"][0]["project_name"] == "tn-sandbox"


def test_adoption_of_an_archived_key_is_a_409_with_the_archived_project_id(env):
    client, _, world = env
    seeded = _project(client, "Pessoal/tn-sandbox")
    client.patch(f"/api/workspace-projects/{seeded['id']}", json={"archived": True})
    sandbox = world["root"] / "Pessoal" / "tn-sandbox"
    response = _post_project(client, _workspace_id(client, "Pessoal"), "again", [{"path": str(sandbox)}])
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "adopt_conflict"
    assert detail["archived_project_id"] == seeded["id"]
    assert detail["message"] == 'Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".'
    # nothing was created
    assert [p["name"] for w in _workspaces(client, True) if w["key"] == "Pessoal" for p in w["projects"]
            if p["name"] == "again"] == []


def test_no_adoption_when_the_primary_is_not_the_scan_folder_itself(env):
    client, _, world = env
    docs = _mark(world["root"] / "Pessoal" / "Y3") / "docs"
    docs.mkdir()
    body = _new_project(client, _workspace_id(client, "Pessoal"), "docs", docs)
    assert body["adopted_legacy_key"] is None
    assert body["project"]["key"].startswith("Pessoal/.p")


def test_adoption_only_looks_at_the_primary_folder(env):
    client, _, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y4")
    body = _new_project(
        client, _workspace_id(client, "Pessoal"), "y4", world["folders"]["a"], folder
    )
    assert body["adopted_legacy_key"] is None  # the primary is folders/a
    body = _new_project(
        client, _workspace_id(client, "Pessoal"), "y4b", folder, world["folders"]["b"]
    )
    assert body["adopted_legacy_key"] == "Pessoal/Y4"


def test_the_scan_only_runs_when_the_primary_is_inside_the_projects_root(env):
    client, main_mod, world = env
    calls = []
    real_scan = main_mod.workspace_service.scan

    def counting_scan():
        calls.append(1)
        return real_scan()

    main_mod.workspace_service.scan = counting_scan
    pessoal = _workspace_id(client, "Pessoal")
    _new_project(client, pessoal, "outside", world["folders"]["a"])
    assert calls == []  # outside PROJECTS_ROOT: never adoptable, no 3 s scan
    synthetic_ws = _new_workspace(client)["id"]
    _new_project(client, synthetic_ws, "w", world["root"] / "projeto_2")
    assert calls == []  # a ".wN" workspace can never own a legacy key
    inside = world["root"] / "Pessoal" / "Z"
    inside.mkdir()
    _new_project(client, pessoal, "inside", inside)
    assert calls == [1]


# -- patch project ----------------------------------------------------------------------


def test_patch_project_renames_and_replaces_the_folder_list(env):
    client, _, world = env
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"], world["folders"]["b"])["project"]
    url = f"/api/workspace-projects/{project['id']}"

    renamed = client.patch(url, json={"name": " renamed "}).json()["project"]
    assert renamed["name"] == "renamed"
    assert [f["path"] for f in renamed["folders"]] == [f["path"] for f in project["folders"]]

    response = client.patch(url, json={"folders": [
        {"path": str(world["folders"]["c"])},
        {"path": str(world["folders"]["b"]), "is_primary": True},
    ]})
    assert response.status_code == 200, response.text
    folders = response.json()["project"]["folders"]
    assert [(f["path"].endswith(n), f["is_primary"], f["position"]) for f, n in
            zip(folders, ("c", "b"))] == [(True, False, 0), (True, True, 1)]
    assert response.json()["project"]["key"] == project["key"]  # keys never change


def test_patch_project_validates_folders_like_the_post(env):
    client, _, world = env
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    url = f"/api/workspace-projects/{project['id']}"
    response = client.patch(url, json={"folders": [{"path": "\\\\host\\share"}]})
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == "unc_or_device"
    assert client.patch(url, json={"folders": []}).json()["detail"]["problems"][0]["code"] == "no_folders"
    assert client.patch(url, json={"name": ""}).status_code == 400
    # nothing changed
    assert _project(client, project["key"])["folders"][0]["path"] == project["folders"][0]["path"]


def test_patch_project_warns_about_other_projects_but_not_about_itself(env):
    client, _, world = env
    ws = _new_workspace(client)
    mine = _new_project(client, ws["id"], "mine", world["folders"]["a"])["project"]
    other = _new_project(client, ws["id"], "other", world["folders"]["b"])["project"]
    response = client.patch(f"/api/workspace-projects/{mine['id']}", json={"folders": [
        {"path": str(world["folders"]["a"])}, {"path": str(world["folders"]["b"])},
    ]})
    warnings = response.json()["warnings"]
    assert [(w["code"], w["path"]) for w in warnings] == [("already_used", str(world["folders"]["b"]))]
    assert warnings[0]["projects"][0]["project_id"] == other["id"]
    # renaming to a name another active project already has
    response = client.patch(f"/api/workspace-projects/{mine['id']}", json={"name": "OTHER"})
    assert [w["code"] for w in response.json()["warnings"]] == ["name_in_use"]
    # a project is never a homonym of itself, and a free name is silent
    response = client.patch(f"/api/workspace-projects/{other['id']}", json={"name": "other"})
    assert [w["code"] for w in response.json()["warnings"]] == ["name_in_use"]  # "mine" is OTHER now
    response = client.patch(f"/api/workspace-projects/{mine['id']}", json={"name": "unique"})
    assert response.json()["warnings"] == []
    response = client.patch(f"/api/workspace-projects/{mine['id']}", json={"name": "unique"})
    assert response.json()["warnings"] == []


def test_primary_locked_on_a_seeded_project(env):
    client, _, world = env
    seeded = _project(client, "Pessoal/tn-sandbox")
    assert seeded["primary_locked"] is True
    primary = seeded["folders"][0]["path"]
    url = f"/api/workspace-projects/{seeded['id']}"

    # changing the primary folder is refused
    response = client.patch(url, json={"folders": [{"path": str(world["folders"]["a"])}]})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "primary_locked"
    assert detail["message"].startswith("A pasta principal está travada.")
    assert _project(client, "Pessoal/tn-sandbox")["folders"][0]["path"] == primary

    # demoting it in favor of an extra folder is refused too
    response = client.patch(url, json={"folders": [
        {"path": primary}, {"path": str(world["folders"]["a"]), "is_primary": True},
    ]})
    assert response.status_code == 409

    # adding an extra folder while keeping the primary is fine
    response = client.patch(url, json={"folders": [
        {"path": primary, "is_primary": True}, {"path": str(world["folders"]["a"])},
    ]})
    assert response.status_code == 200, response.text
    assert [f["is_primary"] for f in response.json()["project"]["folders"]] == [True, False]

    # and removing it again
    response = client.patch(url, json={"folders": [{"path": primary}]})
    assert response.status_code == 200
    assert len(response.json()["project"]["folders"]) == 1

    # renaming and archiving never touch the lock
    assert client.patch(url, json={"name": "Sandbox"}).status_code == 200


def test_an_adopted_project_is_locked_but_a_minted_one_is_not(env):
    client, _, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y5")
    adopted = _new_project(client, _workspace_id(client, "Pessoal"), "Y5", folder)["project"]
    response = client.patch(
        f"/api/workspace-projects/{adopted['id']}",
        json={"folders": [{"path": str(world["folders"]["a"])}]},
    )
    assert response.status_code == 409
    minted = _new_project(client, _new_workspace(client)["id"], "m", world["folders"]["a"])["project"]
    response = client.patch(
        f"/api/workspace-projects/{minted['id']}",
        json={"folders": [{"path": str(world["folders"]["b"])}]},
    )
    assert response.status_code == 200


def test_archiving_hides_the_project_and_it_can_come_back(env):
    client, _, world = env
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    url = f"/api/workspace-projects/{project['id']}"
    assert client.patch(url, json={"archived": True}).json()["project"]["archived"] is True
    visible = [p["key"] for w in _workspaces(client) for p in w["projects"]]
    assert project["key"] not in visible
    assert _project(client, project["key"])["archived"] is True
    assert client.patch(url, json={"archived": False}).json()["project"]["archived"] is False
    assert project["key"] in [p["key"] for w in _workspaces(client) for p in w["projects"]]


def test_patch_project_rejects_workspace_id_and_unknown_fields_and_unknown_ids(env):
    client, _, world = env
    ws = _new_workspace(client)
    other = _new_workspace(client, "Other")
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    url = f"/api/workspace-projects/{project['id']}"
    assert client.patch(url, json={"workspace_id": other["id"]}).status_code == 422  # I2
    assert client.patch(url, json={"key": "hack"}).status_code == 422  # I3
    assert client.patch("/api/workspace-projects/9999", json={"name": "x"}).status_code == 404
    assert _project(client, project["key"])["key"] == project["key"]


def test_there_is_no_delete_anywhere(env):
    client, _, world = env
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    assert client.delete(f"/api/workspaces/{ws['id']}").status_code in (404, 405)
    assert client.delete(f"/api/workspace-projects/{project['id']}").status_code in (404, 405)


# -- the rest of the backend sees the new rows -------------------------------------------


def test_the_minted_key_is_url_safe_for_the_attachments_route(env):
    client, _, world = env
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    response = client.get(f"/api/projects/{project['key']}/attachments")
    assert response.status_code == 200
    assert response.json() == {"attachments": []}


def test_the_session_of_a_new_project_runs_in_its_primary_folder(env):
    client, main_mod, world = env
    assert client.post("/api/agents", json={
        "id": AGENT, "nome": "Shell", "papel": "Teste", "ia": "claude", "cmd": ["claude"],
    }).status_code == 201
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    real_spawn = main_mod.pty_manager.spawn
    spawned = {}

    def spy(session_key, cmd, **kwargs):
        spawned["cwd"] = kwargs.get("cwd")
        return real_spawn(session_key, cmd, **kwargs)

    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD), \
            patch.object(main_mod.pty_manager, "spawn", side_effect=spy):
        response = client.post(f"/api/sessions/{project['key']}::{AGENT}/continue")
    assert response.json()["status"] == "sent"
    import os
    assert os.path.normcase(spawned["cwd"]) == os.path.normcase(
        os.path.normpath(str(world["folders"]["a"]))
    )


def test_an_archived_project_is_not_a_target_but_keeps_resolving(env):
    client, main_mod, world = env
    assert client.post("/api/agents", json={
        "id": AGENT, "nome": "Shell", "papel": "Teste", "ia": "claude", "cmd": ["claude"],
    }).status_code == 201
    pessoal = _workspace_id(client, "Pessoal")
    project = _new_project(client, pessoal, "extra", world["folders"]["a"])["project"]
    session = register_session(client, f"Pessoal/tn-sandbox::{AGENT}", "Pessoal/tn-sandbox")

    def create_card(target):
        response = client.post("/api/hooks/cards/create", json={
            "claude_session_id": session, "titulo": "x", "projeto_id": target,
        })
        assert response.status_code == 200
        return response.json()

    assert create_card(project["key"])["success"] is True  # same workspace, active

    client.patch(f"/api/workspace-projects/{project['id']}", json={"archived": True})
    assert create_card(project["key"]) == {
        "success": False, "error": f"Projeto '{project['key']}' não existe",
    }
    # ...but its sessions still resolve (S-4): the folder is still its cwd
    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD):
        response = client.post(f"/api/sessions/{project['key']}::{AGENT}/continue")
    assert response.json()["status"] == "sent"
    assert client.get(f"/api/projects/{project['key']}/attachments").status_code == 200


def test_a_project_of_an_archived_workspace_is_not_a_target_either(env):
    client, _, world = env
    assert client.post("/api/agents", json={
        "id": AGENT, "nome": "Shell", "papel": "Teste", "ia": "claude", "cmd": ["claude"],
    }).status_code == 201
    ws = _new_workspace(client)
    project = _new_project(client, ws["id"], "p", world["folders"]["a"])["project"]
    session = register_session(client, f"{project['key']}::{AGENT}", project["key"])
    client.patch(f"/api/workspaces/{ws['id']}", json={"archived": True})
    # reading and cwd keep working (Bruno, 2026-10-22: archive only blocks NEW agent writes)
    assert client.get(f"/api/projects/{project['key']}/attachments").status_code == 200
    response = client.post("/api/hooks/cards/create", json={
        "claude_session_id": session, "titulo": "x", "projeto_id": project["key"],
    })
    assert response.json()["success"] is False


def test_no_adoption_into_another_legacy_workspace_either(env):
    client, _, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y6")
    body = _new_project(client, _workspace_id(client, "podesubir"), "y6", folder)
    assert body["adopted_legacy_key"] is None  # I1: "Pessoal/Y6" belongs to Pessoal
    assert body["project"]["key"].startswith("podesubir/.p")


# -- name_in_use ignores archived homonyms ------------------------------------------------


def test_an_archived_homonym_does_not_warn_name_in_use(env):
    client, _, world = env
    ws = _new_workspace(client)
    old = _new_project(client, ws["id"], "Same", world["folders"]["a"])["project"]
    client.patch(f"/api/workspace-projects/{old['id']}", json={"archived": True})
    body = _new_project(client, ws["id"], "same", world["folders"]["b"])
    assert body["warnings"] == []


# -- concurrent adoption of the same legacy key ---------------------------------------


def _gather_calls(client, make_call, count=2):
    """Run `count` service calls concurrently; each yields ('201', payload) or
    (status, detail) so a loser's HTTPException can be inspected."""

    async def one():
        try:
            return ("201", await make_call())
        except HTTPException as exc:
            return (str(exc.status_code), exc.detail)

    async def run():
        return await asyncio.gather(*[one() for _ in range(count)])

    return client.portal.call(run)


def test_two_concurrent_project_adoptions_end_like_the_sequential_order(env):
    client, main_mod, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y")
    pessoal = _workspace_id(client, "Pessoal")
    body = ProjectCreateRequest(name="Y", folders=[{"path": str(folder)}])
    outcomes = _gather_calls(
        client, lambda: main_mod.workspace_service.create_project(pessoal, body)
    )
    assert [status for status, _ in outcomes] == ["201", "201"]
    payloads = [payload for _, payload in outcomes]
    adopted = [p for p in payloads if p["adopted_legacy_key"] == "Pessoal/Y"]
    synthetic = [p for p in payloads if p["adopted_legacy_key"] is None]
    assert len(adopted) == 1 and len(synthetic) == 1
    assert synthetic[0]["project"]["key"].startswith("Pessoal/.p")
    # the loser is told who owns the folder, like in the sequential order
    warning = synthetic[0]["warnings"][0]
    assert warning.code == "already_used"
    assert [p.project_id for p in warning.projects] == [adopted[0]["project"]["id"]]
    assert _project(client, "Pessoal/Y")["id"] == adopted[0]["project"]["id"]


def test_a_project_adoption_losing_to_an_archived_owner_is_a_409_with_its_id(env):
    """The owner appears (already archived) between the snapshot and the write."""
    client, main_mod, world = env
    folder = _mark(world["root"] / "Pessoal" / "Y")
    pessoal = _workspace_id(client, "Pessoal")
    service = main_mod.workspace_service
    real_find = service._find_adoptable_key

    async def scenario():
        loop = asyncio.get_running_loop()
        winner = {}

        async def adopt_then_archive():
            row = await service.store.create_project(
                pessoal, "Y",
                [{"path": str(folder), "canonical_path": str(folder), "is_primary": True}],
                adopt_key="Pessoal/Y",
            )
            await service.store.update_project(row.id, archived=True)
            return row.id

        def find_then_lose_the_race(*args):
            found = real_find(*args)
            winner["id"] = asyncio.run_coroutine_threadsafe(adopt_then_archive(), loop).result()
            return found

        body = ProjectCreateRequest(name="Y2", folders=[{"path": str(folder)}])
        with patch.object(service, "_find_adoptable_key", find_then_lose_the_race):
            try:
                await service.create_project(pessoal, body)
            except HTTPException as exc:
                return exc, winner["id"]
        raise AssertionError("expected a 409")

    exc, winner_id = client.portal.call(scenario)
    assert exc.status_code == 409
    assert exc.detail["code"] == "adopt_conflict"
    assert exc.detail["archived_project_id"] == winner_id
    assert exc.detail["message"] == 'Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".'


def test_two_concurrent_workspace_adoptions_get_the_workspace_wording(env):
    client, main_mod, world = env
    (world["root"] / "NewCo" / "x" / ".claude").mkdir(parents=True)
    body = WorkspaceCreateRequest(name="NewCo", adopt_legacy_key="NewCo")
    outcomes = _gather_calls(client, lambda: main_mod.workspace_service.create_workspace(body))
    assert sorted(status for status, _ in outcomes) == ["201", "409"]
    loser = next(detail for status, detail in outcomes if status == "409")
    assert loser["code"] == "adopt_conflict"
    assert loser["message"] == "Já existe um workspace com esse nome de cliente."
    assert loser["archived"] is False
    assert loser["workspace_id"] == _workspace_id(client, "NewCo")


def test_a_workspace_adoption_losing_to_an_archived_owner_says_archived(env):
    client, main_mod, world = env
    (world["root"] / "NewCo" / "x" / ".claude").mkdir(parents=True)
    service = main_mod.workspace_service
    real_scan = service._scan_blocking

    async def scenario():
        loop = asyncio.get_running_loop()

        async def adopt_then_archive():
            row = await service.store.create_workspace("NewCo", adopt_key="NewCo")
            await service.store.update_workspace(row.id, archived=True)

        def scan_then_lose_the_race():
            scanned = real_scan()
            asyncio.run_coroutine_threadsafe(adopt_then_archive(), loop).result()
            return scanned

        body = WorkspaceCreateRequest(name="NewCo2", adopt_legacy_key="NewCo")
        with patch.object(service, "_scan_blocking", scan_then_lose_the_race):
            try:
                await service.create_workspace(body)
            except HTTPException as exc:
                return exc
        raise AssertionError("expected a 409")

    exc = client.portal.call(scenario)
    assert exc.status_code == 409
    assert exc.detail["code"] == "adopt_conflict"
    assert exc.detail["archived"] is True
    assert exc.detail["message"].startswith("Esse workspace já existe arquivado")
