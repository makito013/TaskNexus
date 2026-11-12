"""Card questions: the agent asks through POST /api/hooks/cards/questions (MCP
tool `perguntar_card`), the user answers through
PATCH /api/cards/{id}/questions/{qid}, and the agent reads the answers back
through POST /api/hooks/cards/get (`ver_card`).

Same fixture and session-registration technique as
test_hooks_card_attachments.py.
"""
from __future__ import annotations

import sqlite3
import sys
import time
import uuid as uuid_mod
from unittest.mock import patch

import pytest
import pytest_asyncio

from app.card_store import CardStore


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


def _ask(client, sid, card_id, perguntas):
    r = client.post("/api/hooks/cards/questions", json={
        "claude_session_id": sid, "card_id": card_id, "perguntas": perguntas,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _board_card(client, card_id):
    return next(c for c in client.get("/api/cards").json() if c["id"] == card_id)


def _ver_card(client, sid, card_id):
    r = client.post("/api/hooks/cards/get", json={"claude_session_id": sid, "card_id": card_id})
    return r.json()["card"]


# -- full round trip -------------------------------------------------------------


def test_agent_asks_user_answers_agent_reads_answers(client):
    sid = _register_session(client)
    card_id = _create_card(client)

    body = _ask(client, sid, card_id, ["Qual banco usar?", "  ", " Precisa de migração? "])
    assert body["success"] is True, body
    asked = body["questions"]
    assert [q["question"] for q in asked] == ["Qual banco usar?", "Precisa de migração?"]
    assert all(q["answer"] is None and q["asked_by"] == "agente:agente-teste" for q in asked)

    # The board shows them on the card.
    assert [q["id"] for q in _board_card(client, card_id)["questions"]] == [q["id"] for q in asked]

    r = client.patch(
        f"/api/cards/{card_id}/questions/{asked[0]['id']}", json={"answer": "  Postgres  "}
    )
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == "Postgres"
    assert r.json()["answered_at"] is not None

    questions = _ver_card(client, sid, card_id)["questions"]
    assert [(q["question"], q["answer"]) for q in questions] == [
        ("Qual banco usar?", "Postgres"),
        ("Precisa de migração?", None),
    ]


def test_blank_answer_puts_question_back_to_pending(client):
    sid = _register_session(client)
    card_id = _create_card(client)
    qid = _ask(client, sid, card_id, ["P?"])["questions"][0]["id"]
    client.patch(f"/api/cards/{card_id}/questions/{qid}", json={"answer": "sim"})

    r = client.patch(f"/api/cards/{card_id}/questions/{qid}", json={"answer": "   "})
    assert r.status_code == 200
    assert r.json()["answer"] is None
    assert r.json()["answered_at"] is None


def test_answer_or_delete_question_of_another_card_is_404(client):
    sid = _register_session(client)
    card_a = _create_card(client)
    card_b = _create_card(client)
    qid = _ask(client, sid, card_a, ["P?"])["questions"][0]["id"]

    assert client.patch(f"/api/cards/{card_b}/questions/{qid}", json={"answer": "x"}).status_code == 404
    assert client.delete(f"/api/cards/{card_b}/questions/{qid}").status_code == 404
    assert _board_card(client, card_a)["questions"][0]["answer"] is None


def test_delete_question(client):
    sid = _register_session(client)
    card_id = _create_card(client)
    qid = _ask(client, sid, card_id, ["P?"])["questions"][0]["id"]

    r = client.delete(f"/api/cards/{card_id}/questions/{qid}")
    assert r.status_code == 200
    assert _board_card(client, card_id)["questions"] == []


# -- agent-path validation -------------------------------------------------------


@pytest.mark.parametrize("perguntas", [[], ["", "   "], None, ["ok", 3], "não é lista"])
def test_ask_rejects_invalid_perguntas(client, perguntas):
    sid = _register_session(client)
    card_id = _create_card(client)
    body = _ask(client, sid, card_id, perguntas)
    assert body["success"] is False
    assert body["error"]
    assert _board_card(client, card_id)["questions"] == []


def test_ask_rejects_too_long_question(client):
    sid = _register_session(client)
    card_id = _create_card(client)
    body = _ask(client, sid, card_id, ["x" * 2001])
    assert body["success"] is False
    assert "2000" in body["error"]


def test_ask_on_card_of_another_cliente_is_refused(client):
    sid = _register_session(client)
    import app.main as main_mod
    other_card = _insert_card_direct(main_mod.SESSIONS_DB, "outrocliente/proj")

    body = _ask(client, sid, other_card, ["P?"])
    assert body == {"success": False, "error": f"Card {other_card} pertence a outro cliente"}


def test_ask_on_missing_card_returns_error(client):
    sid = _register_session(client)
    body = _ask(client, sid, 999999, ["P?"])
    assert body["success"] is False


def test_ask_with_unknown_session_is_silent_noop(client):
    card_id = _create_card(client)
    body = _ask(client, "sessao-desconhecida", card_id, ["P?"])
    assert body.get("success") is not True
    assert _board_card(client, card_id)["questions"] == []


def test_mcp_config_exposes_the_ask_url(client):
    import json
    import app.main as main_mod
    config = json.loads(main_mod._build_mcp_config_json("sid-1"))
    env = config["mcpServers"]["escritorio-cards"]["env"]
    assert env["ESCRITORIO_HOOK_ASK_URL"].endswith("/api/hooks/cards/questions")


# -- store ---------------------------------------------------------------------


@pytest_asyncio.fixture
async def store(tmp_path):
    s = CardStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


async def _new_card(store, **kwargs):
    return await store.create(titulo="C", projeto_id="proj-a", **kwargs)


@pytest.mark.asyncio
async def test_store_question_limit_is_enforced_atomically(store):
    card_id = await _new_card(store)
    await store.add_questions(card_id, ["p"] * (CardStore.MAX_QUESTIONS_PER_CARD - 1), "agente:a")
    with pytest.raises(ValueError):
        await store.add_questions(card_id, ["p1", "p2"], "agente:a")
    assert len(await store.list_questions(card_id)) == CardStore.MAX_QUESTIONS_PER_CARD - 1


@pytest.mark.asyncio
async def test_store_subcards_carry_their_questions(store):
    parent = await _new_card(store)
    sub = await store.create(titulo="S", projeto_id="", parent_id=parent)
    await store.add_questions(sub, ["Da sub?"], "agente:a")
    [card] = await store.list_top_level(["proj-a"])
    assert card["questions"] == []
    assert [q["question"] for q in card["subcards"][0]["questions"]] == ["Da sub?"]


@pytest.mark.asyncio
async def test_store_clear_finished_removes_questions(store):
    card_id = await _new_card(store, status="feito")
    await store.add_questions(card_id, ["P?"], "agente:a")
    await store.executar_limpar_concluidos("proj-a")
    assert await store.list_questions(card_id) == []
