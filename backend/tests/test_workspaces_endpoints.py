"""GET /api/workspaces and the guarantee that the V2 endpoints do not notice
the registry."""
from __future__ import annotations

import functools
import json
import shutil

import pytest

from app.workspace_store import SeedResult
from registry_helpers import make_client, make_tree, prepare_cards_db


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    return make_tree(root)


def _call(client, fn, *args, **kwargs):
    """Run a store coroutine on the app's own event loop."""
    return client.portal.call(functools.partial(fn, *args, **kwargs))


def test_get_workspaces_returns_the_contract_shape(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, _main):
        response = client.get("/api/workspaces")
        assert response.status_code == 200
        body = response.json()
    assert set(body) == {"seeded", "workspaces"}
    assert set(body["seeded"]) == {"at", "root", "workspaces", "projects"}
    assert body["seeded"]["root"] == str(tree)
    assert (body["seeded"]["workspaces"], body["seeded"]["projects"]) == (3, 6)
    assert [w["key"] for w in body["workspaces"]] == ["Pessoal", "podesubir", "projeto_2"]
    workspace = body["workspaces"][0]
    assert set(workspace) == {"id", "key", "name", "origin", "archived", "projects"}
    project = workspace["projects"][0]
    assert set(project) == {
        "id", "key", "name", "origin", "archived", "primary_locked", "folders",
    }
    folder = project["folders"][0]
    assert set(folder) == {"id", "path", "is_primary", "position", "exists"}


def test_seeded_projects_are_locked_existing_and_not_archived(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, _main):
        body = client.get("/api/workspaces").json()
    projects = [p for w in body["workspaces"] for p in w["projects"]]
    assert len(projects) == 6
    for project in projects:
        assert project["primary_locked"] is True
        assert project["archived"] is False
        assert project["origin"] == "legacy_seed"
        assert [f["exists"] for f in project["folders"]] == [True]
        assert [f["is_primary"] for f in project["folders"]] == [True]


def test_registry_made_projects_are_not_locked(tmp_path, tree):
    from registry_helpers import folder_spec
    extra = tmp_path / "elsewhere"
    extra.mkdir()
    with make_client(tmp_path, root=tree) as (client, main_mod):
        store = main_mod.workspace_store
        ws = _call(client, store.create_workspace, "Acme")
        project = _call(client, store.create_project, ws.id, "Site", [folder_spec(extra)])
        body = client.get("/api/workspaces").json()
    acme = next(w for w in body["workspaces"] if w["key"] == ws.key)
    assert acme["projects"][0]["key"] == project.key
    assert acme["projects"][0]["primary_locked"] is False


def test_include_archived_toggles_archived_projects(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, main_mod):
        store = main_mod.workspace_store
        target = store.snapshot.project_by_key["Pessoal/tn-sandbox"]
        _call(client, store.update_project, target.id, archived=True)
        hidden = client.get("/api/workspaces", params={"include_archived": 0}).json()
        shown = client.get("/api/workspaces", params={"include_archived": 1}).json()
        default = client.get("/api/workspaces").json()
    def keys(body):
        return {p["key"] for w in body["workspaces"] for p in w["projects"]}
    assert "Pessoal/tn-sandbox" not in keys(hidden)
    assert "Pessoal/tn-sandbox" in keys(shown)
    assert keys(default) == keys(hidden)
    archived = next(
        p for w in shown["workspaces"] for p in w["projects"]
        if p["key"] == "Pessoal/tn-sandbox"
    )
    assert archived["archived"] is True


def test_include_archived_rejects_other_values(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, _main):
        assert client.get("/api/workspaces", params={"include_archived": 2}).status_code == 422


def test_exists_turns_false_when_the_folder_disappears(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, _main):
        shutil.rmtree(tree / "Pessoal" / "tn-sandbox")
        body = client.get("/api/workspaces").json()
    project = next(
        p for w in body["workspaces"] for p in w["projects"]
        if p["key"] == "Pessoal/tn-sandbox"
    )
    assert project["folders"][0]["exists"] is False


V2_ENDPOINTS = (
    "/api/projects",
    "/api/agents",
    "/api/cards",
    "/api/board/columns",
    "/api/sessions/persisted",
    "/api/sessions/active",
    "/api/tasks/global",
    "/api/settings/projects-root",
    "/api/artifacts",
)


