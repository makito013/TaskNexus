"""Routes of the workspace registry (V3, trilha 1).

Same shape as viewer_api.py: a service with injected dependencies plus a
router FACTORY, because main.py is reloaded by the tests and the router must be
rebuilt with the fresh instances (no import back into main).

This phase only reads (`GET /api/workspaces`); the write routes arrive with the
folder validation in a later phase. `scan` and `get_global_agents` are injected
now so the service keeps one constructor across phases.
"""
from __future__ import annotations

import asyncio
import os
from typing import Callable

from fastapi import APIRouter, Query

from app.models import Agent, Project, WorkspacesResponse
from app.workspace_keys import is_synthetic_key
from app.workspace_store import WorkspaceStore


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

    async def list_workspaces(self, include_archived: bool) -> dict:
        registry = await self.store.list_registry(include_archived)
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


def create_workspaces_router(service: WorkspaceService) -> APIRouter:
    router = APIRouter()

    @router.get("/api/workspaces", response_model=WorkspacesResponse)
    async def list_workspaces(include_archived: int = Query(0, ge=0, le=1)):
        return await service.list_workspaces(bool(include_archived))

    return router
