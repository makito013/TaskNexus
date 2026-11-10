"""One live conversation (ADR-39): an owner task that connects the process, reads its
messages and executes the commands the rest of the backend queues, then disconnects.

Nothing outside this module touches the process: WS and REST put a `Command` in the inbox
and wait for its future. The owner task is also the task that spawned the process, which is
what the SDK's cancel scopes require.

`SessionHub` is the part that outlives a process: the event lock (`seq` order), the live
readers (fan-out with bounded queues) and `publish`, used by the runtime and by the service
for events that exist without a process (status, history import, reset).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from . import connectors, permissions
from .engine import (
    ChatEngine,
    ChatProcess,
    ChatSpec,
    EngineCallbacks,
    EngineMessage,
    PermissionContext,
    PermissionDecision,
    ResumeFailed,
    SpawnFailed,
    EngineUnavailable,
    ArgvValueError,
    validate_model,
    ALLOWED_PERMISSION_MODES,
)
from .normalizer import ChatEvent, Normalizer, NormalizerState
from .store import ChatStore

logger = logging.getLogger(__name__)

MAX_READERS = 16
READER_QUEUE_SIZE = 1024
COMMAND_TIMEOUT_SECONDS = 30.0
MAX_SEND_CHARS = 100_000
OVERFLOW = object()  # sentinel left in a reader's queue when it fell behind


class ChatCommandError(Exception):
    """A command the runtime refuses; `code` is a `command.rejected` code of the WS contract."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class TooManyReaders(Exception):
    pass


# -- readers and the hub --------------------------------------------------------------------------


class Reader:
    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=READER_QUEUE_SIZE)
        self.overflowed = False

    def offer(self, frame: dict) -> None:
        if self.overflowed:
            return  # the socket is about to close; the client will ask for the rest with `since`
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            # Too slow: drop the backlog and leave a marker; the socket closes with 4408
            # and the client reconnects with `since` (the log is the truth).
            self.overflowed = True
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(OVERFLOW)


class SessionHub:
    """Per `session_key`: the event lock, the readers and the one way to publish."""

    def __init__(self, session_key: str, store: ChatStore):
        self.session_key = session_key
        self.store = store
        self.event_lock = asyncio.Lock()
        self.readers: list[Reader] = []

    def frame(self, kind: str, payload: dict, seq: int | None, ts: float) -> dict:
        return {"type": kind, "session_key": self.session_key, "seq": seq, "ts": ts, **payload}

    def _fan_out(self, frame: dict) -> None:
        for reader in list(self.readers):
            reader.offer(frame)

    async def publish(self, kind: str, payload: dict) -> int:
        """Persist and fan out. Order of `seq` is the order of the lock. When the caller is
        cancelled with the commit already in flight the event still reaches the readers
        (the store runs the callback), so a durable event is never invisible live."""
        async with self.event_lock:
            seq, _ = await self.store.append_event(
                self.session_key, kind, payload,
                on_committed=lambda seq, ts: self._fan_out(self.frame(kind, payload, seq, ts)),
            )
        return seq

    def emit(self, kind: str, payload: dict) -> None:
        """Live only (`seq: null`): deltas, rate limits, state."""
        self._fan_out(self.frame(kind, payload, None, time.time()))

    async def add_reader(self) -> tuple[Reader, int]:
        """Register a reader and read the cutoff in ONE critical section, so no event falls
        between the replay (seq <= cutoff, from the database) and the live queue."""
        async with self.event_lock:
            if len(self.readers) >= MAX_READERS:
                raise TooManyReaders()
            reader = Reader()
            self.readers.append(reader)
            session = await self.store.get_chat_session(self.session_key)
            return reader, (session["last_seq"] if session else 0)

    def remove_reader(self, reader: Reader) -> None:
        if reader in self.readers:
            self.readers.remove(reader)


# -- the runtime ----------------------------------------------------------------------------------


