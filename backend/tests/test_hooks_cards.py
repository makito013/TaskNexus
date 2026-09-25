"""Testes de integração para os hooks do agente para o Board (Tarefa 7,
05-TL.md, + Fase 3): POST /api/hooks/cards/create, /move, /update, /delete,
/get e /list.

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
    cliente, para exercitar a regra "mesmo cliente" de _agent_same_cliente sem
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


# -- POST /api/hooks/cards/update (Fase 3) -----------------------------------

def test_hook_cards_update_same_cliente_edits_fields_and_sets_ultima_atualizacao(client):
    """Fluxo de sucesso: agente do mesmo cliente corrige título/descrição/status
    de um card existente e passa a constar como último a atualizar."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000001")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Titulo errado",
        "descricao": "descricao errada",
    }).json()
    card_id = created["card_id"]

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": card_id,
        "titulo": "Titulo certo",
        "descricao": "descricao certa",
        "status": "em_revisao",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["card"]["titulo"] == "Titulo certo"

    updated = _get_card(client, card_id)
    assert updated["titulo"] == "Titulo certo"
    assert updated["descricao"] == "descricao certa"
    assert updated["status"] == "em_revisao"
    assert updated["ultima_atualizacao_por"] == "agente:agente-teste"


def test_hook_cards_update_omitted_fields_are_preserved(client):
    """Campos omitidos não são apagados — mesma semântica parcial do PATCH."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000002")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Original",
        "descricao": "Descrição original",
    }).json()
    card_id = created["card_id"]

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": card_id,
        "titulo": "Só o título muda",
    })
    assert r.json()["success"] is True

    updated = _get_card(client, card_id)
    assert updated["titulo"] == "Só o título muda"
    assert updated["descricao"] == "Descrição original"
    assert updated["status"] == "a_fazer"


def test_hook_cards_update_subcard_is_supported(client):
    """Editar subcard usa exatamente o mesmo contrato de editar card de topo."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000003")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    parent = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Pai",
    }).json()
    sub = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Sub", "parent_id": parent["card_id"],
    }).json()

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": sub["card_id"],
        "titulo": "Sub editado",
    })
    assert r.json()["success"] is True

    pai = _get_card(client, parent["card_id"])
    subcard = next(s for s in pai["subcards"] if s["id"] == sub["card_id"])
    assert subcard["titulo"] == "Sub editado"


def test_hook_cards_update_unknown_session_is_noop(client):
    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": "unknown-uuid",
        "card_id": 999999,
        "titulo": "X",
    })
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_hook_cards_update_other_cliente_rejected_and_card_unchanged(client, tmp_path):
    """P0/segurança: card de outro cliente não pode ser editado, e a checagem
    acontece ANTES do update (o card fica intacto)."""
    db_path = str(tmp_path / "sessions.db")
    card_id = _insert_card_direct(
        db_path,
        titulo="Card do outro cliente",
        projeto_id="outrocliente/proj",
        descricao="original",
    )

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000004")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": card_id,
        "titulo": "Invadido",
        "descricao": "invadido",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")

    unchanged = _get_card(client, card_id, projeto_id="outrocliente/proj")
    assert unchanged["titulo"] == "Card do outro cliente"
    assert unchanged["descricao"] == "original"
    assert unchanged["ultima_atualizacao_por"] == "bruno"


def test_hook_cards_update_nonexistent_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000005")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid, "card_id": 999999, "titulo": "X",
    })
    assert r.status_code == 200
    assert r.json().get("success") is False
    assert r.json().get("error")


def test_hook_cards_update_deleted_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("a1a1a1a1-0000-0000-0000-000000000006")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Vai ser apagado",
    }).json()
    client.delete("/api/cards/{0}".format(created["card_id"]))

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid, "card_id": created["card_id"], "titulo": "X",
    })
    assert r.json().get("success") is False


# -- POST /api/hooks/cards/delete (Fase 3) -----------------------------------

