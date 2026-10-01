"""Servir arquivos de um projeto para a tela: o "conteúdo" (texto + metadados)
e os bytes crus (`f/`, inclusive download). Fase V, Parte 6 seções 6.4.3.

Recebe sempre `(project_root, rel_path, download)` e NADA sobre sessão ou aba,
de propósito: as rotas `/api/viewer/{item_id}/...` (Fase V) e
`/api/artifacts/{artifact_id}/...` (Fase A, Parte 7 seção 7.3) resolvem o
próprio id para uma raiz de projeto e um caminho e chamam as MESMAS funções
daqui. Assim só existe uma implementação de limite de 1 MB, CSP, nosniff,
download e denylist.

Duas camadas:
- `read_content` / `build_file_response`: síncronas, levantam os erros de
  `file_access` (PermissionError / FileNotFoundError / IsADirectoryError).
- `content_payload` / `file_response`: assíncronas, rodam as síncronas em
  `asyncio.to_thread` (todo acesso a disco fora do event loop) e traduzem os
  erros para HTTPException com mensagem em português. É o que as rotas usam.
"""
from __future__ import annotations

import asyncio
import codecs
import mimetypes
import os
import unicodedata
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import FileResponse

from app.file_access import (
    HEAD_BYTES,
    InvalidPathError,
    OutsideProjectError,
    ProtectedFileError,
    detect_kind,
    is_text_kind,
    language_for,
    resolve_safe_path,
    to_relative_posix,
)

# Texto devolvido pela rota `content`. Acima disso a tela mostra o cartão de
# download em vez do preview (6.2, estado "Binário ou > 1 MB"), mas o primeiro
# 1 MB ainda vai junto com `truncated: true` — a tela decide o que fazer.
TEXT_LIMIT_BYTES = 1024 * 1024

# Content-Type explícito para o que o navegador precisa interpretar certo.
# Não dá para confiar só no `mimetypes`: no Windows ele lê o registro, e
# máquinas reais devolvem `text/plain` para `.js` — com `nosniff` (abaixo), um
# script com tipo errado simplesmente não roda dentro do HTML do relatório.
_MEDIA_TYPES = {
    ".html": "text/html",
    ".htm": "text/html",
    ".xhtml": "application/xhtml+xml",
    ".xml": "text/xml",
    ".svg": "image/svg+xml",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".wasm": "application/wasm",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".mov": "video/quicktime",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
}

# CSP aplicado a toda resposta da rota `f/`, menos PDF (abaixo). O `sandbox`
# no CABEÇALHO vale mesmo quando o arquivo é aberto fora do iframe (botão ↗
# "Abrir no navegador"): o documento roda numa origem opaca e não consegue ler
# cookies/storage nem chamar a API do TaskNexus como se fosse a própria página.
#
# `allow-popups-to-escape-sandbox` acompanha o atributo `sandbox` do iframe da
# seção 6.5.4: o efetivo é a INTERSEÇÃO dos dois, e sem ele aqui um link
# `target=_blank` do relatório abriria o site externo ainda sandboxed (sem
# cookies, quebrado). `default-src *` com inline/eval: relatórios gerados por
# agente usam CDN e script inline o tempo todo, e o isolamento vem do sandbox,
# não da lista de origens.
_SANDBOX_CSP = (
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; "
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'"
)

# PDF fica FORA do CSP sandbox: o leitor de PDF embutido do Chrome se recusa a
# renderizar um documento com `sandbox` (fica em branco), e o PDF não é HTML.
_NO_SANDBOX_TYPES = frozenset({"application/pdf"})


def _media_type_for(real_path: str, kind: str) -> str:
    """Content-Type do arquivo, dado o `kind` já detectado. Texto que o
    navegador não precisa interpretar (markdown, código) vai como
    `text/plain`: assim "Abrir no navegador" mostra o texto em vez de baixar,
    e com `nosniff` ele nunca é executado como HTML."""
    ext = os.path.splitext(real_path)[1].lower()
    if ext in _MEDIA_TYPES:
        return _MEDIA_TYPES[ext]
    if is_text_kind(kind):
        return "text/plain"
    guessed = mimetypes.guess_type(real_path)[0]
    # Um palpite `text/*` do registro do Windows para um arquivo que tem NUL
    # no cabeçalho estaria errado; binário desconhecido baixa.
    if guessed and not guessed.startswith("text/"):
        return guessed
    return "application/octet-stream"


