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
