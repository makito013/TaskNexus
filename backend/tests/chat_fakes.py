"""Scripted stand-ins for the chat engine: no SDK, no `claude` binary.

`FakeChatProcess` keeps the discipline of the real client: every call except `messages()`
must come from the task that spawned it (the runtime's owner task); a call from anywhere
else is recorded in `engine.violations` and fails the test that checks it.
"""
from __future__ import annotations

import asyncio
import itertools
import uuid
from typing import Any, Callable

from app.chat.engine import (
    ChatSpec,
    EngineCallbacks,
    EngineMessage,
    PermissionContext,
    PermissionDecision,
)

_PIDS = itertools.count(41000)


def init_message(session_id: str, model: str = "haiku", tools: list[str] | None = None, **data: Any) -> EngineMessage:
    base = {
        "permission_mode": "default", "cwd": "C:/work/proj", "additional_directories": [],
        "claude_code_version": "2.1.317", "api_key_source": "none", "mcp_servers": [],
        "tools": tools if tools is not None else ["Read", "Write", "Bash"], "slash_commands": [],
    }
    base.update(data)
    return EngineMessage(kind="init", session_id=session_id, model=model, data=base)


def assistant_text(text: str, message_id: str = "msg-1", model: str = "haiku") -> EngineMessage:
    return EngineMessage(kind="assistant", message_id=message_id, model=model,
                         blocks=[{"type": "text", "text": text}])


def result_message(**data: Any) -> EngineMessage:
    base = {"subtype": "success", "is_error": False, "terminal_reason": "end_turn",
            "cost_usd": 0.001, "duration_ms": 10, "num_turns": 1, "permission_denials": []}
    base.update(data)
    return EngineMessage(kind="result", data=base)


class FakeChatProcess:
    def __init__(self, engine: "FakeChatEngine", spec: ChatSpec, callbacks: EngineCallbacks):
        self.engine = engine
        self.spec = spec
        self.callbacks = callbacks
        self.pid = next(_PIDS)
        self.owner_task = asyncio.current_task()
        self.out: asyncio.Queue = asyncio.Queue()
        self.queries: list[str] = []
        self.calls: list[tuple] = []
        self.closed = False
        self.session_id = spec.resume or spec.session_id or str(uuid.uuid4())
        self.model = spec.model or "haiku"
        self._turns = 0
        self.permission_tasks: list[asyncio.Task] = []
        self.announced_model: str | None = None
        self.server_info_calls = 0

    def _check(self, name: str) -> None:
        if asyncio.current_task() is not self.owner_task:
            self.engine.violations.append(name)

    # -- ChatProcess ------------------------------------------------------------------------

    async def query(self, text: str) -> None:
        self._check("query")
        self.queries.append(text)
        self.calls.append(("query", text))
        await self.engine.on_query(self, text)

    async def interrupt(self) -> None:
        self._check("interrupt")
        self.calls.append(("interrupt",))
        self.engine.interrupts += 1
        if self.engine.reply_to_interrupt:
            self.push(result_message(subtype="error_during_execution", is_error=True,
                                     terminal_reason="aborted_streaming"))

    async def set_model(self, alias: str) -> None:
        """Like the real CLI (observed on 2.1.317): the call is answered at once and the new model
        shows only in the `init` of the NEXT turn (see `default_on_query`)."""
        self._check("set_model")
        self.calls.append(("set_model", alias))
        if self.engine.set_model_error is not None:
            raise self.engine.set_model_error
        self.model = alias

    async def set_permission_mode(self, mode: str) -> None:
        self._check("set_permission_mode")
        self.calls.append(("set_permission_mode", mode))

    async def get_mcp_status(self) -> dict:
        self._check("get_mcp_status")
        return self.engine.mcp_status

    async def get_server_info(self) -> dict:
        self._check("get_server_info")
        self.server_info_calls += 1
        return self.engine.server_info

    async def messages(self):
        while True:
            item = await self.out.get()
            if item is None:
                return
            yield item

    async def close(self) -> None:
        self._check("close")
        self.closed = True
        self.calls.append(("close",))
        self.out.put_nowait(None)

    # -- helpers for tests ------------------------------------------------------------------

    def push(self, *messages: EngineMessage) -> None:
        for message in messages:
            self.out.put_nowait(message)

    def die(self) -> None:
        """The process ends by itself (crash)."""
        self.out.put_nowait(None)

    def ask_permission(self, tool_name: str, tool_input: dict, suggestions: list[dict] | None = None,
                       tool_use_id: str = "toolu_1") -> asyncio.Task:
        """What the SDK does: call `can_use_tool` from its own task and wait."""
        task = asyncio.ensure_future(self.callbacks.can_use_tool(
            tool_name, tool_input, PermissionContext(tool_use_id=tool_use_id, suggestions=suggestions or []),
        ))
        self.permission_tasks.append(task)
        return task

    def withdraw_permission(self, task: asyncio.Task) -> None:
        """What the SDK does on a `control_cancel_request`: cancel the task of the callback (for
        example the other parallel tool calls after an interrupt)."""
        task.cancel()

    async def fire_stop(self) -> None:
        await self.callbacks.on_stop({"session_id": self.session_id})


