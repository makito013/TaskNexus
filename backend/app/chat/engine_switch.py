"""Switching a conversation between the terminal (PTY) and the chat, with the best-effort import
of the terminal's history. Used by `ChatService`, which stays the facade `api.py` calls.

The collaborators come in as callables the service binds late (the instance's own attributes are
swapped by tests and by `main.py` after construction).
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from . import history_import
from .agents import expanded_env, require_chat_capable
from .engine import SpawnFailed, is_valid_session_id
from .errors import ChatError, public_detail
from .hub import SessionHub
from .manager import ChatManager
from .store import ChatStore


def split_key(key: str) -> tuple[str, str]:
    """`project::agent` or `project::agent::suffix` (a V2 key may carry a suffix): the first
    two parts. A project ref never holds `::` (synthetic keys do not produce it)."""
    parts = key.split("::")
    return (parts[0], parts[1]) if len(parts) >= 2 else (key, "")


class EngineSwitcher:
    def __init__(
        self,
        *,
        store: Any,
        chat_store: ChatStore,
        manager: ChatManager,
        session_lock: Callable[[str], Any],
        resolve_agent: Callable[[str, str | None], Any],
        resolve_project: Callable[[str, str], tuple[str, list[str], list[str]]],
        pty_evict: Callable[[str], Awaitable[None]],
        history_reader: Callable[[str, str], list],
        hub: Callable[[str], SessionHub],
        require_sdk: Callable[[], None],
    ):
        self.store = store
        self.chat_store = chat_store
        self.manager = manager
        self._session_lock = session_lock
        self._resolve_agent = resolve_agent
        self._resolve_project = resolve_project
        self._pty_evict = pty_evict
        self._history_reader = history_reader
        self._hub = hub
        self._require_sdk = require_sdk

    async def switch(self, key: str, target: str, confirm: bool = False) -> dict:
        if target not in ("chat", "pty"):
            raise ChatError("invalid_engine", "engine must be chat or pty")
        if target == "chat":
            return await self._to_chat(key, confirm)
        return await self._to_pty(key)

    async def _to_chat(self, key: str, confirm: bool) -> dict:
        if not confirm:
            raise ChatError("confirmation_required", "confirm the switch to the chat")
        self._require_sdk()
        async with self._session_lock(key):
            engine = await self.store.get_engine(key)
            if engine is None:
                raise ChatError("session_not_found")
            if engine == "chat":
                raise ChatError("engine_conflict", "already a chat")
            row = await self.chat_store.get_chat_session(key)
            project_ref, agent_id = (row["project_ref"], row["agent_id"]) if row else split_key(key)
            _, agent = self._resolve_agent(project_ref, agent_id)
            if agent is None or agent.id != agent_id:
                raise ChatError("agent_not_found")
            require_chat_capable(agent)
            try:
                cwd, add_dirs, _ = self._resolve_project(project_ref, agent_id)
            except SpawnFailed as exc:
                # Before touching the terminal: a switch that cannot succeed must not kill it.
                raise ChatError("folder_unavailable", public_detail(exc.detail)) from exc
            await self._pty_evict(key)
            if row is None:
                await self.chat_store.create_chat_session({
                    "session_key": key, "project_ref": project_ref, "agent_id": agent_id, "cwd": cwd,
                    "add_dirs": add_dirs, "origin": "imported_from_pty", "status": "stopped",
                })
            else:
                await self.chat_store.update_chat_session(
                    key, status="stopped", origin="imported_from_pty", cwd=cwd, add_dirs=add_dirs
                )
            history = await self._import_history(key, cwd, agent)
            await self.store.set_engine(key, "chat")
            return {"engine": "chat", "history": history}

    async def _import_history(self, key: str, cwd: str, agent) -> dict:
        claude_id = await self.store.get(key)
        hub = self._hub(key)
        try:
            if not is_valid_session_id(claude_id):
                raise history_import.ImportFailed("no_session")
            known = await self.chat_store.logged_conversation(key)
            events = await history_import.import_history(
                claude_id, cwd, expanded_env(agent), reader=self._history_reader, known=known
            )
        except history_import.ImportFailed as exc:
            await hub.publish("history.import_failed", {"reason": exc.reason})
            return {"failed": exc.reason}
        for event in events:
            await hub.publish(event.kind, event.payload)
        await hub.publish("history.imported", {"count": len(events)})
        return {"imported": len(events)}

    async def _to_pty(self, key: str) -> dict:
        async with self._session_lock(key):
            if await self.store.get_engine(key) is None:
                raise ChatError("session_not_found")
            if await self.store.get_engine(key) != "chat":
                raise ChatError("engine_conflict", "not a chat")
            await self.manager.close(key, "switched_to_pty")
            await self.store.set_engine(key, "pty")
            # The chat data stays for a later switch back; the V2 terminate reads this mark to
            # know the key still has some to erase (it never touches the chat store otherwise).
            await self.store.mark_was_chat(key)
            if await self.chat_store.get_chat_session(key) is not None:
                await self.chat_store.update_chat_session(key, status="switched_to_pty")
            return {"engine": "pty", "history": None}