@dataclass
class RuntimeHooks:
    """What the service wants to hear about (each may be a no-op)."""

    on_stop: Callable[[str, dict], Awaitable[None]]
    on_permission_pending: Callable[[str], Awaitable[None]]
    on_all_decided: Callable[[str], Awaitable[None]]
    on_session_id_changed: Callable[[str, str, str], Awaitable[None]]
    on_closed: Callable[[str, "ChatRuntime"], None]
    # The ONE producer of `session.state` (contract 4): the service, which reads the row.
    state_payload: Callable[[str], Awaitable[dict]]


@dataclass
class _Command:
    kind: str
    args: dict
    future: asyncio.Future = field(default_factory=lambda: asyncio.get_running_loop().create_future())


@dataclass
class _Pending:
    future: asyncio.Future
    tool_name: str
    tool_input: dict
    suggestions: list[dict]
    connector: str | None
    created: float


class ChatRuntime:
    # With an allowlist the allowed connectors load in the background after connect(): wait
    # (bounded) for them to leave `pending` before the first query, or the first turn would
    # start without their tools.
    connector_settle_seconds = 15.0
    connector_poll_seconds = 0.5

    def __init__(
        self,
        *,
        session_key: str,
        hub: SessionHub,
        engine: ChatEngine,
        spec: ChatSpec,
        hooks: RuntimeHooks,
        resumed: bool,
        clock: Callable[[], float] = time.monotonic,
        command_timeout: float = COMMAND_TIMEOUT_SECONDS,
    ):
        self.session_key = session_key
        self.hub = hub
        self.store = hub.store
        self.engine = engine
        self.spec = spec
        self.hooks = hooks
        self.clock = clock
        self.command_timeout = command_timeout
        self.normalizer = Normalizer(NormalizerState(
            claude_session_id=spec.resume or spec.session_id, model=spec.model, resuming=resumed,
        ))
        self.inbox: asyncio.Queue[_Command] = asyncio.Queue()
        self.pending: dict[str, _Pending] = {}
        self.process: ChatProcess | None = None
        self.turn_running = False
        self.last_activity = clock()
        self.closing_reason: str | None = None
        self.stop_pushed_for_turn = False
        self._owner: asyncio.Task | None = None
        self._ready: asyncio.Future | None = None
        self._background: set[asyncio.Task] = set()
        self.alive = False

    # -- lifecycle ------------------------------------------------------------------------------

    async def start(self) -> None:
        """Spawn and connect inside the owner task; returns when the process is up. Raises
        what the engine raises (SpawnFailed, ResumeFailed, EngineUnavailable)."""
        loop = asyncio.get_running_loop()
        self._ready = loop.create_future()
        self._owner = loop.create_task(self._owner_main(), name=f"chat-owner:{self.session_key}")
        try:
            await asyncio.shield(self._ready)
        except BaseException:
            # The starter was cancelled or the spawn failed: nothing may be left running.
            if not self._owner.done():
                self._owner.cancel()
            raise

    async def close(self, reason: str, timeout: float = 15.0) -> None:
        """Ask the owner task to finish and wait for it (cancelling it after `timeout`)."""
        owner = self._owner
        if owner is None or owner.done():
            return
        self.closing_reason = self.closing_reason or reason
        self.inbox.put_nowait(_Command("close", {"reason": reason}))
        done, _ = await asyncio.wait({owner}, timeout=timeout)
        if not done:
            owner.cancel()
            await asyncio.wait({owner}, timeout=5.0)

    @property
    def idle(self) -> bool:
        """Nobody reading, no turn, nothing to approve: safe to evict (ADR-39, SA10)."""
        return not self.hub.readers and not self.turn_running and not self.pending

    @property
    def pid(self) -> int | None:
        return getattr(self.process, "pid", None)

    def snapshot(self) -> dict:
        return {
            "process": "running" if self.alive else "stopped",
            "turn": "running" if self.turn_running else "idle",
            "pending_permissions": len(self.pending),
        }

    # -- commands (the only way in) -------------------------------------------------------------

    async def submit(self, kind: str, **args: Any) -> Any:
        if not self.alive:
            raise ChatCommandError("engine_unavailable", "the conversation process is not running")
        command = _Command(kind, args)
        self.inbox.put_nowait(command)
        try:
            return await asyncio.wait_for(asyncio.shield(command.future), self.command_timeout)
        except asyncio.TimeoutError:
            raise ChatCommandError("process_error", f"{kind} did not finish in {self.command_timeout:g}s") from None

    async def _execute(self, command: _Command) -> bool:
        """Run one command in the owner task. Returns False to stop the loop."""
        try:
            if command.kind == "close":
                self.closing_reason = self.closing_reason or command.args.get("reason", "terminated")
                if not command.future.done():
                    command.future.set_result(None)
                return False
            result = await getattr(self, f"_cmd_{command.kind}")(**command.args)
            if not command.future.done():
                command.future.set_result(result)
        except ChatCommandError as exc:
            if not command.future.done():
                command.future.set_exception(exc)
        except Exception as exc:  # noqa: BLE001 - the process misbehaved; tell the caller, keep the loop
            logger.warning("chat %s: command %s failed (%s)", self.session_key, command.kind, type(exc).__name__)
            if not command.future.done():
                command.future.set_exception(ChatCommandError("process_error", f"{type(exc).__name__}"))
        return True

    async def _cmd_send(self, text: str, client_msg_id: str | None = None) -> None:
        if not text or len(text) > MAX_SEND_CHARS:
            raise ChatCommandError("invalid_frame", "text must be 1 to 100000 characters")
        # Persisted BEFORE the query: a crash between the two leaves the user's words in the log.
        self.turn_running = True
        self.stop_pushed_for_turn = False
        self.last_activity = self.clock()
        await self.hub.publish("message.user", {"client_msg_id": client_msg_id, "text": text, "origin": "ui"})
        await self._emit_state()
        await self.process.query(text)

    async def _cmd_interrupt(self) -> None:
        # Pending approvals end first (database, then the waiting futures), then the process.
        await self._cancel_pending("cancelled")
        await self.process.interrupt()

    async def _cmd_set_model(self, model: str) -> None:
        try:
            validate_model(model)
        except ArgvValueError:
            raise ChatCommandError("model_not_allowed", "not a model alias or id") from None
        await self.process.set_model(model)
        await self.store.update_chat_session(self.session_key, model=model)
        await self._emit_state()

    async def _cmd_set_permission_mode(self, mode: str) -> None:
        if mode not in ALLOWED_PERMISSION_MODES:
            raise ChatCommandError("mode_not_allowed", "only default, acceptEdits and plan are allowed")
        await self.process.set_permission_mode(mode)
        await self.store.update_chat_session(self.session_key, permission_mode=mode)
        await self.hub.publish("mode.changed", {"permission_mode": mode})
        await self._emit_state()

    # -- the owner task -------------------------------------------------------------------------

    def _callbacks(self) -> EngineCallbacks:
        return EngineCallbacks(
            can_use_tool=self._can_use_tool,
            on_stop=self._on_stop,
            connector_gate=lambda tool_name: connectors.gate_pre_tool_use(tool_name, self.spec.connector_policy),
        )

    async def _owner_main(self) -> None:
        reader_task: asyncio.Task | None = None
        try:
            try:
                self.process = await asyncio.wait_for(
                    self.engine.spawn(self.spec, self._callbacks()), self.spec.connect_timeout + 5
                )
            except asyncio.TimeoutError:
                if self.spec.resume:
                    raise ResumeFailed("connect timed out") from None
                raise SpawnFailed("process_error", "connect timed out") from None
            if self.spec.connector_policy.allowed:
                await self._settle_connectors()
            exposed = connectors.audit(
                await self.process.get_mcp_status(), None, self.spec.connector_policy
            )
            if exposed:
                raise SpawnFailed("connector_exposed", "connectors still loaded: " + ", ".join(exposed))
            await self.store.update_chat_session(
                self.session_key, status="idle", runtime_owner_pid=os.getpid(), last_error=None
            )
            self.alive = True
            if not self._ready.done():
                self._ready.set_result(None)
        except asyncio.CancelledError:
            await self._finish()
            if not self._ready.done():
                self._ready.set_exception(SpawnFailed("process_error", "start cancelled"))
            raise
        except BaseException as exc:  # noqa: BLE001 - reported to the starter, after the cleanup
            await self._finish()
            if not isinstance(exc, (SpawnFailed, ResumeFailed, EngineUnavailable)):
                # Anything else between connect() and "ready" (a status call, the database) is a
                # failed start the service can record, not an unhandled error.
                logger.warning("chat %s: start failed (%s)", self.session_key, type(exc).__name__)
                exc = SpawnFailed("process_error", type(exc).__name__)
            if not self._ready.done():
                self._ready.set_exception(exc)
            return

        try:
            reader_task = asyncio.create_task(self._read_loop(), name=f"chat-reader:{self.session_key}")
            while True:
                getter = asyncio.ensure_future(self.inbox.get())
                await asyncio.wait({getter, reader_task}, return_when=asyncio.FIRST_COMPLETED)
                if not getter.done():
                    getter.cancel()
                    self.closing_reason = self.closing_reason or "process_exit"
                    break
                if not await self._execute(getter.result()):
                    break
        finally:
            if reader_task is not None:
                reader_task.cancel()
                await asyncio.gather(reader_task, return_exceptions=True)
            await self._finish()

    async def _settle_connectors(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.connector_settle_seconds
        while loop.time() < deadline:
            status = await self.process.get_mcp_status()
            servers = [s for s in (status or {}).get("mcpServers") or [] if connectors.is_claudeai(s)]
            if servers and all(s.get("status") != "pending" for s in servers):
                return
            await asyncio.sleep(self.connector_poll_seconds)

    async def _finish(self) -> None:
        """Close in a fixed order: approvals in the database, then their futures, then the
        process, then the row. Runs on every exit, cancellation included."""
        self.alive = False
        self.turn_running = False  # a process that died mid-turn is not "running" any more
        reason = self.closing_reason or "shutdown"
        pending_status = "expired" if reason in ("idle", "expired") else "cancelled"
        try:
            await self._cancel_pending(pending_status)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: could not close pending approvals", self.session_key)
        if self.process is not None:
            try:
                await self.process.close()
            except Exception:  # noqa: BLE001
                logger.exception("chat %s: process close failed", self.session_key)
        for future_owner in list(self.pending.values()):
            if not future_owner.future.done():
                future_owner.future.set_result(
                    PermissionDecision(behavior="deny", message="cancelled", interrupt=True)
                )
        self.pending.clear()
        try:
            if self.process is not None:
                await self.store.update_chat_session(
                    self.session_key,
                    status="failed" if reason == "connector_exposed" else "stopped",
                    runtime_owner_pid=None,
                )
                await self.hub.publish("status", {"code": "closed", "reason": reason})
                await self._emit_state()
            else:
                # Never came up: the service records why; here only the owner mark goes.
                await self.store.update_chat_session(self.session_key, runtime_owner_pid=None)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: could not record the close", self.session_key)
        if self._background:
            # Announcements and withdrawals still in flight: let them land before the key is forgotten.
            await asyncio.wait(set(self._background), timeout=5.0)
        self.hooks.on_closed(self.session_key, self)

    async def _emit_state(self) -> None:
        """Live `session.state` frame, built by the service from the stored row and the live
        runtime (never from this runtime's own idea of the spec: `set_model` and
        `set_permission_mode` change the row)."""
        try:
            self.hub.emit("session.state", await self.hooks.state_payload(self.session_key))
        except Exception:  # noqa: BLE001 - a state frame must never break a command
            logger.exception("chat %s: could not build the session state", self.session_key)

    # -- reading --------------------------------------------------------------------------------

    async def _read_loop(self) -> None:
        async for message in self.process.messages():
            try:
                await self._handle_message(message)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad message must not end the conversation
                logger.exception("chat %s: could not handle a %s message", self.session_key, message.kind)

    async def _handle_message(self, message: EngineMessage) -> None:
        self.last_activity = self.clock()
        if message.kind == "init":
            exposed = connectors.audit(None, message.data.get("tools"), self.spec.connector_policy)
            if exposed:
                await self._connector_exposed(exposed)
                return
        for event in self.normalizer.feed(message):
            await self._handle_event(event)

    async def _handle_event(self, event: ChatEvent) -> None:
        if not event.persist:
            self.hub.emit(event.kind, event.payload)
            return
        await self.hub.publish(event.kind, event.payload)
        if event.kind in ("session.started", "session.resumed"):
            await self.store.update_chat_session(self.session_key, status="running")
        elif event.kind == "session.id_changed":
            await self.hooks.on_session_id_changed(
                self.session_key, event.payload["previous"], event.payload["current"]
            )
        elif event.kind == "model.changed":
            await self.store.update_chat_session(self.session_key, model=event.payload["model"])
        elif event.kind == "turn.ended":
            self.turn_running = False
            await self.store.update_chat_session(self.session_key, status="idle")
            await self._emit_state()

    async def _connector_exposed(self, names: list[str]) -> None:
        detail = "connectors loaded outside the allowlist: " + ", ".join(names)
        await self.hub.publish("status", {"code": "spawn_failed", "reason": "connector_exposed", "detail": detail})
        await self.store.update_chat_session(
            self.session_key, status="failed",
            last_error={"code": "spawn_failed", "reason": "connector_exposed", "detail": detail},
        )
        self.closing_reason = "connector_exposed"
        self.inbox.put_nowait(_Command("close", {"reason": "connector_exposed"}))

    # -- permissions ----------------------------------------------------------------------------

    async def _on_stop(self, payload: dict) -> None:
        await self.hooks.on_stop(self.session_key, payload)

    async def _can_use_tool(
        self, tool_name: str, tool_input: dict, context: PermissionContext
    ) -> PermissionDecision:
        """Runs in the SDK's own task and may wait for as long as the user takes."""
        kind = permissions.classify(tool_name)
        suggestions = permissions.sanitize_suggestions(context.suggestions)
        connector = connectors.connector_of_tool(tool_name, self.spec.connector_policy)
        permission_id = uuid.uuid4().hex
        await self.store.create_permission({
            "id": permission_id, "session_key": self.session_key, "tool_use_id": context.tool_use_id,
            "kind": kind, "tool_name": tool_name, "input": tool_input,
            "suggestions": suggestions, "connector": connector,
        })
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[permission_id] = _Pending(
            future, tool_name, tool_input, suggestions, connector, self.clock()
        )
        await self.hub.publish("permission.request", {
            "id": permission_id, "kind": kind, "tool_name": tool_name,
            "tool_use_id": context.tool_use_id, "input": tool_input,
            "suggestions_available": bool(suggestions),
            "allow_session": permissions.allow_session_possible(tool_name, suggestions, connector),
            "connector": connector,
        })
        await self._emit_state()
        await self.hooks.on_permission_pending(self.session_key)
        try:
            return await future
        finally:
            self.pending.pop(permission_id, None)
            if not future.done() or future.cancelled():
                # The CLI withdrew the request (for example it cancelled the other parallel tool
                # calls after an interrupt) and this task is being cancelled: the card must not
                # stay `pending`. Done in a task of our own, because the awaits of a task under
                # the SDK's cancel scope are cancelled again.
                self._spawn_background(self._withdraw(permission_id))

    def _spawn_background(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _withdraw(self, permission_id: str) -> None:
        """Close one request the CLI no longer waits for, announce it, and ack if it was the last."""
        try:
            row = await self.store.cancel_permission(permission_id, "cancelled")
            if row is None:
                return  # somebody decided first
            await self.hub.publish("permission.resolved", {
                "id": permission_id, "status": "cancelled", "scope": "once", "by": "system",
            })
            await self._emit_state()
            if await self.store.pending_count(self.session_key) == 0:
                await self.hooks.on_all_decided(self.session_key)
        except Exception:  # noqa: BLE001
            logger.exception("chat %s: could not close a withdrawn approval", self.session_key)

    async def decide(
        self, permission_id: str, *, behavior: str, scope: str = "once", message: str | None = None,
        interrupt: bool = False, answers: dict | None = None, by: str = "rest",
    ) -> str:
        """First decision wins. Returns the final status; raises ChatCommandError
        (permission_not_found / already_decided / permission_expired / scope_not_allowed)."""
        if behavior not in ("allow", "deny"):
            raise ChatCommandError("invalid_frame", "behavior must be allow or deny")
        row = await self.store.get_permission(permission_id, self.session_key)
        if row is None:
            raise ChatCommandError("permission_not_found")
        if row["status"] in ("expired", "cancelled"):
            raise ChatCommandError("permission_expired")
        if row["status"] != "pending":
            raise ChatCommandError("already_decided")
        try:
            decision = permissions.build_decision(
                tool_name=row["tool_name"], tool_input=row["input"], suggestions=row["suggestions"],
                connector=row["connector"], behavior=behavior, scope=scope, message=message,
                interrupt=interrupt, answers=answers,
            )
        except permissions.ScopeNotAllowed as exc:
            raise ChatCommandError("scope_not_allowed", str(exc)) from None

        status = "allowed" if behavior == "allow" else "denied"
        announce: list[asyncio.Task] = []

        def on_won() -> None:
            # Runs right after the commit, even if this caller was cancelled meanwhile: a
            # decision on disk always resolves the waiting future and gets announced.
            entry = self.pending.get(permission_id)
            if entry is not None and not entry.future.done():
                entry.future.set_result(decision)
            task = asyncio.ensure_future(self._announce_decision(permission_id, status, scope, by, message))
            self._background.add(task)
            task.add_done_callback(self._background.discard)
            announce.append(task)

        won = await self.store.decide_permission(
            permission_id, status,
            {"behavior": behavior, "scope": scope, "message": message, "interrupt": bool(interrupt),
             "answered": answers is not None},
            by, on_committed=on_won, session_key=self.session_key,
        )
        if not won:
            # Lost the race. Whoever won may be a close (cancelled/expired), which the contract
            # reports as 410, not as "someone already decided".
            current = await self.store.get_permission(permission_id, self.session_key)
            if current is not None and current["status"] in ("expired", "cancelled"):
                raise ChatCommandError("permission_expired")
            raise ChatCommandError("already_decided")
        await announce[0]
        return status

    async def _announce_decision(
        self, permission_id: str, status: str, scope: str, by: str, message: str | None
    ) -> None:
        payload = {"id": permission_id, "status": status, "scope": scope, "by": by}
        if message:
            payload["message"] = message
        await self.hub.publish("permission.resolved", payload)
        await self._emit_state()
        if await self.store.pending_count(self.session_key) == 0:
            await self.hooks.on_all_decided(self.session_key)

    async def _cancel_pending(self, status: str) -> None:
        """Database first (cancelled/expired), then the futures, so nothing can be decided
        between the two and the log never disagrees with what the process was told."""
        rows = await self.store.close_pending(self.session_key, status)
        for row in rows:
            await self.hub.publish("permission.resolved", {
                "id": row["id"], "status": status, "scope": "once", "by": "system",
            })
        for row in rows:
            entry = self.pending.get(row["id"])
            if entry is not None and not entry.future.done():
                entry.future.set_result(
                    PermissionDecision(behavior="deny", message="cancelled", interrupt=True)
                )
        if rows:
            await self._emit_state()
