"""Resolution of registry projects (synthetic keys) by the three folder
lookups of the backend (ADR-23), and the guarantee that legacy keys keep
resolving through the folder scan exactly as before.

- G1 (scan): spawn cwd, attachments routes, viewer/artifact project lookup.
- G2 (direct join PROJECTS_ROOT + id): viewer content/files and artifact state.
"""
from __future__ import annotations

import functools
import os
import sqlite3
import sys
from unittest.mock import patch

import pytest

from app.viewer_api import ViewerService
from app.artifacts_api import ArtifactService
from registry_helpers import (
    insert_registry_direct,
    make_client,
    make_tree,
    prepare_artifacts_db,
    register_session,
)

SLEEP_CMD = [sys.executable, "-c", "import time; time.sleep(5)"]


@pytest.fixture
def world(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    folders = {}
    for name in ("a", "b"):
        folders[name] = tmp_path / "folders" / name
        folders[name].mkdir(parents=True)  # no .claude marker on purpose
    (folders["a"] / "notes.md").write_text("# real notes\n", encoding="utf-8")
    db = str(tmp_path / "sessions.db")
    insert_registry_direct(
        db,
        workspaces=[(".w1", "W1")],
        projects=[(".w1/.p1", ".w1", "p1", folders["a"])],
    )
    return {"root": root, "db": db, "folders": folders, "tmp": tmp_path}


@pytest.fixture
def env(world):
    with make_client(world["tmp"], root=world["root"]) as (client, main_mod):
        yield client, main_mod, world


def _create_global_agent(client, agent_id="shell-agent"):
    response = client.post("/api/agents", json={
        "id": agent_id, "nome": "Shell", "papel": "Teste", "ia": "claude", "cmd": ["claude"],
    })
    assert response.status_code == 201
    return agent_id


# -- G1: spawn cwd ------------------------------------------------------------------


def test_continue_spawns_a_registry_project_in_its_primary_folder_with_a_global_agent(env):
    client, main_mod, world = env
    agent_id = _create_global_agent(client)
    real_spawn = main_mod.pty_manager.spawn
    spawned = {}

    def spy(session_key, cmd, **kwargs):
        spawned["cwd"] = kwargs.get("cwd")
        return real_spawn(session_key, cmd, **kwargs)

    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD), \
            patch.object(main_mod.pty_manager, "spawn", side_effect=spy), \
            patch("app.main._build_agent_cmd", wraps=main_mod._build_agent_cmd) as build:
        response = client.post(f"/api/sessions/.w1/.p1::{agent_id}/continue")
    assert response.json() == {"status": "sent", "session_key": f".w1/.p1::{agent_id}"}
    assert os.path.normcase(spawned["cwd"]) == os.path.normcase(
        os.path.normpath(str(world["folders"]["a"]))
    )
    assert build.call_args.args[0].id == agent_id  # the global agent, despite no .claude marker


def test_websocket_init_spawns_a_registry_project_in_its_primary_folder(env):
    client, main_mod, world = env
    agent_id = _create_global_agent(client)
    real_spawn = main_mod.pty_manager.spawn
    spawned = {}

    def spy(session_key, cmd, **kwargs):
        spawned["cwd"] = kwargs.get("cwd")
        return real_spawn(session_key, cmd, **kwargs)

    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD), \
            patch.object(main_mod.pty_manager, "spawn", side_effect=spy):
        with client.websocket_connect(f"/ws/pty/.w1/.p1::{agent_id}") as ws:
            ws.send_json({"type": "init", "project_id": ".w1/.p1", "agent_id": agent_id,
                          "cols": 80, "rows": 24})
            import time
            time.sleep(0.3)
    assert os.path.normcase(spawned["cwd"]) == os.path.normcase(
        os.path.normpath(str(world["folders"]["a"]))
    )


def test_unknown_synthetic_key_with_an_explicit_agent_is_no_agent(env):
    client, _, _ = env
    agent_id = _create_global_agent(client)
    response = client.post(f"/api/sessions/.w1/.p404::{agent_id}/continue")
    assert response.json() == {"status": "no_agent", "session_key": f".w1/.p404::{agent_id}"}


