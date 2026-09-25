"""Testes de integração para os endpoints /api/cards (Tarefa 6, 05-TL.md).

Mesmo padrão de fixture `client` de test_agents_endpoints.py/
test_sessions_tasks_endpoints.py: reload de app.main com env vars apontando
pra um tmp_path isolado — aqui isso inclui BOARD_UPLOADS_ROOT, que o próprio
main.py aceita via override de env var (main.py: `os.getenv("BOARD_UPLOADS_ROOT", ...)`)
justamente para nenhum teste escrever no board_uploads/ real do repo.
"""
from __future__ import annotations

import os
import pytest
from unittest.mock import patch

# Assinatura PNG válida (magic bytes) — sniff_image_type só olha os primeiros
# bytes, não decodifica a imagem de verdade (trade-off aceito em
# 05-ARQUITETO.md), então qualquer payload com essa assinatura é "válido"
# para este sistema.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
FAKE_PNG_BYTES = b"isso e so texto puro, nada de imagem aqui" * 4


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
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


def _create_card(client, **overrides):
    payload = {"titulo": "Card de teste", "projeto_id": "proj-a", **overrides}
    r = client.post("/api/cards", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# -- ciclo básico: create -> list -> patch -> delete -------------------------


def test_card_crud_cycle_without_children(client):
    created = _create_card(client, titulo="Fazer X")
    assert created["titulo"] == "Fazer X"
    assert created["projeto_id"] == "proj-a"
    assert created["status"] == "a_fazer"
    assert created["origem"] == "bruno"
    assert created["ultima_atualizacao_por"] == "bruno"
    assert created["parent_id"] is None
    assert created["subcards"] == []
    assert created["subcards_resumo"] is None
    assert created["imagens"] == []

    r = client.get("/api/cards")
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()}
    assert created["id"] in ids

    r = client.patch(f"/api/cards/{created['id']}", json={"status": "em_andamento"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "em_andamento"
    assert body["titulo"] == "Fazer X"  # campo não enviado no PATCH, não muda

    r = client.delete(f"/api/cards/{created['id']}")
    assert r.status_code == 200
    assert r.json() == {"subcards_afetados": 0}

    r = client.get("/api/cards")
    ids = {c["id"] for c in r.json()}
    assert created["id"] not in ids


def test_patch_unknown_card_returns_404(client):
    r = client.patch("/api/cards/999999", json={"titulo": "X"})
    assert r.status_code == 404


def test_get_cards_filters_by_projeto_id(client):
    a = _create_card(client, projeto_id="proj-a")
    _create_card(client, projeto_id="proj-b")

    r = client.get("/api/cards", params={"projeto_id": "proj-a"})
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()}
    assert ids == {a["id"]}


# -- cliente_id (Grupo B da feature Cliente/Projeto) --------------------------


def test_create_card_with_only_cliente_id_returns_201(client):
    """Card "cliente-only": body só com cliente_id (sem projeto_id) —
    backend resolve projeto_id = cliente_id e retorna 201."""
    r = client.post("/api/cards", json={"titulo": "Card do cliente", "cliente_id": "cliente_projeto_1"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["projeto_id"] == "cliente_projeto_1"


def test_create_card_without_projeto_id_nem_cliente_id_returns_400(client):
    """Nenhum dos dois foi enviado — 400, não 500 (gap que esta tarefa
    fecha: create_card não capturava ValueError nenhum antes)."""
    r = client.post("/api/cards", json={"titulo": "Card sem vínculo"})
    assert r.status_code == 400


def test_create_card_legacy_body_with_only_projeto_id_still_returns_201(client):
    """Regressão explícita: corpo antigo (só projeto_id, sem cliente_id)
    continua funcionando exatamente como antes."""
    r = client.post("/api/cards", json={"titulo": "Card legado", "projeto_id": "proj-a"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["projeto_id"] == "proj-a"


# -- delete de card de topo com subcards --------------------------------------


def test_delete_top_level_card_with_subcards_reports_affected_count(client):
    parent = _create_card(client, titulo="Feature grande")
    client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Sub 1"})
    client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Sub 2"})

    r = client.delete(f"/api/cards/{parent['id']}")
    assert r.status_code == 200
    assert r.json() == {"subcards_afetados": 2}

    r = client.get("/api/cards")
    ids = {c["id"] for c in r.json()}
    assert parent["id"] not in ids


# -- subcards ------------------------------------------------------------------


def test_create_subcard_with_valid_parent_returns_201(client):
    parent = _create_card(client, titulo="Pai")
    r = client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Filho"})
    assert r.status_code == 201
    body = r.json()
    assert body["titulo"] == "Filho"
    assert body["parent_id"] == parent["id"]
    assert body["projeto_id"] == parent["projeto_id"]

    r = client.get("/api/cards")
    parent_body = next(c for c in r.json() if c["id"] == parent["id"])
    assert parent_body["subcards_resumo"] == {"total": 1, "feitos": 0}
    assert len(parent_body["subcards"]) == 1


def test_create_subcard_under_a_subcard_returns_400(client):
    parent = _create_card(client, titulo="Pai")
    sub = client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Filho"}).json()

    r = client.post(f"/api/cards/{sub['id']}/subcards", json={"titulo": "Neto"})
    assert r.status_code == 400


def test_create_subcard_under_nonexistent_parent_returns_400(client):
    r = client.post("/api/cards/999999/subcards", json={"titulo": "Órfão"})
    assert r.status_code == 400


# -- upload de imagem -----------------------------------------------------------


def test_upload_valid_png_returns_201_writes_file_and_includes_url(client, tmp_path):
    card = _create_card(client, titulo="Com imagem")

    r = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("print.png", PNG_BYTES, "image/png")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["card_id"] == card["id"]
    assert body["mime_type"] == "image/png"
    assert body["size_bytes"] == len(PNG_BYTES)
    assert body["url"] == f"/board_uploads/{card['id']}/{body['filename']}"

    disk_path = tmp_path / "board_uploads" / str(card["id"]) / body["filename"]
    assert disk_path.exists()
    assert disk_path.read_bytes() == PNG_BYTES


def test_upload_fake_png_with_spoofed_content_type_returns_400(client):
    card = _create_card(client, titulo="Upload malicioso")

    r = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("fake.png", FAKE_PNG_BYTES, "image/png")},
    )
    assert r.status_code == 400


def test_upload_sixth_image_returns_409(client):
    card = _create_card(client, titulo="Muitas imagens")
    for _ in range(5):
        r = client.post(
            f"/api/cards/{card['id']}/images",
            files={"file": ("p.png", PNG_BYTES, "image/png")},
        )
        assert r.status_code == 201

    r = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("p.png", PNG_BYTES, "image/png")},
    )
    assert r.status_code == 409


def test_upload_too_large_returns_413(client):
    card = _create_card(client, titulo="Upload grande demais")
    too_big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 1)

    r = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("big.png", too_big, "image/png")},
    )
    assert r.status_code == 413


