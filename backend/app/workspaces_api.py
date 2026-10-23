"""Routes of the workspace registry (V3, trilha 1).

Same shape as viewer_api.py: a service with injected dependencies plus a
router FACTORY, because main.py is reloaded by the tests and the router must be
rebuilt with the fresh instances (no import back into main).

Read: `GET /api/workspaces`, `GET /api/folders/discover`,
`POST /api/folders/inspect` (read-only despite the verb).
Write: create/rename/archive workspaces, create/edit/archive projects with
their folders. There is no DELETE anywhere (ADR-29): rows are archived.

Every folder typed by the user goes through `folder_validation` first; the
store only guarantees structural integrity. Disk work (realpath, isdir, the
3 s folder scan) always runs in a worker thread.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Callable

from fastapi import APIRouter, HTTPException, Query

from app.folder_validation import (
    MAX_FOLDERS_PER_PROJECT,
    FolderPolicy,
    FolderProblem,
    FolderValidationError,
    default_policy,
    is_or_inside,
    normalize_name,
    problem,
    validate_folder_path,
)
from app.models import (
    Agent,
    DiscoverEntry,
    DiscoverResponse,
    FolderInspectRequest,
    FolderWarning,
    InspectResponse,
    InspectResult,
    NestedRef,
    Project,
    ProjectCreateRequest,
    ProjectFolderIn,
    ProjectMutationResponse,
    ProjectUpdateRequest,
    ProjectUpdateResponse,
    RegistryProjectRef,
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspacesResponse,
    WorkspaceUpdateRequest,
)
from app.workspace_keys import has_reserved_segment, is_synthetic_key, workspace_key_of
from app.workspace_store import (
    RegistryConflictError,
    RegistryNotFoundError,
    RegistrySnapshot,
    RegistryValidationError,
    WorkspaceStore,
)

_MARKER_DIRS = (".claude", ".codex", ".gemini")

CONFLICT_MESSAGES = {
    "workspace_archived": (
        "Este workspace está arquivado. Desarquive-o antes de adicionar projetos."
    ),
    "primary_locked": (
        "A pasta principal está travada. A V2 ainda abre as sessões deste projeto nela, "
        "e V2 e V3 compartilham a mesma conversa. Ela destrava quando a V3 substituir "
        "a V2. Você pode renomear o projeto, adicionar ou tirar pastas extras e arquivar."
    ),
    "adopt_conflict": (
        'Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".'
    ),
}
_WORKSPACE_ADOPT_ARCHIVED = (
    'Esse workspace já existe arquivado. Desarquive-o em "Mostrar arquivados".'
)
_WORKSPACE_ADOPT_EXISTS = "Já existe um workspace com esse nome de cliente."
_WORKSPACE_ADOPT_UNKNOWN = "A V2 não conhece nenhum cliente com esse nome."


def _canonical(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def _http_400(problems: list[dict]) -> HTTPException:
    message = problems[0]["message"] if problems else "Dados inválidos."
    return HTTPException(
        status_code=400, detail={"message": message, "problems": problems}
    )


def _problem_dict(item: FolderProblem, path: str | None = None) -> dict:
    return {"path": path, "code": item.code, "message": item.message}


def _http_409(code: str, message: str | None = None, **extra) -> HTTPException:
    detail = {"code": code, "message": message or CONFLICT_MESSAGES.get(code, code)}
    detail.update(extra)
    return HTTPException(status_code=409, detail=detail)


def _from_store_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RegistryValidationError):
        return _http_400([
            {"path": p.get("path"), "code": p.get("code", "invalid"),
             "message": p.get("message", "Dados inválidos.")}
            for p in exc.problems
        ])
    if isinstance(exc, RegistryConflictError):
        extra = dict(exc.detail)
        if exc.code == "adopt_conflict" and "project_id" in extra:
            extra["archived_project_id"] = extra.pop("project_id")
        return _http_409(exc.code, **extra)
    if isinstance(exc, RegistryNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    raise exc


class _PreparedFolders:
    """Result of validating a project's name/folder list (thread-safe data)."""

    def __init__(self, name, specs, primary_canonical, problems, policy_root):
        self.name: str | None = name
        self.specs: list[dict] = specs  # {path, canonical_path, is_primary, input}
        self.primary_canonical: str | None = primary_canonical
        self.problems: list[dict] = problems
        self.projects_root: str = policy_root


