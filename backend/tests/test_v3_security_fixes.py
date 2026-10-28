"""Security fixes of the V3 registry (stage 10 report, S-2 folders, S-5, S-6).

S-2: the AppData subtree and credential dot-folders are refused as project folders.
S-5: a primary folder swapped for a junction/symlink after registration stops resolving.
S-6: request bodies are bounded and folder scans never run unbounded in parallel.

Nothing here opens an SMB path: junction targets are plain folders under tmp_path.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import threading
import time
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import pytest

from app.folder_validation import (
    FolderValidationError,
    default_policy,
    validate_folder_path,
)
from app.models import (
    Project,
    ProjectCreateRequest,
    ProjectFolderIn,
    WorkspaceCreateRequest,
)
from app.workspace_store import WorkspaceStore
from app.workspaces_api import WorkspaceService
from registry_helpers import make_client, make_tree

WINDOWS = sys.platform == "win32"

# Folders added to the sensitive list by the S-2 fix (the old ones keep their tests).
NEW_SENSITIVE_DIRS = [
    ".config", ".docker", ".kube", ".azure", ".gradle", ".m2", ".npm",
    ".terraform.d", ".password-store", ".cargo", ".oci", ".minikube",
]


def _profile_env(home):
    return {
        "USERPROFILE": str(home),
        "HOME": str(home),
        "APPDATA": str(home / "AppData" / "Roaming"),
        "LOCALAPPDATA": str(home / "AppData" / "Local"),
    }


def _code(raw, policy) -> str:
    with pytest.raises(FolderValidationError) as info:
        validate_folder_path(raw, policy)
    assert len(info.value.problems) == 1
    return info.value.problems[0].code


@pytest.fixture
def fabricated(tmp_path):
    home = tmp_path / "home"
    root = home / "dev"
    (root / "client" / "app").mkdir(parents=True)
    (home / "work" / "app").mkdir(parents=True)
    policy = default_policy(str(root), _profile_env(home))
    return {"home": home, "root": root, "policy": policy}


# -- S-2: the AppData subtree --------------------------------------------------------


@pytest.mark.parametrize("relative", ["AppData", "AppData/Roaming", "AppData/Local"])
def test_appdata_and_its_roots_are_a_home_root_refusal(fabricated, relative):
    # "Pick a subfolder" is accurate advice only for AppData itself, its Roaming/Local
    # roots (the APPDATA/LOCALAPPDATA values) and ancestors.
    assert _code(str(fabricated["home"] / relative), fabricated["policy"]) == "home_root"


@pytest.mark.parametrize("relative", [
    "AppData/Roaming/GitHub CLI",
    "AppData/Roaming/Code/User/globalStorage",
    "AppData/Local/Temp",
    "AppData/Local/Temp/pytest-of-someone/pytest-0/x",
    "AppData/Local/Google/Chrome/User Data/Default",
    "AppData/LocalLow",
    "AppData/LocalLow/vendor/app",
])
def test_appdata_subtree_is_refused_with_the_fabricated_policy(fabricated, relative):
    # Refused before the disk is touched: none of these folders exists.
    target = fabricated["home"] / relative
    assert not target.exists()
    assert _code(str(target), fabricated["policy"]) == "sensitive_folder"


def test_appdata_subtree_is_refused_even_when_the_folder_exists(fabricated):
    existing = fabricated["home"] / "AppData" / "Local" / "Programs" / "tool"
    existing.mkdir(parents=True)
    assert _code(str(existing), fabricated["policy"]) == "sensitive_folder"


def test_relocated_appdata_variables_are_refused_with_their_descendants(tmp_path):
    home = tmp_path / "home"
    relocated = tmp_path / "elsewhere" / "roaming"
    (relocated / "app").mkdir(parents=True)
    env = {**_profile_env(home), "APPDATA": str(relocated)}
    policy = default_policy(str(tmp_path / "root"), env)
    assert _code(str(relocated / "app"), policy) == "sensitive_folder"
    assert _code(str(relocated), policy) == "home_root"


def test_a_name_that_only_starts_like_appdata_is_not_refused(fabricated):
    sibling = fabricated["home"] / "AppDataBackup" / "app"
    sibling.mkdir(parents=True)
    assert validate_folder_path(str(sibling), fabricated["policy"]).path == str(sibling)


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows feature")
def test_junction_into_the_appdata_subtree_is_caught_by_the_canonical_path(
    fabricated, tmp_path
):
    target = fabricated["home"] / "AppData" / "Roaming" / "tool"
    target.mkdir(parents=True)
    link = tmp_path / "innocent-link"
    done = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True
    )
    if done.returncode != 0:
        pytest.skip(f"cannot create a junction here: {done.stderr or done.stdout}")
    assert _code(str(link), fabricated["policy"]) == "sensitive_folder"


# -- S-2: credential dot-folders -----------------------------------------------------


@pytest.mark.parametrize("name", NEW_SENSITIVE_DIRS)
def test_new_credential_folders_and_descendants_are_refused(fabricated, name):
    folder = fabricated["home"] / name
    assert _code(str(folder), fabricated["policy"]) == "sensitive_folder"
    assert _code(str(folder / "sub" / "deeper"), fabricated["policy"]) == "sensitive_folder"


def test_existing_credential_folders_are_still_refused(fabricated):
    for name in (".ssh", ".claude", ".codex", ".gemini", ".aws", ".gnupg"):
        assert _code(str(fabricated["home"] / name), fabricated["policy"]) == "sensitive_folder"


def test_the_profile_itself_stays_a_home_root_refusal(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    policy = default_policy(str(tmp_path / "root"), _profile_env(home))
    assert _code(str(home), policy) == "home_root"


# -- S-2r: every dot-folder under the home, and `.git` components ----------------------


@pytest.mark.parametrize("relative", [
    ".aws_backup_before_restore",
    ".vtex",
    ".vtex/session",
    ".android",
    ".some-future-tool/deep/er",
    ".Mixed-Case",
])
def test_any_dot_folder_directly_under_the_home_is_refused(fabricated, relative):
    assert _code(str(fabricated["home"] / relative), fabricated["policy"]) == "sensitive_folder"


def test_dot_folder_rule_follows_a_relocated_profile(tmp_path):
    home = tmp_path / "somewhere" / "else" / "me"
    (home / ".tool").mkdir(parents=True)
    policy = default_policy(str(tmp_path / "root"), _profile_env(home))
    assert _code(str(home / ".tool"), policy) == "sensitive_folder"


def test_dot_folders_that_are_not_directly_under_the_home_stay_allowed(fabricated, tmp_path):
    inside = fabricated["home"] / "work" / "app" / ".vscode"
    outside = tmp_path / "outside" / "app" / ".vscode"
    for folder in (inside, outside):
        folder.mkdir(parents=True)
        assert validate_folder_path(str(folder), fabricated["policy"]).path == str(folder)
    nested = fabricated["home"] / "dotfiles" / ".config"
    nested.mkdir(parents=True)
    assert validate_folder_path(str(nested), fabricated["policy"]).path == str(nested)


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows feature")
def test_junction_to_a_home_dot_folder_is_caught_by_the_canonical_path(fabricated, tmp_path):
    target = fabricated["home"] / ".vtex"
    target.mkdir()
    link = tmp_path / "innocent-link"
    done = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True
    )
    if done.returncode != 0:
        pytest.skip(f"cannot create a junction here: {done.stderr or done.stdout}")
    assert _code(str(link), fabricated["policy"]) == "sensitive_folder"


@pytest.mark.parametrize("relative", [
    "repo/.git",
    "repo/.git/hooks",
    "repo/.git/refs/heads",
    ".git",
    "a/.GIT/b",
])
def test_a_git_component_is_refused_even_outside_the_home(tmp_path, fabricated, relative):
    target = tmp_path / "outside" / relative
    assert _code(str(target), fabricated["policy"]) == "sensitive_folder"


def test_git_lookalike_names_are_not_refused(tmp_path, fabricated):
    for name in (".github", ".gitlab", ".gitx", "my.gitx", "x.git", "legit-git", "git"):
        folder = tmp_path / "outside" / name
        folder.mkdir(parents=True)
        assert validate_folder_path(str(folder), fabricated["policy"]).path == str(folder), name


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows feature")
def test_junction_to_a_git_folder_is_caught_by_the_canonical_path(fabricated, tmp_path):
    target = tmp_path / "outside" / "repo" / ".git"
    target.mkdir(parents=True)
    link = tmp_path / "innocent-link"
    done = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True
    )
    if done.returncode != 0:
        pytest.skip(f"cannot create a junction here: {done.stderr or done.stdout}")
    assert _code(str(link), fabricated["policy"]) == "sensitive_folder"


# -- S-2: the real policy (real profile variables, nothing created or read) ----------


@pytest.mark.parametrize("relative", [
    os.path.join("AppData", "Roaming", "zz-no-such-app"),
    os.path.join("AppData", "Local", "Temp", "zz-no-such-app"),
    os.path.join("AppData", "LocalLow", "zz-no-such-app"),
])
def test_real_policy_refuses_appdata_descendants(tmp_path, relative):
    policy = default_policy(str(tmp_path / "root"))
    target = os.path.join(os.path.expanduser("~"), relative)
    assert _code(target, policy) == "sensitive_folder"


def test_real_policy_refuses_unlisted_dot_folders_and_git(tmp_path):
    policy = default_policy(str(tmp_path / "root"))
    home = os.path.expanduser("~")
    assert _code(os.path.join(home, ".zz-no-such-tool", "sub"), policy) == "sensitive_folder"
    assert _code(os.path.join(tmp_path, "zz-no-such", ".git"), policy) == "sensitive_folder"


@pytest.mark.parametrize("name", [
    ".config", ".docker", ".kube", ".azure", ".ssh", ".claude", ".codex", ".aws", ".gnupg",
])
def test_real_policy_refuses_credential_folders(tmp_path, name):
    policy = default_policy(str(tmp_path / "root"))
    target = os.path.join(os.path.expanduser("~"), name, "zz-no-such-sub")
    assert _code(target, policy) == "sensitive_folder"


# -- S-2: endpoints (fabricated home through the make_client fixture) ----------------


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    make_tree(root)
    with make_client(tmp_path, root=root) as (client, main_mod):
        yield client, main_mod, tmp_path


def _workspace(client):
    response = client.post("/api/workspaces", json={"name": "S"})
    assert response.status_code == 201, response.text
    return response.json()["workspace"]["id"]


def _post_project(client, workspace_id, folders, name="p"):
    return client.post(
        f"/api/workspaces/{workspace_id}/projects", json={"name": name, "folders": folders}
    )


@pytest.mark.parametrize("relative, code", [
    ("AppData/Roaming/GitHub CLI", "sensitive_folder"),
    ("AppData/Local/Temp", "sensitive_folder"),
    ("AppData/LocalLow/app", "sensitive_folder"),
    (".aws_backup_before_restore", "sensitive_folder"),
    (".vtex/session", "sensitive_folder"),
    (".config/gh", "sensitive_folder"),
    (".docker", "sensitive_folder"),
    (".kube", "sensitive_folder"),
    (".azure", "sensitive_folder"),
])
def test_endpoints_refuse_the_new_folders(env, relative, code):
    client, _, tmp_path = env
    folder = tmp_path / "fake_home" / relative
    folder.mkdir(parents=True)
    ws = _workspace(client)

    response = _post_project(client, ws, [{"path": str(folder)}])
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == code

    inspected = client.post("/api/folders/inspect", json={"paths": [str(folder)]})
    result = inspected.json()["results"][0]
    assert result["ok"] is False
    assert result["problems"][0]["code"] == code


def test_projects_root_under_the_home_but_outside_appdata_still_works(tmp_path):
    home = tmp_path / "fake_home"
    root = home / "dev"
    app = root / "client" / "app"
    elsewhere = home / "work" / "other"
    for folder in (app, elsewhere):
        folder.mkdir(parents=True)
    with make_client(tmp_path, root=root) as (client, _):
        ws = _workspace(client)
        response = _post_project(client, ws, [{"path": str(app)}])
        assert response.status_code == 201, response.text
        response = _post_project(client, ws, [{"path": str(elsewhere)}], name="q")
        assert response.status_code == 201, response.text


# -- S-5: a primary folder swapped for a junction ------------------------------------


def _link(link, target) -> None:
    if WINDOWS:
        done = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True, text=True,
        )
        if done.returncode != 0:
            pytest.skip(f"cannot create a junction here: {done.stderr or done.stdout}")
    else:
        os.symlink(target, link)


def _remove_dir_or_link(path) -> None:
    # rmdir removes an empty folder and also a junction (without touching its target).
    os.rmdir(path)


def test_primary_folder_swapped_for_a_junction_stops_resolving(env):
    client, main_mod, tmp_path = env
    folder = tmp_path / "folders" / "mine"
    folder.mkdir(parents=True)
    (folder / "README.md").write_text("hello")
    other = tmp_path / "folders" / "other"
    other.mkdir()
    (other / "README.md").write_text("other")

    ws = _workspace(client)
    key = _post_project(client, ws, [{"path": str(folder)}]).json()["project"]["key"]

    # Before the swap the root is the registered folder.
    assert main_mod._registry_root_for(key) == os.path.normpath(str(folder))
    assert client.get(f"/api/projects/{key}/attachments").status_code == 200

    (folder / "README.md").unlink()
    _remove_dir_or_link(folder)
    _link(folder, other)

    # Same lexical path, different real folder: treated like a missing folder.
    assert os.path.isdir(folder)
    assert main_mod._registry_root_for(key) is None
    assert main_mod._find_project_path(key) is None
    assert client.get(f"/api/projects/{key}/attachments").status_code == 404


def test_primary_folder_that_is_gone_still_does_not_resolve(env):
    client, main_mod, tmp_path = env
    folder = tmp_path / "folders" / "gone"
    folder.mkdir(parents=True)
    ws = _workspace(client)
    key = _post_project(client, ws, [{"path": str(folder)}]).json()["project"]["key"]
    folder.rmdir()
    assert main_mod._registry_root_for(key) is None


# -- S-6: bounded request bodies -----------------------------------------------------


def test_oversized_folder_lists_are_422_before_validation(env):
    client, _, tmp_path = env
    ws = _workspace(client)
    folder = {"path": str(tmp_path)}
    response = _post_project(client, ws, [folder] * 51)
    assert response.status_code == 422

    real = tmp_path / "folders" / "real"
    real.mkdir(parents=True)
    created = _post_project(client, ws, [{"path": str(real)}], name="real")
    assert created.status_code == 201, created.text
    pid = created.json()["project"]["id"]
    assert client.patch(f"/api/workspace-projects/{pid}", json={"folders": [folder] * 51}
                        ).status_code == 422


def test_eleven_folders_still_get_the_friendly_400(env):
    client, _, tmp_path = env
    ws = _workspace(client)
    response = _post_project(client, ws, [{"path": str(tmp_path)}] * 11)
    assert response.status_code == 400
    assert response.json()["detail"]["problems"][0]["code"] == "too_many_folders"


@pytest.mark.parametrize("method, url, body", [
    ("post", "/api/workspaces", {"name": "n" * 321}),
    ("post", "/api/workspaces", {"name": "ok", "adopt_legacy_key": "k" * 513}),
    ("post", "/api/workspaces/1/projects", {"name": "n" * 321, "folders": []}),
    ("post", "/api/workspaces/1/projects",
     {"name": "ok", "folders": [{"path": "C:/" + "a" * 4100}]}),
    ("patch", "/api/workspaces/1", {"name": "n" * 321}),
    ("patch", "/api/workspace-projects/1", {"name": "n" * 321}),
    ("post", "/api/folders/inspect", {"paths": ["C:/" + "a" * 4100]}),
])
def test_oversized_strings_are_422(env, method, url, body):
    client, _, _ = env
    assert getattr(client, method)(url, json=body).status_code == 422


# -- S-6: scans never pile up --------------------------------------------------------


class _ScanProbe:
    """Counts scans and the highest number running at the same time."""

    def __init__(self, delay=0.15, result=()):
        self.delay = delay
        self.result = list(result)
        self.calls = 0
        self.running = 0
        self.max_running = 0
        self._lock = threading.Lock()

    def __call__(self):
        with self._lock:
            self.calls += 1
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        time.sleep(self.delay)
        with self._lock:
            self.running -= 1
        return list(self.result)


def _service(scan):
    snapshot = SimpleNamespace(
        project_by_key={}, workspace_by_key={}, folder_canonical_index={}
    )
    store = SimpleNamespace(snapshot=snapshot)
    return WorkspaceService(store, lambda: "root", scan, lambda: [])


def test_concurrent_discover_calls_share_one_scan():
    probe = _ScanProbe()
    service = _service(probe)

    async def run():
        return await asyncio.gather(*(service.discover() for _ in range(6)))

    results = asyncio.run(run())
    assert probe.calls == 1
    assert all(r["entries"] == [] for r in results)


def test_discover_after_the_scan_finished_scans_again():
    probe = _ScanProbe(delay=0.01)
    service = _service(probe)

    async def run():
        await service.discover()
        await service.discover()

    asyncio.run(run())
    assert probe.calls == 2


def test_a_cancelled_discover_does_not_cancel_the_shared_scan():
    probe = _ScanProbe(delay=0.2)
    service = _service(probe)

    async def run():
        first = asyncio.ensure_future(service.discover())
        second = asyncio.ensure_future(service.discover())
        await asyncio.sleep(0.05)
        first.cancel()
        return await second

    assert asyncio.run(run())["entries"] == []
    assert probe.calls == 1


def test_adoption_scans_and_discover_never_run_together():
    probe = _ScanProbe()
    service = _service(probe)

    async def run():
        await asyncio.gather(
            service._gated(service._scan_blocking),
            service._gated(service._scan_blocking),
            service._gated(service._scan_blocking),
            service.discover(),
        )

    asyncio.run(run())
    assert probe.max_running == 1
    # Three adoption scans (each needs its own fresh scan) plus one discover scan.
    assert probe.calls == 4


def test_discover_endpoint_still_serves_the_contract(env):
    client, _, _ = env
    response = client.get("/api/folders/discover")
    assert response.status_code == 200
    assert {"root", "scanned_in_ms", "entries"} <= set(response.json())


def test_real_adoption_paths_go_through_the_scan_gate(tmp_path, monkeypatch):
    """create_workspace and create_project (not just `_gated` directly) never run
    their adoption scans concurrently."""
    home = tmp_path / "fake_home"
    home.mkdir()
    for name, value in _profile_env(home).items():
        monkeypatch.setenv(name, value)
    root = tmp_path / "root"
    clients = ["c1", "c2", "c3"]
    folders = {}
    for client in clients:
        folders[client] = root / client / "app"
        folders[client].mkdir(parents=True)
    probe = _ScanProbe(result=[
        Project(id=f"{c}/app", nome="app", path=str(folders[c]), cliente_id=c, elegivel=True)
        for c in clients
    ])

    async def run():
        store = WorkspaceStore(db_path=str(tmp_path / "gate.db"))
        await store.initialize()
        service = WorkspaceService(store, lambda: str(root), probe, lambda: [])
        try:
            await asyncio.gather(*(
                service.create_workspace(WorkspaceCreateRequest(name=c, adopt_legacy_key=c))
                for c in clients
            ))
            assert (probe.calls, probe.max_running) == (3, 1)
            probe.calls = probe.max_running = 0
            await asyncio.gather(*(
                service.create_project(
                    store.snapshot.workspace_by_key[c].id,
                    ProjectCreateRequest(
                        name="app", folders=[ProjectFolderIn(path=str(folders[c]), is_primary=True)]
                    ),
                )
                for c in clients
            ))
            assert (probe.calls, probe.max_running) == (3, 1)
        finally:
            await store.close()

    asyncio.run(run())


# -- S-5r: no spawn into a folder that no longer resolves to its canonical path ---------


SLEEP_CMD = [sys.executable, "-c", "import time; time.sleep(5)"]


def _swap_primary_for_a_junction(tmp_path, client):
    folder = tmp_path / "folders" / "mine"
    folder.mkdir(parents=True)
    other = tmp_path / "folders" / "other"
    other.mkdir()
    ws = _workspace(client)
    key = _post_project(client, ws, [{"path": str(folder)}]).json()["project"]["key"]
    folder.rmdir()
    _link(folder, other)
    return key


def _agent(client):
    response = client.post("/api/agents", json={
        "id": "shell-agent", "nome": "Shell", "papel": "Teste", "ia": "claude", "cmd": ["claude"],
    })
    assert response.status_code == 201
    return "shell-agent"


def test_continue_does_not_spawn_into_a_swapped_folder(env):
    client, main_mod, tmp_path = env
    key = _swap_primary_for_a_junction(tmp_path, client)
    agent_id = _agent(client)
    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD),             patch("app.main.provision_session_id", new=AsyncMock(return_value="x")) as provision,             patch.object(main_mod.pty_manager, "spawn") as spawn:
        response = client.post(f"/api/sessions/{key}::{agent_id}/continue")
    body = response.json()
    assert body["status"] == "provisioning_failed"
    spawn.assert_not_called()
    provision.assert_not_called()


def test_websocket_init_answers_spawn_failed_for_a_swapped_folder(env):
    client, main_mod, tmp_path = env
    key = _swap_primary_for_a_junction(tmp_path, client)
    agent_id = _agent(client)
    with patch("app.main._build_pty_cmd", return_value=SLEEP_CMD),             patch("app.main.provision_session_id", new=AsyncMock(return_value="x")),             patch.object(main_mod.pty_manager, "spawn") as spawn:
        with client.websocket_connect(f"/ws/pty/{key}::{agent_id}") as ws:
            ws.send_json({"type": "init", "project_id": key, "agent_id": agent_id,
                          "cols": 80, "rows": 24})
            frame = ws.receive_json()
    assert frame["type"] == "spawn_failed"
    spawn.assert_not_called()
