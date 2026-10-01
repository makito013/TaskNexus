"""Rotas da aba Artefatos (Fase A, Parte 7 seção 7.4.3).

Mesma organização de viewer_api.py:

- `ArtifactService`: a regra de "publicar um arquivo como artefato" (validar
  tipo e caminho, ler metadados, gravar) e o enriquecimento da lista com o
  estado ATUAL do disco (`exists`, `mtime`, `size`). Tem vários chamadores: a
  rota do usuário, a importação, o hook do agente (`publicar_artefato`) e a
  publicação automática do `abrir_no_visualizador`.
- `create_artifacts_router(service)`: as rotas. Fábrica, e não `router` de
  módulo, pelo mesmo motivo do visualizador: as dependências moram em main.py
  e os testes recarregam main.py a cada caso.

Os arquivos são servidos pelo `file_serving.py` da Fase V, sem cópia: CSP,
nosniff, limite de 1 MB, download e denylist são exatamente os mesmos das
rotas `/api/viewer/{item_id}/...`.

Erros: as rotas JSON respondem `{"success": false, "error": "..."}` com o
status HTTP certo (400/403/404), a mesma convenção da rota do usuário do
visualizador (6.10.2, item 8). As rotas `content` e `f/` devolvem o erro do
`file_serving` (`{"detail": ...}`), idênticas às do visualizador.
"""
from __future__ import annotations

import asyncio
import logging
import os
import unicodedata
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app import file_serving
from app.agent_discovery import cliente_id_from_projeto_id
from app.artifact_meta import UNSUPPORTED_KIND_ERROR, artifact_kind_for, extract_meta
from app.artifact_store import ArtifactStore
from app.viewer_api import (
    SESSION_NOT_FOUND,
    ViewerOpenError,
    ViewerService,
    hook_request_allowed,
)
from app.file_access import (
    is_denied,
    is_within_directory,
    project_dir_from_id,
    resolve_safe_path,
    to_relative_posix,
)

logger = logging.getLogger(__name__)

ARTIFACT_NOT_FOUND = "Artefato não encontrado"
HOOK_NOT_LOOPBACK = "O hook de artefatos só aceita chamadas da própria máquina."

# Valores aceitos em `?tipo=`: os chips da tela dizem MD/HTML/PDF, e o `kind`
# gravado é `markdown`. Vazio e `todos` = sem filtro.
_KIND_FILTERS = {
    "md": "markdown", "markdown": "markdown",
    "html": "html", "htm": "html",
    "pdf": "pdf",
}
_ORDERS = ("recentes", "nome")

# "Importar do projeto" (7.2, item 6): até 300 candidatos, e a importação
# aceita no máximo o mesmo tanto por pedido.
MAX_CANDIDATES = 300

# Pastas que nunca têm entregável do usuário: as mesmas que o navegador de
# arquivos ignora por padrão (Parte 1, `tree`) mais caches comuns. `.venv*`
# e qualquer pasta oculta (`.git`, `.claude`, `.escritorio`, `.next`…) são
# tratadas pela regra do nome em `_skip_dir`.
_IGNORED_DIRS = frozenset({
    "node_modules", "__pycache__", "dist", "build", "venv", "site-packages",
    "coverage", "htmlcov",
})
# Marcadores de projeto (os mesmos de `scan_projects`): uma subpasta com um
# deles é OUTRO projeto, e os arquivos dela aparecem nos candidatos dela.
_PROJECT_MARKERS = (".claude", ".gemini", ".codex")