def _prepare_name(raw: str, problems: list[dict]) -> str | None:
    try:
        return normalize_name(raw)
    except FolderValidationError as exc:
        problems.extend(_problem_dict(p) for p in exc.problems)
        return None


def _prepare_folders(
    folders: list[ProjectFolderIn], policy: FolderPolicy, problems: list[dict]
) -> tuple[list[dict], str | None]:
    """Validate every typed folder, accumulating problems per input path.
    Returns (specs, primary canonical path). Runs in a worker thread."""
    if not folders:
        problems.append(_problem_dict(problem("no_folders")))
        return [], None
    if len(folders) > MAX_FOLDERS_PER_PROJECT:
        problems.append(_problem_dict(problem("too_many_folders")))
        return [], None
    if sum(1 for f in folders if f.is_primary) > 1:
        problems.append(_problem_dict(problem("multiple_primary")))
        return [], None
    primary_index = next((i for i, f in enumerate(folders) if f.is_primary), 0)
    specs: list[dict] = []
    seen: set[str] = set()
    primary_canonical: str | None = None
    for index, folder in enumerate(folders):
        try:
            validated = validate_folder_path(folder.path, policy)
        except FolderValidationError as exc:
            problems.extend(_problem_dict(p, folder.path) for p in exc.problems)
            continue
        if validated.canonical_path in seen:
            problems.append(_problem_dict(problem("duplicate_in_project"), folder.path))
            continue
        seen.add(validated.canonical_path)
        specs.append({
            "path": validated.path,
            "canonical_path": validated.canonical_path,
            "is_primary": index == primary_index,
            "input": folder.path,
        })
        if index == primary_index:
            primary_canonical = validated.canonical_path
    return specs, primary_canonical


