"""Testes unitários de app/file_serving.py — o módulo que a rota do
visualizador (Fase V) e a dos Artefatos (Fase A) compartilham. Os cabeçalhos
das respostas reais estão cobertos em test_viewer_endpoints.py; aqui ficam os
detalhes que não aparecem bem por HTTP."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import file_serving
from app.file_access import OutsideProjectError, ProtectedFileError


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "p"
    root.mkdir()
    return root


def test_content_disposition_attachment_and_inline():
    assert file_serving.content_disposition("relatório.md", download=True) == (
        "attachment; filename=\"relatorio.md\"; filename*=UTF-8''relat%C3%B3rio.md"
    )
    assert file_serving.content_disposition("a b.pdf", download=False) == (
        "inline; filename=\"a b.pdf\"; filename*=UTF-8''a%20b.pdf"
    )


def test_content_disposition_fallback_never_breaks_the_header():
    header = file_serving.content_disposition('aspas"e\\barra.md', download=True)
    assert 'filename="aspaseebarra.md"' not in header  # só remove os perigosos
    assert 'filename="aspasebarra.md"' in header
    assert file_serving.content_disposition("日本語", download=True).startswith(
        'attachment; filename="arquivo";'
    )


def test_read_content_strips_bom(project):
    (project / "bom.md").write_bytes(b"\xef\xbb\xbf# T\n")
    payload = file_serving.read_content(str(project), "bom.md")
    assert payload["text"] == "# T\n"


def test_read_content_does_not_split_a_multibyte_char_at_the_limit(project, monkeypatch):
    monkeypatch.setattr(file_serving, "TEXT_LIMIT_BYTES", 5)
    # "aaaa" + "é" (2 bytes): o limite de 5 bytes corta o "é" ao meio.
    (project / "a.txt").write_bytes("aaaaé e mais".encode("utf-8"))
    payload = file_serving.read_content(str(project), "a.txt")
    assert payload["truncated"] is True
    assert payload["text"] == "aaaa"


def test_read_content_replaces_invalid_utf8(project):
    (project / "latin1.txt").write_bytes("ação".encode("latin-1"))
    payload = file_serving.read_content(str(project), "latin1.txt")
    assert payload["is_text"] is True
    assert "�" in payload["text"]


def test_sync_functions_raise_file_access_errors(project):
    (project / ".env").write_text("x", encoding="utf-8")
    with pytest.raises(ProtectedFileError):
        file_serving.read_content(str(project), ".env")
    with pytest.raises(OutsideProjectError):
        file_serving.build_file_response(str(project), "../../x", download=False)


@pytest.mark.parametrize("exc,status", [
    (OutsideProjectError(), 403),
    (ProtectedFileError(), 403),
    (FileNotFoundError("x"), 404),
    (IsADirectoryError("x"), 400),
    (PermissionError(13, "Permission denied", "/abs/segredo"), 500),
])
def test_http_error_mapping(exc, status):
    error = file_serving.http_error(exc, "docs/a.md")
    assert isinstance(error, HTTPException)
    assert error.status_code == status
    # Nunca repassa o caminho absoluto do SO.
    assert "/abs" not in error.detail


@pytest.mark.asyncio
async def test_async_wrappers_raise_http_exception(project):
    with pytest.raises(HTTPException) as exc:
        await file_serving.content_payload(str(project), "nao-existe.md")
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await file_serving.file_response(str(project), "../x", download=True)
    assert exc.value.status_code == 403