class ArtifactError(Exception):
    """Recusa legível: `message` vai para a tela/agente, `status_code` para a
    rota do usuário (o hook do agente responde 200 com success=false)."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _error(exc: ArtifactError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.message},
    )


def _not_found() -> JSONResponse:
    return JSONResponse(status_code=404, content={"success": False, "error": ARTIFACT_NOT_FOUND})


def _optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _fold(text: str | None) -> str:
    """Minúsculas e sem acento, para a busca: "relatorio" acha "Relatório"
    (no iPad, digitar acento é mais lento que no teclado físico). O LIKE do
    SQLite só ignora caixa em ASCII, por isso a busca é feita aqui."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _inspect_file(project_root: str, caminho: Any) -> dict:
    """Valida e lê o arquivo a publicar. Síncrona: roda em to_thread.

    O tipo é checado DUAS vezes: pelo nome pedido (para um `app.py` receber
    "Artefatos aceitam .md, .html e .pdf" mesmo se nem existir) e pelo
    arquivo real depois do `resolve_safe_path` (um link `notas.md` que
    aponta para um `.py` grava o caminho real, que não é artefato)."""
    # Sem caminho é pedido malformado (400), não recusa de regra: o
    # `resolve_safe_path` classificaria como 403 (InvalidPathError).
    if not isinstance(caminho, str) or not caminho.strip():
        raise ArtifactError("Informe o caminho do arquivo.", 400)
    if artifact_kind_for(caminho.strip()) is None:
        raise ArtifactError(UNSUPPORTED_KIND_ERROR, 400)
    try:
        real = resolve_safe_path(project_root, caminho)
    except OSError as exc:
        shown = caminho.strip() if isinstance(caminho, str) else ""
        error = file_serving.http_error(exc, shown)
        raise ArtifactError(error.detail, error.status_code) from None
    rel = to_relative_posix(os.path.realpath(project_root), real)
    kind = artifact_kind_for(rel)
    if kind is None:
        raise ArtifactError(UNSUPPORTED_KIND_ERROR, 400)
    st = os.stat(real)
    meta = extract_meta(real)
    return {
        "path": rel,
        "kind": kind,
        "size": st.st_size,
        "mtime": st.st_mtime,
        "title": meta["title"],
        "excerpt": meta["excerpt"],
    }


def _current_state(projects_root: str, artifacts: list[dict]) -> list[dict]:
    """`exists`, `mtime` e `size` atuais de cada artefato, em lote (uma
    thread para a lista toda). Síncrona: roda em to_thread.

    Passa por `resolve_safe_path` e não por um `os.stat` cru: um arquivo
    trocado por um link para fora do projeto (ou que caiu na denylist)
    aparece como "não encontrado", igual ao que a rota `f/` vai responder.
    Sem o arquivo, `mtime`/`size` ficam os da última publicação."""
    roots: dict[str, str | None] = {}
    result = []
    for artifact in artifacts:
        project_id = artifact["project_id"]
        if project_id not in roots:
            roots[project_id] = project_dir_from_id(projects_root, project_id)
        root = roots[project_id]
        current = dict(artifact)
        current["exists"] = False
        if root is not None:
            try:
                st = os.stat(resolve_safe_path(root, artifact["path"]))
                current.update(exists=True, mtime=st.st_mtime, size=st.st_size)
            except OSError:
                pass
        result.append(current)
    return result


def _skip_dir(name: str) -> bool:
    return name.startswith(".") or name in _IGNORED_DIRS


def _find_candidates(project_root: str, published: set) -> tuple[list[dict], bool]:
    """Arquivos .md/.html/.htm/.pdf do projeto que ainda não são artefatos.
    Devolve `(candidatos, truncated)`. Síncrona: roda em to_thread.

    - Pastas ocultas e de dependência/build são podadas antes de descer
      (`node_modules` sozinho pode ter dezenas de milhares de .md).
    - Subpastas que são projetos próprios ficam de fora: no caso
      "cliente-como-projeto" (`podesubir` com `podesubir/site` dentro), o
      README do site é candidato do projeto `podesubir/site`, não de
      `podesubir` — senão o mesmo arquivo viraria dois artefatos.
    - Arquivos da denylist e links que apontam para fora do projeto nunca
      aparecem (a importação recusaria de qualquer jeito).
    - Ordem estável (pastas e arquivos em ordem alfabética) para o corte em
      300 ser sempre o mesmo."""
    root_real = os.path.realpath(project_root)
    candidates: list[dict] = []
    for dirpath, dirnames, filenames in os.walk(root_real):
        kept = []
        for name in sorted(dirnames, key=str.casefold):
            if _skip_dir(name):
                continue
            full = os.path.join(dirpath, name)
            if any(os.path.isdir(os.path.join(full, marker)) for marker in _PROJECT_MARKERS):
                continue
            kept.append(name)
        dirnames[:] = kept
        for name in sorted(filenames, key=str.casefold):
            kind = artifact_kind_for(name)
            if kind is None or name.startswith("."):
                continue
            full = os.path.join(dirpath, name)
            rel = to_relative_posix(root_real, full)
            if rel in published or is_denied(rel):
                continue
            if os.path.islink(full) and not is_within_directory(root_real, full):
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            if len(candidates) >= MAX_CANDIDATES:
                return candidates, True
            candidates.append({"path": rel, "kind": kind, "size": st.st_size, "mtime": st.st_mtime})
    return candidates, False


