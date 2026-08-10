import sys
import time
from unittest.mock import patch

import pytest


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def test_tasks_from_multiple_sessions_appear_with_derived_ids(client):
    """Tasks created under different project::agent session keys must all
    show up in the global list, each with projeto_id/agent_id correctly
    derived from its own session_key via partition("::")."""
    client.post(
        "/api/sessions/proj-a::claude/tasks",
        json={"titulo": "Tarefa A", "descricao_markdown": "descr A"},
    )
    client.post(
        "/api/sessions/proj-b::claude/tasks",
        json={"titulo": "Tarefa B", "descricao_markdown": "descr B"},
    )

    r = client.get("/api/tasks/global")
    assert r.status_code == 200
    tasks = r.json()
    assert len(tasks) == 2

    by_titulo = {t["titulo"]: t for t in tasks}
    assert by_titulo["Tarefa A"]["projeto_id"] == "proj-a"
    assert by_titulo["Tarefa A"]["agent_id"] == "claude"
    assert by_titulo["Tarefa A"]["session_key"] == "proj-a::claude"
    assert by_titulo["Tarefa B"]["projeto_id"] == "proj-b"
    assert by_titulo["Tarefa B"]["agent_id"] == "claude"
    assert by_titulo["Tarefa B"]["session_key"] == "proj-b::claude"


def test_session_display_name_is_populated_from_conversation_store(client):
    """A task whose session has a custom display_name (set via PATCH
    .../rename) must surface that name as session_display_name in the
    global list."""
    with patch("app.main._build_pty_cmd", return_value=[sys.executable, "-c", "import time; time.sleep(10)"]):
        with client.websocket_connect("/ws/pty/proj-named::claude") as ws:
            ws.send_json({
                "type": "init", "project_id": "meu-projeto", "agent_id": None,
                "cols": 80, "rows": 24,
            })
            time.sleep(0.2)

    rename_r = client.patch(
        "/api/sessions/proj-named::claude/rename",
        json={"display_name": "Meu Chat Favorito"},
    )
    assert rename_r.status_code == 200

    client.post(
        "/api/sessions/proj-named::claude/tasks",
        json={"titulo": "Tarefa nomeada", "descricao_markdown": "descr"},
    )

    r = client.get("/api/tasks/global")
    assert r.status_code == 200
    tasks = r.json()
    named = next(t for t in tasks if t["titulo"] == "Tarefa nomeada")
    assert named["session_display_name"] == "Meu Chat Favorito"


def test_session_key_without_separator_does_not_raise(client):
    """Edge case: a session_key with no '::' at all must not raise — per
    str.partition semantics, projeto_id becomes the whole string and
    agent_id becomes empty string."""
    r = client.post(
        "/api/sessions/sessao-sem-separador/tasks",
        json={"titulo": "Tarefa solta", "descricao_markdown": "descr"},
    )
    assert r.status_code == 201

    r = client.get("/api/tasks/global")
    assert r.status_code == 200
    tasks = r.json()
    solta = next(t for t in tasks if t["titulo"] == "Tarefa solta")
    assert solta["projeto_id"] == "sessao-sem-separador"
    assert solta["agent_id"] == ""
    assert solta["session_display_name"] is None


def test_global_endpoint_never_calls_scan_projects(client):
    """ADR-9: GET /api/tasks/global must never scan the filesystem — it only
    reads TaskStore.list_all() and ConversationStore.get_all_meta()."""
    client.post(
        "/api/sessions/proj-a::claude/tasks",
        json={"titulo": "Tarefa A", "descricao_markdown": "descr A"},
    )
    with patch("app.main.scan_projects") as mock_scan:
        r = client.get("/api/tasks/global")
        assert r.status_code == 200
        mock_scan.assert_not_called()


def test_projeto_id_coalesce_explicit_wins_null_falls_back(client):
    """Tarefa 5: o projeto_id do TaskGlobal é COALESCE(coluna, session_key):
    uma tarefa com projeto_id explícito (criada em outro sub-projeto do mesmo
    cliente) usa esse valor; uma tarefa sem projeto_id (NULL) cai no fallback
    derivado da session_key."""
    # Explícito: session em cliente/aadmin, tarefa apontando para cliente/outro.
    client.post(
        "/api/sessions/cliente/aadmin::claude/tasks",
        json={
            "titulo": "Explícita",
            "descricao_markdown": "d",
            "projeto_id": "cliente/outro",
        },
    )
    # NULL: sem projeto_id no body -> fallback pra "proj-b".
    client.post(
        "/api/sessions/proj-b::claude/tasks",
        json={"titulo": "Fallback", "descricao_markdown": "d"},
    )

    r = client.get("/api/tasks/global")
    assert r.status_code == 200
    by_titulo = {t["titulo"]: t for t in r.json()}
    assert by_titulo["Explícita"]["projeto_id"] == "cliente/outro"
    assert by_titulo["Fallback"]["projeto_id"] == "proj-b"


def test_global_coalesce_never_calls_scan_projects(client):
    """O coalesce da Tarefa 5 é só leitura de coluna + fallback de string —
    NÃO pode reintroduzir uma chamada a scan_projects (contrato ADR-9), mesmo
    com uma tarefa que tem projeto_id explícito."""
    client.post(
        "/api/sessions/cliente/aadmin::claude/tasks",
        json={"titulo": "X", "descricao_markdown": "d", "projeto_id": "cliente/outro"},
    )
    with patch("app.main.scan_projects") as mock_scan:
        r = client.get("/api/tasks/global")
        assert r.status_code == 200
        mock_scan.assert_not_called()