def test_registry_project_without_a_primary_folder_resolves_to_nothing(env):
    _, main_mod, _ = env
    snapshot = main_mod.workspace_store.snapshot
    project = snapshot.project_by_key[".w1/.p1"]
    stripped = type(snapshot)(
        workspaces=snapshot.workspaces,
        projects=snapshot.projects,
        workspace_by_key=snapshot.workspace_by_key,
        workspace_by_id=snapshot.workspace_by_id,
        project_by_key=snapshot.project_by_key,
        project_by_id=snapshot.project_by_id,
        projects_by_workspace_id=snapshot.projects_by_workspace_id,
        folders_by_project_id={project.id: ()},
        folder_canonical_index={},
    )
    with patch.object(type(main_mod.workspace_store), "snapshot", property(lambda self: stripped)):
        assert main_mod._registry_project(".w1/.p1") is None
        assert main_mod._registry_root_for(".w1/.p1") is None
        assert main_mod._resolve_agent(".w1/.p1", None) == (None, None, main_mod.PROJECTS_ROOT)


def test_registry_project_view_carries_the_global_agents_and_the_workspace(env):
    client, main_mod, world = env
    agent_id = _create_global_agent(client)
    project = main_mod._registry_project(".w1/.p1")
    assert project.id == ".w1/.p1"
    assert project.nome == "p1"
    assert project.cliente_id == ".w1"
    assert project.elegivel is True
    assert project.sub_projetos == []
    assert [a.id for a in project.agentes] == [agent_id]
    assert os.path.normcase(project.path) == os.path.normcase(
        os.path.normpath(str(world["folders"]["a"]))
    )
    assert main_mod._registry_project("Pessoal/tn-sandbox") is None  # legacy keys never come from here


def test_archived_registry_project_still_resolves(env):
    client, main_mod, _ = env
    store = main_mod.workspace_store
    project = store.snapshot.project_by_key[".w1/.p1"]
    client.portal.call(functools.partial(store.update_project, project.id, archived=True))
    assert main_mod._registry_project(".w1/.p1") is not None
    assert main_mod._registry_root_for(".w1/.p1") is not None


# -- G1: attachments (routes with {project_id:path}) ---------------------------------


def test_attachments_route_accepts_a_synthetic_key_without_encoding(env):
    client, _, _ = env
    response = client.get("/api/projects/.w1/.p1/attachments")
    assert response.status_code == 200
    assert response.json() == {"attachments": []}
    assert client.get("/api/projects/.w1/.p404/attachments").status_code == 404


