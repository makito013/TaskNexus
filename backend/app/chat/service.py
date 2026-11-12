"""`ChatService`: what `main.py` injects (stores, project/agent resolution, the PTY side) and
what `api.py` calls. The `chat` package never imports `main` (the dependencies come in
through the constructor), and it never imports the SDK (`sdk_engine` does, lazily).
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import availability, commands, sdk_engine
from .agents import NOT_CHAT_CAPABLE_MESSAGE, expanded_env, require_chat_capable
from .config import ChatConfig
from .connector_admin import ConnectorAdmin
from .engine import (
    ALLOWED_PERMISSION_MODES,
    ChatEngine,
    ChatSpec,
    ConnectorPolicy,
    EngineUnavailable,
    ResumeFailed,
    SpawnFailed,
    is_valid_session_id,
)
from .engine_switch import EngineSwitcher
from .errors import ChatCommandError, ChatError, public_detail, public_last_error
from .hub import Reader, SessionHub
from .manager import ChatManager, ClosedWhileStarting
from .runtime import MAX_SEND_CHARS, ChatRuntime, InitInfo, RuntimeHooks
from .store import ChatStore

logger = logging.getLogger(__name__)

_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"
RESOLVE_TIMEOUT_SECONDS = 15.0


class ChatService:
    def __init__(
        self,
        *,
        store,
        chat_store: ChatStore,
        manager: ChatManager,
        engine_factory: Callable[[], ChatEngine],
        cli_resolver: availability.CliResolver,
        resolve_project: Callable[[str, str], tuple[str, list[str], list[str]]],
        resolve_agent: Callable[[str, str | None], Any],
        agent_exists: Callable[[str], bool],
        escritorio_mcp_servers: Callable[[str], dict],
        session_lock: Callable[[str], Any],
        pty_is_alive: Callable[[str], bool],
        pty_evict: Callable[[str], Awaitable[None]],
        mark_needs_attention: Callable[[str], Awaitable[None]],
        dispatch_push: Callable[[str], Awaitable[Any]],
        ack: Callable[[str], Awaitable[None]],
        sdk_status: Callable[[], availability.SdkStatus] = availability.sdk_status,
        config: ChatConfig | None = None,
        history_reader: Callable[[str, str], list] = sdk_engine.read_session_messages,
        command_catalog: commands.CommandCatalog | None = None,
    ):
        self.store = store
        self.chat_store = chat_store
        self.manager = manager
        self.engine_factory = engine_factory
        self.cli_resolver = cli_resolver
        self.resolve_project = resolve_project
        self.resolve_agent = resolve_agent
        self.agent_exists = agent_exists
        self.escritorio_mcp_servers = escritorio_mcp_servers
        self.session_lock = session_lock
        self.pty_is_alive = pty_is_alive
        self.pty_evict = pty_evict
        self.mark_needs_attention = mark_needs_attention
        self.dispatch_push = dispatch_push
        self.ack = ack
        self.sdk_status = sdk_status
        self.config = config or ChatConfig()
        self.history_reader = history_reader
        self.catalog = command_catalog or commands.CommandCatalog(chat_store, Path.home())
        self._hubs: dict[str, SessionHub] = {}
        self._background: set[asyncio.Task] = set()
        self._hooks = RuntimeHooks(
            on_stop=self.on_stop,
            on_permission_pending=self.on_permission_pending,
            on_all_decided=self.ack,
            on_session_id_changed=self.on_session_id_changed,
            on_closed=self._on_runtime_closed,
            state_payload=self.state_payload,
            on_init=self.on_init,
        )
        # The collaborators read the injected callables when they run, not when they are built:
        # tests and `main.py` swap these attributes on the instance after construction.
        self._connector_admin = ConnectorAdmin(
            chat_store=chat_store, manager=manager, config=self.config,
            agent_exists=lambda agent_id: self.agent_exists(agent_id),
            resolve_agent=lambda ref, agent_id: self.resolve_agent(ref, agent_id),
            engine_factory=lambda: self.engine_factory(),
            resolve_cli=self._resolve_cli, require_sdk=self._require_sdk,
        )
        self._engine_switcher = EngineSwitcher(
            store=store, chat_store=chat_store, manager=manager,
            session_lock=lambda key: self.session_lock(key),
            resolve_agent=lambda ref, agent_id: self.resolve_agent(ref, agent_id),
            resolve_project=lambda ref, agent_id: self.resolve_project(ref, agent_id),
            pty_evict=lambda key: self.pty_evict(key),
            history_reader=lambda claude_id, cwd: self.history_reader(claude_id, cwd),
            hub=self.hub, require_sdk=self._require_sdk,
        )

    # -- small helpers ----------------------------------------------------------------------------

    def hub(self, session_key: str) -> SessionHub:
        hub = self._hubs.get(session_key)
        if hub is None:
            hub = self._hubs[session_key] = SessionHub(session_key, self.chat_store)
        return hub

    def _spawn_task(self, coro) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    def _on_runtime_closed(self, session_key: str, runtime: ChatRuntime) -> None:
        self.manager.forget(session_key, runtime)

    def _require_sdk(self) -> None:
        status = self.sdk_status()
        if not status.available:
            raise ChatError("engine_unavailable", public_detail(status.detail) or "the chat engine is not installed")

    async def _resolve_cli(self, agent) -> availability.CliInfo:
        """`resolve` blocks (it runs `--version`): a thread, with a limit of its own."""
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self.cli_resolver.resolve, agent), RESOLVE_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            return availability.CliInfo(None, None, False, "cli_invalid", "resolving the binary timed out")

    # -- create / open ------------------------------------------------------------------------------

    async def create(
        self, project_ref: str, agent_id: str, model: str | None = None,
        permission_mode: str | None = None, first_message: str | None = None,
    ) -> dict:
        self._require_sdk()
        mode = permission_mode or "default"
        if mode not in ALLOWED_PERMISSION_MODES:
            raise ChatError("mode_not_allowed", "only default, acceptEdits and plan are allowed")
        if model is not None:
            await self._require_model_in_catalog(model)
        if first_message is not None and len(first_message) > MAX_SEND_CHARS:
            raise ChatError("first_message_too_long", f"first_message is at most {MAX_SEND_CHARS} characters")
        if first_message is not None:
            await self._reject_ui_command(first_message)
        project, agent = self.resolve_agent(project_ref, agent_id)
        if project is None:
            raise ChatError("project_not_found")
        if agent is None or agent.id != agent_id:
            raise ChatError("agent_not_found")
        require_chat_capable(agent)

        try:
            cwd, add_dirs, _ = self.resolve_project(project_ref, agent_id)
        except SpawnFailed:
            cwd, add_dirs = "", []  # the spawn will report folder_unavailable
        session_uuid = str(uuid.uuid4())
        while True:
            key = f"{project_ref}::{agent_id}::{''.join(secrets.choice(_BASE36) for _ in range(6))}"
            if await self.store.create_if_absent(key, session_uuid, "chat"):
                break
        await self.chat_store.create_chat_session({
            "session_key": key, "project_ref": project_ref, "agent_id": agent_id, "cwd": cwd,
            "add_dirs": add_dirs, "model": model, "permission_mode": mode,
        })
        self._spawn_task(self._start_in_background(key, first_message))
        return {"session_key": key, "status": "new"}

    async def _start_in_background(self, key: str, first_message: str | None) -> None:
        try:
            runtime = await self.ensure_runtime(key)
            if first_message:
                await runtime.submit("send", text=first_message, client_msg_id=None)
        except ChatCommandError as exc:
            await self._record_first_message_failure(key, exc)
        except ChatError:
            pass  # a failed start was recorded by ensure_runtime (status event and last_error)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: background start failed", key)

    async def _record_first_message_failure(self, key: str, exc: ChatCommandError) -> None:
        payload = {"code": "first_message_failed", "reason": exc.code, "detail": public_detail(exc.message)}
        try:
            await self.hub(key).publish("status", payload)
            await self.chat_store.update_chat_session(key, last_error=payload)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: could not record the failure of the first message", key)

    async def ensure_runtime(self, key: str) -> ChatRuntime:
        """The live runtime of a chat, starting (or resuming) it when needed. Under the same
        `session_lock` as the PTY path, so one key never has two engines (ADR-45)."""
        async with self.session_lock(key):
            existing = self.manager.get(key)
            if existing is not None:
                return existing
            row = await self.chat_store.get_chat_session(key)
            if row is None:
                raise ChatError("session_not_found")
            if await self.store.get_engine(key) != "chat" or self.pty_is_alive(key):
                raise ChatError("engine_conflict", "this conversation belongs to the terminal")
            self._require_sdk()
            try:
                return await self.manager.get_or_spawn(key, lambda: self._build_and_start(key))
            except (SpawnFailed, ResumeFailed) as exc:
                await self._record_failure(key, exc)
                raise ChatError(
                    "resume_failed" if isinstance(exc, ResumeFailed) else "spawn_failed",
                    public_detail(getattr(exc, "detail", "")),
                ) from exc
            except EngineUnavailable as exc:
                raise ChatError("engine_unavailable", public_detail(exc.detail)) from exc
            except ClosedWhileStarting as exc:
                raise ChatError(
                    "closed_while_starting", f"the conversation was closed ({exc.reason}) while starting"
                ) from exc

    async def _build_and_start(self, key: str) -> ChatRuntime:
        # Inside the manager's reservation now: a terminate that deleted the row before it was
        # taken is seen here, one that comes later waits for this start.
        row = await self.chat_store.get_chat_session(key)
        if row is None:
            raise ChatError("session_not_found")
        _, agent = self.resolve_agent(row["project_ref"], row["agent_id"])
        if agent is None or agent.id != row["agent_id"]:
            # No fallback to another agent: it would bring another env, prompt and allowlist.
            raise SpawnFailed("agent_unavailable", "the agent is not available for this project")
        if agent.ia != "claude":
            raise SpawnFailed("agent_not_chat_capable", NOT_CHAT_CAPABLE_MESSAGE)
        if len(agent.cmd or []) > 1:
            raise SpawnFailed("agent_cmd_args_unsupported", "the agent command has arguments the chat cannot apply")
        cli = await self._resolve_cli(agent)
        if not cli.ok:
            raise SpawnFailed(cli.reason or "cli_invalid", cli.detail or "")
        cwd, add_dirs, skipped = self.resolve_project(row["project_ref"], agent.id)

        settings = await self.chat_store.get_agent_settings(agent.id)
        policy = ConnectorPolicy(
            allowed=tuple(settings["mcp_allowlist"]), known=tuple(settings["known_connectors"])
        )

        stored_id = await self.store.get(key)
        # A reset gave the conversation a new id no transcript knows yet: only what came after
        # the last reset says whether the CLI has this id (a connect with no message leaves none).
        # A terminal turn read back after the reset proves it too: the terminal created the id.
        was_reset = await self.chat_store.has_event_kind(key, ("session.reset",))
        started_before = (
            (row["origin"] == "imported_from_pty" and not was_reset)
            or await self.chat_store.started_since_last_reset(key, ("session.started", "session.resumed"))
            or await self.chat_store.imported_since_last_reset(key)
        )
        resume = session_id = None
        if started_before and stored_id:
            if not is_valid_session_id(stored_id):
                raise ResumeFailed("the stored conversation id is not a valid session id")
            resume = stored_id
        else:
            session_id = stored_id if is_valid_session_id(stored_id) else str(uuid.uuid4())
            if session_id != stored_id:
                await self.store.set(key, session_id)

        spec = ChatSpec(
            cli_path=cli.path, cwd=cwd, add_dirs=list(add_dirs), env=expanded_env(agent), session_id=session_id, resume=resume,
            model=row["model"], permission_mode=row["permission_mode"],
            system_prompt_append=agent.system_prompt,
            mcp_servers=self.escritorio_mcp_servers(resume or session_id),
            connector_policy=policy, connect_timeout=self.config.connect_timeout,
        )
        try:
            runtime = await self._start(key, spec, resumed=resume is not None)
        except SpawnFailed as exc:
            if exc.reason != "connector_exposed" or policy.allowed or spec.strict_mcp:
                raise
            # The safety net: only the servers we pass explicitly (G0.1, alternative E).
            spec = replace(spec, strict_mcp=True)
            runtime = await self._start(key, spec, resumed=resume is not None)
        await self.chat_store.update_chat_session(
            key, cli_path=cli.path, cli_version=cli.version, cwd=cwd, add_dirs=list(add_dirs),
            last_error=None,
        )
        if skipped:
            await self.hub(key).publish("system.notice", {
                "kind": "folder_skipped",
                "text": f"{len(skipped)} extra folder(s) of the project are unavailable and were left out.",
            })
        return runtime

    async def _start(self, key: str, spec: ChatSpec, *, resumed: bool) -> ChatRuntime:
        spec.validate_for_spawn()
        runtime = ChatRuntime(
            session_key=key, hub=self.hub(key), engine=self.engine_factory(), spec=spec,
            hooks=self._hooks, resumed=resumed, command_timeout=self.config.command_timeout,
        )
        await runtime.start()
        return runtime

    async def _record_failure(self, key: str, exc: Exception) -> None:
        if isinstance(exc, ResumeFailed):
            payload = {"code": "resume_failed", "detail": public_detail(exc.detail)}
        else:
            payload = {"code": "spawn_failed", "reason": exc.reason, "detail": public_detail(exc.detail)}
        try:
            await self.hub(key).publish("status", payload)
            await self.chat_store.update_chat_session(key, status="failed", last_error=payload)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: could not record the failure", key)

    async def open(self, key: str) -> dict:
        try:
            await self.ensure_runtime(key)
        except ChatError as exc:
            if exc.code in ("spawn_failed", "resume_failed"):
                row = await self.chat_store.get_chat_session(key)
                return {"status": "failed", "last_error": row["last_error"] if row else None}
            raise
        return {"status": "idle"}

    async def close(self, key: str) -> dict:
        if await self.chat_store.get_chat_session(key) is None:
            raise ChatError("session_not_found")
        await self.manager.close(key, "terminated")
        return {"status": "stopped"}

    # -- commands from the client --------------------------------------------------------------------

    async def send(self, key: str, text: str, client_msg_id: str | None = None) -> None:
        await self._reject_ui_command(text)
        runtime = await self.ensure_runtime(key)
        await runtime.submit("send", text=text, client_msg_id=client_msg_id)

    async def interrupt(self, key: str) -> None:
        runtime = self.manager.get(key)
        if runtime is not None:
            await runtime.submit("interrupt")

    async def _require_model_in_catalog(self, model: str) -> None:
        """The one gate of the model catalog (create and `set_model`); the syntax that may reach
        the command line is `ChatSpec.validate`'s business, further down."""
        if not await self.chat_store.model_enabled(model):
            raise ChatCommandError("model_not_allowed", "not a model of the catalog")

    async def _reject_ui_command(self, text: str) -> None:
        """A `/name` the app handles itself (`handling: ui`, like `/model`) never goes to the model."""
        if text.startswith("/") and await self.chat_store.command_handling(commands.command_name(text)) == "ui":
            raise ChatCommandError("invalid_frame", "this command is handled by the app, not sent to the conversation")

    async def set_model(self, key: str, model: str) -> None:
        await self._require_model_in_catalog(model)
        runtime = self.manager.get(key)
        if runtime is not None:
            await runtime.submit("set_model", model=model)
        else:
            await self.chat_store.update_chat_session(key, model=model)
            await self.hub(key).publish("model.changed", {"model": model})

    async def set_permission_mode(self, key: str, mode: str) -> None:
        if mode not in ALLOWED_PERMISSION_MODES:
            raise ChatCommandError("mode_not_allowed", "only default, acceptEdits and plan are allowed")
        runtime = self.manager.get(key)
        if runtime is not None:
            await runtime.submit("set_permission_mode", mode=mode)
        else:
            await self.chat_store.update_chat_session(key, permission_mode=mode)
            await self.hub(key).publish("mode.changed", {"permission_mode": mode})

    async def decide(
        self, permission_id: str, *, behavior: str, scope: str = "once", message: str | None = None,
        interrupt: bool = False, answers: dict | None = None, by: str = "rest",
        session_key: str | None = None,
    ) -> dict:
        """`session_key` set (the WS case) means: only approvals of THAT conversation."""
        row = await self.chat_store.get_permission(permission_id, session_key)
        if row is None:
            raise ChatCommandError("permission_not_found")
        runtime = self.manager.get(row["session_key"])
        if runtime is None:
            if row["status"] == "pending":
                # Nobody is left to answer (the process is gone): it can only be expired.
                await self.chat_store.close_pending(row["session_key"], "expired")
            raise ChatCommandError("permission_expired" if row["status"] in ("pending", "expired", "cancelled")
                                   else "already_decided")
        status = await runtime.decide(
            permission_id, behavior=behavior, scope=scope, message=message, interrupt=interrupt,
            answers=answers, by=by,
        )
        return {"id": permission_id, "status": status}

    # -- reading ------------------------------------------------------------------------------------

    async def attach(self, key: str) -> tuple[Reader, int]:
        if await self.chat_store.get_chat_session(key) is None:
            raise ChatError("session_not_found")
        return await self.hub(key).add_reader()

    def detach(self, key: str, reader: Reader) -> None:
        self.hub(key).remove_reader(reader)

    async def state_payload(self, key: str) -> dict:
        """The ONE producer of `session.state` (the runtime asks for it too): always the full
        shape of contract 4, from the stored row and the live runtime."""
        row = await self.chat_store.get_chat_session(key)
        if row is None:
            raise ChatError("session_not_found")
        runtime = self.manager.get(key)
        pending = len(runtime.pending) if runtime else await self.chat_store.pending_count(key)
        return {
            "engine": "chat",
            "process": "running" if runtime else "stopped",
            "turn": "running" if runtime and runtime.turn_running else "idle",
            "model": row["model"], "permission_mode": row["permission_mode"], "cwd": row["cwd"],
            "add_dirs": row["add_dirs"], "pending_permissions": pending, "status": row["status"],
            "last_error": public_last_error(row["last_error"]), "last_seq": row["last_seq"],
        }

    async def list_sessions(self, project_ref: str | None = None) -> list[dict]:
        rows = await self.chat_store.list_chat_sessions(project_ref)
        meta = await self.store.get_all_meta(include_engine=True)
        result = []
        for row in rows:
            key = row["session_key"]
            entry = meta.get(key, {})
            runtime = self.manager.get(key)
            pending = len(runtime.pending) if runtime else await self.chat_store.pending_count(key)
            result.append({
                "session_key": key, "project_ref": row["project_ref"], "agent_id": row["agent_id"],
                "display_name": entry.get("display_name"), "engine": entry.get("engine", "chat"),
                "origin": row["origin"], "status": row["status"],
                "live_status": self._live_status(runtime), "pending_permissions": pending,
                "needs_attention": entry.get("needs_attention", False),
                "push_notified": entry.get("push_notified", False), "model": row["model"],
                "permission_mode": row["permission_mode"], "last_error": public_last_error(row["last_error"]),
                "last_seq": row["last_seq"], "created_at": row["created_at"], "updated_at": row["updated_at"],
            })
        return result

    @staticmethod
    def _live_status(runtime: ChatRuntime | None) -> str | None:
        if runtime is None:
            return None
        if runtime.pending:
            return "awaiting_permission"
        return "running" if runtime.turn_running else "idle"

    async def active_snapshot(self) -> dict:
        meta = await self.store.get_all_meta()
        snapshot = {}
        for key, runtime in self.manager.active().items():
            entry = meta.get(key, {})
            snapshot[key] = {
                "status": self._live_status(runtime), "connected": bool(self.hub(key).readers),
                "needs_attention": entry.get("needs_attention", False),
                "display_name": entry.get("display_name"), "engine": "chat",
                "pending_permissions": len(runtime.pending),
            }
        return snapshot

    async def events(self, key: str, since: int, limit: int) -> dict:
        if await self.chat_store.get_chat_session(key) is None:
            raise ChatError("session_not_found")
        events, last_seq, has_more = await self.chat_store.events_since(key, since, limit)
        return {"events": events, "last_seq": last_seq, "has_more": has_more}

    async def health(self) -> dict:
        sdk = self.sdk_status()
        cli = await self._resolve_cli(None)
        return {
            "sdk": {"available": sdk.available, "version": sdk.version,
                    **({"detail": public_detail(sdk.detail)} if sdk.detail else {})},
            # The file name only: the full path is a local detail clients do not need.
            "cli": {"path": os.path.basename(cli.path) if cli.path else None, "version": cli.version,
                    "ok": cli.ok, **({"reason": cli.reason} if cli.reason else {})},
            "min_cli_version": self.cli_resolver.min_version,
        }

    # -- hooks from the runtime ---------------------------------------------------------------------

    async def on_stop(self, key: str, payload: dict) -> None:
        """The Stop hook, in process: once per turn."""
        runtime = self.manager.get(key)
        if runtime is not None:
            if runtime.stop_pushed_for_turn:
                return
            runtime.stop_pushed_for_turn = True
        await self.mark_needs_attention(key)
        await self.dispatch_push(key)

    async def on_permission_pending(self, key: str) -> None:
        await self.mark_needs_attention(key)
        await self.dispatch_push(key)

    async def on_session_id_changed(self, key: str, previous: str, current: str) -> None:
        """`/clear` gave the conversation a new id: keep the old one as an alias. A value that
        is not a UUID never reaches `sessions.claude_session_id` (it becomes `--resume <value>`)."""
        if not is_valid_session_id(current):
            logger.warning("chat %s: ignoring a session id that is not a UUID", key)
            return
        await self.store.set_claude_session_id_with_alias(key, current.lower())

    # -- ending a conversation ----------------------------------------------------------------------

    async def terminate(self, key: str) -> bool:
        """Close the process and erase the chat's data for the key. False when the key is not a chat."""
        if await self.chat_store.get_chat_session(key) is None and self.manager.get(key) is None:
            return False
        await self.manager.close(key, "terminated")
        await self.chat_store.delete_session_data(key)
        hub = self._hubs.pop(key, None)
        if hub is not None:
            hub.emit("status", {"code": "closed", "reason": "terminated"})
        return True

    async def reset(self, key: str) -> bool:
        if await self.chat_store.get_chat_session(key) is None:
            return False
        await self.manager.close(key, "reset")
        await self.hub(key).publish("session.reset", {})
        await self.chat_store.update_chat_session(key, status="new", last_error=None)
        return True

    async def switch_engine(self, key: str, target: str, confirm: bool = False) -> dict:
        return await self._engine_switcher.switch(key, target, confirm)

    # -- connectors of an agent ---------------------------------------------------------------------

    async def get_connectors(self, agent_id: str) -> dict:
        return await self._connector_admin.get(agent_id)

    async def put_connectors(self, agent_id: str, allowlist: list) -> dict:
        return await self._connector_admin.put(agent_id, allowlist)

    async def refresh_connectors(self, agent_id: str) -> dict:
        return await self._connector_admin.refresh(agent_id)

    # -- commands and models of the catalog --------------------------------------------------------

    async def session_commands(self, key: str) -> list[dict]:
        """What the composer may offer in this conversation: the project's, the user's and the
        plugins' commands, those of the live process and the registry, merged."""
        row = await self.chat_store.get_chat_session(key)
        if row is None:
            raise ChatError("session_not_found")
        runtime = self.manager.get(key)
        return await self.catalog.for_session(
            key, row["cwd"], row["add_dirs"], runtime.init_info if runtime is not None else None
        )

    async def get_commands(self) -> list[dict]:
        return await self.chat_store.list_commands()

    async def put_commands(self, items: object) -> list[dict]:
        """Upsert the registry (the client edits a few entries and sends them; the others stay),
        then tell every conversation that its command list changed."""
        await self.chat_store.put_commands(commands.validate_command_items(items))
        self.catalog.invalidate()
        for hub in list(self._hubs.values()):
            hub.emit("commands.changed", {})
        return await self.chat_store.list_commands()

    async def get_models(self) -> list[dict]:
        return await self.chat_store.list_models()

    async def put_models(self, items: object) -> list[dict]:
        await self.chat_store.put_models(commands.validate_model_items(items))
        return await self.chat_store.list_models()

    async def on_init(self, key: str, info: InitInfo) -> None:
        """From the owner task, after an `init`: the binary's own models join the catalog and
        the conversation's command list is read again."""
        await self.chat_store.seed_models_from_server_info(info.models)
        self.catalog.invalidate(key)
        self.hub(key).emit("commands.changed", {})

    # -- boot ---------------------------------------------------------------------------------------

    async def reconcile_on_boot(self) -> dict:
        """Close what a previous run left open, then start the sweeper of idle conversations."""
        result = await ChatManager.reconcile_on_boot(self.chat_store)
        self.manager.start_sweeper()
        return result