async def default_on_query(process: FakeChatProcess, text: str) -> None:
    """An `init` when the turn is the first, when `/clear` gives the conversation a new id (the
    real CLI does, and the id of the very `init` is already the new one) or when the model changed
    since the last `init`; then an echo and the end of the turn."""
    process._turns += 1
    if text.strip() == "/clear":
        process.session_id = str(uuid.uuid4())
        process.announced_model = None
    if process._turns == 1 or text.strip() == "/clear" or process.announced_model != process.model:
        process.push(init_message(process.session_id, model=process.model))
        process.announced_model = process.model
    process.push(assistant_text(f"echo: {text}", message_id=f"msg-{process._turns}"), result_message())


class FakeChatEngine:
    def __init__(self) -> None:
        self.spawns = 0
        self.specs: list[ChatSpec] = []
        self.processes: list[FakeChatProcess] = []
        self.violations: list[str] = []
        self.interrupts = 0
        self.reply_to_interrupt = True
        self.fail_with: Exception | Callable[[ChatSpec], Exception | None] | None = None
        self.hang = False
        # A slow connect: `spawn` waits here until a test sets the event.
        self.gate: asyncio.Event | None = None
        self.mcp_status: dict = {"mcpServers": []}
        # What `get_server_info()` answers (the keys the product reads: commands, models).
        self.server_info: dict = {}
        # A refusal of the CLI to `set_model` (the control request fails).
        self.set_model_error: Exception | None = None
        self.on_query: Callable[[FakeChatProcess, str], Any] = default_on_query

    @property
    def last(self) -> FakeChatProcess:
        return self.processes[-1]

    async def spawn(self, spec: ChatSpec, callbacks: EngineCallbacks) -> FakeChatProcess:
        self.spawns += 1
        self.specs.append(spec)
        if self.hang:
            await asyncio.Event().wait()
        if self.gate is not None:
            await self.gate.wait()
        failure = self.fail_with(spec) if callable(self.fail_with) else self.fail_with
        if failure is not None:
            raise failure
        process = FakeChatProcess(self, spec, callbacks)
        self.processes.append(process)
        return process


# -- a runtime wired to a real ChatStore and the fake engine ---------------------------------------------

KEY = "proj::claude::abc123"
SESSION_UUID = "11111111-1111-4111-8111-111111111111"