def test_hook_cards_delete_same_cliente_removes_card_and_reports_subcards(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("b2b2b2b2-0000-0000-0000-000000000001")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    parent = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Pai",
    }).json()
    client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Sub 1", "parent_id": parent["card_id"],
    })
    client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Sub 2", "parent_id": parent["card_id"],
    })

    r = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": claude_sid, "card_id": parent["card_id"],
    })
    assert r.status_code == 200
    assert r.json() == {"success": True, "subcards_afetados": 2}

    assert client.get("/api/cards", params={"projeto_id": "meu-projeto"}).json() == []


def test_hook_cards_delete_unknown_session_is_noop(client):
    r = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": "unknown-uuid", "card_id": 999999,
    })
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_hook_cards_delete_other_cliente_rejected_and_card_kept(client, tmp_path):
    """P0/segurança: exclusão exige mesmo cliente, e a checagem vem ANTES do
    soft_delete — o card do outro cliente continua no board."""
    db_path = str(tmp_path / "sessions.db")
    card_id = _insert_card_direct(
        db_path, titulo="Card do outro cliente", projeto_id="outrocliente/proj",
    )

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("b2b2b2b2-0000-0000-0000-000000000002")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": claude_sid, "card_id": card_id,
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")

    ainda_la = _get_card(client, card_id, projeto_id="outrocliente/proj")
    assert ainda_la["id"] == card_id


def test_hook_cards_delete_nonexistent_card_returns_explicit_error(client):
    """Diferente do DELETE /api/cards/{id} da UI, que responde sucesso para id
    inexistente: o hook do agente confirma existência antes, senão o agente
    receberia "excluído com sucesso" para um card que nunca existiu."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("b2b2b2b2-0000-0000-0000-000000000003")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": claude_sid, "card_id": 999999,
    })
    assert r.status_code == 200
    assert r.json().get("success") is False
    assert r.json().get("error")


def test_hook_cards_delete_already_deleted_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("b2b2b2b2-0000-0000-0000-000000000004")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Apagar duas vezes",
    }).json()
    first = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": claude_sid, "card_id": created["card_id"],
    })
    assert first.json()["success"] is True

    second = client.post("/api/hooks/cards/delete", json={
        "claude_session_id": claude_sid, "card_id": created["card_id"],
    })
    assert second.json().get("success") is False


# -- POST /api/hooks/cards/get (Fase 3) --------------------------------------

def test_hook_cards_get_same_cliente_returns_raw_card_fields(client):
    """ver_card devolve os campos CRUS do card (CardStore.get) — sem
    subcards/imagens hidratados, decisão fechada com o Bruno."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("c3c3c3c3-0000-0000-0000-000000000001")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Card para revisar",
        "descricao": "conteúdo",
    }).json()
    client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Sub", "parent_id": created["card_id"],
    })

    r = client.post("/api/hooks/cards/get", json={
        "claude_session_id": claude_sid, "card_id": created["card_id"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    card = body["card"]
    assert card["id"] == created["card_id"]
    assert card["titulo"] == "Card para revisar"
    assert card["descricao"] == "conteúdo"
    assert card["projeto_id"] == "meu-projeto"
    assert card["origem"] == "agente:agente-teste"
    # cru: nenhuma hidratação, mesmo tendo um subcard e podendo ter imagens
    assert "subcards" not in card
    assert "imagens" not in card


def test_hook_cards_get_unknown_session_is_noop(client):
    r = client.post("/api/hooks/cards/get", json={
        "claude_session_id": "unknown-uuid", "card_id": 999999,
    })
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_hook_cards_get_other_cliente_rejected(client, tmp_path):
    """P0/segurança: leitura também é restrita ao mesmo cliente — senão o
    agente lê o conteúdo de cards de outros clientes só enumerando ids."""
    db_path = str(tmp_path / "sessions.db")
    card_id = _insert_card_direct(
        db_path, titulo="Segredo do outro cliente", projeto_id="outrocliente/proj",
    )

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("c3c3c3c3-0000-0000-0000-000000000002")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/get", json={
        "claude_session_id": claude_sid, "card_id": card_id,
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")
    assert "card" not in body


def test_hook_cards_get_nonexistent_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("c3c3c3c3-0000-0000-0000-000000000003")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/get", json={
        "claude_session_id": claude_sid, "card_id": 999999,
    })
    assert r.status_code == 200
    assert r.json().get("success") is False
    assert r.json().get("error")


def test_hook_cards_get_deleted_card_returns_explicit_error(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("c3c3c3c3-0000-0000-0000-000000000004")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Apagado",
    }).json()
    client.delete("/api/cards/{0}".format(created["card_id"]))

    r = client.post("/api/hooks/cards/get", json={
        "claude_session_id": claude_sid, "card_id": created["card_id"],
    })
    assert r.json().get("success") is False


