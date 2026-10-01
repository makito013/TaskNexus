"""Metadados de um artefato: título, trecho e páginas (Fase A, Parte 7 seção 7.4.4).

O cartão da aba Artefatos mostra um título e um trecho de até 2 linhas sem
abrir o arquivo. Este módulo tira os dois do próprio documento:

- Markdown: título = primeira linha `# ...`; trecho = primeiro parágrafo de
  texto, sem a marcação básica (`*`, `_`, `` ` ``, `[x](y)` -> `x`).
- HTML: título = `<title>`; trecho = `<meta name="description">` ou o texto do
  primeiro `<p>`. Lido com `html.parser` da stdlib, que só tokeniza: nada do
  documento é executado nem buscado na rede.
- PDF: título = nome do arquivo; trecho = "N páginas", contando `/Type /Page`
  nos bytes. É heurística (PDF com object streams comprimidos esconde as
  páginas), por isso falhar significa "sem trecho", nunca erro.

Só biblioteca padrão e NUNCA levanta: metadado é enfeite do cartão, e uma
falha aqui não pode impedir a publicação do artefato. Síncrono de propósito
(leitura de disco): quem chama do event loop usa `asyncio.to_thread`.

Compatibilidade: Python 3.9.6 — sem match/case, `X | Y` só em anotação.
"""
from __future__ import annotations

import os
import re
from html.parser import HTMLParser

# Quanto de cada .md/.html é lido para achar título e trecho. O título e o
# primeiro parágrafo estão sempre no começo; ler o arquivo inteiro (um HTML de
# relatório com imagens em base64 passa fácil de 10 MB) seria só custo.
META_READ_LIMIT = 256 * 1024

# PDF: a contagem de páginas precisa do arquivo inteiro (os objetos de página
# ficam espalhados), então só é tentada até este tamanho.
PDF_PAGE_COUNT_LIMIT = 20 * 1024 * 1024

# Tamanho máximo do trecho do cartão (7.4.2, coluna `excerpt`).
EXCERPT_MAX = 200

# Tipos aceitos como artefato (7.4.3, "Regras"). A tabela aceitaria qualquer
# `kind`, mas a galeria é de entregáveis legíveis: imagens, .docx e .csv ficam
# para depois (7.1, "Outros tipos").
ARTIFACT_KIND_BY_EXT = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".html": "html",
    ".htm": "html",
    ".pdf": "pdf",
}
UNSUPPORTED_KIND_ERROR = "Artefatos aceitam .md, .html e .pdf"


def artifact_kind_for(path: str) -> str | None:
    """`markdown | html | pdf` pela extensão (sem distinção de maiúsculas), ou
    None quando o arquivo não pode ser artefato."""
    ext = os.path.splitext(path.replace("\\", "/"))[1].lower()
    return ARTIFACT_KIND_BY_EXT.get(ext)


def _truncate(text: str, limit: int = EXCERPT_MAX) -> str | None:
    """Espaços colapsados e corte em `limit` caracteres (com "…" contando
    dentro do limite). Texto vazio vira None: o cartão simplesmente não
    mostra trecho."""
    text = " ".join(text.split())
    if not text:
        return None
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _read_head(real_path: str) -> str:
    with open(real_path, "rb") as fh:
        data = fh.read(META_READ_LIMIT)
    # utf-8-sig tira o BOM que editores do Windows colocam; `replace` porque um
    # caractere multibyte partido no corte de 256 KB não pode virar exceção.
    return data.decode("utf-8-sig", errors="replace")


# --- Markdown ------------------------------------------------------------------

_MD_H1 = re.compile(r"^ {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$")
_MD_HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]|$)")
_MD_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_MD_HR = re.compile(r"^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_MD_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_REF_LINK = re.compile(r"\[([^\]]*)\]\[[^\]]*\]")
_MD_AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")
_MD_HTML_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_MD_LIST_MARKER = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s+")
_MD_QUOTE = re.compile(r"^\s*(?:>\s?)+")
# `_` só como marcação de ênfase (na borda de uma palavra): apagar todo `_`
# estragaria `snake_case` e nomes de arquivo no trecho.
_MD_UNDERSCORE = re.compile(r"(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])")


def _strip_inline_markdown(text: str) -> str:
    text = _MD_IMAGE.sub(r"\1", text)
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_REF_LINK.sub(r"\1", text)
    text = _MD_AUTOLINK.sub(r"\1", text)
    text = _MD_HTML_TAG.sub("", text)
    text = text.replace("*", "").replace("`", "")
    text = _MD_UNDERSCORE.sub("", text)
    return text


def _skip_front_matter(lines: list[str]) -> list[str]:
    """Pula o bloco YAML `---` ... `---` do topo (comum em docs de sites
    estáticos): ele não é título nem parágrafo."""
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() in ("---", "..."):
                return lines[index + 1:]
    return lines


