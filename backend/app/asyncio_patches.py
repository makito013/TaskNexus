"""Workaround for a CPython bug in the Proactor transport (Windows).

## The bug

`asyncio.proactor_events._ProactorBasePipeTransport._call_connection_lost` does,
in CPython 3.12.10 **and still in 3.14**:

    def _call_connection_lost(self, exc):
        if self._called_connection_lost:
            return
        try:
            self._protocol.connection_lost(exc)
        finally:
            # XXX If there is a pending overlapped read on the other
            # end then it may fail with ERROR_NETNAME_DELETED if we
            # just close our end.  First calling shutdown() seems to
            # cure it, but maybe using DisconnectEx() would be better.
            if hasattr(self._sock, 'shutdown') and self._sock.fileno() != -1:
                self._sock.shutdown(socket.SHUT_RDWR)   # <-- no try/except
            self._sock.close()
            self._sock = None
            server = self._server
            if server is not None:
                server._detach()
                self._server = None
            self._called_connection_lost = True

When the peer has already reset the connection — the canonical case here is an
iPad going to sleep in the middle of a PTY session — `shutdown()` raises
`ConnectionResetError` (WinError 10054). There is no `try/except`, so the
exception escapes the `finally` **before** the cleanup, which means:

- `self._sock.close()` never runs -> the socket handle stays open (the GC closes
  it later via `__del__`, non-deterministically)
- `server._detach()` never runs -> `Server._active_count` **never decrements**,
  and `Server.wait_closed()` (which uvicorn's graceful shutdown calls) ends up
  waiting on connections that are long dead
- `self._called_connection_lost = True` never runs -> the idempotency guard at
  the top of the method is disarmed, so a second invocation would call
  `protocol.connection_lost()` **again**

And because this is a `call_soon` callback, the exception lands in the event
loop's exception handler, which dumps "Exception in callback
_ProactorBasePipeTransport._call_connection_lost" plus a traceback into the
terminal on every disconnect.

All three effects are verified deterministically in
`tests/test_asyncio_patches.py`.

## Upstream status

gh-83191 ("ProactorEventLoop raises unhandled ConnectionResetError") has been
**open** since 2019; the 2020 PRs addressed a different aspect (cancelled
futures) in 3.8-3.10. gh-149388 is the neighbour — same method, but
`PipeHandle.close()` with WinError 6 — and was fixed in 3.13/3.14/3.15 without
touching this line. Confirmed by reading the 3.14 source: the `shutdown()` line
is still unguarded.

Since Python 3.12 has been in security-only phase since 2025-10, a bug fix would
not be backported here anyway. This workaround is meant to last.

## Why it does NOT replicate the stdlib cleanup

The tempting fix is to rewrite `_call_connection_lost` entirely with the missing
`try/except`. That would duplicate CPython internals — including the signature
of `server._detach()`, which gained an argument between 3.12 and 3.14 — and force
a review on every Python upgrade.

Wrapping the original in a `try/except` and re-running it does not work either:
`protocol.connection_lost(exc)` sits in the `try`, **before** the `finally`, so it
has already run by the time the exception surfaces — re-running would notify the
protocol twice.

Neutralising `shutdown` on the socket instance is impossible too:
`socket.socket` defines `__slots__` and rejects new attributes.

The way out is to use the guard the stdlib already has. By closing the socket
**before** delegating, `fileno()` starts returning -1, the condition
`self._sock.fileno() != -1` becomes false, the problematic `shutdown()` is
skipped, and the `finally` runs to completion — socket `close()` is idempotent in
CPython (maintainer statement in gh-149388), `_detach()` happens with whatever
signature this version uses, and the flag gets set. Zero internals replicated.

## Accepted behaviour delta

The stdlib calls `shutdown()`/`close()` **after** `protocol.connection_lost(exc)`;
here they happen before. So a protocol that inspected the socket inside
`connection_lost` would see a closed socket.

Accepted because: (a) `_call_connection_lost` is only scheduled once the
connection is already dead, so the socket has no legitimate use there; (b)
uvicorn's/websockets' `connection_lost` only resolves futures and clears state,
never touching the socket. If that ever changes, the symptom would be an error
inside `connection_lost` — not silence.
"""
from __future__ import annotations

import socket
import sys

_installed = False

# Keeps the original method around so tests can exercise the pre-workaround
# behaviour. That backs the canary test which fails if CPython ever fixes the
# line — the signal that this module can be deleted.
_original_call_connection_lost = None


def install_proactor_connection_lost_patch() -> None:
    """Apply the workaround. No-op outside Windows, and idempotent.

    Outside Windows there is no `ProactorEventLoop`, so importing the module
    would not even make sense — POSIX uses `selector_events`, which lacks this
    bug.
    """
    global _installed, _original_call_connection_lost
    if _installed or sys.platform != "win32":
        return

    from asyncio import proactor_events

    target = proactor_events._ProactorBasePipeTransport
    original = target._call_connection_lost
    _original_call_connection_lost = original

    def _call_connection_lost(self, exc):  # noqa: ANN001, ANN202
        sock = getattr(self, "_sock", None)
        if sock is not None:
            # Preserve the intent of the stdlib's `shutdown()` (avoiding
            # ERROR_NETNAME_DELETED on a pending read at the other end) while
            # tolerating failure: if the peer already reset, there is nothing
            # left to preserve.
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            # Close here on purpose: with fileno() == -1 the stdlib guard skips
            # the shutdown that would raise, letting its `finally` complete
            # `_detach()` and the idempotency flag as usual.
            try:
                sock.close()
            except OSError:
                pass
        return original(self, exc)

    target._call_connection_lost = _call_connection_lost
    _installed = True