# -- POST /api/hooks/cards/list (Fase 3) -------------------------------------

def test_hook_cards_list_without_projeto_id_lists_whole_cliente(client, tmp_path):
    """Sem projeto_id: todos os cards de topo do CLIENTE da sessão — o
    cliente-como-projeto e todos os sub-projetos —, e NADA de outro cliente."""
    db_path = str(tmp_path / "sessions.db")
    id_aadmin = _insert_card_direct(db_path, titulo="No aadmin", projeto_id="cliente/aadmin")
    id_outro = _insert_card_direct(db_path, titulo="No outro", projeto_id="cliente/outro")
    id_raiz = _insert_card_direct(db_path, titulo="Cliente-only", projeto_id="cliente")
    _insert_card_direct(db_path, titulo="De outro cliente", projeto_id="outrocliente/proj")

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000001")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/list", json={"claude_session_id": claude_sid})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["total"] == 3
    assert sorted(c["id"] for c in body["cards"]) == sorted([id_aadmin, id_outro, id_raiz])
    assert all(c["projeto_id"].startswith("cliente") for c in body["cards"])


def test_hook_cards_list_with_projeto_id_filters_that_project_only(client, tmp_path):
    db_path = str(tmp_path / "sessions.db")
    _insert_card_direct(db_path, titulo="No aadmin", projeto_id="cliente/aadmin")
    id_outro = _insert_card_direct(db_path, titulo="No outro", projeto_id="cliente/outro")

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000002")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/list", json={
        "claude_session_id": claude_sid, "projeto_id": "cliente/outro",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert [c["id"] for c in body["cards"]] == [id_outro]


def test_hook_cards_list_embeds_subcards_and_resumo(client):
    """A listagem devolve a árvore hidratada (mesmo formato de GET /api/cards),
    para o agente enxergar subcards sem uma segunda chamada."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000003")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    parent = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Pai",
    }).json()
    sub = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Sub", "parent_id": parent["card_id"],
    }).json()

    r = client.post("/api/hooks/cards/list", json={"claude_session_id": claude_sid})
    body = r.json()
    assert [c["id"] for c in body["cards"]] == [parent["card_id"]]
    assert [s["id"] for s in body["cards"][0]["subcards"]] == [sub["card_id"]]
    assert body["cards"][0]["subcards_resumo"] == {"total": 1, "feitos": 0}


def test_hook_cards_list_empty_is_success_not_error(client):
    """Nenhum card é sucesso com lista vazia — o adapter precisa distinguir
    "nenhum card" de "sessão não encontrada"."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000004")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/list", json={"claude_session_id": claude_sid})
    assert r.status_code == 200
    assert r.json() == {"success": True, "cards": [], "total": 0}