def test_upload_to_nonexistent_card_returns_404(client):
    r = client.post(
        "/api/cards/999999/images",
        files={"file": ("p.png", PNG_BYTES, "image/png")},
    )
    assert r.status_code == 404


def test_delete_image_removes_file_from_disk(client, tmp_path):
    card = _create_card(client, titulo="Para apagar imagem")
    uploaded = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("p.png", PNG_BYTES, "image/png")},
    ).json()

    disk_path = tmp_path / "board_uploads" / str(card["id"]) / uploaded["filename"]
    assert disk_path.exists()

    r = client.delete(f"/api/cards/{card['id']}/images/{uploaded['id']}")
    assert r.status_code == 200
    assert not disk_path.exists()


def test_delete_unknown_image_returns_404(client):
    card = _create_card(client, titulo="Sem imagens")
    r = client.delete(f"/api/cards/{card['id']}/images/999999")
    assert r.status_code == 404


# -- limpar concluídos ----------------------------------------------------------


def test_preview_limpar_concluidos_does_not_mutate_anything(client):
    done_card = _create_card(client, titulo="Feito", projeto_id="proj-clean")
    client.patch(f"/api/cards/{done_card['id']}", json={"status": "feito"})

    before = client.get("/api/cards", params={"projeto_id": "proj-clean"}).json()

    r = client.get(
        "/api/cards/limpar-concluidos/preview", params={"projeto_id": "proj-clean"}
    )
    assert r.status_code == 200
    preview = r.json()
    assert preview["cards"] == 1
    assert preview["imagens"] == 0
    assert preview["imagens_com_falha"] == 0

    after = client.get("/api/cards", params={"projeto_id": "proj-clean"}).json()
    assert before == after


