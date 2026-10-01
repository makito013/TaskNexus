"""Testes de artifact_meta.py (Fase A, Parte 7 seção 7.4.4): título e trecho
de .md e .html, contagem de páginas de PDF, e a garantia de nunca levantar."""
from __future__ import annotations

import pytest

from app import artifact_meta
from app.artifact_meta import (
    EXCERPT_MAX,
    artifact_kind_for,
    extract_meta,
    html_meta,
    markdown_meta,
    pdf_page_count,
)


# -- Tipo -----------------------------------------------------------------------


@pytest.mark.parametrize("path,kind", [
    ("docs/a.md", "markdown"),
    ("A.MARKDOWN", "markdown"),
    ("r.html", "html"),
    ("r.HTM", "html"),
    ("x.pdf", "pdf"),
    ("app.py", None),
    ("img.png", None),
    ("sem_extensao", None),
    ("docs\\a.md", "markdown"),
])
def test_artifact_kind_for(path, kind):
    assert artifact_kind_for(path) == kind


# -- Markdown -------------------------------------------------------------------


def test_markdown_title_and_first_paragraph_without_markup():
    text = (
        "# Relatório de **testes**\n"
        "\n"
        "## Resumo\n"
        "\n"
        "Rodamos *58* testes com `pytest`, veja [o log](logs/x.txt) e\n"
        "o arquivo meu_modulo.py: _tudo_ certo.\n"
        "\n"
        "Segundo parágrafo.\n"
    )
    title, excerpt = markdown_meta(text)
    assert title == "Relatório de testes"
    assert excerpt == "Rodamos 58 testes com pytest, veja o log e o arquivo meu_modulo.py: tudo certo."


def test_markdown_skips_code_blocks_tables_comments_and_front_matter():
    text = (
        "---\n"
        "title: ignorado\n"
        "---\n"
        "<!-- comentário\n"
        "de várias linhas -->\n"
        "```python\n"
        "print('não é parágrafo')\n"
        "```\n"
        "| a | b |\n"
        "|---|---|\n"
        "\n"
        "> Citação que vale como texto.\n"
    )
    title, excerpt = markdown_meta(text)
    assert title is None
    assert excerpt == "Citação que vale como texto."


def test_markdown_title_only_from_level_1_heading():
    title, excerpt = markdown_meta("## Seção\n\nTexto.\n")
    assert title is None
    assert excerpt == "Texto."


def test_markdown_setext_title():
    title, excerpt = markdown_meta("Plano Geral\n===========\n\nCorpo do plano.\n")
    assert title == "Plano Geral"
    assert excerpt == "Corpo do plano."


def test_markdown_excerpt_is_cut_at_200_chars():
    _, excerpt = markdown_meta("# T\n\n" + "palavra " * 100)
    assert len(excerpt) == EXCERPT_MAX
    assert excerpt.endswith("…")


def test_markdown_without_text_has_no_excerpt():
    assert markdown_meta("# Só título\n") == ("Só título", None)
    assert markdown_meta("") == (None, None)


# -- HTML -----------------------------------------------------------------------


def test_html_title_and_meta_description():
    text = (
        "<!doctype html><html><head><title> Relatório &amp; métricas </title>"
        '<meta name="Description" content="58 passaram, 2 falharam.">'
        "<script>var p = '<p>falso</p>';</script></head>"
        "<body><p>Primeiro parágrafo.</p></body></html>"
    )
    assert html_meta(text) == ("Relatório & métricas", "58 passaram, 2 falharam.")


def test_html_first_paragraph_when_there_is_no_description():
    text = (
        "<html><head><title>T</title><style>p { color: red }</style></head>"
        "<body><p>   </p><p>Olá <b>mundo</b>\n   bonito.</p><p>Outro.</p></body></html>"
    )
    assert html_meta(text) == ("T", "Olá mundo bonito.")


def test_html_without_title_or_text():
    assert html_meta("<div>sem p</div>") == (None, None)


def test_html_broken_markup_does_not_raise():
    title, _ = html_meta("<html><title>Quebrado<p>abc</p")
    assert title.startswith("Quebrado")


# -- PDF ------------------------------------------------------------------------


def _fake_pdf(pages: int) -> bytes:
    body = b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
    body += b"2 0 obj << /Type /Pages /Count %d >> endobj\n" % pages
    for index in range(pages):
        # Alterna as duas grafias reais: com e sem espaço.
        marker = b"/Type /Page" if index % 2 else b"/Type/Page"
        body += b"%d 0 obj << %s /Parent 2 0 R >> endobj\n" % (index + 3, marker)
    return body + b"%%EOF\n"


def test_pdf_counts_pages_and_ignores_pages_node(tmp_path):
    pdf = tmp_path / "relatorio.pdf"
    pdf.write_bytes(_fake_pdf(3))
    assert pdf_page_count(str(pdf)) == 3
    assert extract_meta(str(pdf)) == {"title": "relatorio.pdf", "excerpt": "3 páginas"}


def test_pdf_with_one_page_is_singular(tmp_path):
    pdf = tmp_path / "um.pdf"
    pdf.write_bytes(_fake_pdf(1))
    assert extract_meta(str(pdf))["excerpt"] == "1 página"


def test_pdf_without_visible_pages_has_no_excerpt(tmp_path):
    pdf = tmp_path / "comprimido.pdf"
    pdf.write_bytes(b"%PDF-1.7\n<< /Type /ObjStm /Filter /FlateDecode >>\n%%EOF")
    assert extract_meta(str(pdf)) == {"title": "comprimido.pdf", "excerpt": None}


def test_pdf_over_the_size_limit_is_not_counted(tmp_path, monkeypatch):
    pdf = tmp_path / "grande.pdf"
    pdf.write_bytes(_fake_pdf(2))
    monkeypatch.setattr(artifact_meta, "PDF_PAGE_COUNT_LIMIT", 10)
    assert pdf_page_count(str(pdf)) is None
    assert extract_meta(str(pdf))["excerpt"] is None


# -- extract_meta ---------------------------------------------------------------


def test_extract_meta_markdown_and_title_fallback(tmp_path):
    md = tmp_path / "plano.md"
    md.write_text("﻿# Plano\n\nFazer X.\n", encoding="utf-8")
    assert extract_meta(str(md)) == {"title": "Plano", "excerpt": "Fazer X."}
    sem_titulo = tmp_path / "notas.md"
    sem_titulo.write_text("Só texto.\n", encoding="utf-8")
    assert extract_meta(str(sem_titulo)) == {"title": "notas.md", "excerpt": "Só texto."}


def test_extract_meta_reads_at_most_256kb(tmp_path, monkeypatch):
    md = tmp_path / "longo.md"
    md.write_text("x" * 10 + "\n\n# Título tardio\n", encoding="utf-8")
    monkeypatch.setattr(artifact_meta, "META_READ_LIMIT", 5)
    # Com o limite em 5 bytes, nem o título nem o texto inteiro são lidos.
    assert extract_meta(str(md)) == {"title": "longo.md", "excerpt": "xxxxx"}


def test_extract_meta_never_raises(tmp_path):
    assert extract_meta(str(tmp_path / "nao-existe.md")) == {"title": "nao-existe.md", "excerpt": None}
    assert extract_meta(str(tmp_path / "nao-existe.pdf")) == {"title": "nao-existe.pdf", "excerpt": None}
    invalid = tmp_path / "binario.html"
    invalid.write_bytes(b"\xff\xfe\x00<title>\x80ok</title>")
    assert extract_meta(str(invalid))["title"]
