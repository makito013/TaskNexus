"""Testes de integração para os hooks do agente para o Board (Tarefa 7,
05-TL.md): POST /api/hooks/cards/create e POST /api/hooks/cards/move.

Mesmo padrão de fixture `client` de test_hooks_task.py/test_cards_endpoints.py
(reload de app.main com env vars apontando pra um tmp_path isolado). Sessões
de agente são registradas exatamente como test_hooks_task.py faz: abre um
/ws/pty real com _build_pty_cmd trocado por um comando inofensivo e
uuid.uuid4 fixado, para saber de antemão qual claude_session_id o
ConversationStore vai gravar para aquele session_key.
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
    # Estrutura cliente/sub-projeto + outro cliente para a validação
    # "mesmo cliente" de resolve_projeto_alvo (Tarefa 3) no hook de cards.
    (tmp_path / "cliente" / "aadmin" / ".claude").mkdir(parents=True)
    (tmp_path / "cliente" / "outro" / ".claude").mkdir(parents=True)
    (tmp_path / "outrocliente" / "proj" / ".claude").mkdir(parents=True)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "BOARD_UPLOADS_ROOT": str(tmp_path / "board_uploads"),
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


def _register_session(client, session_key: str, project_id: str = "meu-projeto",
                       fixed_uuid: uuid_mod.UUID | None = None) -> str:
    """Registra session_key -> claude_session_id no ConversationStore, mesma
    técnica de test_hooks_task.py: o processo real do `claude` CLI nunca é
    spawnado (_build_pty_cmd é trocado por um comando inofensivo), só o
    mapeamento session_key <-> claude_session_id importa para os hooks."""
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


def _insert_card_direct(db_path: str, **cols) -> int:
    """Escreve uma linha de `cards` direto via sqlite3 stdlib — conexão
    própria, síncrona, separada da conexão async do CardStore (evita
    problemas de "different event loop" ao chamar o CardStore fora do loop
    do TestClient). Permite montar estados que nenhum endpoint HTTP produz
    hoje (ex: um card com origem="agente:claude" já no projeto de OUTRO
    cliente, para exercitar a regra "mesmo cliente" de _agent_can_move sem
    depender de qual agente o criou)."""
    now = time.time()
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(
            """
            INSERT INTO cards (
                titulo, projeto_id, parent_id, status, origem,
                ultima_atualizacao_por, descricao, session_key,
                criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cols.get("titulo", "Card"),
                cols.get("projeto_id", "meu-projeto"),
                cols.get("parent_id"),
                cols.get("status", "a_fazer"),
                cols.get("origem", "bruno"),
                cols.get("ultima_atualizacao_por", "bruno"),
                cols.get("descricao"),
                cols.get("session_key"),
                now, now,
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _get_card(client, card_id: int, projeto_id: str = "meu-projeto") -> dict:
    cards = client.get("/api/cards", params={"projeto_id": projeto_id}).json()
    return next(c for c in cards if c["id"] == card_id)


# -- POST /api/hooks/cards/create --------------------------------------------

def test_hook_cards_create_unknown_session_is_noop(client):
    """claude_session_id não resolvível -> no-op silencioso, mesmo padrão de
    hook_task/hook_stop: não é erro (200), mas também não é um sucesso de
    criação."""
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": "unknown-uuid",
        "titulo": "Card órfão",
    })
    assert r.status_code == 200
    assert r.json().get("success") is not True