def markdown_meta(text: str) -> tuple[str | None, str | None]:
    """(título, trecho) de um texto Markdown. Título é o primeiro `# ...`
    (só nível 1: um `## Seção` não é o nome do documento). Trecho é o
    primeiro parágrafo de texto corrido — títulos, blocos de código, tabelas,
    réguas e comentários HTML não contam."""
    lines = _skip_front_matter(text.splitlines())
    title = None
    excerpt = None
    paragraph: list[str] = []
    in_fence = None
    in_comment = False

    def flush() -> None:
        nonlocal excerpt, paragraph
        if excerpt is None and paragraph:
            excerpt = _truncate(_strip_inline_markdown(" ".join(paragraph)))
        paragraph = []

    for line in lines:
        if in_fence is not None:
            if line.strip().startswith(in_fence):
                in_fence = None
            continue
        if in_comment:
            if "-->" in line:
                in_comment = False
            continue
        stripped = line.strip()
        fence = _MD_FENCE.match(line)
        if fence:
            flush()
            in_fence = fence.group(1)[:3]
            continue
        if stripped.startswith("<!--"):
            flush()
            in_comment = "-->" not in stripped
            continue
        if title is None:
            h1 = _MD_H1.match(line)
            if h1:
                flush()
                title = _truncate(_strip_inline_markdown(h1.group(1)), 200)
                continue
        if not stripped:
            flush()
        elif _MD_HEADING.match(line) or _MD_HR.match(line) or stripped.startswith("|"):
            flush()
        elif _MD_SETEXT.match(line) and paragraph:
            # Título no estilo "Texto\n=====": a linha anterior era título,
            # não parágrafo.
            if title is None and stripped.startswith("="):
                title = _truncate(_strip_inline_markdown(" ".join(paragraph)), 200)
            paragraph = []
        else:
            line_text = _MD_LIST_MARKER.sub("", _MD_QUOTE.sub("", line))
            if line_text.strip():
                paragraph.append(line_text.strip())
        if title is not None and excerpt is not None:
            break
    flush()
    return title, excerpt


# --- HTML ----------------------------------------------------------------------


class _HtmlMetaParser(HTMLParser):
    """Coleta `<title>`, `<meta name="description">` e o texto do primeiro
    `<p>`. Conteúdo de `<script>`/`<style>`/`<template>` é ignorado (é
    código, não texto). `convert_charrefs=True` (padrão) já devolve `&amp;`
    como `&`."""

    _IGNORED = frozenset({"script", "style", "template", "noscript"})

    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.description: str | None = None
        self.first_p_parts: list[str] = []
        self.first_p_done = False
        self._in_title = False
        self._in_p = False
        self._ignored_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._IGNORED:
            self._ignored_depth += 1
            return
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and self.description is None:
            attributes = {key.lower(): (value or "") for key, value in attrs}
            name = attributes.get("name", "").lower()
            prop = attributes.get("property", "").lower()
            if name == "description" or prop == "og:description":
                content = attributes.get("content", "").strip()
                if content:
                    self.description = content
        elif tag == "p" and not self.first_p_done:
            self._in_p = True

    def handle_endtag(self, tag):
        if tag in self._IGNORED:
            self._ignored_depth = max(0, self._ignored_depth - 1)
            return
        if tag == "title":
            self._in_title = False
        elif tag == "p" and self._in_p:
            self._in_p = False
            # Um <p> vazio (espaçador) não é "o primeiro parágrafo".
            if " ".join(self.first_p_parts).strip():
                self.first_p_done = True
            else:
                self.first_p_parts = []

    def handle_data(self, data):
        if self._ignored_depth:
            return
        if self._in_title:
            self.title_parts.append(data)
        if self._in_p and not self.first_p_done:
            self.first_p_parts.append(data)


def html_meta(text: str) -> tuple[str | None, str | None]:
    """(título, trecho) de um texto HTML. O trecho prefere a
    `meta description` (escrita para isso) ao primeiro `<p>`."""
    parser = _HtmlMetaParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception:
        # HTMLParser é tolerante, mas o que der errado no meio não pode
        # apagar o que já foi coletado.
        pass
    title = _truncate(" ".join(parser.title_parts), 200)
    excerpt = _truncate(parser.description or "") or _truncate(" ".join(parser.first_p_parts))
    return title, excerpt


# --- PDF -----------------------------------------------------------------------

# `/Type /Page` mas não `/Type /Pages` (o nó da árvore de páginas). O `\s*`
# cobre `/Type/Page`, forma comum em PDFs gerados por navegador.
_PDF_PAGE = re.compile(rb"/Type\s*/Page(?![A-Za-z])")


def pdf_page_count(real_path: str) -> int | None:
    """Quantidade de páginas pela contagem de objetos `/Type /Page`, ou None
    quando não dá para saber (arquivo grande demais, nenhuma página visível
    nos bytes — PDF 1.5+ com object streams —, erro de leitura)."""
    try:
        if os.path.getsize(real_path) > PDF_PAGE_COUNT_LIMIT:
            return None
        with open(real_path, "rb") as fh:
            data = fh.read(PDF_PAGE_COUNT_LIMIT + 1)
    except OSError:
        return None
    count = len(_PDF_PAGE.findall(data))
    return count or None


def _pages_label(count: int) -> str:
    return "1 página" if count == 1 else "{0} páginas".format(count)


# --- Entrada única ---------------------------------------------------------------


def extract_meta(real_path: str) -> dict:
    """`{"title": str, "excerpt": str | None}` do arquivo, pelo tipo da
    extensão. `title` nunca é vazio: sem título no documento, é o nome do
    arquivo (a mesma regra das abas do visualizador). Nunca levanta."""
    name = os.path.basename(real_path)
    title = None
    excerpt = None
    try:
        kind = artifact_kind_for(real_path)
        if kind == "markdown":
            title, excerpt = markdown_meta(_read_head(real_path))
        elif kind == "html":
            title, excerpt = html_meta(_read_head(real_path))
        elif kind == "pdf":
            pages = pdf_page_count(real_path)
            excerpt = _pages_label(pages) if pages else None
    except Exception:
        title, excerpt = None, None
    return {"title": title or name, "excerpt": excerpt}