def test_attachment_upload_lands_in_the_primary_folder(env):
    client, _, world = env
    response = client.post(
        "/api/projects/.w1/.p1/attachments",
        files={"files": ("hello.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 201
    stored = list((world["folders"]["a"] / ".escritorio" / "attachments").rglob("hello*"))
    assert len(stored) == 1


def test_session_routes_accept_a_synthetic_key_without_encoding(env):
    client, _, _ = env
    session_key = ".w1/.p1::ag"
    created = client.post(f"/api/sessions/{session_key}/tasks", json={
        "titulo": "t", "descricao_markdown": "d",
    })
    assert created.status_code == 201
    assert [t["titulo"] for t in client.get(f"/api/sessions/{session_key}/tasks").json()] == ["t"]


# -- G2: viewer and artifacts ----------------------------------------------------------


def _open_in_viewer(client, session_key, caminho):
    return client.post(f"/api/sessions/{session_key}/viewer", json={"caminho": caminho})


def test_viewer_serves_files_of_a_registry_project_from_its_primary_folder(env):
    client, _, world = env
    session_key = ".w1/.p1::ag"
    opened = _open_in_viewer(client, session_key, str(world["folders"]["a"] / "notes.md"))
    assert opened.status_code == 200, opened.text
    item = opened.json()["item"]
    assert item["project_id"] == ".w1/.p1" and item["path"] == "notes.md"
    content = client.get(f"/api/viewer/{item['item_id']}/content")
    assert content.status_code == 200
    assert "real notes" in content.text
    served = client.get(f"/api/viewer/{item['item_id']}/f/notes.md")
    assert served.status_code == 200 and "real notes" in served.text


def test_a_real_folder_named_like_the_synthetic_key_cannot_hijack_the_root(env):
    """`<PROJECTS_ROOT>/.w1/.p1` is a plain folder that the old join would hit."""
    client, main_mod, world = env
    hijack = world["root"] / ".w1" / ".p1"
    hijack.mkdir(parents=True)
    (hijack / "evil.txt").write_text("secret", encoding="utf-8")
    item, _, _ = client.portal.call(functools.partial(
        main_mod.viewer_store.open_item,
        session_key=".w1/.p1::ag", project_id=".w1/.p1", path="evil.txt", title=None,
        line=None, kind="text", language=None, opened_by="user",
    ))
    assert client.get(f"/api/viewer/{item['item_id']}/content").status_code == 404
    assert client.get(f"/api/viewer/{item['item_id']}/f/evil.txt").status_code == 404
    assert main_mod.viewer_service.project_root_for(".w1/.p1") != str(hijack)


def test_viewer_root_of_an_unregistered_synthetic_key_is_none(env):
    _, main_mod, _ = env
    assert main_mod.viewer_service.project_root_for(".w1/.p404") is None
    assert main_mod.artifact_service.project_root_for(".w1/.p404") is None


def test_viewer_and_artifact_roots_of_a_registry_project_are_its_primary_folder(env):
    _, main_mod, world = env
    expected = os.path.normcase(os.path.normpath(str(world["folders"]["a"])))
    assert os.path.normcase(main_mod.viewer_service.project_root_for(".w1/.p1")) == expected
    assert os.path.normcase(main_mod.artifact_service.project_root_for(".w1/.p1")) == expected


def test_registry_root_is_none_when_the_folder_is_gone(env):
    _, main_mod, world = env
    os.rmdir(world["folders"]["b"])  # unrelated folder: the primary one is untouched
    assert main_mod._registry_root_for(".w1/.p1") is not None
    (world["folders"]["a"] / "notes.md").unlink()
    os.rmdir(world["folders"]["a"])
    assert main_mod._registry_root_for(".w1/.p1") is None
    assert main_mod._registry_root_for("Pessoal/tn-sandbox") is None  # legacy: never from the registry


def test_artifact_state_uses_the_registry_root_and_not_the_hijack_folder(world):
    hijack = world["root"] / ".w1" / ".p1"
    hijack.mkdir(parents=True)
    (hijack / "evil.txt").write_text("secret", encoding="utf-8")
    prepare_artifacts_db(
        world["db"], [(".w1/.p1", "notes.md"), (".w1/.p1", "evil.txt")]
    )
    with make_client(world["tmp"], root=world["root"]) as (client, _):
        response = client.get("/api/artifacts")
    assert response.status_code == 200
    exists = {a["path"]: a["exists"] for a in response.json()["artifacts"]}
    assert exists == {"notes.md": True, "evil.txt": False}


# -- legacy keys keep going through the old lookups ------------------------------------


def test_legacy_root_comes_from_the_join_even_if_the_seeded_folder_points_elsewhere(world):
    with make_client(world["tmp"], root=world["root"]):
        pass  # first boot seeds the registry
    conn = sqlite3.connect(world["db"])
    try:
        conn.execute(
            "UPDATE project_folders SET path = ?, canonical_path = ? WHERE project_id = "
            "(SELECT id FROM workspace_projects WHERE key = 'Pessoal/tn-sandbox')",
            (str(world["folders"]["b"]), os.path.normcase(str(world["folders"]["b"]))),
        )
        conn.commit()
    finally:
        conn.close()
    with make_client(world["tmp"], root=world["root"]) as (client, main_mod):
        expected = str(world["root"] / "Pessoal" / "tn-sandbox")
        assert main_mod.viewer_service.project_root_for("Pessoal/tn-sandbox") == expected
        assert main_mod.artifact_service.project_root_for("Pessoal/tn-sandbox") == expected
        assert main_mod._registry_root_for("Pessoal/tn-sandbox") is None
        # G1 still uses the scan: the spawn cwd is the scanned folder, not the edited registry row.
        proj, _, cwd = main_mod._resolve_agent("Pessoal/tn-sandbox", None)
        assert proj is not None and os.path.normcase(cwd) == os.path.normcase(expected)
        assert client.get("/api/projects/Pessoal/tn-sandbox/attachments").status_code == 200


def test_services_built_without_a_registry_resolve_synthetic_keys_to_none(tmp_path):
    root = tmp_path / "proj"
    (root / "cli" / "app").mkdir(parents=True)
    viewer = ViewerService(
        store=None, find_project_path=lambda _k: None,
        get_projects_root=lambda: str(root),
        session_key_for_claude_id=None,
    )
    artifacts = ArtifactService(
        store=None, find_project_path=lambda _k: None, get_projects_root=lambda: str(root),
    )
    for service in (viewer, artifacts):
        assert service.project_root_for(".w1/.p1") is None
        assert service.project_root_for("cli/.p9") is None
        assert service.project_root_for("cli/app") == str(root / "cli" / "app")


# -- a registry project whose primary folder is gone -------------------------------------


def test_attachment_routes_of_a_project_with_a_missing_primary_folder_are_404_and_write_nothing(env):
    client, _, world = env
    folder = world["folders"]["a"]
    (folder / "notes.md").unlink()
    os.rmdir(folder)
    expected = {"detail": "Project not found: .w1/.p1"}
    upload = client.post("/api/projects/.w1/.p1/attachments",
                         files={"files": ("hello.txt", b"hello", "text/plain")})
    assert (upload.status_code, upload.json()) == (404, expected)
    listing = client.get("/api/projects/.w1/.p1/attachments")
    assert (listing.status_code, listing.json()) == (404, expected)
    removal = client.delete("/api/projects/.w1/.p1/attachments/whatever")
    assert (removal.status_code, removal.json()) == (404, expected)
    candidates = client.get("/api/projects/.w1/.p1/artifact-candidates")
    assert candidates.status_code == 404
    assert not folder.exists()  # nothing recreated on disk


def test_session_of_a_project_with_a_missing_primary_folder_stays_controlled(env):
    client, _, world = env
    agent_id = _create_global_agent(client)
    (world["folders"]["a"] / "notes.md").unlink()
    os.rmdir(world["folders"]["a"])
    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD):
        response = client.post(f"/api/sessions/.w1/.p1::{agent_id}/continue")
    assert response.json()["status"] == "provisioning_failed"
    assert not world["folders"]["a"].exists()


def test_gone_primary_folder_never_falls_back_to_a_real_folder_named_like_the_key(env):
    """Primary folder gone + real `<PROJECTS_ROOT>/.w1/.p1` and `.../.w1/.p404`:
    the join must never answer for a synthetic key (ADR-23)."""
    client, main_mod, world = env
    for key in (".w1/.p1", ".w1/.p404"):
        hijack = world["root"] / key
        hijack.mkdir(parents=True)
        (hijack / "evil.txt").write_text("secret", encoding="utf-8")
    (world["folders"]["a"] / "notes.md").unlink()
    os.rmdir(world["folders"]["a"])
    for key in (".w1/.p1", ".w1/.p404"):
        assert main_mod.viewer_service.project_root_for(key) is None
        assert main_mod.artifact_service.project_root_for(key) is None
    item, _, _ = client.portal.call(functools.partial(
        main_mod.viewer_store.open_item,
        session_key=".w1/.p1::ag", project_id=".w1/.p1", path="evil.txt", title=None,
        line=None, kind="text", language=None, opened_by="user",
    ))
    assert client.get(f"/api/viewer/{item['item_id']}/f/evil.txt").status_code == 404
    assert client.get(f"/api/viewer/{item['item_id']}/content").status_code == 404