def test_hook_cards_list_unknown_session_is_noop(client):
    r = client.post("/api/hooks/cards/list", json={"claude_session_id": "unknown-uuid"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_hook_cards_list_other_cliente_projeto_id_rejected(client, tmp_path):
    """P0/segurança: pedir explicitamente um projeto de outro cliente é erro,
    nunca uma listagem parcial."""
    db_path = str(tmp_path / "sessions.db")
    _insert_card_direct(db_path, titulo="De outro cliente", projeto_id="outrocliente/proj")

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000005")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/list", json={
        "claude_session_id": claude_sid, "projeto_id": "outrocliente/proj",
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is False
    assert "outro cliente" in body.get("error", "")
    assert "cards" not in body


def test_hook_cards_list_empty_projeto_id_lists_whole_cliente(client, tmp_path):
    """projeto_id="" significa "não informado" (o adapter nunca deveria mandar
    assim, mas o backend não pode estreitar silenciosamente para o projeto da
    sessão — resolve_projeto_alvo trata string vazia como "projeto atual")."""
    db_path = str(tmp_path / "sessions.db")
    id_aadmin = _insert_card_direct(db_path, titulo="No aadmin", projeto_id="cliente/aadmin")
    id_outro = _insert_card_direct(db_path, titulo="No outro", projeto_id="cliente/outro")

    session_key = "cliente/aadmin::agente-teste"
    fixed_uuid = uuid_mod.UUID("d4d4d4d4-0000-0000-0000-000000000006")
    claude_sid = _register_session(
        client, session_key, project_id="cliente/aadmin", fixed_uuid=fixed_uuid
    )

    r = client.post("/api/hooks/cards/list", json={
        "claude_session_id": claude_sid, "projeto_id": "",
    })
    body = r.json()
    assert body["success"] is True
    assert sorted(c["id"] for c in body["cards"]) == sorted([id_aadmin, id_outro])


# -- tipo / prazo on the agent path (Cards Board v2, Phase 1) ----------------


def test_hook_cards_update_accepts_valid_tipo(client):
    """Catches U3 (the easiest point to forget): the hook accepts `tipo` and
    the field shows up on the returned card."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000001")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card",
    }).json()
    card_id = created["card_id"]

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid, "card_id": card_id, "tipo": "bug",
    })
    body = r.json()
    assert body["success"] is True
    assert body["card"]["tipo"] == "bug"
    assert _get_card(client, card_id)["tipo"] == "bug"


def test_hook_cards_update_invalid_tipo_returns_exact_error_string(client):
    """The exact string matters — it is the text the agent reads. And never a
    422 (which the adapter would translate into a "connectivity error")."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000002")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card",
    }).json()

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": created["card_id"],
        "tipo": "xpto",
    })
    assert r.status_code == 200
    assert r.json() == {
        "success": False,
        "error": "tipo inválido: 'xpto'. Use bug, hotfix ou historia.",
    }

    # No case normalization: "Bug" is invalid too (lower() was not asked for;
    # adding it would create a second rule to maintain).
    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": created["card_id"],
        "tipo": "Bug",
    })
    assert r.json()["success"] is False
    assert r.json()["error"] == "tipo inválido: 'Bug'. Use bug, hotfix ou historia."


def test_hook_cards_update_empty_string_tipo_clears_the_field(client):
    """Prevents the D-4.1 regression: "" must not be rejected as invalid —
    it is the clear gesture."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000003")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card", "tipo": "bug",
    }).json()
    card_id = created["card_id"]
    assert _get_card(client, card_id)["tipo"] == "bug"

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid, "card_id": card_id, "tipo": "",
    })
    assert r.json()["success"] is True
    assert _get_card(client, card_id)["tipo"] is None


def test_hook_cards_create_accepts_valid_tipo(client):
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000004")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Bug do agente",
        "tipo": "hotfix",
    })
    body = r.json()
    assert body["success"] is True
    assert _get_card(client, body["card_id"])["tipo"] == "hotfix"


def test_hook_cards_create_invalid_tipo_rejected_and_nothing_created(client):
    """Validate early, do not create-then-complain: no card is left in the database."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000005")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card ruim", "tipo": "xpto",
    })
    assert r.json() == {
        "success": False,
        "error": "tipo inválido: 'xpto'. Use bug, hotfix ou historia.",
    }
    assert client.get("/api/cards", params={"projeto_id": "meu-projeto"}).json() == []


def test_hook_cards_update_ignores_prazo_silently(client):
    """`prazo` is outside the MCP on purpose (AD-11): it is not in the
    handler's include, so it is ignored without an error."""
    session_key = "meu-projeto::agente-teste"
    fixed_uuid = uuid_mod.UUID("11110000-0000-0000-0000-000000000006")
    claude_sid = _register_session(client, session_key, fixed_uuid=fixed_uuid)

    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card",
    }).json()
    card_id = created["card_id"]

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid, "card_id": card_id,
        "prazo": "2026-09-15",
    })
    assert r.json()["success"] is True
    assert _get_card(client, card_id)["prazo"] is None



