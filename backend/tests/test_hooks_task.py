import sys
import time
import uuid as uuid_mod

import pytest
from unittest.mock import patch


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    # Estrutura cliente/sub-projeto para exercitar a validação "mesmo cliente"
    # de resolve_projeto_alvo (Tarefa 3): dois sub-projetos do mesmo cliente
    # (cliente/aadmin, cliente/outro) e um projeto de OUTRO cliente.
    (tmp_path / "cliente" / "aadmin" / ".claude").mkdir(parents=True)
    (tmp_path / "cliente" / "outro" / ".claude").mkdir(parents=True)
    (tmp_path / "outrocliente" / "proj" / ".claude").mkdir(parents=True)
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


def _register_session(client, session_key, project_id="meu-projeto", fixed_uuid=None):
    """Registra session_key -> claude_session_id no ConversationStore (mesma
    técnica de test_hooks_cards.py): o `claude` CLI real nunca é spawnado
    (_build_pty_cmd trocado por um comando inofensivo), só o mapeamento
    session_key <-> claude_session_id importa para o hook."""
    fixed_uuid = fixed_uuid or uuid_mod.uuid4()
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=fixed_uuid):
            with client.websocket_connect(f"/ws/pty/{session_key}") as ws:
                ws.send_json({
                    "type": "init", "project_id": project_id, "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                time.sleep(0.2)
    return str(fixed_uuid)


def test_hook_task_creates_task_for_known_claude_session_id(client):
    """POST /api/hooks/task resolves claude_session_id -> session_key (same
    ConversationStore mapping the Stop hook uses) and creates the task.
    Pins uuid.uuid4() so the test knows exactly which claude_session_id the
    spawn will register — same technique as
    test_hook_stop_marks_needs_attention_for_known_session in
    test_websocket.py, for the same event-loop reason (the store's aiosqlite
    connection lives on the TestClient's own loop, not this sync test's)."""
    import uuid as uuid_mod
    fixed_uuid = uuid_mod.UUID("22222222-2222-2222-2222-222222222222")
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=fixed_uuid):
            with client.websocket_connect("/ws/pty/mcp-hook-test") as ws:
                ws.send_json({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                import time
                time.sleep(0.2)

    r = client.post("/api/hooks/task", json={
        "claude_session_id": str(fixed_uuid),
        "titulo": "Validar decisão X",
        "descricao_markdown": "Confirme se **isso** está certo.",
    })
    assert r.status_code == 200

    tasks = client.get("/api/sessions/mcp-hook-test/tasks").json()
    assert len(tasks) == 1
    assert tasks[0]["titulo"] == "Validar decisão X"
    assert tasks[0]["descricao_markdown"] == "Confirme se **isso** está certo."
    assert tasks[0]["status"] == "pending"


def test_hook_task_unknown_claude_session_id_is_noop(client):
    """A claude_session_id not resolvable to any session_key must not error
    (fire-and-forget, same tolerance as hook_stop) — and must not create a
    task anywhere."""
    r = client.post("/api/hooks/task", json={
        "claude_session_id": "unknown-uuid",
        "titulo": "Título",
        "descricao_markdown": "descr",
    })
    assert r.status_code == 200


def test_hook_task_missing_required_field_returns_422(client):
    r = client.post("/api/hooks/task", json={"claude_session_id": "x"})
    assert r.status_code == 422


def test_hook_task_accepts_optional_descricao_html(client):
    import uuid as uuid_mod
    fixed_uuid = uuid_mod.UUID("33333333-3333-3333-3333-333333333333")
    fake_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with patch("app.main._build_pty_cmd", return_value=fake_cmd):
        with patch("app.main.uuid.uuid4", return_value=fixed_uuid):
            with client.websocket_connect("/ws/pty/mcp-hook-html-test") as ws:
                ws.send_json({
                    "type": "init", "project_id": "meu-projeto", "agent_id": None,
                    "cols": 80, "rows": 24,
                })
                import time
                time.sleep(0.2)

    r = client.post("/api/hooks/task", json={
        "claude_session_id": str(fixed_uuid),
        "titulo": "T",
        "descricao_markdown": "md",
        "descricao_html": "<p>md</p>",
    })
    assert r.status_code == 200

    tasks = client.get("/api/sessions/mcp-hook-html-test/tasks").json()
    assert tasks[0]["descricao_html"] == "<p>md</p>"


# -- Tarefa 3: validação "mesmo cliente" do projeto_id -----------------------


def test_hook_task_known_session_returns_success_true(client):
    """Contrato novo: sessão resolvível + tarefa criada -> {"success": True}
    (não mais o antigo {"status": "ok"})."""
    session_key = "meu-projeto::claude"
    claude_sid = _register_session(client, session_key)
    r = client.post("/api/hooks/task", json={
        "claude_session_id": claude_sid,
        "titulo": "T",
        "descricao_markdown": "md",
    })
    assert r.status_code == 200
    assert r.json() == {"success": True}


def test_hook_task_with_same_cliente_projeto_id_succeeds_and_persists(client):
    """projeto_id de outro sub-projeto do MESMO cliente -> permitido; a tarefa
    é criada e guarda o projeto_id pedido."""
    session_key = "cliente/aadmin::claude"
    claude_sid = _register_session(client, session_key, project_id="cliente/aadmin")
    r = client.post("/api/hooks/task", json={
        "claude_session_id": claude_sid,
        "titulo": "Cross-proj",
        "descricao_markdown": "md",
        "projeto_id": "cliente/outro",
    })
    assert r.status_code == 200
    assert r.json() == {"success": True}

    tasks = client.get(f"/api/sessions/{session_key}/tasks").json()
    assert len(tasks) == 1
    assert tasks[0]["projeto_id"] == "cliente/outro"


def test_hook_task_nonexistent_projeto_id_rejected_and_nothing_created(client):
    """P0: projeto inexistente -> {"success": False, "error": <não-vazio>} e
    NADA é criado."""
    session_key = "cliente/aadmin::claude"
    claude_sid = _register_session(client, session_key, project_id="cliente/aadmin")
    r = client.post("/api/hooks/task", json={
        "claude_session_id": claude_sid,
        "titulo": "Não deve existir",
        "descricao_markdown": "md",
        "projeto_id": "cliente/fantasma",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert body.get("error")

    tasks = client.get(f"/api/sessions/{session_key}/tasks").json()
    assert tasks == []


def test_hook_task_other_cliente_projeto_id_rejected_and_nothing_created(client):
    """P0 (regra de segurança inegociável): projeto de OUTRO cliente ->
    rejeitado com erro, nada criado."""
    session_key = "cliente/aadmin::claude"
    claude_sid = _register_session(client, session_key, project_id="cliente/aadmin")
    r = client.post("/api/hooks/task", json={
        "claude_session_id": claude_sid,
        "titulo": "Vazamento entre clientes",
        "descricao_markdown": "md",
        "projeto_id": "outrocliente/proj",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")

    tasks = client.get(f"/api/sessions/{session_key}/tasks").json()
    assert tasks == []