class ArtifactService:
    """Publicar, listar e enriquecer artefatos.

    Dependências injetadas por main.py:
    - `find_project_path(project_id) -> str | None`: síncrona, varre os
      projetos (`_resolve_project_or_404` sem o 404). Só na publicação, que é
      rara, e é o que confirma que o projeto existe de fato.
    - `get_projects_root() -> str`: raiz atual dos projetos, para servir
      arquivo e checar existência sem varrer a árvore.
    - `session_key_for_claude_id(id) -> str | None`: assíncrona, a mesma do
      visualizador (o hook do agente chega com o id de conversa do CLI).
    - `agent_label_for(session_key) -> str | None`: síncrona, "claude",
      "codex"… do agente da sessão (7.4.3, `agent_label`).
    - `viewer`: o ViewerService, para `publicar_artefato` com `abrir=true`
      reaproveitar a MESMA abertura de aba do `abrir_no_visualizador`
      (inclusive o frame `viewer_open`). None = não abre (só testes).
    """

    def __init__(
        self,
        *,
        store: ArtifactStore,
        find_project_path: Callable[[str], Optional[str]],
        get_projects_root: Callable[[], str],
        session_key_for_claude_id: Optional[Callable[[str], Awaitable[Optional[str]]]] = None,
        agent_label_for: Optional[Callable[[str], Optional[str]]] = None,
        viewer: Optional[ViewerService] = None,
    ):
        self.store = store
        self._find_project_path = find_project_path
        self._get_projects_root = get_projects_root
        self._session_key_for_claude_id = session_key_for_claude_id
        self._agent_label_for = agent_label_for
        self.viewer = viewer

    async def session_key_for_claude_id(self, claude_session_id: Any) -> str | None:
        if not isinstance(claude_session_id, str) or not claude_session_id:
            return None
        if self._session_key_for_claude_id is None:
            return None
        return await self._session_key_for_claude_id(claude_session_id)

    def agent_label_for(self, session_key: str) -> str | None:
        if self._agent_label_for is None:
            return None
        try:
            return self._agent_label_for(session_key)
        except Exception:
            # Rótulo é só o rodapé do cartão: nunca impede a publicação.
            return None

    async def publish_from_session(
        self,
        session_key: str,
        caminho: Any,
        *,
        titulo: str | None = None,
        descricao: str | None = None,
        project_path: str | None = None,
    ) -> tuple[dict, bool]:
        """Publicação feita pelo AGENTE de uma sessão: o projeto é o da
        `session_key` (mesma regra `partition("::")` do visualizador) e o
        rótulo é o do agente da sessão."""
        project_id = session_key.partition("::")[0]
        if project_path is None:
            path = None
            if project_id:
                path = await asyncio.to_thread(self._find_project_path, project_id)
            if path is None:
                raise ArtifactError(f"Projeto da sessão não encontrado: {project_id}", 404)
            project_path = path
        return await self.publish(
            project_id,
            caminho,
            project_path=project_path,
            titulo=titulo,
            descricao=descricao,
            created_by="agent",
            agent_label=self.agent_label_for(session_key),
            session_key=session_key,
        )

    async def publish_opened_item(self, session_key: str, item: dict) -> dict | None:
        """Publicação automática (7.3): o agente abriu um .md/.html/.pdf com
        `abrir_no_visualizador`. Chamada pelo hook do visualizador DEPOIS da
        aba gravada; outros tipos são ignorados. Nunca levanta — a aba já foi
        aberta, e falhar aqui não pode virar erro para o agente.

        O projeto vem do item (já validado pela abertura), pelo caminho
        rápido `project_dir_from_id`: a abertura acabou de varrer os projetos
        e não precisa de uma segunda varredura."""
        if artifact_kind_for(item.get("path") or "") is None:
            return None
        try:
            project_path = await asyncio.to_thread(self.project_root_for, item["project_id"])
            if project_path is None:
                return None
            artifact, _ = await self.publish_from_session(
                session_key, item["path"], project_path=project_path,
            )
            return artifact
        except ArtifactError as exc:
            logger.info("Publicação automática de %s recusada: %s", item.get("path"), exc.message)
        except Exception:
            logger.exception("Falha na publicação automática de %s", item.get("path"))
        return None

    def project_root_for(self, project_id: str) -> str | None:
        return project_dir_from_id(self._get_projects_root(), project_id)

    async def find_project_path(self, project_id: Any) -> str:
        if not isinstance(project_id, str) or not project_id.strip():
            raise ArtifactError("Informe o projeto (project_id).", 400)
        project_id = project_id.strip()
        path = await asyncio.to_thread(self._find_project_path, project_id)
        if path is None:
            raise ArtifactError(f"Projeto não encontrado: {project_id}", 404)
        return path

    async def publish(
        self,
        project_id: str,
        caminho: Any,
        *,
        project_path: str | None = None,
        titulo: str | None = None,
        descricao: str | None = None,
        created_by: str,
        agent_label: str | None = None,
        session_key: str | None = None,
    ) -> tuple[dict, bool]:
        """Valida, lê metadados e grava (upsert por projeto + caminho).
        Devolve `(artifact_com_estado_atual, created)`; levanta ArtifactError."""
        if project_path is None:
            project_path = await self.find_project_path(project_id)
        info = await asyncio.to_thread(_inspect_file, project_path, caminho)
        artifact, created = await self.store.upsert(
            project_id=project_id,
            cliente_id=cliente_id_from_projeto_id(project_id),
            path=info["path"],
            kind=info["kind"],
            auto_title=info["title"],
            title=titulo,
            description=descricao,
            excerpt=info["excerpt"],
            size=info["size"],
            mtime=info["mtime"],
            created_by=created_by,
            agent_label=agent_label if created_by == "agent" else None,
            session_key=session_key,
        )
        return await self.with_state(artifact), created

    async def candidates(self, project_id: str) -> dict:
        project_path = await self.find_project_path(project_id)
        published = await self.store.paths_for_project(project_id.strip())
        found, truncated = await asyncio.to_thread(_find_candidates, project_path, published)
        return {"candidates": found, "truncated": truncated}

    async def import_paths(self, project_id: Any, caminhos: Any) -> dict:
        """Publica vários arquivos como o usuário. Um caminho ruim não
        derruba os outros: vira uma entrada em `errors`."""
        if not isinstance(caminhos, list) or not caminhos:
            raise ArtifactError("Informe a lista de caminhos (caminhos).", 400)
        if len(caminhos) > MAX_CANDIDATES:
            raise ArtifactError(
                "Importe no máximo {0} arquivos por vez.".format(MAX_CANDIDATES), 400,
            )
        project_path = await self.find_project_path(project_id)
        project_id = project_id.strip()
        created_count = 0
        artifacts: list[dict] = []
        errors: list[dict] = []
        for caminho in caminhos:
            try:
                artifact, created = await self.publish(
                    project_id, caminho, project_path=project_path, created_by="user",
                )
            except ArtifactError as exc:
                errors.append({
                    "caminho": caminho if isinstance(caminho, str) else str(caminho),
                    "erro": exc.message,
                })
                continue
            created_count += 1 if created else 0
            artifacts.append(artifact)
        return {"created": created_count, "artifacts": artifacts, "errors": errors}

    async def with_state(self, artifact: dict) -> dict:
        return (await self.with_state_many([artifact]))[0]

    async def with_state_many(self, artifacts: list[dict]) -> list[dict]:
        if not artifacts:
            return []
        return await asyncio.to_thread(_current_state, self._get_projects_root(), artifacts)

    async def list_artifacts(
        self,
        *,
        cliente_id: str | None,
        projeto_id: str | None,
        tipo: str | None,
        q: str | None,
        ordem: str | None,
    ) -> list[dict]:
        tipo_key = (tipo or "").strip().lower()
        kind = None
        if tipo_key and tipo_key != "todos":
            kind = _KIND_FILTERS.get(tipo_key)
            if kind is None:
                raise ArtifactError("Tipo inválido. Use md, html ou pdf.", 400)
        order = (ordem or "recentes").strip().lower()
        if order not in _ORDERS:
            raise ArtifactError("Ordem inválida. Use recentes ou nome.", 400)

        artifacts = await self.store.list_artifacts(
            cliente_id=_optional_text(cliente_id),
            projeto_id=_optional_text(projeto_id),
            kind=kind,
        )
        needle = _fold(_optional_text(q))
        if needle:
            artifacts = [
                a for a in artifacts
                if needle in _fold(a["title"])
                or needle in _fold(a["path"])
                or needle in _fold(a["description"])
            ]
        artifacts = await self.with_state_many(artifacts)
        if order == "nome":
            artifacts.sort(key=lambda a: (_fold(a["title"]), a["path"]))
        else:
            # "Recentes" pela última mudança que o usuário veria: a
            # publicação OU o arquivo alterado depois dela (7.2, "atualizado
            # há X" usa o mtime real).
            artifacts.sort(
                key=lambda a: max(a["updated_at"] or 0, a["mtime"] or 0),
                reverse=True,
            )
        return artifacts


