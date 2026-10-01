"""Rotas do visualizador de arquivos (Fase V, Parte 6 seção 6.4.3).

APIRouter próprio, registrado em main.py com `app.include_router(...)`: a
quebra do main.py em routers (Parte 4, 4.3) é outra fase, mas o que nasce
novo já nasce separado.

Duas peças:

- `ViewerService`: a regra de "abrir um arquivo numa aba" (resolver projeto e
  caminho, gravar a aba, avisar a tela). Fica fora das rotas porque tem dois
  chamadores hoje (o hook do agente e o clique do usuário) e um terceiro na
  Fase A (`publicar_artefato` com `abrir=true`, Parte 7 seção 7.4.3).
- `create_viewer_router(service)`: as rotas. É uma FÁBRICA, e não um
  `router` no nível do módulo, porque as dependências (stores, função de aviso
  pelo WebSocket, raiz dos projetos) moram em main.py, e os testes recarregam
  main.py (`importlib.reload`) a cada caso: o router precisa ser montado de
  novo com as instâncias novas, sem import circular de volta para main.
"""
from __future__ import annotations

import asyncio
import ipaddress
import os
import posixpath
import re
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import file_serving
from app.file_access import (
    HEAD_BYTES,
    detect_kind,
    language_for,
    project_dir_from_id,
    resolve_safe_path,
    to_relative_posix,
)
from app.viewer_store import MAX_ITEMS_PER_SESSION, ViewerStore

# Mensagens que o agente lê como resultado da tool (6.4.6) ou a tela mostra.
SESSION_NOT_FOUND = "Sessão do TaskNexus não encontrada"
HOOK_NOT_LOOPBACK = "O hook do visualizador só aceita chamadas da própria máquina."
ITEM_NOT_FOUND = "Aba não encontrada"

# (session_key, item, reused, evicted_ids) -> entregue ao vivo?
NotifyFn = Callable[[str, dict, bool, list], Awaitable[bool]]
# (session_key, item) -> qualquer coisa; chamado depois que o AGENTE abriu um
# arquivo pelo hook (Fase A: publicação automática em Artefatos).
AgentOpenFn = Callable[[str, dict], Awaitable[Any]]


