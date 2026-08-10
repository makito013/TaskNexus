import pytest
from unittest.mock import patch


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


def test_list_agents_empty_returns_empty_list(client):
    r = client.get("/api/agents")
    assert r.status_code == 200
    assert r.json() == []


def test_create_agent_returns_201_and_body(client):
    r = client.post("/api/agents", json={
        "id": "claude-work", "nome": "Claude (Work)", "papel": "Assistente",
        "ia": "claude", "cmd": ["claude", "--settings", "~/.claude-work"],
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "claude-work"
    assert body["cmd"] == ["claude", "--settings", "~/.claude-work"]
    assert body["default"] is False


def test_create_agent_then_list_returns_it(client):
    client.post("/api/agents", json={
        "id": "claude-work", "nome": "Claude (Work)", "papel": "Assistente",
        "ia": "claude", "cmd": ["claude"],
    })
    r = client.get("/api/agents")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_create_agent_duplicate_id_returns_409(client):
    payload = {"id": "dup", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]}
    client.post("/api/agents", json=payload)
    r = client.post("/api/agents", json=payload)
    assert r.status_code == 409


def test_create_agent_empty_cmd_returns_422(client):
    r = client.post("/api/agents", json={"id": "x", "nome": "A", "papel": "p", "ia": "claude", "cmd": []})
    assert r.status_code == 422


def test_create_agent_missing_field_returns_422(client):
    r = client.post("/api/agents", json={"nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})
    assert r.status_code == 422


def test_update_agent_returns_200_and_updated_body(client):
    client.post("/api/agents", json={"id": "dup", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})
    r = client.put("/api/agents/dup", json={"id": "dup", "nome": "B", "papel": "p2", "ia": "gemini", "cmd": ["agy"]})
    assert r.status_code == 200
    body = r.json()
    assert body["nome"] == "B"
    assert body["ia"] == "gemini"
    assert body["cmd"] == ["agy"]


def test_update_agent_unknown_id_returns_404(client):
    r = client.put("/api/agents/ghost", json={"id": "ghost", "nome": "B", "papel": "p", "ia": "claude", "cmd": ["claude"]})
    assert r.status_code == 404


def test_update_agent_empty_cmd_returns_422(client):
    client.post("/api/agents", json={"id": "dup", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})
    r = client.put("/api/agents/dup", json={"id": "dup", "nome": "A", "papel": "p", "ia": "claude", "cmd": []})
    assert r.status_code == 422


def test_delete_agent_returns_200_and_removes_it(client):
    client.post("/api/agents", json={"id": "dup", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]})
    r = client.delete("/api/agents/dup")
    assert r.status_code == 200
    assert client.get("/api/agents").json() == []


def test_delete_agent_unknown_id_returns_404(client):
    r = client.delete("/api/agents/ghost")
    assert r.status_code == 404


def test_global_agent_appears_in_project_list(client):
    """End-to-end: creating a global agent makes it show up in /api/projects
    for a project that's already eligible (has .claude/) — confirms the
    _global_agents_cache reload-after-write actually takes effect."""
    client.post("/api/agents", json={
        "id": "claude-work", "nome": "Claude (Work)", "papel": "Assistente",
        "ia": "claude", "cmd": ["claude", "--settings", "~/.claude-work"],
    })
    r = client.get("/api/projects")
    assert r.status_code == 200
    proj = next(p for p in r.json() if p["id"] == "meu-projeto")
    ids = {a["id"] for a in proj["agentes"]}
    assert "claude-work" in ids


def test_deleted_global_agent_disappears_from_project_list(client):
    client.post("/api/agents", json={
        "id": "claude-work", "nome": "Claude (Work)", "papel": "Assistente",
        "ia": "claude", "cmd": ["claude"],
    })
    client.delete("/api/agents/claude-work")
    r = client.get("/api/projects")
    proj = next(p for p in r.json() if p["id"] == "meu-projeto")
    ids = {a["id"] for a in proj["agentes"]}
    assert "claude-work" not in ids