async def _read_json_object(request: Request) -> dict | None:
    """Corpo JSON lido à mão: corpo malformado vira mensagem legível em vez
    do 422 do FastAPI (mesma convenção do hook do visualizador)."""
    try:
        payload = await request.json()
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


_BAD_BODY = ArtifactError("Corpo da requisição inválido.", 400)


def _parse_bool(value: Any, default: bool) -> bool:
    """`abrir` vindo do agente: booleano, ou as formas de texto que alguns
    modelos mandam ("false", "0", "não"). Qualquer outra coisa vale o padrão
    — abrir é o comportamento esperado (7.4.5)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("false", "0", "no", "nao", "não", "n"):
            return False
        if text in ("true", "1", "yes", "sim", "s"):
            return True
    return default


def create_artifacts_router(service: ArtifactService) -> APIRouter:
    router = APIRouter()

    @router.get("/api/artifacts")
    async def list_artifacts(
        cliente_id: Optional[str] = None,
        projeto_id: Optional[str] = None,
        tipo: Optional[str] = None,
        q: Optional[str] = None,
        ordem: Optional[str] = None,
    ):
        try:
            artifacts = await service.list_artifacts(
                cliente_id=cliente_id, projeto_id=projeto_id, tipo=tipo, q=q, ordem=ordem,
            )
        except ArtifactError as exc:
            return _error(exc)
        return {"artifacts": artifacts}

    @router.post("/api/artifacts")
    async def create_artifact(request: Request):
        """"Salvar em Artefatos" (o usuário). 201 quando nasce, 200 quando o
        arquivo já era artefato (upsert: atualiza e mantém o id)."""
        payload = await _read_json_object(request)
        if payload is None:
            return _error(_BAD_BODY)
        try:
            project_path = await service.find_project_path(payload.get("project_id"))
            artifact, created = await service.publish(
                payload["project_id"].strip(),
                payload.get("caminho"),
                project_path=project_path,
                titulo=_optional_text(payload.get("titulo")),
                descricao=_optional_text(payload.get("descricao")),
                created_by="user",
            )
        except ArtifactError as exc:
            return _error(exc)
        return JSONResponse(status_code=201 if created else 200, content=artifact)

    @router.post("/api/hooks/artifacts/publish")
    async def hook_artifacts_publish(request: Request):
        """Chamado só pelo mcp_viewer_adapter.py (tool `publicar_artefato`).

        Mesmas regras do hook do visualizador: só loopback (exceto com
        HOOK_CALLBACK_BASE_URL), corpo lido à mão e SEMPRE `{"success": ...}`
        legível com 200 — um 422 viraria "não foi possível falar com o
        TaskNexus" no adaptador e esconderia do agente o que ele errou.

        Sucesso: `{"success": true, "artifact": {...}, "created": bool,
        "opened": bool, "delivered": bool}`. `opened` diz se a aba foi
        gravada no visualizador; `delivered`, se a tela estava aberta e
        recebeu o frame `viewer_open`."""
        if not hook_request_allowed(request):
            return JSONResponse(
                status_code=403,
                content={"success": False, "error": HOOK_NOT_LOOPBACK},
            )
        payload = await _read_json_object(request)
        if payload is None:
            return {"success": False, "error": _BAD_BODY.message}
        session_key = await service.session_key_for_claude_id(payload.get("claude_session_id"))
        if not session_key:
            return {"success": False, "error": SESSION_NOT_FOUND}

        titulo = _optional_text(payload.get("titulo"))
        try:
            artifact, created = await service.publish_from_session(
                session_key,
                payload.get("caminho"),
                titulo=titulo,
                descricao=_optional_text(payload.get("descricao")),
            )
        except ArtifactError as exc:
            return {"success": False, "error": exc.message}

        opened = False
        delivered = False
        if _parse_bool(payload.get("abrir"), True) and service.viewer is not None:
            # A MESMA abertura do `abrir_no_visualizador` (aba gravada +
            # frame `viewer_open`), com o caminho já validado e relativo.
            # Ela não passa pelo hook do visualizador, então não publica de
            # novo. Falhar aqui não desfaz a publicação.
            try:
                opened_result = await service.viewer.open_path(
                    session_key, artifact["path"], titulo=titulo, opened_by="agent",
                )
                opened = True
                delivered = bool(opened_result.get("delivered"))
            except ViewerOpenError as exc:
                logger.info("Artefato publicado, mas não aberto: %s", exc.message)
        return {
            "success": True,
            "artifact": artifact,
            "created": created,
            "opened": opened,
            "delivered": delivered,
        }

    @router.post("/api/artifacts/import")
    async def import_artifacts(request: Request):
        """"Importar do projeto": `{"created": n, "artifacts": [...],
        "errors": [{"caminho", "erro"}]}`. `created` conta só os que
        nasceram agora; `artifacts` traz todos os que deram certo (inclusive
        os que já existiam e foram atualizados)."""
        payload = await _read_json_object(request)
        if payload is None:
            return _error(_BAD_BODY)
        try:
            return await service.import_paths(payload.get("project_id"), payload.get("caminhos"))
        except ArtifactError as exc:
            return _error(exc)

    @router.get("/api/projects/{project_id:path}/artifact-candidates")
    async def artifact_candidates(project_id: str):
        try:
            return await service.candidates(project_id)
        except ArtifactError as exc:
            return _error(exc)

    @router.get("/api/artifacts/{artifact_id}")
    async def get_artifact(artifact_id: str):
        artifact = await service.store.get(artifact_id)
        if artifact is None:
            return _not_found()
        return await service.with_state(artifact)

    @router.patch("/api/artifacts/{artifact_id}")
    async def patch_artifact(artifact_id: str, request: Request):
        """Renomear e editar descrição. `titulo` vazio é recusado (o cartão
        precisa de nome); `descricao` vazia ou null apaga a descrição."""
        payload = await _read_json_object(request)
        if payload is None:
            return _error(_BAD_BODY)
        titulo = payload.get("titulo")
        if titulo is not None and not _optional_text(titulo):
            return _error(ArtifactError("O título não pode ficar vazio.", 400))
        clear_description = "descricao" in payload and not _optional_text(payload.get("descricao"))
        artifact = await service.store.update(
            artifact_id,
            title=_optional_text(titulo),
            description=_optional_text(payload.get("descricao")),
            clear_description=clear_description,
        )
        if artifact is None:
            return _not_found()
        return await service.with_state(artifact)

    @router.delete("/api/artifacts/{artifact_id}")
    async def delete_artifact(artifact_id: str):
        """Tira da galeria. O arquivo no disco NÃO é apagado (7.1, A7)."""
        if not await service.store.delete(artifact_id):
            return _not_found()
        return {"status": "removed"}

    async def _artifact_and_root(artifact_id: str) -> tuple[dict, str]:
        """Erros aqui saem como `{"detail": ...}` (HTTPException), iguais aos
        de `file_serving` e aos das rotas do visualizador: a tela trata
        `content`/`f/` do artefato e da aba com o mesmo código."""
        artifact = await service.store.get(artifact_id)
        if artifact is None:
            raise HTTPException(status_code=404, detail=ARTIFACT_NOT_FOUND)
        root = await asyncio.to_thread(service.project_root_for, artifact["project_id"])
        if root is None:
            raise HTTPException(
                status_code=404,
                detail=f"Projeto não encontrado: {artifact['project_id']}",
            )
        return artifact, root

    @router.get("/api/artifacts/{artifact_id}/content")
    async def artifact_content(artifact_id: str):
        """Igual a `/api/viewer/{item_id}/content`, com `artifact_id` no
        lugar de `item_id`."""
        artifact, root = await _artifact_and_root(artifact_id)
        payload = await file_serving.content_payload(root, artifact["path"])
        return {"artifact_id": artifact_id, **payload}

    @router.get("/api/artifacts/{artifact_id}/f/{file_path:path}")
    async def artifact_file(artifact_id: str, file_path: str, download: bool = False):
        """O arquivo do artefato E seus vizinhos do mesmo projeto (o HTML pede
        `style.css` relativo). Mesmas regras de `/api/viewer/{item_id}/f/`."""
        _, root = await _artifact_and_root(artifact_id)
        return await file_serving.file_response(root, file_path, download)

    return router
