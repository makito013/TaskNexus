"""Registry of live conversations: capacity, idleness, approval TTL, boot reconciliation
and shutdown (ADR-39, ADR-45, SA10)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Awaitable, Callable

from .engine import SpawnFailed
from .runtime import ChatRuntime
from .store import ChatStore

logger = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 30.0
_LIVE_STATUSES = ("new", "running", "idle")


class ClosedWhileStarting(Exception):
    """A close or terminate arrived while the process was coming up: it was closed as soon as
    it was up and is not registered."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class _Starting:
    """The reservation of a runtime that is still coming up: counts against the limit and is
    visible to `close`, which waits for `done`."""

    def __init__(self) -> None:
        self.done = asyncio.Event()
        self.close_reason: str | None = None


class ChatManager:
    def __init__(
        self,
        max_processes: int = 6,
        idle_timeout: float = 1800.0,
        pending_ttl: float = 14400.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_processes = max_processes
        self.idle_timeout = idle_timeout
        self.pending_ttl = pending_ttl
        self.clock = clock
        self._runtimes: dict[str, ChatRuntime] = {}
        self._starting: dict[str, _Starting] = {}
        self._sweeper: asyncio.Task | None = None

    # -- registry -------------------------------------------------------------------------------

    def get(self, session_key: str) -> ChatRuntime | None:
        runtime = self._runtimes.get(session_key)
        return runtime if runtime is not None and runtime.alive else None

    def active(self) -> dict[str, ChatRuntime]:
        return {key: rt for key, rt in self._runtimes.items() if rt.alive}

    def forget(self, session_key: str, runtime: ChatRuntime) -> None:
        if self._runtimes.get(session_key) is runtime:
            del self._runtimes[session_key]

    async def get_or_spawn(
        self, session_key: str, factory: Callable[[], Awaitable[ChatRuntime]]
    ) -> ChatRuntime:
        """The live runtime of the key, or a new one from `factory` (which builds and
        STARTS it). At capacity the least recently active idle runtime is closed first; with
        no idle one the spawn is refused (`capacity_exceeded`), never by killing a busy one.

        From the moment the room is found until the runtime is registered the key holds a
        reservation: it counts against the limit and `close` waits for it, so a terminate during
        the connect leaves neither a process nor a registered runtime behind. A close that
        arrived meanwhile closes the runtime right here and raises `ClosedWhileStarting`."""
        while True:
            existing = self.get(session_key)
            if existing is not None:
                return existing
            booting = self._starting.get(session_key)
            if booting is None:
                break
            await booting.done.wait()  # somebody else is bringing this key up
        starting = await self._reserve(session_key)
        try:
            runtime = await factory()
            if starting.close_reason is not None:
                await runtime.close(starting.close_reason)
                raise ClosedWhileStarting(starting.close_reason)
            self._runtimes[session_key] = runtime
            return runtime
        finally:
            self._starting.pop(session_key, None)
            starting.done.set()

    async def _reserve(self, session_key: str) -> _Starting:
        """Find room (evicting idle runtimes) and take the reservation with no `await` in
        between, so concurrent starts cannot all pass the same check."""
        while True:
            if session_key in self._starting:
                raise SpawnFailed("process_error", "this conversation is already starting")
            if len(self.active()) + len(self._starting) < self.max_processes:
                starting = self._starting[session_key] = _Starting()
                return starting
            idle = [rt for rt in self.active().values() if rt.idle]
            if not idle:
                raise SpawnFailed("capacity_exceeded", f"{self.max_processes} conversations are running")
            victim = min(idle, key=lambda rt: rt.last_activity)
            await victim.close("capacity")

    # -- housekeeping ---------------------------------------------------------------------------

    async def sweep(self) -> None:
        """One pass: close what has been idle too long; expire approvals nobody answered."""
        now = self.clock()
        for runtime in list(self.active().values()):
            oldest_pending = min((p.created for p in runtime.pending.values()), default=None)
            if oldest_pending is not None and now - oldest_pending > self.pending_ttl:
                await runtime.close("expired")
            elif runtime.idle and now - runtime.last_activity > self.idle_timeout:
                await runtime.close("idle")

    def start_sweeper(self, interval: float = SWEEP_INTERVAL_SECONDS) -> None:
        if self._sweeper is not None:
            return

        async def loop() -> None:
            while True:
                await asyncio.sleep(interval)
                try:
                    await self.sweep()
                except Exception:  # noqa: BLE001 - housekeeping never ends the backend
                    logger.exception("chat: sweep failed")

        self._sweeper = asyncio.get_running_loop().create_task(loop(), name="chat-sweeper")

    async def shutdown(self, timeout: float = 15.0) -> None:
        """Close everything. Never raises: a stuck CLI must not keep the rest of the backend's
        shutdown from running (each runtime has its own `timeout`, then its task is cancelled)."""
        if self._sweeper is not None:
            self._sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._sweeper
            self._sweeper = None
        starting = list(self._starting.values())
        for entry in starting:
            entry.close_reason = entry.close_reason or "shutdown"
        runtimes = list(self._runtimes.values())
        try:
            if starting:
                await asyncio.wait_for(
                    asyncio.gather(*(entry.done.wait() for entry in starting)), timeout + 5
                )
            runtimes = list(self._runtimes.values())
            if runtimes:
                await asyncio.wait_for(
                    asyncio.gather(*(rt.close("shutdown", timeout=timeout) for rt in runtimes),
                                   return_exceptions=True),
                    timeout + 5,
                )
        except Exception:  # noqa: BLE001 - includes the timeout; the process is leaving anyway
            logger.exception("chat: shutdown did not finish cleanly")
        self._runtimes.clear()

    async def close(self, session_key: str, reason: str) -> None:
        starting = self._starting.get(session_key)
        if starting is not None:
            starting.close_reason = starting.close_reason or reason
            await starting.done.wait()
        runtime = self._runtimes.get(session_key)
        if runtime is not None:
            await runtime.close(reason)

    # -- boot -----------------------------------------------------------------------------------

    @staticmethod
    async def reconcile_on_boot(store: ChatStore) -> dict:
        """No process survives a restart: live-looking sessions become `stopped`, their owner
        mark is cleared, and approvals nobody can answer any more are `expired` (with the
        event that tells the log so)."""
        stopped = 0
        for session in await store.list_chat_sessions():
            if session["status"] in _LIVE_STATUSES or session["runtime_owner_pid"] is not None:
                await store.update_chat_session(
                    session["session_key"],
                    status="stopped" if session["status"] in _LIVE_STATUSES else session["status"],
                    runtime_owner_pid=None,
                )
                stopped += 1
        expired = await store.close_pending(None, "expired")
        for row in expired:
            await store.append_event(row["session_key"], "permission.resolved", {
                "id": row["id"], "status": "expired", "scope": "once", "by": "system",
            })
        return {"stopped": stopped, "expired": len(expired)}
