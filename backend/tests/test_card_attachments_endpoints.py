"""Integration tests for board card file attachments.

Attachments are stored under BOARD_ATTACHMENTS_ROOT (never under the
statically-mounted board_uploads/, where an uploaded .html would run
same-origin) and are served only through /api/card-attachments/{id}/...,
which reuses file_serving (sandbox CSP, nosniff, Content-Disposition).
"""
from __future__ import annotations

import pytest
from unittest.mock import patch


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
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


def _create_card(client, **overrides):
    payload = {"titulo": "Card com anexo", "projeto_id": "proj-a", **overrides}
    r = client.post("/api/cards", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _upload(client, card_id, name, data, content_type="application/octet-stream"):
    return client.post(
        f"/api/cards/{card_id}/attachments",
        files={"file": (name, data, content_type)},
    )


def _card_from_list(client, card_id):
    return next(c for c in client.get("/api/cards").json() if c["id"] == card_id)


def test_new_card_has_empty_attachments(client):
    card = _create_card(client)
    assert card["attachments"] == []


def test_upload_stores_file_outside_static_mount_and_lists_it_on_card(client, tmp_path):
    card = _create_card(client)

    r = _upload(client, card["id"], "relatório.md", b"# Titulo\n", "text/markdown")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["card_id"] == card["id"]
    assert body["filename"] == "relatório.md"
    assert body["size_bytes"] == len(b"# Titulo\n")
    assert isinstance(body["created_at"], float)

    disk_path = tmp_path / "board_attachments" / str(card["id"]) / str(body["id"]) / "relatório.md"
    assert disk_path.read_bytes() == b"# Titulo\n"
    assert not (tmp_path / "board_uploads" / str(card["id"])).exists()

    listed = _card_from_list(client, card["id"])
    assert [a["id"] for a in listed["attachments"]] == [body["id"]]


def test_subcard_attachments_are_listed_inside_parent(client):
    parent = _create_card(client, titulo="Pai")
    r = client.post(f"/api/cards/{parent['id']}/subcards", json={"titulo": "Filho"})
    assert r.status_code == 201, r.text
    sub = r.json()

    uploaded = _upload(client, sub["id"], "notas.txt", b"oi").json()

    listed = _card_from_list(client, parent["id"])
    assert listed["subcards"][0]["attachments"][0]["id"] == uploaded["id"]


def test_content_route_returns_markdown_text(client):
    card = _create_card(client)
    uploaded = _upload(client, card["id"], "plano.md", b"# Plano\n").json()

    r = client.get(f"/api/card-attachments/{uploaded['id']}/content")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "markdown"
    assert body["text"] == "# Plano\n"
    assert body["name"] == "plano.md"
    assert body["attachment_id"] == uploaded["id"]


def test_html_is_served_sandboxed_and_download_uses_original_name(client):
    card = _create_card(client)
    uploaded = _upload(client, card["id"], "relatorio.html", b"<h1>oi</h1>", "text/html").json()

    r = client.get(f"/api/card-attachments/{uploaded['id']}/f/relatorio.html")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert "sandbox" in r.headers["content-security-policy"]
    assert r.headers["content-disposition"].startswith("inline")

    r = client.get(
        f"/api/card-attachments/{uploaded['id']}/f/relatorio.html", params={"download": 1}
    )
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    assert 'filename="relatorio.html"' in r.headers["content-disposition"]


def test_pdf_is_served_without_sandbox(client):
    card = _create_card(client)
    uploaded = _upload(client, card["id"], "doc.pdf", b"%PDF-1.4\n%%EOF", "application/pdf").json()

    r = client.get(f"/api/card-attachments/{uploaded['id']}/f/doc.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "content-security-policy" not in r.headers


def test_file_route_cannot_reach_other_attachments(client):
    card = _create_card(client)
    first = _upload(client, card["id"], "a.md", b"a").json()
    second = _upload(client, card["id"], "b.md", b"b").json()

    # `%2E%2E` so the HTTP client does not normalise the `..` away before the
    # request reaches the route (it would land on the SPA fallback instead).
    r = client.get(f"/api/card-attachments/{first['id']}/f/%2E%2E/{second['id']}/b.md")
    assert r.status_code == 403


def test_upload_rejects_traversal_and_denied_names(client):
    card = _create_card(client)
    assert _upload(client, card["id"], "../evil.md", b"x").status_code == 400
    assert _upload(client, card["id"], ".env", b"SECRET=1").status_code == 400
    assert _card_from_list(client, card["id"])["attachments"] == []


def test_upload_too_large_returns_413_and_leaves_nothing_behind(client, tmp_path):
    import app.main as main_mod

    card = _create_card(client)
    with patch.object(main_mod, "CARD_ATTACHMENT_MAX_BYTES", 10):
        r = _upload(client, card["id"], "big.txt", b"x" * 11)
    assert r.status_code == 413
    assert _card_from_list(client, card["id"])["attachments"] == []
    card_dir = tmp_path / "board_attachments" / str(card["id"])
    assert not card_dir.exists() or not any(card_dir.iterdir())


def test_upload_beyond_limit_returns_409(client):
    import app.main as main_mod

    card = _create_card(client)
    with patch.object(main_mod.card_store, "MAX_ATTACHMENTS_PER_CARD", 2):
        assert _upload(client, card["id"], "1.txt", b"1").status_code == 201
        assert _upload(client, card["id"], "2.txt", b"2").status_code == 201
        assert _upload(client, card["id"], "3.txt", b"3").status_code == 409


def test_upload_to_unknown_card_returns_404(client):
    assert _upload(client, 999999, "a.md", b"a").status_code == 404


def test_delete_removes_row_and_folder(client, tmp_path):
    card = _create_card(client)
    uploaded = _upload(client, card["id"], "a.md", b"a").json()
    folder = tmp_path / "board_attachments" / str(card["id"]) / str(uploaded["id"])
    assert folder.exists()

    r = client.delete(f"/api/cards/{card['id']}/attachments/{uploaded['id']}")
    assert r.status_code == 200
    assert not folder.exists()
    assert _card_from_list(client, card["id"])["attachments"] == []
    assert client.get(f"/api/card-attachments/{uploaded['id']}/content").status_code == 404


def test_delete_attachment_of_another_card_returns_404(client):
    owner = _create_card(client, titulo="Dono")
    other = _create_card(client, titulo="Outro")
    uploaded = _upload(client, owner["id"], "a.md", b"a").json()

    r = client.delete(f"/api/cards/{other['id']}/attachments/{uploaded['id']}")
    assert r.status_code == 404


def test_patch_response_keeps_attachments(client):
    card = _create_card(client)
    uploaded = _upload(client, card["id"], "a.md", b"a").json()

    r = client.patch(f"/api/cards/{card['id']}", json={"titulo": "Novo título"})
    assert r.status_code == 200
    assert _card_from_list(client, card["id"])["attachments"][0]["id"] == uploaded["id"]


def test_clear_finished_removes_attachment_rows_and_folders(client, tmp_path):
    card = _create_card(client, projeto_id="proj-clean")
    client.patch(f"/api/cards/{card['id']}", json={"status": "feito"})
    uploaded = _upload(client, card["id"], "a.md", b"a").json()
    folder = tmp_path / "board_attachments" / str(card["id"]) / str(uploaded["id"])
    assert folder.exists()

    r = client.post("/api/cards/limpar-concluidos", params={"projeto_id": "proj-clean"})
    assert r.status_code == 200
    assert r.json()["cards"] == 1
    assert not folder.exists()
    assert client.get(f"/api/card-attachments/{uploaded['id']}/content").status_code == 404