def test_hook_cards_create_success_sets_origem_e_session_key(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Nova feature",
        "status": "a_fazer",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    card_id = body["card_id"]

    created = _get_card(client, card_id)
    assert created["origem"] == "agente:agente-teste"
    assert created["session_key"] == session_key


def test_hook_cards_create_subcard_with_missing_parent_returns_explicit_error(client):
    """Diferente do caso de sessão desconhecida acima: aqui a requisição
    chegou e foi processada (a sessão existe), só foi rejeitada por regra de
    negócio do CardStore (pai inexistente) — não é um no-op silencioso, é um
    erro explícito que a tool MCP consegue repassar ao agente."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Subtarefa órfã",
        "parent_id": 999999,
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert body.get("error")


# -- POST /api/hooks/cards/create: validação "mesmo cliente" (Tarefa 3) ------

def test_hook_cards_create_same_cliente_projeto_id_succeeds(client):
    """O agente pode criar um card em outro sub-projeto do MESMO cliente via
    projeto_id — o card é criado nesse projeto-alvo."""
    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("11111111-2222-3333-4444-555555555555")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Card cross-proj",
        "projeto_id": "cliente/outro",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True

    created = _get_card(client, body["card_id"], projeto_id="cliente/outro")
    assert created["projeto_id"] == "cliente/outro"


def test_hook_cards_create_other_cliente_projeto_id_rejected_and_nothing_created(client):
    """P0/segurança: projeto de OUTRO cliente -> erro explícito, nenhum card
    criado (nem no projeto-alvo, nem no projeto da sessão)."""
    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("66666666-7777-8888-9999-000000000000")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Vazamento",
        "projeto_id": "outrocliente/proj",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")

    assert client.get("/api/cards", params={"projeto_id": "outrocliente/proj"}).json() == []
    assert client.get("/api/cards", params={"projeto_id": "cliente/aadmin"}).json() == []


# -- POST /api/hooks/cards/create: subcard via parent_id (validação cliente) -

def test_hook_cards_create_subcard_under_other_cliente_parent_rejected_and_nothing_created(
    client, tmp_path
):
    """P0/segurança (regressão do bug reportado pelo QA): um agente numa
    sessão de clienteA NÃO pode criar um subcard sob um card de clienteB só
    informando parent_id (sem projeto_id). O CardStore deriva projeto_id do
    pai, então a validação "mesmo cliente" precisa recair sobre o projeto do
    PAI — senão vaza cross-tenant. Deve retornar erro real (success=False) e
    NADA pode ser criado sob o card de outro cliente."""
    # Card pai pertencente a OUTRO cliente, gravado direto no banco.
    db_path = str(tmp_path / "sessions.db")
    parent_id = _insert_card_direct(
        db_path,
        titulo="Card do outro cliente",
        projeto_id="outrocliente/proj",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    # Sessão do clienteA tentando criar subcard sob o card do clienteB.
    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("12121212-3434-5656-7878-909090909090")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Subcard vazado",
        "parent_id": parent_id,
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")
    assert body.get("card_id") is None

    # Nada foi criado sob o card do outro cliente: o pai continua sem subcards.
    outro = client.get("/api/cards", params={"projeto_id": "outrocliente/proj"}).json()
    pai = next(c for c in outro if c["id"] == parent_id)
    assert pai["subcards"] == []
    # E nada apareceu no projeto da própria sessão tampouco.
    assert client.get("/api/cards", params={"projeto_id": "cliente/aadmin"}).json() == []


def test_hook_cards_create_subcard_under_same_cliente_parent_succeeds(client, tmp_path):
    """Contraprova: subcard sob um card do MESMO cliente (outro sub-projeto do
    cliente) é permitido — o subcard herda o projeto_id do pai."""
    db_path = str(tmp_path / "sessions.db")
    parent_id = _insert_card_direct(
        db_path,
        titulo="Card do mesmo cliente, outro projeto",
        projeto_id="cliente/outro",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("13131313-2424-3535-4646-575757575757")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Subcard legítimo",
        "parent_id": parent_id,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True

    # Subcard fica embutido no pai (list_top_level), não no nível de topo.
    pai = _get_card(client, parent_id, projeto_id="cliente/outro")
    subcard = next(s for s in pai["subcards"] if s["id"] == body["card_id"])
    assert subcard["parent_id"] == parent_id
    assert subcard["projeto_id"] == "cliente/outro"


def test_hook_cards_create_subcard_with_inconsistent_projeto_id_rejected(client, tmp_path):
    """Ambiguidade: parent_id E projeto_id explícito juntos, apontando para
    projetos diferentes (mesmo que ambos do mesmo cliente) -> erro bloqueante,
    nada criado. O CardStore usaria o do pai silenciosamente; preferimos
    rejeitar um pedido contraditório."""
    db_path = str(tmp_path / "sessions.db")
    parent_id = _insert_card_direct(
        db_path,
        titulo="Pai em cliente/outro",
        projeto_id="cliente/outro",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("14141414-2525-3636-4747-585858585858")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )
    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Subcard ambíguo",
        "parent_id": parent_id,
        "projeto_id": "cliente/aadmin",  # diferente do projeto do pai
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert body.get("error")
    assert body.get("card_id") is None

    # nada criado sob o pai
    outro = client.get("/api/cards", params={"projeto_id": "cliente/outro"}).json()
    pai = next(c for c in outro if c["id"] == parent_id)
    assert pai["subcards"] == []


# -- POST /api/hooks/cards/move ----------------------------------------------

def test_hook_cards_move_unknown_session_is_noop(client):
    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": "unknown-uuid",
        "card_id": 999999,
        "novo_status": "em_andamento",
    })
    assert r.status_code == 200
    assert r.json().get("success") is not True


def test_hook_cards_move_self_created_card_to_feito_succeeds(client):
    """Card criado pelo próprio agente (mesmo projeto/cliente) pode ser movido
    para qualquer status, inclusive 'feito'."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Tarefa própria",
    }).json()
    card_id = created["card_id"]

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": claude_sid,
        "card_id": card_id,
        "novo_status": "feito",
    })
    assert r.status_code == 200
    assert r.json() == {"success": True}

    updated = _get_card(client, card_id)
    assert updated["status"] == "feito"
    assert updated["ultima_atualizacao_por"] == "agente:agente-teste"


