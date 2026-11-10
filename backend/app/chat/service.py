"""`ChatService`: what `main.py` injects (stores, project/agent resolution, the PTY side) and
what `api.py` calls. The `chat` package never imports `main` (the dependencies come in
through the constructor), and it never imports the SDK (`sdk_engine` does, lazily).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, replace
from typing import Any, Awaitable, Callable

from . import availability, connectors, history_import, sdk_engine
from .engine import (
    ALLOWED_PERMISSION_MODES,
    ArgvValueError,
    ChatEngine,
    ChatSpec,
    ConnectorPolicy,
    EngineUnavailable,
    ResumeFailed,
    SpawnFailed,
    is_valid_model,
    is_valid_session_id,
    validate_add_dirs,
)
from .manager import ChatManager, ClosedWhileStarting
from .runtime import MAX_SEND_CHARS, ChatCommandError, ChatRuntime, Reader, RuntimeHooks, SessionHub
from .store import ChatStore

logger = logging.getLogger(__name__)

_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"
RESOLVE_TIMEOUT_SECONDS = 15.0
PROBE_TIMEOUT_SECONDS = 60.0
# A Windows path may hold spaces (`C:\\Program Files\\...`), so from the drive letter the match runs to
# the end of the line or the next quote/bracket; the rest of such a sentence goes with it, which is
# the safe side for text shown to another device. UNC and the usual POSIX roots are covered too.
_LOCAL_PATH_RE = re.compile(
    r"""(?:[A-Za-z]:[\\/][^\r\n'"<>|]*|\\\\[^\s'"<>|]+|(?<![\w.])/(?:home|Users|root|tmp|var|opt|mnt)/[^\s'"<>|]*)"""
)


def public_detail(text: object) -> str:
    """Technical text safe for a client: local filesystem paths are replaced (the client may be
    another device on the network)."""
    return _LOCAL_PATH_RE.sub("<path>", str(text or ""))[:500]


class ChatError(Exception):
    """An error with the HTTP shape of the contract: `{"detail": {"code", "message"}}`."""

    def __init__(self, code: str, message: str = "", status: int = 400):
        super().__init__(message or code)
        self.code = code
        self.message = message or code
        self.status = status


@dataclass
class ChatConfig:
    max_processes: int = 6
    idle_timeout: float = 1800.0
    pending_ttl: float = 14400.0
    connect_timeout: float = 60.0
    command_timeout: float = 30.0

    @classmethod
    def from_env(cls, env=os.environ) -> "ChatConfig":
        def number(name: str, default: float) -> float:
            try:
                return float(env.get(name, default))
            except (TypeError, ValueError):
                return default

        return cls(
            max_processes=int(number("CHAT_MAX_PROCESSES", 6)),
            idle_timeout=number("CHAT_IDLE_TIMEOUT", 1800.0),
            pending_ttl=number("CHAT_PENDING_TTL", 14400.0),
            connect_timeout=number("CHAT_CONNECT_TIMEOUT", 60.0),
            command_timeout=number("CHAT_COMMAND_TIMEOUT", 30.0),
        )


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
        self._hubs: dict[str, SessionHub] = {}
        self._probe_locks: dict[str, asyncio.Lock] = {}
        self._background: set[asyncio.Task] = set()
        self._hooks = RuntimeHooks(
            on_stop=self.on_stop,
            on_permission_pending=self.on_permission_pending,
            on_all_decided=self.ack,
            on_session_id_changed=self.on_session_id_changed,
            on_closed=self._on_runtime_closed,
            state_payload=self.state_payload,
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
            raise ChatError("engine_unavailable", public_detail(status.detail) or "the chat engine is not installed", 503)

    async def _agent_for(self, project_ref: str, agent_id: str | None):
        _, agent = self.resolve_agent(project_ref, agent_id)
        return agent

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
            raise ChatError("mode_not_allowed", "only default, acceptEdits and plan are allowed", 422)
        if model is not None and not is_valid_model(model):
            raise ChatError("model_not_allowed", "not a model alias or id", 422)
        if first_message is not None and len(first_message) > MAX_SEND_CHARS:
            raise ChatError("first_message_too_long", f"first_message is at most {MAX_SEND_CHARS} characters", 422)
        project, agent = self.resolve_agent(project_ref, agent_id)
        if project is None:
            raise ChatError("project_not_found", status=404)
        if agent is None or agent.id != agent_id:
            raise ChatError("agent_not_found", status=404)
        if agent.ia != "claude":
            raise ChatError("agent_not_chat_capable", "only claude agents have a chat", 422)

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
        except ChatError:
            pass  # a failed start was recorded by ensure_runtime (status event and last_error)
        except ChatCommandError as exc:
            await self._record_first_message_failure(key, exc)
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
                raise ChatError("session_not_found", status=404)
            if await self.store.get_engine(key) != "chat" or self.pty_is_alive(key):
                raise ChatError("engine_conflict", "this conversation belongs to the terminal", 409)
            self._require_sdk()
            try:
                return await self.manager.get_or_spawn(key, lambda: self._build_and_start(key))
            except (SpawnFailed, ResumeFailed) as exc:
                await self._record_failure(key, exc)
                raise ChatError(
                    "resume_failed" if isinstance(exc, ResumeFailed) else "spawn_failed",
                    public_detail(getattr(exc, "detail", "")), 200,
                ) from exc
            except EngineUnavailable as exc:
                raise ChatError("engine_unavailable", public_detail(exc.detail), 503) from exc
            except ClosedWhileStarting as exc:
                raise ChatError(
                    "closed_while_starting", f"the conversation was closed ({exc.reason}) while starting", 409
                ) from exc

    async def _build_and_start(self, key: str) -> ChatRuntime:
        # Inside the manager's reservation now: a terminate that deleted the row before it was
        # taken is seen here, one that comes later waits for this start.
        row = await self.chat_store.get_chat_session(key)
        if row is None:
            raise ChatError("session_not_found", status=404)
        agent = await self._agent_for(row["project_ref"], row["agent_id"])
        if agent is None or agent.id != row["agent_id"]:
            # No fallback to another agent: it would bring another env, prompt and allowlist.
            raise SpawnFailed("agent_unavailable", "the agent is not available for this project")
        if agent.ia != "claude":
            raise SpawnFailed("agent_not_chat_capable", "only claude agents have a chat")
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
        # `%VAR%`/`$VAR` in an agent's env, like the PTY does (CT4).
        env = {name: os.path.expandvars(value) for name, value in (agent.env or {}).items()}

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
            cli_path=cli.path, cwd=cwd, add_dirs=list(add_dirs), env=env, session_id=session_id, resume=resume,
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
        try:
            spec.validate()
        except ArgvValueError as exc:
            if exc.field == "resume":
                raise ResumeFailed(str(exc)) from exc
            raise SpawnFailed("process_error", str(exc)) from exc
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
            raise ChatError("session_not_found", status=404)
        await self.manager.close(key, "terminated")
        return {"status": "stopped"}

    # -- commands from the client --------------------------------------------------------------------

    async def send(self, key: str, text: str, client_msg_id: str | None = None) -> None:
        runtime = await self.ensure_runtime(key)
        await runtime.submit("send", text=text, client_msg_id=client_msg_id)

    async def interrupt(self, key: str) -> None:
        runtime = self.manager.get(key)
        if runtime is not None:
            await runtime.submit("interrupt")

    async def set_model(self, key: str, model: str) -> None:
        if not is_valid_model(model):
            raise ChatCommandError("model_not_allowed", "not a model alias or id")
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
            raise ChatError("session_not_found", status=404)
        return await self.hub(key).add_reader()

    def detach(self, key: str, reader: Reader) -> None:
        self.hub(key).remove_reader(reader)

    async def state_payload(self, key: str) -> dict:
        """The ONE producer of `session.state` (the runtime asks for it too): always the full
        shape of contract 4, from the stored row and the live runtime."""
        row = await self.chat_store.get_chat_session(key)
        if row is None:
            raise ChatError("session_not_found", status=404)
        runtime = self.manager.get(key)
        pending = len(runtime.pending) if runtime else await self.chat_store.pending_count(key)
        last_error = row["last_error"]
        if last_error and "detail" in last_error:
            last_error = {**last_error, "detail": public_detail(last_error["detail"])}
        return {
            "engine": "chat",
            "process": "running" if runtime else "stopped",
            "turn": "running" if runtime and runtime.turn_running else "idle",
            "model": row["model"], "permission_mode": row["permission_mode"], "cwd": row["cwd"],
            "add_dirs": row["add_dirs"], "pending_permissions": pending, "status": row["status"],
            "last_error": last_error, "last_seq": row["last_seq"],
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
            last_error = row["last_error"]
            if last_error and "detail" in last_error:
                last_error = {**last_error, "detail": public_detail(last_error["detail"])}
            result.append({
                "session_key": key, "project_ref": row["project_ref"], "agent_id": row["agent_id"],
                "display_name": entry.get("display_name"), "engine": entry.get("engine", "chat"),
                "origin": row["origin"], "status": row["status"],
                "live_status": self._live_status(runtime), "pending_permissions": pending,
                "needs_attention": entry.get("needs_attention", False),
                "push_notified": entry.get("push_notified", False), "model": row["model"],
                "permission_mode": row["permission_mode"], "last_error": last_error,
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
            raise ChatError("session_not_found", status=404)
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
        if target not in ("chat", "pty"):
            raise ChatError("invalid_engine", "engine must be chat or pty", 422)
        if target == "chat":
            return await self._switch_to_chat(key, confirm)
        return await self._switch_to_pty(key)

    async def _switch_to_chat(self, key: str, confirm: bool) -> dict:
        if not confirm:
            raise ChatError("confirmation_required", "confirm the switch to the chat", 400)
        self._require_sdk()
        async with self.session_lock(key):
            engine = await self.store.get_engine(key)
            if engine is None:
                raise ChatError("session_not_found", status=404)
            if engine == "chat":
                raise ChatError("engine_conflict", "already a chat", 409)
            row = await self.chat_store.get_chat_session(key)
            project_ref, agent_id = (row["project_ref"], row["agent_id"]) if row else self._split_key(key)
            project, agent = self.resolve_agent(project_ref, agent_id)
            if agent is None or agent.id != agent_id:
                raise ChatError("agent_not_found", status=404)
            if agent.ia != "claude":
                raise ChatError("agent_not_chat_capable", "only claude agents have a chat", 422)
            try:
                cwd, add_dirs, _ = self.resolve_project(project_ref, agent_id)
            except SpawnFailed as exc:
                # Before touching the terminal: a switch that cannot succeed must not kill it.
                raise ChatError("folder_unavailable", public_detail(exc.detail), 422) from exc
            await self.pty_evict(key)
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

    @staticmethod
    def _split_key(key: str) -> tuple[str, str]:
        """`project::agent` or `project::agent::suffix` (a V2 key may carry a suffix): the first
        two parts. A project ref never holds `::` (synthetic keys do not produce it)."""
        parts = key.split("::")
        return (parts[0], parts[1]) if len(parts) >= 2 else (key, "")

    async def _import_history(self, key: str, cwd: str, agent) -> dict:
        claude_id = await self.store.get(key)
        env = {name: os.path.expandvars(value) for name, value in (agent.env or {}).items()}
        hub = self.hub(key)
        try:
            if not is_valid_session_id(claude_id):
                raise history_import.ImportFailed("no_session")
            known = await self.chat_store.logged_conversation(key)
            events = await history_import.import_history(
                claude_id, cwd, env, reader=self.history_reader, known=known
            )
        except history_import.ImportFailed as exc:
            await hub.publish("history.import_failed", {"reason": exc.reason})
            return {"failed": exc.reason}
        for event in events:
            await hub.publish(event.kind, event.payload)
        await hub.publish("history.imported", {"count": len(events)})
        return {"imported": len(events)}

    async def _switch_to_pty(self, key: str) -> dict:
        async with self.session_lock(key):
            if await self.store.get_engine(key) is None:
                raise ChatError("session_not_found", status=404)
            if await self.store.get_engine(key) != "chat":
                raise ChatError("engine_conflict", "not a chat", 409)
            await self.manager.close(key, "switched_to_pty")
            await self.store.set_engine(key, "pty")
            # The chat data stays for a later switch back; the V2 terminate reads this mark to
            # know the key still has some to erase (it never touches the chat store otherwise).
            await self.store.mark_was_chat(key)
            if await self.chat_store.get_chat_session(key) is not None:
                await self.chat_store.update_chat_session(key, status="switched_to_pty")
            return {"engine": "pty", "history": None}

    # -- connectors of an agent ---------------------------------------------------------------------

    def _require_agent(self, agent_id: str) -> None:
        if not self.agent_exists(agent_id):
            raise ChatError("agent_not_found", status=404)

    async def get_connectors(self, agent_id: str) -> dict:
        self._require_agent(agent_id)
        settings = await self.chat_store.get_agent_settings(agent_id)
        allowed = set(settings["mcp_allowlist"])
        return {
            "agent_id": agent_id, "allowlist": settings["mcp_allowlist"],
            # Names only: never a URL, an id or a credential.
            "known": [{"name": c["name"], "allowed": c["name"] in allowed} for c in settings["known_connectors"]],
            "probed_at": settings["connectors_probed_at"],
        }

    async def put_connectors(self, agent_id: str, allowlist: list) -> dict:
        self._require_agent(agent_id)
        if not isinstance(allowlist, list):
            raise ChatError("invalid_name", "allowlist must be a list of names", 422)
        names = []
        for name in allowlist:
            try:
                names.append(connectors.validate_connector_name(name))
            except connectors.InvalidConnectorName as exc:
                raise ChatError("invalid_name", str(exc), 422) from None
        settings = await self.chat_store.get_agent_settings(agent_id)
        known = {c["name"] for c in settings["known_connectors"]}
        unknown = [n for n in names if n not in known]
        if unknown:
            raise ChatError("unknown_connector", "refresh the list first: that connector was not discovered", 422)
        await self.chat_store.put_agent_settings(agent_id, mcp_allowlist=list(dict.fromkeys(names)))
        return await self.get_connectors(agent_id)

    async def refresh_connectors(self, agent_id: str) -> dict:
        self._require_agent(agent_id)
        self._require_sdk()
        lock = self._probe_locks.setdefault(agent_id, asyncio.Lock())
        if lock.locked():
            async with lock:  # single-flight: wait for the probe in progress, reuse its result
                return await self.get_connectors(agent_id)
        async with lock:
            if len(self.manager.active()) >= self.manager.max_processes:
                raise ChatError("capacity_exceeded", "too many conversations are running", 503)
            agent = await self._agent_for_probe(agent_id)
            cli = await self._resolve_cli(agent)
            if not cli.ok:
                raise ChatError("probe_failed", public_detail(cli.detail), 502)
            scratch = tempfile.mkdtemp(prefix="tn-chat-probe-")
            try:
                spec = ChatSpec(
                    cli_path=cli.path, cwd=scratch,
                    env={n: os.path.expandvars(v) for n, v in ((agent.env if agent else None) or {}).items()},
                    connector_policy=ConnectorPolicy(probe=True), connect_timeout=self.config.connect_timeout,
                )
                found = await asyncio.wait_for(
                    connectors.probe(self.engine_factory(), spec), PROBE_TIMEOUT_SECONDS
                )
            except Exception as exc:  # noqa: BLE001 - whatever the probe hits is a failed probe, never a 500
                if not isinstance(exc, (SpawnFailed, ResumeFailed, EngineUnavailable, asyncio.TimeoutError, OSError)):
                    logger.warning("chat: connector probe failed (%s)", type(exc).__name__)
                raise ChatError("probe_failed", public_detail(getattr(exc, "detail", exc) or type(exc).__name__), 502) from exc
            finally:
                shutil.rmtree(scratch, ignore_errors=True)
            await self.chat_store.put_agent_settings(
                agent_id, known_connectors=found, connectors_probed_at=time.time()
            )
        return await self.get_connectors(agent_id)

    async def _agent_for_probe(self, agent_id: str):
        _, agent = self.resolve_agent("", agent_id)
        return agent

    # -- boot ---------------------------------------------------------------------------------------

    async def reconcile_on_boot(self) -> dict:
        result = await ChatManager.reconcile_on_boot(self.chat_store)
        self.manager.start_sweeper()
        return result
