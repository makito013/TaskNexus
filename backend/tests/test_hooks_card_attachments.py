"""POST /api/hooks/cards/attach (MCP tool `anexar_arquivo_card`) and the
`attachments` field of POST /api/hooks/cards/get (`ver_card`).

Same fixture and session-registration technique as test_hooks_cards.py: the
real `claude` CLI is never spawned, only the session_key <-> claude_session_id
mapping matters for the hooks.
"""
from __future__ import annotations

import sqlite3
import sys
import time
import uuid as uuid_mod
from unittest.mock import patch

import pytest


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    (tmp_path / "outrocliente" / "proj" / ".claude").mkdir(parents=True)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "BOARD_UPLOADS_ROOT": str(tmp_path / "board_uploads"),
        "BOARD_ATTACHMENTS_ROOT": str(tmp_path / "board_attachments"),
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


def _register_session(client, session_key="meu-projeto::agente-teste", project_id="meu-projeto"):
    fixed_uuid = uuid_mod.uuid4()
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


def _create_card(client, projeto_id="meu-projeto"):
    r = client.post("/api/cards", json={"titulo": "Card", "projeto_id": projeto_id})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _insert_card_direct(db_path, projeto_id):
    now = time.time()
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(
            """
            INSERT INTO cards (titulo, projeto_id, status, origem,
                               ultima_atualizacao_por, criado_em, atualizado_em)
            VALUES ('Outro', ?, 'a_fazer', 'bruno', 'bruno', ?, ?)
            """,
            (projeto_id, now, now),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _attach(client, sid, card_id, caminho):
    r = client.post("/api/hooks/cards/attach", json={
        "claude_session_id": sid, "card_id": card_id, "caminho": caminho,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _card_attachments(client, card_id):
    card = next(c for c in client.get("/api/cards").json() if c["id"] == card_id)
    return card["attachments"]


def test_attach_copies_project_file_and_it_opens_in_the_viewer(client, tmp_path):
    (tmp_path / "meu-projeto" / "docs").mkdir()
    (tmp_path / "meu-projeto" / "docs" / "plano.md").write_bytes(b"# Plano\n")
    sid = _register_session(client)
    card_id = _create_card(client)

    body = _attach(client, sid, card_id, "docs/plano.md")
    assert body["success"] is True, body
    attachment = body["attachment"]
    assert attachment["filename"] == "plano.md"
    assert attachment["size_bytes"] == len(b"# Plano\n")

    assert [a["id"] for a in _card_attachments(client, card_id)] == [attachment["id"]]
    content = client.get(f"/api/card-attachments/{attachment['id']}/content").json()
    assert content["kind"] == "markdown"
    assert content["text"] == "# Plano\n"

    # A copy, not a link: editing the project file does not change the attachment.
    (tmp_path / "meu-projeto" / "docs" / "plano.md").write_bytes(b"# Mudou\n")
    content = client.get(f"/api/card-attachments/{attachment['id']}/content").json()
    assert content["text"] == "# Plano\n"


def test_attach_accepts_absolute_path_inside_the_project(client, tmp_path):
    target = tmp_path / "meu-projeto" / "relatorio.html"
    target.write_bytes(b"<h1>oi</h1>")
    sid = _register_session(client)
    card_id = _create_card(client)

    body = _attach(client, sid, card_id, str(target))
    assert body["success"] is True, body
    assert body["attachment"]["filename"] == "relatorio.html"


@pytest.mark.parametrize("caminho", ["../fora.md", ".env", "nao-existe.md", "docs"])
def test_attach_refuses_paths_the_viewer_would_refuse(client, tmp_path, caminho):
    (tmp_path / "fora.md").write_bytes(b"segredo")
    (tmp_path / "meu-projeto" / ".env").write_bytes(b"TOKEN=1")
    (tmp_path / "meu-projeto" / "docs").mkdir()
    sid = _register_session(client)
    card_id = _create_card(client)

    body = _attach(client, sid, card_id, caminho)
    assert body["success"] is False
    assert body["error"]
    assert _card_attachments(client, card_id) == []


def test_attach_to_card_of_another_cliente_is_refused_before_copying(client, tmp_path):
    (tmp_path / "meu-projeto" / "a.md").write_bytes(b"a")
    sid = _register_session(client)
    import app.main as main_mod
    other_card = _insert_card_direct(main_mod.SESSIONS_DB, "outrocliente/proj")

    body = _attach(client, sid, other_card, "a.md")
    assert body == {"success": False, "error": f"Card {other_card} pertence a outro cliente"}
    assert not (tmp_path / "board_attachments" / str(other_card)).exists()


def test_attach_to_missing_card_returns_error(client, tmp_path):
    (tmp_path / "meu-projeto" / "a.md").write_bytes(b"a")
    sid = _register_session(client)
    body = _attach(client, sid, 999999, "a.md")
    assert body["success"] is False


def test_attach_too_large_returns_error_and_leaves_nothing(client, tmp_path):
    (tmp_path / "meu-projeto" / "big.txt").write_bytes(b"x" * 11)
    sid = _register_session(client)
    card_id = _create_card(client)
    import app.main as main_mod

    with patch.object(main_mod, "CARD_ATTACHMENT_MAX_BYTES", 10):
        body = _attach(client, sid, card_id, "big.txt")
    assert body["success"] is False
    assert "limite" in body["error"]
    assert _card_attachments(client, card_id) == []


def test_attach_with_unknown_session_is_silent_noop(client):
    card_id = _create_card(client)
    body = _attach(client, "sessao-desconhecida", card_id, "a.md")
    assert body.get("success") is not True
    assert _card_attachments(client, card_id) == []


def test_ver_card_lists_attachments(client, tmp_path):
    (tmp_path / "meu-projeto" / "a.pdf").write_bytes(b"%PDF-1.4\n%%EOF")
    sid = _register_session(client)
    card_id = _create_card(client)
    attachment = _attach(client, sid, card_id, "a.pdf")["attachment"]

    r = client.post("/api/hooks/cards/get", json={"claude_session_id": sid, "card_id": card_id})
    card = r.json()["card"]
    assert [a["id"] for a in card["attachments"]] == [attachment["id"]]
    assert card["attachments"][0]["filename"] == "a.pdf"