def test_hook_cards_move_different_agent_same_cliente_can_move_including_feito(client):
    """Fluxo feliz que motivou a mudança (decisão do Bruno): o Claude abre o
    card, o Gemini termina. Um agente DIFERENTE do que criou o card consegue
    movê-lo — inclusive para 'feito' — desde que seja do MESMO cliente. Não
    há mais restrição por agent_id nem por vínculo de sessão."""
    # Sessão do "claude" cria o card no projeto meu-projeto.
    sk_claude = "meu-projeto::claude"
    uuid_claude = uuid_mod.UUID("aaaa1111-2222-3333-4444-555566667777")
    sid_claude = _register_session(client, sk_claude, fixed_uuid=uuid_claude)
    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": sid_claude,
        "titulo": "Card aberto pelo Claude",
    }).json()
    card_id = created["card_id"]
    assert _get_card(client, card_id)["origem"] == "agente:claude"

    # Sessão do "gemini", no mesmo projeto (mesmo cliente), termina o card.
    sk_gemini = "meu-projeto::gemini"
    uuid_gemini = uuid_mod.UUID("bbbb1111-2222-3333-4444-555566667777")
    sid_gemini = _register_session(client, sk_gemini, fixed_uuid=uuid_gemini)

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": sid_gemini,
        "card_id": card_id,
        "novo_status": "feito",
    })
    assert r.status_code == 200
    assert r.json() == {"success": True}

    updated = _get_card(client, card_id)
    assert updated["status"] == "feito"
    # quem moveu por último foi o gemini, ainda que o claude tenha criado
    assert updated["ultima_atualizacao_por"] == "agente:gemini"


def test_hook_cards_move_other_cliente_blocked_even_when_agent_id_matches(client, tmp_path):
    """P0/segurança: um agente de OUTRO cliente não pode mover o card, mesmo
    que o agent_id "bata" por coincidência com a origem do card (agent_id é
    global entre clientes). A única regra é "mesmo cliente" — cliente
    diferente -> erro bloqueante, nada muda."""
    # Card em outrocliente/proj, criado (fictíciamente) por "agente:claude".
    db_path = str(tmp_path / "sessions.db")
    card_id = _insert_card_direct(
        db_path,
        titulo="Card de outro cliente criado por agente:claude",
        projeto_id="outrocliente/proj",
        status="a_fazer",
        origem="agente:claude",
        ultima_atualizacao_por="agente:claude",
    )

    # Sessão de cliente/aadmin cujo agent_id é EXATAMENTE "claude" — bate com a
    # origem do card, mas é outro cliente.
    session_key = "cliente/aadmin::claude"
    fixed_uuid = uuid_mod.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": claude_sid,
        "card_id": card_id,
        "novo_status": "em_andamento",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")

    # Card inalterado: status e ultima_atualizacao_por preservados.
    unchanged = _get_card(client, card_id, projeto_id="outrocliente/proj")
    assert unchanged["status"] == "a_fazer"
    assert unchanged["ultima_atualizacao_por"] == "agente:claude"


def test_hook_cards_move_nonexistent_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": claude_sid,
        "card_id": 999999,
        "novo_status": "em_andamento",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert body.get("error")