class ViewerOpenError(Exception):
    """Falha ao abrir: `message` vai para o agente/tela; `status_code` é usado
    pela rota do usuário (o hook responde sempre 200 com success=false)."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _inspect_file(project_root: str, caminho: str) -> tuple[str, str]:
    """(caminho relativo normalizado, kind). Síncrona: roda em to_thread."""
    real = resolve_safe_path(project_root, caminho)
    rel = to_relative_posix(os.path.realpath(project_root), real)
    with open(real, "rb") as fh:
        head = fh.read(HEAD_BYTES)
    return rel, detect_kind(real, head)


class ViewerService:
    """Abrir arquivo numa aba do visualizador de uma sessão.

    Dependências injetadas por main.py (ver docstring do módulo):
    - `find_project_path(project_id) -> str | None`: síncrona, a mesma
      resolução de `_resolve_project_or_404` (varre os projetos). Usada só na
      abertura, que é rara.
    - `get_projects_root() -> str`: raiz atual dos projetos (muda pela tela de
      Configuração), usada para servir arquivos sem varrer a árvore.
    - `session_key_for_claude_id(id) -> str | None`: assíncrona,
      `ConversationStore.get_session_key_by_claude_id`.
    - `notify(...)`: `notify_viewer_open` de main.py; None = ninguém avisa
      (sempre `delivered=false`).
    """

    def __init__(
        self,
        *,
        store: ViewerStore,
        find_project_path: Callable[[str], str | None],
        get_projects_root: Callable[[], str],
        session_key_for_claude_id: Callable[[str], Awaitable[str | None]],
        notify: NotifyFn | None = None,
        max_items: int = MAX_ITEMS_PER_SESSION,
        reuse: bool = True,
    ):
        self.store = store
        self._find_project_path = find_project_path
        self._get_projects_root = get_projects_root
        self._session_key_for_claude_id = session_key_for_claude_id
        self._notify = notify
        self._max_items = max_items
        # "O mesmo arquivo pedido de novo reaproveita a aba" (6.1). A
        # alternativa "uma aba nova toda vez" é só trocar para False.
        self._reuse = reuse

    async def session_key_for_claude_id(self, claude_session_id: str) -> str | None:
        if not claude_session_id:
            return None
        return await self._session_key_for_claude_id(claude_session_id)

    def project_root_for(self, project_id: str) -> str | None:
        """Pasta do projeto de uma aba já gravada (caminho rápido, sem varrer)."""
        return project_dir_from_id(self._get_projects_root(), project_id)

    async def open_path(
        self,
        session_key: str,
        caminho: Any,
        *,
        titulo: str | None = None,
        linha: int | None = None,
        opened_by: str,
    ) -> dict:
        """Grava (ou reaproveita) a aba e avisa a tela. Devolve o corpo de
        sucesso das rotas POST; levanta ViewerOpenError com a mensagem certa
        para cada recusa.

        `project_id` sai da `session_key` pela mesma regra de
        `continue_session` (`partition("::")[0]`)."""
        project_id = session_key.partition("::")[0]
        project_path = None
        if project_id:
            project_path = await asyncio.to_thread(self._find_project_path, project_id)
        if project_path is None:
            raise ViewerOpenError(f"Projeto da sessão não encontrado: {project_id}", 404)

        try:
            rel_path, kind = await asyncio.to_thread(_inspect_file, project_path, caminho)
        except OSError as exc:
            shown = caminho.strip() if isinstance(caminho, str) else ""
            error = file_serving.http_error(exc, shown)
            raise ViewerOpenError(error.detail, error.status_code) from None

        item, reused, evicted = await self.store.open_item(
            session_key=session_key,
            project_id=project_id,
            path=rel_path,
            title=titulo,
            line=linha,
            kind=kind,
            language=language_for(rel_path),
            opened_by=opened_by,
            reuse=self._reuse,
            max_items=self._max_items,
        )
        # A aba JÁ está gravada: o aviso ao vivo é só conveniência (6.3), e
        # uma tela fechada (ou um envio que falhou) vira `delivered=false` —
        # a tela busca as abas pelo GET quando abrir a conversa.
        delivered = False
        if self._notify is not None:
            delivered = bool(await self._notify(session_key, item, reused, evicted))
        return {
            "success": True,
            "item": item,
            "reused": reused,
            "delivered": delivered,
            "evicted": evicted,
        }


# --- Hook só de loopback -----------------------------------------------------


def _is_loopback_host(host: str | None) -> bool:
    """127.0.0.0/8, ::1 e IPv4 mapeado em IPv6 (::ffff:127.0.0.1, que é como
    um socket dual-stack enxerga uma conexão local). Nome (ex.: "testclient")
    não é IP e não conta."""
    if not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return ip.is_loopback


def hook_request_allowed(request: Request) -> bool:
    """As rotas /api/hooks/viewer/* só atendem a própria máquina (6.4.3).

    O adaptador MCP sempre chama por `_hook_callback_base_url()`, que é
    `http://127.0.0.1:<porta>` — então quem chega de outro IP não é o
    adaptador. A exceção é HOOK_CALLBACK_BASE_URL definida (backend atrás de
    proxy/container): aí o adaptador chega pelo IP do proxy, e checar o IP
    mataria o hook. Lida a cada requisição, como em `_hook_callback_base_url`.

    Os hooks antigos (/api/hooks/cards/*, task, stop) ficam como estão: mudar
    o comportamento deles não é escopo desta fase."""
    if os.getenv("HOOK_CALLBACK_BASE_URL", "").strip():
        return True
    client = request.client
    return _is_loopback_host(client.host if client else None)


# --- Corpo das rotas -----------------------------------------------------------


class ViewerOpenRequest(BaseModel):
    """Corpo de POST /api/sessions/{session_key}/viewer (clique do usuário).

    `relativo_a` é o caminho do arquivo onde o link estava, para resolver
    `../plano.md` a partir dele (link num markdown aberto, 6.5.4)."""
    caminho: str
    linha: int | None = None
    relativo_a: str | None = None


def _parse_line(value: Any) -> int | None:
    """`linha` vinda do agente: inteiro >= 1, ou string só de dígitos (alguns
    modelos mandam "42"). Qualquer outra coisa vira "sem linha" em vez de
    erro — abrir o arquivo é o que importa."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 1 else None
    if isinstance(value, str) and value.strip().isdigit():
        number = int(value.strip())
        return number if number >= 1 else None
    return None


def _optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


_LINE_FRAGMENT = re.compile(r"^L(\d+)")
_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]")


def _resolve_link(caminho: str, relativo_a: str | None) -> tuple[str, int | None]:
    """Link clicado pelo usuário -> (caminho a abrir, linha do fragmento).

    - `#...` é descartado (`src/app.py#L10` vira linha 10). Âncoras de seção
      são tratadas pela própria tela (6.5.4), nunca chegam aqui sozinhas.
    - Relativo com `relativo_a`: resolvido a partir da PASTA do arquivo onde o
      link estava, como o navegador faria com um link relativo.
    Nada aqui valida contenção: o resultado ainda passa por resolve_safe_path.
    """
    path, _, fragment = caminho.partition("#")
    match = _LINE_FRAGMENT.match(fragment)
    line = int(match.group(1)) if match and int(match.group(1)) >= 1 else None
    path = path.strip()
    if path and relativo_a and not (path.startswith("/") or _WINDOWS_ABSOLUTE.match(path)):
        base_dir = posixpath.dirname(relativo_a.replace("\\", "/"))
        path = posixpath.join(base_dir, path)
    return path, line


def create_viewer_router(
    service: ViewerService, on_agent_open: AgentOpenFn | None = None,
) -> APIRouter:
    """`on_agent_open`: chamado só quando a abertura veio do AGENTE (hook) e
    deu certo. É por ele que a Fase A publica automaticamente os .md/.html/
    .pdf que o agente mostra (Parte 7, 7.3). Fica aqui, e não dentro de
    `ViewerService.open_path`, de propósito: a abertura pelo usuário e a do
    próprio `publicar_artefato` usam `open_path` e NÃO devem publicar."""
    router = APIRouter()

    @router.post("/api/hooks/viewer/open")
    async def hook_viewer_open(request: Request):
        """Chamado só pelo mcp_viewer_adapter.py (tool abrir_no_visualizador).

        Responde SEMPRE com `{"success": ...}` legível, inclusive para corpo
        malformado: um 422 do FastAPI viraria "não foi possível falar com o
        TaskNexus" no adaptador, escondendo do agente o que ele errou (mesmo
        motivo de main._validate_card_tipo). Por isso o corpo é lido à mão e
        não por um modelo pydantic."""
        if not hook_request_allowed(request):
            return JSONResponse(
                status_code=403,
                content={"success": False, "error": HOOK_NOT_LOOPBACK},
            )
        try:
            payload = await request.json()
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            return {"success": False, "error": "Corpo da requisição inválido."}

        claude_session_id = payload.get("claude_session_id")
        session_key = None
        if isinstance(claude_session_id, str):
            session_key = await service.session_key_for_claude_id(claude_session_id)
        if not session_key:
            return {"success": False, "error": SESSION_NOT_FOUND}

        try:
            result = await service.open_path(
                session_key,
                payload.get("caminho"),
                titulo=_optional_text(payload.get("titulo")),
                linha=_parse_line(payload.get("linha")),
                opened_by="agent",
            )
        except ViewerOpenError as exc:
            return {"success": False, "error": exc.message}
        if on_agent_open is not None:
            # A aba já está aberta: o que acontecer daqui em diante é extra e
            # nunca vira erro para o agente.
            try:
                await on_agent_open(session_key, result["item"])
            except Exception:
                pass
        return result

    @router.post("/api/sessions/{session_key:path}/viewer")
    async def open_in_session_viewer(session_key: str, body: ViewerOpenRequest):
        """Clique do usuário (caminho no terminal, link num markdown). Mesmo
        corpo de resposta do hook; nas recusas o status HTTP acompanha
        (403/404/400) para a tela poder tratar como erro de fetch comum."""
        caminho, fragment_line = _resolve_link(body.caminho, body.relativo_a)
        linha = body.linha if body.linha is not None and body.linha >= 1 else fragment_line
        try:
            return await service.open_path(
                session_key, caminho, linha=linha, opened_by="user",
            )
        except ViewerOpenError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"success": False, "error": exc.message},
            )

    @router.get("/api/sessions/{session_key:path}/viewer")
    async def list_session_viewer(session_key: str):
        return {"items": await service.store.list_for_session(session_key)}

    @router.delete("/api/sessions/{session_key:path}/viewer/{item_id}")
    async def close_viewer_item(session_key: str, item_id: str):
        if not await service.store.delete(session_key, item_id):
            raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
        return {"status": "closed"}

    @router.delete("/api/sessions/{session_key:path}/viewer")
    async def close_all_viewer_items(session_key: str):
        count = await service.store.clear_for_session(session_key)
        return {"status": "closed", "count": count}

    async def _item_and_root(item_id: str) -> tuple[dict, str]:
        item = await service.store.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
        root = await asyncio.to_thread(service.project_root_for, item["project_id"])
        if root is None:
            raise HTTPException(
                status_code=404,
                detail=f"Projeto não encontrado: {item['project_id']}",
            )
        return item, root

    @router.get("/api/viewer/{item_id}/content")
    async def viewer_item_content(item_id: str):
        item, root = await _item_and_root(item_id)
        payload = await file_serving.content_payload(root, item["path"])
        return {"item_id": item_id, **payload}

    @router.get("/api/viewer/{item_id}/f/{file_path:path}")
    async def viewer_item_file(item_id: str, file_path: str, download: bool = False):
        """O arquivo da aba E seus vizinhos do mesmo projeto: o HTML no iframe
        pede `style.css` relativo e o navegador resolve para esta mesma rota
        (6.3). `file_path` é relativo à raiz do projeto e passa pelas mesmas
        regras de resolve_safe_path + denylist."""
        _, root = await _item_and_root(item_id)
        return await file_serving.file_response(root, file_path, download)

    return router