# -- server-side status validation (task #43, phase 1) -----------------------
#
# The MCP tool schemas used to carry a fixed `enum` of the four statuses, which
# is what stopped an agent from writing a status nobody renders. Columns are
# user-managed now, so the enum is gone and these three hooks are the only
# thing standing between an agent's typo and a card that exists in the database
# and appears nowhere on the board.


def test_hook_cards_create_rejects_an_unknown_status_listing_the_valid_ones(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100001-0000-0000-0000-000000000001"),
    )

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Card em coluna inexistente",
        "status": "coluna_que_nao_existe",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    # The error text is the agent's ONLY discovery mechanism now that the enum
    # is gone — every valid slug has to be in it.
    for slug in ("a_fazer", "em_andamento", "em_revisao", "feito"):
        assert slug in body["error"]

    assert client.get("/api/cards", params={"projeto_id": "meu-projeto"}).json() == []


def test_hook_cards_create_rejects_creating_straight_into_the_done_column(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100002-0000-0000-0000-000000000002"),
    )

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Nasce pronto",
        "status": "feito",
    })
    assert r.json()["success"] is False
    assert client.get("/api/cards", params={"projeto_id": "meu-projeto"}).json() == []


def test_hook_cards_create_follows_the_done_column_when_it_moves(client):
    """The rule tracks the is_done COLUMN, not the literal 'feito' slug: after
    the user marks another column as done, creating in 'feito' becomes legal
    and creating in the new done column becomes the refusal."""
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100003-0000-0000-0000-000000000003"),
    )
    assert client.post("/api/board/columns/em_revisao/done").status_code == 200

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Agora pode",
        "status": "feito",
    })
    assert r.json()["success"] is True

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Agora nao pode",
        "status": "em_revisao",
    })
    assert r.json()["success"] is False


def test_hook_cards_create_accepts_a_column_the_user_just_created(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100004-0000-0000-0000-000000000004"),
    )
    assert client.post(
        "/api/board/columns", json={"label": "Em Homologação"}
    ).status_code == 201

    r = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid,
        "titulo": "Card na coluna nova",
        "status": "em_homologacao",
    })
    assert r.json()["success"] is True
    assert _get_card(client, r.json()["card_id"])["status"] == "em_homologacao"


def test_hook_cards_move_rejects_an_unknown_status_and_leaves_the_card_put(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100005-0000-0000-0000-000000000005"),
    )
    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card", "status": "a_fazer",
    }).json()

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": claude_sid,
        "card_id": created["card_id"],
        "novo_status": "coluna_que_nao_existe",
    })
    assert r.json()["success"] is False
    for slug in ("a_fazer", "em_andamento", "em_revisao", "feito"):
        assert slug in r.json()["error"]

    assert _get_card(client, created["card_id"])["status"] == "a_fazer"


def test_hook_cards_move_to_a_valid_column_still_works(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100006-0000-0000-0000-000000000006"),
    )
    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card", "status": "a_fazer",
    }).json()

    r = client.post("/api/hooks/cards/move", json={
        "claude_session_id": claude_sid,
        "card_id": created["card_id"],
        "novo_status": "feito",
    })
    assert r.json()["success"] is True
    assert _get_card(client, created["card_id"])["status"] == "feito"


def test_hook_cards_update_rejects_an_unknown_status_and_changes_nothing(client):
    claude_sid = _register_session(
        client, "meu-projeto::agente-teste",
        fixed_uuid=uuid_mod.UUID("c0100007-0000-0000-0000-000000000007"),
    )
    created = client.post("/api/hooks/cards/create", json={
        "claude_session_id": claude_sid, "titulo": "Card", "status": "a_fazer",
    }).json()

    r = client.post("/api/hooks/cards/update", json={
        "claude_session_id": claude_sid,
        "card_id": created["card_id"],
        "titulo": "Titulo novo",
        "status": "coluna_que_nao_existe",
    })
    assert r.json()["success"] is False

    card = _get_card(client, created["card_id"])
    assert card["status"] == "a_fazer"
    # The whole update is refused, not just the status half of it.
    assert card["titulo"] == "Card"