def test_executar_limpar_concluidos_removes_db_rows_and_files_then_second_call_is_noop(
    client, tmp_path
):
    done_card = _create_card(client, titulo="Feito", projeto_id="proj-clean-2")
    client.patch(f"/api/cards/{done_card['id']}", json={"status": "feito"})
    uploaded = client.post(
        f"/api/cards/{done_card['id']}/images",
        files={"file": ("p.png", PNG_BYTES, "image/png")},
    ).json()
    disk_path = tmp_path / "board_uploads" / str(done_card["id"]) / uploaded["filename"]
    assert disk_path.exists()

    r = client.post(
        "/api/cards/limpar-concluidos", params={"projeto_id": "proj-clean-2"}
    )
    assert r.status_code == 200
    result = r.json()
    assert result["cards"] == 1
    assert result["imagens"] == 1
    assert result["imagens_com_falha"] == 0

    assert not disk_path.exists()
    remaining = client.get("/api/cards", params={"projeto_id": "proj-clean-2"}).json()
    assert remaining == []

    r2 = client.post(
        "/api/cards/limpar-concluidos", params={"projeto_id": "proj-clean-2"}
    )
    assert r2.status_code == 200
    assert r2.json() == {"cards": 0, "imagens": 0, "imagens_com_falha": 0}


# -- board_uploads/ ausente antes do boot ----------------------------------------


def test_app_boots_and_serves_uploads_even_when_board_uploads_dir_is_missing(
    client, tmp_path
):
    """O fixture `client` já reconstrói app.main (importlib.reload) com
    BOARD_UPLOADS_ROOT=tmp_path/board_uploads, um diretório que NÃO existe
    antes da fixture rodar — se os.makedirs(..., exist_ok=True) não
    rodasse antes do app.mount(StaticFiles(...)), o processo já teria
    caído no import/reload acima, e nenhum teste deste arquivo teria
    chegado até aqui. Este teste também confirma que o diretório existe
    de fato depois do boot, e que um upload real funciona (StaticFiles
    servindo o mount)."""
    board_uploads = tmp_path / "board_uploads"
    assert board_uploads.is_dir()

    card = _create_card(client, titulo="Depois do boot")
    uploaded = client.post(
        f"/api/cards/{card['id']}/images",
        files={"file": ("p.png", PNG_BYTES, "image/png")},
    ).json()

    r = client.get(uploaded["url"])
    assert r.status_code == 200
    assert r.content == PNG_BYTES


# -- tipo / prazo (Cards Board v2, Phase 1) ------------------------------------


