"""Testes de integração das rotas do visualizador (Fase V, Parte 6 seções
6.4.3 e 6.7): hook do agente, abertura pelo usuário, lista, fechar, conteúdo
e arquivos crus (`f/`, inclusive download).

Mesmo padrão de fixture `client` de test_hooks_cards.py (reload de app.main
com env vars apontando para um tmp_path isolado). Sessões de agente são
registradas como lá: um /ws/pty real com _build_pty_cmd trocado por um
comando inofensivo e uuid4 fixado, para saber de antemão qual
claude_session_id o ConversationStore grava.
"""
from __future__ import annotations

import os
import sys
import time
import uuid as uuid_mod
from unittest.mock import patch

import pytest

SK = "meu-projeto::claude"
README = "# Projeto\n\nOlá, mundo.\n"


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "meu-projeto"
    (root / ".claude").mkdir(parents=True)
    (root / "docs" / "img").mkdir(parents=True)
    (root / "README.md").write_text(README, encoding="utf-8")
    (root / "docs" / "plano.md").write_text("# Plano\n", encoding="utf-8")
    (root / "docs" / "relatorio.html").write_text(
        '<html><head><link rel="stylesheet" href="style.css"></head>'
        '<body><img src="img/logo.png"></body></html>',
        encoding="utf-8",
    )
    (root / "docs" / "style.css").write_text("body { color: red }", encoding="utf-8")
    (root / "docs" / "img" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00fake")
    (root / "app.py").write_text("print('oi')\n", encoding="utf-8")
    (root / ".env").write_text("TOKEN=segredo", encoding="utf-8")
    (tmp_path / "fora.txt").write_text("fora do projeto", encoding="utf-8")
    return root


@pytest.fixture
def client(tmp_path, project, monkeypatch):
    # O hook só atende loopback quando HOOK_CALLBACK_BASE_URL NÃO está
    # definida; garante que nada do ambiente do desenvolvedor vaze para cá.
    monkeypatch.delenv("HOOK_CALLBACK_BASE_URL", raising=False)
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


@pytest.fixture
def loopback(monkeypatch):
    """O TestClient se apresenta como host "testclient", que não é IP de
    loopback. Para os testes do caminho feliz do hook, finge que é."""
    import app.viewer_api as viewer_api
    monkeypatch.setattr(viewer_api, "_is_loopback_host", lambda host: True)


def _register_session(client, session_key: str = SK, project_id: str = "meu-projeto") -> str:
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


def _hook(client, claude_session_id, **body):
    return client.post("/api/hooks/viewer/open", json={
        "claude_session_id": claude_session_id, **body,
    })


def _open(client, caminho, session_key=SK, **body):
    return client.post(f"/api/sessions/{session_key}/viewer", json={"caminho": caminho, **body})


# -- POST /api/hooks/viewer/open ----------------------------------------------


def test_hook_opens_file_for_a_known_session(client, loopback, project):
    sid = _register_session(client)
    r = _hook(client, sid, caminho="docs/relatorio.html", titulo="Relatório")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["reused"] is False
    # Sem tela conectada nesta fase do teste: gravado, não entregue.
    assert body["delivered"] is False
    assert body["evicted"] == []
    item = body["item"]
    assert item["session_key"] == SK
    assert item["project_id"] == "meu-projeto"
    assert item["path"] == "docs/relatorio.html"
    assert item["title"] == "Relatório"
    assert item["kind"] == "html"
    assert item["language"] == "html"
    assert item["opened_by"] == "agent"
    assert item["line"] is None


def test_hook_with_unknown_claude_session_id_fails_readably(client, loopback):
    r = _hook(client, "uuid-que-nao-existe", caminho="README.md")
    assert r.status_code == 200
    assert r.json() == {"success": False, "error": "Sessão do TaskNexus não encontrada"}


def test_hook_accepts_absolute_path_and_stores_it_relative(client, loopback, project):
    sid = _register_session(client)
    r = _hook(client, sid, caminho=str(project / "docs" / "plano.md"))
    assert r.json()["item"]["path"] == "docs/plano.md"


def test_hook_reuses_the_tab_of_the_same_path(client, loopback):
    sid = _register_session(client)
    first = _hook(client, sid, caminho="README.md").json()
    second = _hook(client, sid, caminho="./README.md", linha=3).json()
    assert second["success"] is True
    assert second["reused"] is True
    assert second["item"]["item_id"] == first["item"]["item_id"]
    assert second["item"]["line"] == 3


def test_hook_line_from_string_and_invalid_line_is_ignored(client, loopback):
    sid = _register_session(client)
    assert _hook(client, sid, caminho="app.py", linha="7").json()["item"]["line"] == 7
    assert _hook(client, sid, caminho="app.py", linha=0).json()["item"]["line"] is None
    assert _hook(client, sid, caminho="app.py", linha="abc").json()["item"]["line"] is None


@pytest.mark.parametrize("caminho,error", [
    ("docs/x.md", "Arquivo não encontrado: docs/x.md"),
    ("../fora.txt", "Caminho fora do projeto"),
    (".env", "Arquivo protegido (segredos não são exibidos)"),
    ("docs", "É uma pasta, não um arquivo: docs"),
    ("", "Informe o caminho do arquivo."),
])
def test_hook_refusals_are_readable_errors(client, loopback, caminho, error):
    sid = _register_session(client)
    r = _hook(client, sid, caminho=caminho)
    assert r.status_code == 200
    assert r.json() == {"success": False, "error": error}


def test_hook_without_caminho_or_with_bad_body_never_422(client, loopback):
    sid = _register_session(client)
    missing = _hook(client, sid)
    assert missing.status_code == 200
    assert missing.json()["success"] is False
    wrong_type = _hook(client, sid, caminho=["README.md"])
    assert wrong_type.status_code == 200
    assert wrong_type.json()["success"] is False
    not_json = client.post(
        "/api/hooks/viewer/open", content=b"isto nao e json",
        headers={"Content-Type": "application/json"},
    )
    assert not_json.status_code == 200
    assert not_json.json()["success"] is False


def test_hook_from_non_loopback_ip_is_forbidden(client):
    # Sem o fixture `loopback`: o TestClient chega como "testclient".
    r = _hook(client, "qualquer", caminho="README.md")
    assert r.status_code == 403
    assert r.json()["success"] is False
    assert "própria máquina" in r.json()["error"]


def test_hook_ip_check_is_skipped_when_callback_base_url_is_set(client, monkeypatch):
    monkeypatch.setenv("HOOK_CALLBACK_BASE_URL", "http://10.0.0.5:9999")
    sid = _register_session(client)
    r = _hook(client, sid, caminho="README.md")
    assert r.status_code == 200
    assert r.json()["success"] is True


@pytest.mark.parametrize("host,expected", [
    ("127.0.0.1", True),
    ("127.0.0.2", True),
    ("::1", True),
    ("::ffff:127.0.0.1", True),
    ("192.168.0.10", False),
    ("100.101.102.103", False),
    ("::ffff:192.168.0.10", False),
    ("testclient", False),
    ("", False),
    (None, False),
])
def test_is_loopback_host(host, expected):
    from app.viewer_api import _is_loopback_host
    assert _is_loopback_host(host) is expected


# -- POST /api/sessions/{session_key}/viewer (usuário) -------------------------


def test_user_open_creates_tab_opened_by_user(client):
    r = _open(client, "docs/plano.md")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["item"]["opened_by"] == "user"
    assert body["item"]["kind"] == "markdown"


def test_user_open_resolves_relative_link_from_the_current_file(client):
    r = _open(client, "../README.md", relativo_a="docs/plano.md")
    assert r.json()["item"]["path"] == "README.md"
    r = _open(client, "style.css", relativo_a="docs/relatorio.html")
    assert r.json()["item"]["path"] == "docs/style.css"
    assert r.json()["item"]["language"] == "css"


def test_user_open_takes_line_from_fragment(client):
    r = _open(client, "app.py#L10")
    assert r.json()["item"]["path"] == "app.py"
    assert r.json()["item"]["line"] == 10
    # `linha` explícita vence o fragmento.
    r = _open(client, "app.py#L10", linha=2)
    assert r.json()["item"]["line"] == 2


@pytest.mark.parametrize("caminho,status", [
    ("docs/x.md", 404),
    ("../fora.txt", 403),
    (".env", 403),
    ("docs", 400),
])
def test_user_open_refusals_carry_http_status_and_same_body(client, caminho, status):
    r = _open(client, caminho)
    assert r.status_code == status
    assert r.json()["success"] is False
    assert r.json()["error"]


def test_user_open_on_session_of_unknown_project_is_404(client):
    r = _open(client, "README.md", session_key="projeto-inexistente::claude")
    assert r.status_code == 404
    assert r.json()["success"] is False


def test_limit_of_15_tabs_per_session_evicts_the_oldest(client, project):
    for i in range(16):
        (project / f"n{i}.md").write_text(str(i), encoding="utf-8")
    ids = [_open(client, f"n{i}.md").json()["item"]["item_id"] for i in range(15)]
    last = _open(client, "n15.md").json()
    assert last["evicted"] == [ids[0]]
    items = client.get(f"/api/sessions/{SK}/viewer").json()["items"]
    assert len(items) == 15
    assert ids[0] not in [item["item_id"] for item in items]


# -- GET / DELETE -----------------------------------------------------------------


def test_list_returns_items_in_creation_order(client):
    a = _open(client, "README.md").json()["item"]
    b = _open(client, "app.py").json()["item"]
    _open(client, "README.md", linha=2)
    r = client.get(f"/api/sessions/{SK}/viewer")
    assert r.status_code == 200
    assert [item["item_id"] for item in r.json()["items"]] == [a["item_id"], b["item_id"]]


def test_list_of_session_without_tabs_is_empty(client):
    assert client.get("/api/sessions/outra::claude/viewer").json() == {"items": []}


def test_close_one_tab(client):
    item = _open(client, "README.md").json()["item"]
    r = client.delete(f"/api/sessions/{SK}/viewer/{item['item_id']}")
    assert r.status_code == 200
    assert r.json() == {"status": "closed"}
    assert client.get(f"/api/sessions/{SK}/viewer").json()["items"] == []
    again = client.delete(f"/api/sessions/{SK}/viewer/{item['item_id']}")
    assert again.status_code == 404


def test_close_tab_of_another_session_is_404(client):
    item = _open(client, "README.md").json()["item"]
    r = client.delete(f"/api/sessions/outra::claude/viewer/{item['item_id']}")
    assert r.status_code == 404
    assert len(client.get(f"/api/sessions/{SK}/viewer").json()["items"]) == 1


def test_close_all_tabs(client):
    _open(client, "README.md")
    _open(client, "app.py")
    r = client.delete(f"/api/sessions/{SK}/viewer")
    assert r.status_code == 200
    assert r.json() == {"status": "closed", "count": 2}
    assert client.get(f"/api/sessions/{SK}/viewer").json()["items"] == []


def test_terminate_session_closes_its_tabs(client):
    _register_session(client)
    item = _open(client, "README.md").json()["item"]
    assert client.post(f"/api/sessions/{SK}/terminate").status_code == 200
    assert client.get(f"/api/sessions/{SK}/viewer").json()["items"] == []
    assert client.get(f"/api/viewer/{item['item_id']}/content").status_code == 404


# -- GET /api/viewer/{item_id}/content ---------------------------------------------


def test_content_of_markdown(client):
    item = _open(client, "README.md").json()["item"]
    r = client.get(f"/api/viewer/{item['item_id']}/content")
    assert r.status_code == 200
    body = r.json()
    assert body["item_id"] == item["item_id"]
    assert body["path"] == "README.md"
    assert body["name"] == "README.md"
    assert body["kind"] == "markdown"
    assert body["language"] == "markdown"
    assert body["is_text"] is True
    assert body["text"] == README
    assert body["truncated"] is False
    assert body["size"] == len(README.encode("utf-8"))
    assert isinstance(body["mtime"], float)


def test_content_reflects_the_file_as_it_is_now(client, project):
    item = _open(client, "README.md").json()["item"]
    (project / "README.md").write_text("# Alterado\n", encoding="utf-8")
    assert client.get(f"/api/viewer/{item['item_id']}/content").json()["text"] == "# Alterado\n"


def test_content_of_binary_has_no_text(client, project):
    (project / "dados.bin").write_bytes(b"\x00\x01\x02\x03")
    item = _open(client, "dados.bin").json()["item"]
    assert item["kind"] == "binary"
    body = client.get(f"/api/viewer/{item['item_id']}/content").json()
    assert body["is_text"] is False
    assert body["kind"] == "binary"
    assert "text" not in body
    assert body["truncated"] is False
    assert body["size"] == 4


def test_content_of_image_has_no_text(client):
    item = _open(client, "docs/img/logo.png").json()["item"]
    body = client.get(f"/api/viewer/{item['item_id']}/content").json()
    assert body["kind"] == "image"
    assert body["is_text"] is False
    assert body["mime"] == "image/png"
    assert "text" not in body


def test_content_over_1mb_is_truncated(client, project):
    big = "linha de log\n" * 100_000  # ~1,3 MB
    (project / "grande.log").write_text(big, encoding="utf-8")
    item = _open(client, "grande.log").json()["item"]
    body = client.get(f"/api/viewer/{item['item_id']}/content").json()
    assert body["is_text"] is True
    assert body["truncated"] is True
    assert len(body["text"].encode("utf-8")) == 1024 * 1024
    assert body["size"] == len(big.encode("utf-8"))


def test_content_of_deleted_file_is_404(client, project):
    item = _open(client, "app.py").json()["item"]
    os.remove(project / "app.py")
    r = client.get(f"/api/viewer/{item['item_id']}/content")
    assert r.status_code == 404
    assert r.json()["detail"] == "Arquivo não encontrado: app.py"


def test_content_of_unknown_item_is_404(client):
    r = client.get("/api/viewer/vw_nao_existe/content")
    assert r.status_code == 404
    assert r.json()["detail"] == "Aba não encontrada"


# -- GET /api/viewer/{item_id}/f/{file_path} -------------------------------------


def test_f_serves_html_with_sandbox_csp(client):
    item = _open(client, "docs/relatorio.html").json()["item"]
    r = client.get(f"/api/viewer/{item['item_id']}/f/docs/relatorio.html")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    csp = r.headers["content-security-policy"]
    assert csp.startswith("sandbox allow-scripts allow-popups")
    # Nunca allow-same-origin: o HTML roda numa origem opaca.
    assert "allow-same-origin" not in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-disposition"].startswith("inline;")
    assert b"stylesheet" in r.content


def test_f_serves_svg_with_sandbox_csp(client, project):
    (project / "d.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    item = _open(client, "d.svg").json()["item"]
    r = client.get(f"/api/viewer/{item['item_id']}/f/d.svg")
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in r.headers["content-security-policy"]


def test_f_serves_neighbor_assets_of_the_same_project(client):
    item = _open(client, "docs/relatorio.html").json()["item"]
    css = client.get(f"/api/viewer/{item['item_id']}/f/docs/style.css")
    assert css.status_code == 200
    assert css.headers["content-type"].startswith("text/css")
    assert css.text == "body { color: red }"
    png = client.get(f"/api/viewer/{item['item_id']}/f/docs/img/logo.png")
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"


def test_f_serves_code_as_plain_text(client):
    item = _open(client, "app.py").json()["item"]
    r = client.get(f"/api/viewer/{item['item_id']}/f/app.py")
    assert r.headers["content-type"].startswith("text/plain")
    assert r.headers["x-content-type-options"] == "nosniff"


def test_f_serves_pdf_without_sandbox_csp(client, project):
    (project / "manual.pdf").write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    item = _open(client, "manual.pdf").json()["item"]
    assert item["kind"] == "pdf"
    r = client.get(f"/api/viewer/{item['item_id']}/f/manual.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "content-security-policy" not in r.headers
    assert r.headers["cache-control"] == "no-store"


def test_f_refuses_env(client):
    item = _open(client, "README.md").json()["item"]
    r = client.get(f"/api/viewer/{item['item_id']}/f/.env")
    assert r.status_code == 403
    assert r.json()["detail"] == "Arquivo protegido (segredos não são exibidos)"


def test_f_refuses_traversal(client):
    item = _open(client, "README.md").json()["item"]
    # Pontos codificados: o cliente HTTP não normaliza, o servidor decodifica
    # para "../../fora.txt" — é a forma que chegaria de um atacante.
    r = client.get(f"/api/viewer/{item['item_id']}/f/%2e%2e/fora.txt")
    assert r.status_code == 403
    assert r.json()["detail"] == "Caminho fora do projeto"
    r = client.get(f"/api/viewer/{item['item_id']}/f/docs/%2e%2e/%2e%2e/fora.txt")
    assert r.status_code == 403


def test_f_missing_file_and_unknown_item_are_404(client):
    item = _open(client, "README.md").json()["item"]
    assert client.get(f"/api/viewer/{item['item_id']}/f/nao-existe.md").status_code == 404
    assert client.get("/api/viewer/vw_nao_existe/f/README.md").status_code == 404


def test_f_download_with_accented_name(client, project):
    (project / "relatório final.md").write_text("# R\n", encoding="utf-8")
    item = _open(client, "relatório final.md").json()["item"]
    r = client.get(
        f"/api/viewer/{item['item_id']}/f/relatório final.md",
        params={"download": "1"},
    )
    assert r.status_code == 200
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''relat%C3%B3rio%20final.md" in disposition
    assert 'filename="relatorio final.md"' in disposition
    assert r.content == "# R\n".encode("utf-8")