def _ascii_fallback(name: str) -> str:
    """Nome só-ASCII para o `filename=` antigo do Content-Disposition (o
    `filename*` UTF-8 é o que os navegadores atuais usam). Tira acento em vez
    de apagar a letra: "relatório.md" -> "relatorio.md"."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    cleaned = "".join(c for c in ascii_only if c.isprintable() and c not in '"\\')
    return cleaned.strip() or "arquivo"


def content_disposition(name: str, download: bool) -> str:
    """`attachment` (botão Baixar) ou `inline` (preview), sempre com o nome.

    `filename*=UTF-8''...` (RFC 6266/5987) leva o nome acentuado intacto; o
    `filename="..."` ASCII é só o fallback. Com `inline`, o nome ainda serve
    para o "Salvar" do Safari não chamar o arquivo de `f`."""
    disposition = "attachment" if download else "inline"
    return (
        f'{disposition}; filename="{_ascii_fallback(name)}"; '
        f"filename*=UTF-8''{quote(name, safe='')}"
    )


def _decode_text(data: bytes, final: bool) -> str:
    """UTF-8 (tirando BOM) com `replace` para byte inválido. Com
    `final=False` (texto cortado no limite), um caractere multibyte partido
    no fim é descartado em vez de virar `�`."""
    decoder = codecs.getincrementaldecoder("utf-8-sig")(errors="replace")
    return decoder.decode(data, final=final)


def read_content(project_root: str, rel_path: str) -> dict[str, Any]:
    """Metadados do arquivo e, se for texto, o conteúdo (até 1 MB).

    Formato (Parte 6, rota `content`, sem o id — quem chama acrescenta
    `item_id`/`artifact_id`):
    `{"path","name","size","mtime","kind","language","mime","is_text","text"?,"truncated"}`.
    `text` só existe quando `is_text` é true. Levanta os erros de file_access.
    """
    real = resolve_safe_path(project_root, rel_path)
    rel = to_relative_posix(os.path.realpath(project_root), real)
    with open(real, "rb") as fh:
        st = os.fstat(fh.fileno())
        head = fh.read(HEAD_BYTES)
        kind = detect_kind(real, head)
        payload: dict[str, Any] = {
            "path": rel,
            "name": os.path.basename(real),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "kind": kind,
            "language": language_for(rel),
            "mime": _media_type_for(real, kind),
            "is_text": is_text_kind(kind),
            "truncated": False,
        }
        if payload["is_text"]:
            data = head + fh.read(max(0, TEXT_LIMIT_BYTES + 1 - len(head)))
            truncated = len(data) > TEXT_LIMIT_BYTES
            payload["text"] = _decode_text(data[:TEXT_LIMIT_BYTES], final=not truncated)
            payload["truncated"] = truncated
    return payload


def build_file_response(project_root: str, rel_path: str, download: bool) -> FileResponse:
    """FileResponse da rota `f/` (HTML no iframe, imagens, PDF, assets
    relativos e download). Levanta os erros de file_access.

    Cabeçalhos:
    - `Cache-Control: no-store` em tudo: o agente reescreve o arquivo e a aba
      recarrega; cache aqui mostraria a versão velha.
    - `X-Content-Type-Options: nosniff` em tudo: sem isso o navegador pode
      "adivinhar" HTML num `.txt` e executá-lo.
    - CSP `sandbox` em tudo menos PDF (ver `_SANDBOX_CSP`). A especificação
      pede no mínimo para html/svg/xhtml/xml; estender para o resto não quebra
      nada (CSP de imagem, CSS e script carregados por uma página é ignorado)
      e cobre tipos perigosos que uma lista esqueceria.
    """
    real = resolve_safe_path(project_root, rel_path)
    stat_result = os.stat(real)
    with open(real, "rb") as fh:
        head = fh.read(HEAD_BYTES)
    media_type = _media_type_for(real, detect_kind(real, head))
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": content_disposition(os.path.basename(real), download),
    }
    if media_type not in _NO_SANDBOX_TYPES:
        headers["Content-Security-Policy"] = _SANDBOX_CSP
    return FileResponse(
        real,
        media_type=media_type,
        headers=headers,
        stat_result=stat_result,
    )


def http_error(exc: OSError, rel_path: str) -> HTTPException:
    """Traduz o erro de file_access/disco para a resposta HTTP.

    403 para o que é recusado por regra (fora do projeto, protegido, caminho
    inválido); 404 para o que não existe — a tela mostra "Este arquivo não
    existe mais" (6.2); 400 para pasta; 500 para qualquer outra falha de
    leitura. A mensagem do 500 não repassa o texto do SO, que traz o caminho
    absoluto."""
    if isinstance(exc, (InvalidPathError, OutsideProjectError, ProtectedFileError)):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=f"Arquivo não encontrado: {rel_path}")
    if isinstance(exc, IsADirectoryError):
        return HTTPException(status_code=400, detail=f"É uma pasta, não um arquivo: {rel_path}")
    return HTTPException(status_code=500, detail=f"Não foi possível ler o arquivo: {rel_path}")


async def content_payload(project_root: str, rel_path: str) -> dict[str, Any]:
    """`read_content` fora do event loop, com erro já em HTTPException."""
    try:
        return await asyncio.to_thread(read_content, project_root, rel_path)
    except OSError as exc:
        raise http_error(exc, rel_path) from None


async def file_response(project_root: str, rel_path: str, download: bool) -> FileResponse:
    """`build_file_response` fora do event loop, com erro já em HTTPException.
    Os bytes em si são enviados pelo próprio FileResponse, também em thread."""
    try:
        return await asyncio.to_thread(build_file_response, project_root, rel_path, download)
    except OSError as exc:
        raise http_error(exc, rel_path) from None