class WorkspaceService:
    def __init__(
        self,
        store: WorkspaceStore,
        get_projects_root: Callable[[], str],
        scan: Callable[[], list[Project]],
        get_global_agents: Callable[[], list[Agent]],
    ):
        self.store = store
        self.get_projects_root = get_projects_root
        self.scan = scan
        self.get_global_agents = get_global_agents

    # -- policy -------------------------------------------------------------

    def policy(self) -> FolderPolicy:
        """Recomputed on every call: the projects root changes at runtime.
        Does disk work (realpath), so call it from a worker thread."""
        return default_policy(self.get_projects_root())

    # -- reads --------------------------------------------------------------

    async def _annotate(self, registry: dict) -> dict:
        paths = [
            folder["path"]
            for workspace in registry["workspaces"]
            for project in workspace["projects"]
            for folder in project["folders"]
        ]
        # One thread hop for every folder: a slow or disconnected drive must
        # not block the event loop.
        existing = await asyncio.to_thread(
            lambda: {path: os.path.isdir(path) for path in paths}
        )
        for workspace in registry["workspaces"]:
            for project in workspace["projects"]:
                project["primary_locked"] = not is_synthetic_key(project["key"])
                for folder in project["folders"]:
                    folder["exists"] = existing[folder["path"]]
        return registry

    async def list_workspaces(self, include_archived: bool) -> dict:
        return await self._annotate(await self.store.list_registry(include_archived))

    async def _workspace_out(self, workspace_id: int) -> dict:
        registry = await self._annotate(await self.store.list_registry(True))
        return next(w for w in registry["workspaces"] if w["id"] == workspace_id)

    async def _project_out(self, workspace_id: int, project_id: int) -> dict:
        workspace = await self._workspace_out(workspace_id)
        return next(p for p in workspace["projects"] if p["id"] == project_id)

    # -- shared helpers -----------------------------------------------------

    @staticmethod
    def _ref(snapshot: RegistrySnapshot, project_id: int) -> dict | None:
        project = snapshot.project_by_id.get(project_id)
        if project is None:
            return None
        workspace = snapshot.workspace_by_id.get(project.workspace_id)
        if workspace is None:
            return None
        return {
            "project_id": project.id,
            "project_name": project.name,
            "workspace_id": workspace.id,
            "workspace_name": workspace.name,
            "archived": project.archived or workspace.archived,
        }

    def _used_by(
        self, snapshot: RegistrySnapshot, canonical: str, exclude: int | None = None
    ) -> list[dict]:
        refs: list[dict] = []
        seen: set[int] = set()
        for project_id, _folder_id in snapshot.folder_canonical_index.get(canonical, ()):
            if project_id == exclude or project_id in seen:
                continue
            seen.add(project_id)
            ref = self._ref(snapshot, project_id)
            if ref is not None:
                refs.append(ref)
        return refs

    def _nested_in(
        self, snapshot: RegistrySnapshot, canonical: str, exclude: int | None = None
    ) -> list[dict]:
        """Registered folders that contain / are contained by `canonical`
        (equal paths are `used_by`, not nested)."""
        found: dict[tuple[int, str], dict] = {}
        for other, refs in snapshot.folder_canonical_index.items():
            if other == canonical:
                continue
            if is_or_inside(canonical, other):
                relation = "inside"
            elif is_or_inside(other, canonical):
                relation = "contains"
            else:
                continue
            for project_id, _folder_id in refs:
                if project_id == exclude or (project_id, relation) in found:
                    continue
                ref = self._ref(snapshot, project_id)
                if ref is not None:
                    found[(project_id, relation)] = {**ref, "relation": relation}
        return list(found.values())

    def _warnings(
        self,
        snapshot: RegistrySnapshot,
        specs: list[dict],
        exclude_project_id: int | None = None,
    ) -> list[FolderWarning]:
        warnings: list[FolderWarning] = []
        for spec in specs:
            used = self._used_by(snapshot, spec["canonical_path"], exclude_project_id)
            if used:
                warnings.append(FolderWarning(
                    path=spec["input"], code="already_used",
                    projects=[RegistryProjectRef(**ref) for ref in used],
                ))
            for relation in ("inside", "contains"):
                nested = [
                    n for n in self._nested_in(
                        snapshot, spec["canonical_path"], exclude_project_id
                    )
                    if n["relation"] == relation
                ]
                if nested:
                    warnings.append(FolderWarning(
                        path=spec["input"], code="nested", relation=relation,
                        projects=[
                            RegistryProjectRef(**{k: v for k, v in n.items() if k != "relation"})
                            for n in nested
                        ],
                    ))
        return warnings

    def _name_in_use_warning(
        self,
        snapshot: RegistrySnapshot,
        workspace_id: int,
        name: str,
        exclude_project_id: int | None = None,
    ) -> list[FolderWarning]:
        wanted = name.casefold()
        twins = [
            p for p in snapshot.projects_by_workspace_id.get(workspace_id, ())
            if not p.archived and p.id != exclude_project_id and p.name.casefold() == wanted
        ]
        if not twins:
            return []
        refs = [self._ref(snapshot, p.id) for p in twins]
        return [FolderWarning(
            code="name_in_use",
            projects=[RegistryProjectRef(**ref) for ref in refs if ref is not None],
        )]

    def _scan_blocking(self) -> list[Project]:
        return list(self.scan())

    # -- workspaces ---------------------------------------------------------

    async def create_workspace(self, body: WorkspaceCreateRequest) -> dict:
        problems: list[dict] = []
        name = _prepare_name(body.name, problems)
        if problems:
            raise _http_400(problems)
        adopt_key = body.adopt_legacy_key
        if adopt_key is not None:
            # Same guard as the store, answered before paying for a scan.
            if has_reserved_segment(adopt_key) or "/" in adopt_key or not adopt_key:
                raise _http_400([{
                    "path": None, "code": "invalid_key",
                    "message": "A chave adotada precisa ser a de um cliente legado.",
                }])
            if adopt_key in self.store.snapshot.workspace_by_key:
                existing = self.store.snapshot.workspace_by_key[adopt_key]
                raise _http_409(
                    "adopt_conflict",
                    _WORKSPACE_ADOPT_ARCHIVED if existing.archived else _WORKSPACE_ADOPT_EXISTS,
                    archived=existing.archived, workspace_id=existing.id,
                )
            scanned = await asyncio.to_thread(self._scan_blocking)
            if not any(p.elegivel and workspace_key_of(p.id) == adopt_key for p in scanned):
                raise _http_409(
                    "adopt_conflict", _WORKSPACE_ADOPT_UNKNOWN, reason="not_in_scan"
                )
        try:
            row = await self.store.create_workspace(name, adopt_key=adopt_key)
        except RegistryConflictError as exc:
            # The store re-checks under its lock, so a concurrent adoption of
            # the same client key lands here after the snapshot check above
            # passed. Answer with the workspace wording, never the project one.
            if exc.code == "adopt_conflict":
                archived = bool(exc.detail.get("archived"))
                raise _http_409(
                    "adopt_conflict",
                    _WORKSPACE_ADOPT_ARCHIVED if archived else _WORKSPACE_ADOPT_EXISTS,
                    archived=archived, workspace_id=exc.detail.get("workspace_id"),
                )
            raise _from_store_error(exc)
        except RegistryValidationError as exc:
            raise _from_store_error(exc)
        return {"workspace": await self._workspace_out(row.id)}

    async def update_workspace(self, workspace_id: int, body: WorkspaceUpdateRequest) -> dict:
        if workspace_id not in self.store.snapshot.workspace_by_id:
            raise HTTPException(status_code=404, detail=f"workspace {workspace_id} not found")
        problems: list[dict] = []
        name = _prepare_name(body.name, problems) if body.name is not None else None
        if problems:
            raise _http_400(problems)
        try:
            await self.store.update_workspace(workspace_id, name=name, archived=body.archived)
        except (RegistryValidationError, RegistryNotFoundError) as exc:
            raise _from_store_error(exc)
        return {"workspace": await self._workspace_out(workspace_id)}

    # -- projects -----------------------------------------------------------

    def _prepare_project_input_blocking(
        self, raw_name: str | None, folders: list[ProjectFolderIn] | None
    ) -> _PreparedFolders:
        """Name + folder validation + policy, all in one thread hop."""
        problems: list[dict] = []
        name = _prepare_name(raw_name, problems) if raw_name is not None else None
        policy = self.policy()
        specs: list[dict] = []
        primary: str | None = None
        if folders is not None:
            specs, primary = _prepare_folders(folders, policy, problems)
        return _PreparedFolders(name, specs, primary, problems, policy.projects_root)

    def _find_adoptable_key(self, primary_canonical: str, workspace_key: str) -> str | None:
        """Legacy key whose scan folder IS the primary folder (condition 4 of
        the adoption rule); only keys of this workspace qualify (condition 2).
        Runs in a worker thread: the scan is the expensive part."""
        for scanned in sorted(self.scan(), key=lambda p: p.id):
            if not scanned.elegivel or workspace_key_of(scanned.id) != workspace_key:
                continue
            if _canonical(scanned.path) == primary_canonical:
                return scanned.id
        return None

    async def create_project(self, workspace_id: int, body: ProjectCreateRequest) -> dict:
        snapshot = self.store.snapshot
        workspace = snapshot.workspace_by_id.get(workspace_id)
        if workspace is None:
            raise HTTPException(status_code=404, detail=f"workspace {workspace_id} not found")
        if workspace.archived:
            raise _http_409("workspace_archived", workspace_id=workspace_id)

        prepared = await asyncio.to_thread(
            self._prepare_project_input_blocking, body.name, body.folders
        )
        if prepared.problems:
            raise _http_400(prepared.problems)

        # Adoption (section 2.8). Only a primary folder inside PROJECTS_ROOT can
        # match a scan id, so anything else skips the ~3 s scan entirely
        # (TL-7); a synthetic workspace (".wN") can never own a legacy key.
        adopt_key: str | None = None
        if (
            not has_reserved_segment(workspace.key)
            and is_or_inside(prepared.primary_canonical, prepared.projects_root)
        ):
            candidate = await asyncio.to_thread(
                self._find_adoptable_key, prepared.primary_canonical, workspace.key
            )
            if candidate is not None:
                existing = snapshot.project_by_key.get(candidate)
                if existing is None:
                    adopt_key = candidate
                elif existing.archived:
                    raise _http_409("adopt_conflict", archived_project_id=existing.id)
                # An ACTIVE project already owns the legacy key: no adoption,
                # the new project gets a synthetic key (and an `already_used`
                # warning below, since the folder is the same).

        store_specs = [
            {k: spec[k] for k in ("path", "canonical_path", "is_primary")}
            for spec in prepared.specs
        ]
        try:
            row = await self.store.create_project(
                workspace_id, prepared.name, store_specs, adopt_key=adopt_key
            )
        except RegistryConflictError as exc:
            if exc.code != "adopt_conflict" or adopt_key is None or exc.detail.get("archived"):
                raise _from_store_error(exc)
            # Lost a race: while the validation/scan above ran, another request
            # registered the legacy key as an ACTIVE project. Same outcome as the
            # sequential order: no adoption, synthetic key, and warnings computed
            # on a fresh snapshot so the new owner shows up as `already_used`.
            adopt_key = None
            snapshot = self.store.snapshot
            try:
                row = await self.store.create_project(
                    workspace_id, prepared.name, store_specs, adopt_key=None
                )
            except (RegistryValidationError, RegistryConflictError, RegistryNotFoundError) as retry_exc:
                raise _from_store_error(retry_exc)
        except (RegistryValidationError, RegistryNotFoundError) as exc:
            raise _from_store_error(exc)
        # Warnings are computed against the registry as it was BEFORE this
        # project, so it never warns about itself.
        warnings = self._warnings(snapshot, prepared.specs)
        warnings += self._name_in_use_warning(snapshot, workspace_id, prepared.name)
        return {
            "project": await self._project_out(workspace_id, row.id),
            "adopted_legacy_key": adopt_key,
            "warnings": warnings,
        }

    async def update_project(self, project_id: int, body: ProjectUpdateRequest) -> dict:
        snapshot = self.store.snapshot
        current = snapshot.project_by_id.get(project_id)
        if current is None:
            raise HTTPException(status_code=404, detail=f"project {project_id} not found")

        prepared = await asyncio.to_thread(
            self._prepare_project_input_blocking, body.name, body.folders
        )
        if prepared.problems:
            raise _http_400(prepared.problems)

        if body.folders is not None and not is_synthetic_key(current.key):
            # primary_locked (TL-5): the V2 still resolves this key by scanning,
            # so the primary folder must stay the one the scan finds.
            locked = snapshot.primary_folder(current.id)
            if locked is not None and prepared.primary_canonical != locked.canonical_path:
                raise _http_409("primary_locked")

        store_specs = (
            [{k: s[k] for k in ("path", "canonical_path", "is_primary")} for s in prepared.specs]
            if body.folders is not None else None
        )
        try:
            await self.store.update_project(
                project_id, name=prepared.name, folders=store_specs, archived=body.archived
            )
        except (RegistryValidationError, RegistryConflictError, RegistryNotFoundError) as exc:
            raise _from_store_error(exc)

        warnings = self._warnings(snapshot, prepared.specs, exclude_project_id=project_id)
        if prepared.name is not None:
            warnings += self._name_in_use_warning(
                snapshot, current.workspace_id, prepared.name, exclude_project_id=project_id
            )
        return {
            "project": await self._project_out(current.workspace_id, project_id),
            "warnings": warnings,
        }

    # -- folders ------------------------------------------------------------

    def _discover_blocking(self) -> tuple[list[Project], dict[str, str], int]:
        started = time.perf_counter()
        scanned = [p for p in self.scan() if p.elegivel]
        canonical = {p.id: _canonical(p.path) for p in scanned}
        return scanned, canonical, int((time.perf_counter() - started) * 1000)

    async def discover(self) -> dict:
        scanned, canonical, elapsed_ms = await asyncio.to_thread(self._discover_blocking)
        snapshot = self.store.snapshot  # read AFTER the scan: the freshest view
        entries = []
        for project in sorted(scanned, key=lambda p: p.id):
            client = workspace_key_of(project.id)
            adoptable = None
            if project.id not in snapshot.project_by_key:
                workspace = snapshot.workspace_by_key.get(client)
                adoptable = workspace.id if workspace is not None else None
            entries.append(DiscoverEntry(
                legacy_key=project.id,
                name=project.nome,
                path=project.path,
                client_key=client,
                used_by=[
                    RegistryProjectRef(**ref)
                    for ref in self._used_by(snapshot, canonical[project.id])
                ],
                adoptable_into_workspace_id=adoptable,
            ))
        return DiscoverResponse(
            root=self.get_projects_root(), scanned_in_ms=elapsed_ms, entries=entries
        ).model_dump()

    def _inspect_blocking(self, paths: list[str]) -> list[tuple]:
        policy = self.policy()
        out = []
        for raw in paths:
            try:
                validated = validate_folder_path(raw, policy)
            except FolderValidationError as exc:
                out.append((raw, exc, None))
                continue
            has_marker = any(
                os.path.isdir(os.path.join(validated.canonical_path, m)) for m in _MARKER_DIRS
            )
            out.append((raw, validated, has_marker))
        return out

    async def inspect(self, body: FolderInspectRequest) -> dict:
        checked = await asyncio.to_thread(self._inspect_blocking, body.paths)
        snapshot = self.store.snapshot
        exclude = body.exclude_project_id
        results = []
        for raw, outcome, has_marker in checked:
            if isinstance(outcome, FolderValidationError):
                results.append(InspectResult(
                    input=raw, ok=False,
                    problems=[{"code": p.code, "message": p.message} for p in outcome.problems],
                ))
                continue
            canonical = outcome.canonical_path
            in_this_project = exclude is not None and any(
                project_id == exclude
                for project_id, _ in snapshot.folder_canonical_index.get(canonical, ())
            )
            results.append(InspectResult(
                input=raw, path=outcome.path, ok=True,
                used_by=[
                    RegistryProjectRef(**ref)
                    for ref in self._used_by(snapshot, canonical, exclude)
                ],
                in_this_project=in_this_project,
                nested_in=[
                    NestedRef(**ref) for ref in self._nested_in(snapshot, canonical, exclude)
                ],
                has_marker=bool(has_marker),
            ))
        return InspectResponse(results=results).model_dump()


