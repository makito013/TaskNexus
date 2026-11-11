"""The claude.ai connectors of an agent: what the account offers (the probe) and which of them
the agent may use (the allowlist). Used by `ChatService`, which stays the facade `api.py` calls.

The collaborators come in as callables the service binds late (the instance's own attributes are
swapped by tests and by `main.py` after construction).
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import time
from typing import Any, Awaitable, Callable

from . import availability, connectors
from .agents import expanded_env
from .config import ChatConfig
from .engine import ChatEngine, ChatSpec, ConnectorPolicy, EngineUnavailable, ResumeFailed, SpawnFailed
from .errors import ChatError, public_detail
from .manager import ChatManager
from .store import ChatStore

logger = logging.getLogger(__name__)

PROBE_TIMEOUT_SECONDS = 60.0


class ConnectorAdmin:
    def __init__(
        self,
        *,
        chat_store: ChatStore,
        manager: ChatManager,
        config: ChatConfig,
        agent_exists: Callable[[str], bool],
        resolve_agent: Callable[[str, str | None], Any],
        engine_factory: Callable[[], ChatEngine],
        resolve_cli: Callable[[Any], Awaitable[availability.CliInfo]],
        require_sdk: Callable[[], None],
    ):
        self.chat_store = chat_store
        self.manager = manager
        self.config = config
        self._agent_exists = agent_exists
        self._resolve_agent = resolve_agent
        self._engine_factory = engine_factory
        self._resolve_cli = resolve_cli
        self._require_sdk = require_sdk
        self._probe_locks: dict[str, asyncio.Lock] = {}

    def _require_agent(self, agent_id: str) -> None:
        if not self._agent_exists(agent_id):
            raise ChatError("agent_not_found")

    async def get(self, agent_id: str) -> dict:
        self._require_agent(agent_id)
        settings = await self.chat_store.get_agent_settings(agent_id)
        allowed = set(settings["mcp_allowlist"])
        return {
            "agent_id": agent_id, "allowlist": settings["mcp_allowlist"],
            # Names only: never a URL, an id or a credential.
            "known": [{"name": c["name"], "allowed": c["name"] in allowed} for c in settings["known_connectors"]],
            "probed_at": settings["connectors_probed_at"],
        }

    async def put(self, agent_id: str, allowlist: list) -> dict:
        self._require_agent(agent_id)
        if not isinstance(allowlist, list):
            raise ChatError("invalid_name", "allowlist must be a list of names")
        names = []
        for name in allowlist:
            try:
                names.append(connectors.validate_connector_name(name))
            except connectors.InvalidConnectorName as exc:
                raise ChatError("invalid_name", str(exc)) from None
        settings = await self.chat_store.get_agent_settings(agent_id)
        known = {c["name"] for c in settings["known_connectors"]}
        unknown = [n for n in names if n not in known]
        if unknown:
            raise ChatError("unknown_connector", "refresh the list first: that connector was not discovered")
        await self.chat_store.put_agent_settings(agent_id, mcp_allowlist=list(dict.fromkeys(names)))
        return await self.get(agent_id)

    async def refresh(self, agent_id: str) -> dict:
        self._require_agent(agent_id)
        self._require_sdk()
        lock = self._probe_locks.setdefault(agent_id, asyncio.Lock())
        if lock.locked():
            async with lock:  # single-flight: wait for the probe in progress, reuse its result
                return await self.get(agent_id)
        async with lock:
            if len(self.manager.active()) >= self.manager.max_processes:
                raise ChatError("capacity_exceeded", "too many conversations are running")
            # An empty project ref means "any project": the probe is about the account, not a project.
            _, agent = self._resolve_agent("", agent_id)
            cli = await self._resolve_cli(agent)
            if not cli.ok:
                raise ChatError("probe_failed", public_detail(cli.detail))
            scratch = tempfile.mkdtemp(prefix="tn-chat-probe-")
            try:
                spec = ChatSpec(
                    cli_path=cli.path, cwd=scratch, env=expanded_env(agent),
                    connector_policy=ConnectorPolicy(probe=True), connect_timeout=self.config.connect_timeout,
                )
                found = await asyncio.wait_for(
                    connectors.probe(self._engine_factory(), spec), PROBE_TIMEOUT_SECONDS
                )
            except Exception as exc:  # noqa: BLE001 - whatever the probe hits is a failed probe, never a 500
                if not isinstance(exc, (SpawnFailed, ResumeFailed, EngineUnavailable, asyncio.TimeoutError, OSError)):
                    logger.warning("chat: connector probe failed (%s)", type(exc).__name__)
                raise ChatError("probe_failed", public_detail(getattr(exc, "detail", exc) or type(exc).__name__)) from exc
            finally:
                shutil.rmtree(scratch, ignore_errors=True)
            await self.chat_store.put_agent_settings(
                agent_id, known_connectors=found, connectors_probed_at=time.time()
            )
        return await self.get(agent_id)