# Row timestamps differ between two databases seeded at different instants.
_VOLATILE_KEYS = {"criado_em", "atualizado_em"}


def _without_volatile(value):
    if isinstance(value, dict):
        return {k: _without_volatile(v) for k, v in value.items() if k not in _VOLATILE_KEYS}
    if isinstance(value, list):
        return [_without_volatile(v) for v in value]
    return value


def _collect_v2(client) -> dict:
    out = {}
    for path in V2_ENDPOINTS:
        response = client.get(path)
        out[path] = (
            response.status_code,
            json.dumps(_without_volatile(response.json()), sort_keys=True),
        )
    return out


V2_CARD_PROJECTS = (
    "Pessoal/tn-sandbox",  # seeded project
    "podesubir",  # client that is also a project
    "Pessoal",  # card of the client only
    "Sumiu/x",  # client that does not exist on disk
)


def test_v2_endpoints_are_identical_with_and_without_a_registry(tmp_path, tree):
    def skip_seed(main_mod):
        async def skipped(projects, root):
            return SeedResult("skipped", reason="stubbed")
        main_mod.workspace_store.seed_from_legacy_once = skipped

    for name in ("without.db", "with.db"):
        prepare_cards_db(str(tmp_path / name), V2_CARD_PROJECTS)
    with make_client(tmp_path, root=tree, db_name="without.db",
                     before_boot=skip_seed) as (client, main_mod):
        assert main_mod.workspace_store.snapshot.projects == ()
        without = _collect_v2(client)
    with make_client(tmp_path, root=tree, db_name="with.db") as (client, main_mod):
        assert len(main_mod.workspace_store.snapshot.projects) == 6
        with_registry = _collect_v2(client)
    assert without == with_registry
    assert all(status == 200 for status, _ in with_registry.values())
    # The comparison has teeth: the cards really are in the responses.
    cards = json.loads(with_registry["/api/cards"][1])
    assert {c["projeto_id"] for c in cards} == set(V2_CARD_PROJECTS)


def test_cards_of_a_client_missing_on_disk_do_not_create_a_workspace(tmp_path, tree):
    prepare_cards_db(str(tmp_path / "sessions.db"), V2_CARD_PROJECTS)
    with make_client(tmp_path, root=tree) as (client, main_mod):
        body = client.get("/api/workspaces").json()
        snapshot = main_mod.workspace_store.snapshot
    keys = {w["key"] for w in body["workspaces"]}
    assert keys == {"Pessoal", "podesubir", "projeto_2"}
    assert "Sumiu" not in snapshot.workspace_by_key
    assert "Sumiu/x" not in snapshot.project_by_key


def test_include_archived_toggles_archived_workspaces_with_their_projects(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, main_mod):
        store = main_mod.workspace_store
        target = store.snapshot.workspace_by_key["podesubir"]
        _call(client, store.update_workspace, target.id, archived=True)
        hidden = client.get("/api/workspaces", params={"include_archived": 0}).json()
        shown = client.get("/api/workspaces", params={"include_archived": 1}).json()
    assert "podesubir" not in {w["key"] for w in hidden["workspaces"]}
    assert not any(
        p["key"].startswith("podesubir") for w in hidden["workspaces"] for p in w["projects"]
    )
    archived = next(w for w in shown["workspaces"] if w["key"] == "podesubir")
    assert archived["archived"] is True
    assert {p["key"] for p in archived["projects"]} == {"podesubir", "podesubir/site"}


def test_restart_keeps_the_seed_and_the_counts(tmp_path, tree):
    with make_client(tmp_path, root=tree) as (client, _main):
        first = client.get("/api/workspaces").json()
    with make_client(tmp_path, root=tree) as (client, _main):
        second = client.get("/api/workspaces").json()
    assert first["seeded"] == second["seeded"]
    assert first == second


def test_workspaces_route_wins_over_the_spa_catch_all(tmp_path, tree):
    dist = tmp_path / "dist"
    for sub in ("assets", "icons", "fonts"):
        (dist / sub).mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>", encoding="utf-8")
    with make_client(tmp_path, root=tree, env_extra={"FRONTEND_DIST": str(dist)}) as (client, _main):
        spa = client.get("/some/client/route")
        assert spa.text == "<html>spa</html>"
        response = client.get("/api/workspaces")
    assert response.headers["content-type"].startswith("application/json")
    assert "workspaces" in response.json()