class _ReadView:
    """The few reads of ChatStore, over plain sqlite3, for use after the store was closed."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def _query(self, sql: str, params: tuple = ()) -> list:
        import sqlite3

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    async def events_since(self, session_key: str, since: int, limit: int):
        import json

        rows = self._query("SELECT seq, ts, kind, payload FROM chat_events WHERE session_key = ? AND seq > ? "
                           "ORDER BY seq LIMIT ?", (session_key, since, limit))
        session = self._query("SELECT last_seq FROM chat_sessions WHERE session_key = ?", (session_key,))
        events = [{"seq": r["seq"], "ts": r["ts"], "kind": r["kind"], "payload": json.loads(r["payload"])}
                  for r in rows]
        return events, (session[0]["last_seq"] if session else 0), False

    async def get_permission(self, permission_id: str, session_key: str | None = None):
        from app.chat.store import _permission_from_row

        rows = self._query("SELECT * FROM permission_requests WHERE id = ?", (permission_id,))
        if not rows or (session_key is not None and rows[0]["session_key"] != session_key):
            return None
        return _permission_from_row(rows[0])

    async def get_chat_session(self, session_key: str):
        from app.chat.store import _session_from_row

        rows = self._query("SELECT * FROM chat_sessions WHERE session_key = ?", (session_key,))
        return _session_from_row(rows[0]) if rows else None


class Rig:
    """`async with Rig(db_path) as rig: runtime = await rig.start()`.

    Real SQLite, real SessionHub/ChatRuntime; only the engine is scripted. The hooks the
    service would provide are recorded in lists."""

    def __init__(self, db_path, *, session_key: str = KEY, resume: str | None = None, **spec_overrides):
        from app.chat.store import ChatStore

        self.db_path = str(db_path)
        self.session_key = session_key
        self.resume = resume
        self.spec_overrides = spec_overrides
        self.store = ChatStore(db_path=self.db_path)
        self.engine = FakeChatEngine()
        self.runtime = None
        self.stops: list[tuple] = []
        self.pending_calls: list[str] = []
        self.all_decided: list[str] = []
        self.id_changes: list[tuple] = []
        self.inits: list = []
        self.closed: list[str] = []

    async def __aenter__(self) -> "Rig":
        from app.chat.hub import SessionHub

        await self.store.initialize()
        await self.store.create_chat_session({
            "session_key": self.session_key, "project_ref": "proj", "agent_id": "claude",
            "cwd": "C:/work/proj",
        })
        self.hub = SessionHub(self.session_key, self.store)
        return self

    async def __aexit__(self, *exc) -> None:
        if self.runtime is not None and self.runtime.alive:
            await self.runtime.close("shutdown")
        await self.store.close()
        # After the block the tests still inspect what was stored: a read-only view.
        self.store = _ReadView(self.db_path)

    def hooks(self):
        from app.chat.runtime import RuntimeHooks

        async def on_stop(key, payload):
            self.stops.append((key, payload))

        async def on_pending(key):
            self.pending_calls.append(key)

        async def on_all_decided(key):
            self.all_decided.append(key)

        async def on_id_changed(key, previous, current):
            self.id_changes.append((key, previous, current))

        async def on_init(key, info):
            self.inits.append(info)

        async def state_payload(key):
            # The service's own producer, over this rig's store and runtime (no manager here).
            from types import SimpleNamespace

            from app.chat.service import ChatService

            alive = self.runtime if self.runtime is not None and self.runtime.alive else None
            stand_in = SimpleNamespace(chat_store=self.store, manager=SimpleNamespace(get=lambda _key: alive))
            return await ChatService.state_payload(stand_in, key)

        return RuntimeHooks(on_stop=on_stop, on_permission_pending=on_pending,
                            on_all_decided=on_all_decided, on_session_id_changed=on_id_changed,
                            on_closed=lambda key, runtime: self.closed.append(key),
                            state_payload=state_payload, on_init=on_init)

    def build(self, **extra):
        from app.chat.runtime import ChatRuntime

        base = dict(cli_path="C:/bin/claude.exe", cwd="C:/work/proj",
                    session_id=None if self.resume else SESSION_UUID, resume=self.resume,
                    connect_timeout=2.0)
        base.update(self.spec_overrides)
        base.update(extra)
        if isinstance(self.engine, FakeChatEngine):
            ChatRuntime.connector_settle_seconds = 0.2  # the fake has no connectors to wait for
            ChatRuntime.connector_poll_seconds = 0.02
        self.runtime = ChatRuntime(
            session_key=self.session_key, hub=self.hub, engine=self.engine, spec=ChatSpec(**base),
            hooks=self.hooks(), resumed=self.resume is not None, command_timeout=3.0,
        )
        return self.runtime

    async def start(self, **extra):
        runtime = self.build(**extra)
        await runtime.start()
        return runtime

    async def wait_for(self, predicate, timeout: float = 3.0) -> None:
        deadline = asyncio.get_running_loop().time() + timeout
        while not predicate():
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError("condition not reached in time")
            await asyncio.sleep(0.01)

    async def kinds(self) -> list[str]:
        events, _, _ = await self.store.events_since(self.session_key, 0, 1000)
        return [e["kind"] for e in events]

    async def events(self, kind: str | None = None) -> list[dict]:
        events, _, _ = await self.store.events_since(self.session_key, 0, 1000)
        return [e for e in events if kind is None or e["kind"] == kind]