def create_workspaces_router(service: WorkspaceService) -> APIRouter:
    router = APIRouter()

    @router.get("/api/workspaces", response_model=WorkspacesResponse)
    async def list_workspaces(include_archived: int = Query(0, ge=0, le=1)):
        return await service.list_workspaces(bool(include_archived))

    @router.post("/api/workspaces", response_model=WorkspaceResponse, status_code=201)
    async def create_workspace(body: WorkspaceCreateRequest):
        return await service.create_workspace(body)

    @router.patch("/api/workspaces/{workspace_id}", response_model=WorkspaceResponse)
    async def update_workspace(workspace_id: int, body: WorkspaceUpdateRequest):
        return await service.update_workspace(workspace_id, body)

    @router.post(
        "/api/workspaces/{workspace_id}/projects",
        response_model=ProjectMutationResponse,
        status_code=201,
    )
    async def create_project(workspace_id: int, body: ProjectCreateRequest):
        return await service.create_project(workspace_id, body)

    @router.patch("/api/workspace-projects/{project_id}", response_model=ProjectUpdateResponse)
    async def update_project(project_id: int, body: ProjectUpdateRequest):
        return await service.update_project(project_id, body)

    @router.get("/api/folders/discover", response_model=DiscoverResponse)
    async def discover_folders():
        return await service.discover()

    @router.post("/api/folders/inspect", response_model=InspectResponse)
    async def inspect_folders(body: FolderInspectRequest):
        return await service.inspect(body)

    return router