def test_create_card_with_tipo_and_prazo_roundtrips_through_http_body(client):
    """Discriminating test D-1/D-2: the HTTP RESPONSE body (not the store
    dict) must contain tipo/prazo, both on the POST and on the following GET.
    Catches R1 + C1 + C2 + C4 at once — if the Card model drops the fields
    (extra='ignore'), this goes red."""
    r = client.post("/api/cards", json={
        "titulo": "x", "cliente_id": "c", "tipo": "bug", "prazo": "2026-09-15",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["tipo"] == "bug"
    assert created["prazo"] == "2026-09-15"

    listed = client.get("/api/cards").json()
    card = next(c for c in listed if c["id"] == created["id"])
    assert card["tipo"] == "bug"
    assert card["prazo"] == "2026-09-15"


def test_patch_card_sets_tipo_in_response_body(client):
    created = _create_card(client, titulo="Sem tipo ainda")
    r = client.patch(f"/api/cards/{created['id']}", json={"tipo": "historia"})
    assert r.status_code == 200
    assert r.json()["tipo"] == "historia"


def test_patch_card_empty_string_tipo_clears_it_via_ui_path(client):
    created = _create_card(client, titulo="Com tipo", tipo="bug")
    assert created["tipo"] == "bug"
    r = client.patch(f"/api/cards/{created['id']}", json={"tipo": ""})
    assert r.status_code == 200
    assert r.json()["tipo"] is None


def test_patch_card_invalid_tipo_returns_422(client):
    """Proves the D-3 Literal is real — if it comes back 200, the AD-2 no-op
    union survived."""
    created = _create_card(client, titulo="X")
    r = client.patch(f"/api/cards/{created['id']}", json={"tipo": "xpto"})
    assert r.status_code == 422


def test_create_card_empty_string_tipo_is_rejected_by_the_create_contract(client):
    """Deliberate asymmetry (D-3): "" is the clear sentinel ONLY on the PATCH.
    On create there is no "clear" — the modal in `create` mode (Phase 2) must
    send null / omit the field, never "". Here that is a 422."""
    r = client.post("/api/cards", json={
        "titulo": "x", "cliente_id": "c", "tipo": "",
    })
    assert r.status_code == 422


def test_create_card_uppercase_tipo_is_rejected_no_case_normalization(client):
    """No case normalization this round (not asked for; it would create a
    second rule to maintain). "Bug" != "bug"."""
    r = client.post("/api/cards", json={
        "titulo": "x", "cliente_id": "c", "tipo": "Bug",
    })
    assert r.status_code == 422


def test_create_subcard_with_tipo_returns_201_with_field(client):
    parent = _create_card(client, titulo="Pai")
    r = client.post(
        f"/api/cards/{parent['id']}/subcards",
        json={"titulo": "Filho", "tipo": "hotfix"},
    )
    assert r.status_code == 201
    assert r.json()["tipo"] == "hotfix"


def test_patch_card_prazo_accepts_any_string_this_round(client):
    """AD-11: no prazo format validation this round. A test that DOCUMENTS the
    decision (it is not an oversight) — a free-form value is accepted."""
    created = _create_card(client, titulo="X")
    r = client.patch(f"/api/cards/{created['id']}", json={"prazo": "amanhã"})
    assert r.status_code == 200
    assert r.json()["prazo"] == "amanhã"


def test_get_cards_embeds_subcard_tipo_in_the_nested_array(client):
    """Same class as the D-1 silent drop, but on the nested path
    (Card.subcards: list["Card"]): GET /api/cards must carry `tipo` on an
    embedded subcard, not only on the top-level card. Subcard hydration is a
    separate path (CardStore._list_active_subcards has its own SELECT), so a
    field can be right on the top-level card and silently missing on the
    nested one."""
    parent = _create_card(client, titulo="Pai")
    sub = client.post(
        f"/api/cards/{parent['id']}/subcards",
        json={"titulo": "Filho", "tipo": "hotfix"},
    )
    assert sub.status_code == 201

    listed = client.get("/api/cards").json()
    top = next(c for c in listed if c["id"] == parent["id"])
    assert top["subcards"][0]["tipo"] == "hotfix"



# -- /api/board/columns (task #43, phase 1) ----------------------------------


def test_list_columns_returns_the_four_seeded_columns(client):
    r = client.get("/api/board/columns")
    assert r.status_code == 200
    columns = r.json()
    assert [c["slug"] for c in columns] == [
        "a_fazer", "em_andamento", "em_revisao", "feito",
    ]
    assert [c["is_done"] for c in columns] == [False, False, False, True]


def test_create_column_returns_201_with_the_derived_slug(client):
    r = client.post("/api/board/columns", json={"label": "Em Homologação"})
    assert r.status_code == 201, r.text
    assert r.json() == {
        "slug": "em_homologacao", "label": "Em Homologação",
        "position": 5, "is_done": False,
    }


def test_create_column_with_a_duplicate_label_is_409(client):
    client.post("/api/board/columns", json={"label": "Em Homologação"})
    r = client.post("/api/board/columns", json={"label": "em homologação"})
    assert r.status_code == 409


def test_create_column_with_a_blank_label_is_409(client):
    r = client.post("/api/board/columns", json={"label": "   "})
    assert r.status_code == 409


def test_patch_column_renames_without_changing_the_slug(client):
    r = client.patch("/api/board/columns/a_fazer", json={"label": "Backlog"})
    assert r.status_code == 200
    assert r.json()["slug"] == "a_fazer"
    assert r.json()["label"] == "Backlog"


def test_patch_an_unknown_column_is_404(client):
    r = client.patch("/api/board/columns/nao_existe", json={"label": "X"})
    assert r.status_code == 404


def test_patch_with_another_columns_label_is_409(client):
    r = client.patch("/api/board/columns/a_fazer", json={"label": "Feito"})
    assert r.status_code == 409


def test_reorder_columns_returns_the_new_order(client):
    r = client.post(
        "/api/board/columns/reorder",
        json={"slugs": ["feito", "a_fazer", "em_revisao", "em_andamento"]},
    )
    assert r.status_code == 200
    assert [c["slug"] for c in r.json()] == [
        "feito", "a_fazer", "em_revisao", "em_andamento",
    ]


def test_reorder_with_a_non_permutation_is_409(client):
    r = client.post("/api/board/columns/reorder", json={"slugs": ["feito"]})
    assert r.status_code == 409


def test_set_done_column_moves_the_mark(client):
    r = client.post("/api/board/columns/em_revisao/done")
    assert r.status_code == 200
    done = [c["slug"] for c in r.json() if c["is_done"]]
    assert done == ["em_revisao"]


def test_set_done_on_an_unknown_column_is_404(client):
    r = client.post("/api/board/columns/nao_existe/done")
    assert r.status_code == 404


def test_delete_an_empty_column(client):
    client.post("/api/board/columns", json={"label": "Em Homologação"})
    r = client.delete("/api/board/columns/em_homologacao")
    assert r.status_code == 200
    assert "em_homologacao" not in [
        c["slug"] for c in client.get("/api/board/columns").json()
    ]


def test_delete_an_unknown_column_is_404(client):
    r = client.delete("/api/board/columns/nao_existe")
    assert r.status_code == 404


def test_delete_the_done_column_is_409_with_a_discriminable_reason(client):
    r = client.delete("/api/board/columns/feito")
    assert r.status_code == 409
    assert r.json()["detail"]["reason"] == "coluna_concluida"


def test_delete_a_column_with_cards_is_409_carrying_the_count(client):
    client.post("/api/board/columns", json={"label": "Em Homologação"})
    _create_card(client, status="em_homologacao")
    _create_card(client, status="em_homologacao")

    r = client.delete("/api/board/columns/em_homologacao")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["reason"] == "coluna_com_cards"
    assert detail["cards"] == 2


def test_deleting_down_to_the_last_column_is_409_as_the_done_column(client):
    """Renamed from "…is_409_with_its_own_reason": it never reached
    `ultima_coluna`, and it cannot. Deleting the done column is refused, so the
    sole survivor of any deletion sequence always carries the done mark and the
    done check — which runs first — is what stops it.

    `ultima_coluna` is therefore unreachable over HTTP; it is defensive depth
    for a board whose mark was cleared outside the API, covered directly in
    test_card_store.py::test_delete_column_is_last_fires_on_a_board_with_no_done_mark.
    Either way the frontend gets a non-destructive dialog."""
    client.post("/api/board/columns", json={"label": "Sobrevivente"})
    client.post("/api/board/columns/a_fazer/done")
    for slug in ("em_andamento", "em_revisao", "feito"):
        assert client.delete(f"/api/board/columns/{slug}").status_code == 200
    client.post("/api/board/columns/sobrevivente/done")
    assert client.delete("/api/board/columns/a_fazer").status_code == 200

    r = client.delete("/api/board/columns/sobrevivente")
    assert r.status_code == 409
    assert r.json()["detail"]["reason"] == "coluna_concluida"


# -- board_position through the REST surface ---------------------------------


def test_created_cards_are_listed_in_creation_order_within_a_column(client):
    first = _create_card(client, titulo="Primeiro")
    second = _create_card(client, titulo="Segundo")

    listed = [c["id"] for c in client.get("/api/cards").json()]
    assert listed.index(first["id"]) < listed.index(second["id"])
    assert first["board_position"] == 0.0
    assert second["board_position"] == 1.0


def test_patching_a_card_with_its_current_status_keeps_its_position(client):
    first = _create_card(client, titulo="Primeiro")
    _create_card(client, titulo="Segundo")

    # The whole form comes back on every save from CardFormModal, status
    # included — that must NOT re-append the card to the end of its column.
    r = client.patch(
        f"/api/cards/{first['id']}",
        json={"titulo": "Primeiro editado", "status": "a_fazer"},
    )
    assert r.status_code == 200
    assert r.json()["board_position"] == first["board_position"]


def test_patching_a_card_to_another_status_appends_it_there(client):
    _create_card(client, titulo="Já em andamento", status="em_andamento")
    moving = _create_card(client, titulo="Vai mover")

    r = client.patch(f"/api/cards/{moving['id']}", json={"status": "em_andamento"})
    assert r.status_code == 200
    assert r.json()["board_position"] == 1.0


def test_subcards_are_created_without_a_board_position(client):
    parent = _create_card(client, titulo="Pai")
    r = client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Sub"})
    assert r.status_code == 201
    assert r.json()["board_position"] is None


# -- status validation on the UI/REST write path -----------------------------
#
# The agent path (hooks) got this in task 14; the human path is the same rule
# reported as a 400 instead of {"success": False}. Without it, a card written
# to a column that does not exist is in the database, counted nowhere and
# visible nowhere — BoardV2 only renders columns it knows about.


def test_create_card_with_an_unknown_status_is_400_listing_the_valid_slugs(client):
    r = client.post("/api/cards", json={
        "titulo": "Card em coluna inexistente",
        "projeto_id": "proj-a",
        "status": "coluna_que_nao_existe",
    })
    assert r.status_code == 400, r.text
    for slug in ("a_fazer", "em_andamento", "em_revisao", "feito"):
        assert slug in r.json()["detail"]

    assert client.get("/api/cards").json() == []


def test_create_card_accepts_a_column_the_user_just_created(client):
    assert client.post(
        "/api/board/columns", json={"label": "Em Homologação"}
    ).status_code == 201

    created = _create_card(client, status="em_homologacao")
    assert created["status"] == "em_homologacao"


def test_create_card_is_400_once_its_default_column_has_been_deleted(client):
    # "a_fazer" is only a default, not a guarantee: the user can delete it.
    assert client.delete("/api/board/columns/a_fazer").status_code == 200

    r = client.post("/api/cards", json={"titulo": "Sem coluna", "projeto_id": "proj-a"})
    assert r.status_code == 400
    assert "a_fazer" in r.json()["detail"]


def test_create_subcard_with_an_unknown_status_is_400(client):
    parent = _create_card(client, titulo="Pai")

    r = client.post(f"/api/cards/{parent['id']}/subcards", json={
        "titulo": "Sub em coluna inexistente",
        "status": "coluna_que_nao_existe",
    })
    assert r.status_code == 400
    assert "em_andamento" in r.json()["detail"]

    # The parent gained no subcard at all.
    listed = next(c for c in client.get("/api/cards").json() if c["id"] == parent["id"])
    assert listed["subcards"] == []


def test_patch_card_with_an_unknown_status_is_400_and_changes_nothing(client):
    created = _create_card(client, titulo="Card original")

    r = client.patch(f"/api/cards/{created['id']}", json={
        "titulo": "Titulo novo",
        "status": "coluna_que_nao_existe",
    })
    assert r.status_code == 400
    assert "feito" in r.json()["detail"]

    # The whole PATCH is refused, not just the status half of it.
    unchanged = next(c for c in client.get("/api/cards").json() if c["id"] == created["id"])
    assert unchanged["status"] == "a_fazer"
    assert unchanged["titulo"] == "Card original"


def test_patch_without_a_status_is_unaffected_by_the_new_validation(client):
    created = _create_card(client, titulo="Card original")

    r = client.patch(f"/api/cards/{created['id']}", json={"titulo": "Titulo novo"})
    assert r.status_code == 200
    assert r.json()["titulo"] == "Titulo novo"
    assert r.json()["status"] == "a_fazer"


def test_patch_to_a_renamed_column_still_uses_the_slug_not_the_label(client):
    created = _create_card(client, titulo="Card")
    assert client.patch(
        "/api/board/columns/em_andamento", json={"label": "Fazendo"}
    ).status_code == 200

    # The slug is immutable; renaming never invalidates a status already in use.
    r = client.patch(f"/api/cards/{created['id']}", json={"status": "em_andamento"})
    assert r.status_code == 200
    assert r.json()["status"] == "em_andamento"

    # The new LABEL is not a valid status — only slugs are.
    r = client.patch(f"/api/cards/{created['id']}", json={"status": "Fazendo"})
    assert r.status_code == 400


# -- POST /api/cards/{id}/move (task #43, fase 3) ----------------------------
#
# A matemática de posição e as regras de âncora são exercitadas em
# test_board_positions.py / test_card_store.py. O que fica para cá é o
# CONTRATO HTTP: o corpo que o frontend manda, o card que volta, e o código de
# cada recusa — 404, 422 e 409 são três reações diferentes na UI.


def _move(client, card_id, status="a_fazer", after_id=None, before_id=None):
    return client.post(
        f"/api/cards/{card_id}/move",
        json={"status": status, "after_id": after_id, "before_id": before_id},
    )


def _column_ids(client, status="a_fazer"):
    return [c["id"] for c in client.get("/api/cards").json() if c["status"] == status]


def test_move_card_between_two_anchors_returns_200_and_the_updated_card(client):
    first = _create_card(client, titulo="Primeiro")
    second = _create_card(client, titulo="Segundo")
    third = _create_card(client, titulo="Terceiro")

    r = _move(client, third["id"], after_id=first["id"], before_id=second["id"])

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == third["id"]
    # `board_position` viaja na resposta: é ela que o frontend usa para
    # reconciliar o splice otimista com a verdade do servidor.
    assert first["board_position"] < body["board_position"] < second["board_position"]
    assert _column_ids(client) == [first["id"], third["id"], second["id"]]


def test_move_card_to_another_column_changes_status_in_the_same_request(client):
    card = _create_card(client, titulo="Card")

    r = _move(client, card["id"], status="em_andamento")

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "em_andamento"
    assert _column_ids(client, "em_andamento") == [card["id"]]


def test_move_with_both_anchors_null_lands_in_an_empty_column(client):
    card = _create_card(client, titulo="Card")

    r = _move(client, card["id"], status="em_revisao", after_id=None, before_id=None)

    assert r.status_code == 200, r.text
    assert r.json()["board_position"] == 0.0


def test_move_omitting_the_anchor_keys_entirely_is_accepted(client):
    """`after_id`/`before_id` têm default None — um corpo só com `status` é o
    caminho mais curto de "solte numa coluna vazia"."""
    card = _create_card(client, titulo="Card")

    r = client.post(f"/api/cards/{card['id']}/move", json={"status": "feito"})

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "feito"


def test_move_unknown_card_returns_404(client):
    assert _move(client, 999999).status_code == 404


def test_move_deleted_card_returns_404(client):
    card = _create_card(client, titulo="Card")
    assert client.delete(f"/api/cards/{card['id']}").status_code == 200

    assert _move(client, card["id"]).status_code == 404


def test_move_subcard_returns_404(client):
    parent = _create_card(client, titulo="Pai")
    r = client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Sub"})
    assert r.status_code == 201
    subcard = r.json()

    assert _move(client, subcard["id"]).status_code == 404


def test_move_to_an_unknown_column_returns_400(client):
    card = _create_card(client, titulo="Card")

    r = _move(client, card["id"], status="coluna_que_nao_existe")

    # 400, igual aos outros três endpoints de card para a mesma condição — 422
    # aqui ficou reservado a corpo estruturalmente inválido.
    assert r.status_code == 400
    detail = r.json()["detail"]
    # `detail` ESTRUTURADO só neste 4xx: o motivo viaja discriminado para o
    # frontend poder tratar este 400 (alcançável por corrida — outra aba
    # excluiu a coluna no meio do arrasto) como "o board mudou", sem
    # generalizar para qualquer 400 nem casar por prosa. Mesmo precedente de
    # DELETE /api/board/columns/{slug}.
    assert detail["reason"] == "coluna_inexistente"
    # A mensagem lista as colunas válidas, mesmo formato de
    # `_validate_card_status`, agora produzida dentro da transação do store.
    assert "a_fazer" in detail["message"]


def test_move_to_a_column_label_instead_of_its_slug_returns_400(client):
    card = _create_card(client, titulo="Card")
    assert client.patch(
        "/api/board/columns/em_andamento", json={"label": "Fazendo"}
    ).status_code == 200

    assert _move(client, card["id"], status="Fazendo").status_code == 400


def test_move_with_an_anchor_from_another_column_returns_409(client):
    elsewhere = _create_card(client, titulo="Noutra coluna", status="feito")
    card = _create_card(client, titulo="Card")

    r = _move(client, card["id"], status="a_fazer", after_id=elsewhere["id"])

    assert r.status_code == 409
    # Ainda uma STRING crua, ao contrário do 400 de coluna inexistente: o 409
    # já É o conflito, o status sozinho basta para o frontend reagir, e não há
    # subtipo a discriminar. A diferença de forma entre os dois é proposital, e
    # `api.moveCard` trata as duas.
    assert isinstance(r.json()["detail"], str)


def test_move_with_a_deleted_anchor_returns_409(client):
    anchor = _create_card(client, titulo="Ancora")
    card = _create_card(client, titulo="Card")
    assert client.delete(f"/api/cards/{anchor['id']}").status_code == 200

    assert _move(client, card["id"], before_id=anchor["id"]).status_code == 409


def test_move_with_inverted_anchors_returns_409(client):
    first = _create_card(client, titulo="Primeiro")
    second = _create_card(client, titulo="Segundo")
    card = _create_card(client, titulo="Card")

    r = _move(client, card["id"], after_id=second["id"], before_id=first["id"])

    assert r.status_code == 409


def test_a_refused_move_leaves_the_board_untouched(client):
    elsewhere = _create_card(client, titulo="Noutra coluna", status="feito")
    card = _create_card(client, titulo="Card")

    assert _move(
        client, card["id"], status="a_fazer", after_id=elsewhere["id"]
    ).status_code == 409

    unchanged = next(c for c in client.get("/api/cards").json() if c["id"] == card["id"])
    assert unchanged["board_position"] == card["board_position"]
    assert unchanged["atualizado_em"] == card["atualizado_em"]


def test_board_position_is_still_rejected_on_the_normal_patch_path(client):
    """`board_position` nunca entra em CardUpdateRequest: é escrito só por este
    endpoint e pela regra automática de update(). Um PATCH que tente mandá-la
    é ignorado (campo extra), NUNCA aplicado."""
    card = _create_card(client, titulo="Card")

    r = client.patch(f"/api/cards/{card['id']}", json={"board_position": 42.0})

    assert r.status_code == 200
    assert r.json()["board_position"] == card["board_position"]


def test_moving_a_card_does_not_disturb_the_rest_of_the_column(client):
    first = _create_card(client, titulo="Primeiro")
    second = _create_card(client, titulo="Segundo")
    third = _create_card(client, titulo="Terceiro")

    assert _move(
        client, third["id"], after_id=first["id"], before_id=second["id"]
    ).status_code == 200

    board = {c["id"]: c for c in client.get("/api/cards").json()}
    for untouched in (first, second):
        assert board[untouched["id"]]["board_position"] == untouched["board_position"]
        assert board[untouched["id"]]["atualizado_em"] == untouched["atualizado_em"]


# -- QA: the invalid-column contract across the four card endpoints ----------


def test_an_unknown_column_is_reported_consistently_across_card_endpoints(client):
    """ONE error condition — a body naming a column that does not exist — and
    ONE status code across all four card endpoints.

        POST  /api/cards                -> 400
        POST  /api/cards/{id}/subcards  -> 400
        PATCH /api/cards/{id}           -> 400
        POST  /api/cards/{id}/move      -> 400

    /move answered 422 when phase 3 shipped, on the grounds that `status` is a
    request-BODY field there. It is a body field on the other three too, so
    that never distinguished it — and 422 is also what FastAPI emits for a body
    that fails Pydantic validation, so on /move alone a client could not tell
    "your body is structurally wrong" from "the column you named does not
    exist". Bruno's call: 400 everywhere for the business rule, 422 left to
    structure alone (asserted at the end), which restores that distinction
    here."""
    parent = client.post(
        "/api/cards", json={"titulo": "Pai", "projeto_id": "meu-projeto"}
    ).json()

    assert client.post(
        "/api/cards",
        json={"titulo": "X", "projeto_id": "meu-projeto", "status": "nao_existe"},
    ).status_code == 400
    assert client.post(
        f"/api/cards/{parent['id']}/subcards",
        json={"titulo": "S", "status": "nao_existe"},
    ).status_code == 400
    assert client.patch(
        f"/api/cards/{parent['id']}", json={"status": "nao_existe"}
    ).status_code == 400
    assert client.post(
        f"/api/cards/{parent['id']}/move", json={"status": "nao_existe"}
    ).status_code == 400

    # And a STRUCTURALLY invalid body is still 422 — a different code for a
    # different failure, which is the whole point of moving the business rule
    # off 422. The two are distinguishable again.
    assert client.post(
        f"/api/cards/{parent['id']}/move",
        json={"status": 12345, "after_id": "nao-e-um-inteiro"},
    ).status_code == 422
