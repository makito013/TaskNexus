"""Filter for a third-party log record that is benign in this app's context.

## The symptom

When a PTY WebSocket client vanishes without closing the connection — the
canonical case being an iPad going to sleep mid-session, its WiFi radio powering
down and the TCP connection dying without a FIN — Windows raises
`OSError(winerror=121)` ("The semaphore timeout period has expired") on the
pending socket read.

That error is **not** a subclass of `ConnectionError` nor of `TimeoutError`, so it
escapes every specific `except` in
`websockets.legacy.protocol.transfer_data()` and lands in the generic one at the
end, which does:

    self.logger.error("data transfer failed", exc_info=True)   # protocol.py:1011

...dumping a ~25-line traceback into the terminal on every tablet sleep. The
library itself acknowledges the gap in the comment right above that line
("consider catching and handling more exceptions"). None of it goes through our
code: it happens entirely inside the dependency, and is unrelated to
`pty_manager.py`/pywinpty. It is log noise with no behavioural impact.

## Why the previous version of this module did not work

Two independent defects, and the second nullified the first even if the first had
been corrected:

1. **Wrong logger.** The filter was installed on `websockets.server`, the
   library's default (`websockets/legacy/server.py:126`). But uvicorn
   **overrides** the logger when constructing the protocol:

       logger=logging.getLogger("uvicorn.error")
       # uvicorn/protocols/websockets/websockets_impl.py:111

   So in production the record never reached the filtered logger. Worse:
   `test_logging_filters.py` exercised `websockets.server` and **passed** — the
   suite was internally consistent while validating a target that does not exist
   on the real path, which made the bug look fixed for months.

2. **Downgrading to WARNING silences nothing here.** The deploy runs with
   `--log-level warning`, so a WARNING record prints just the same. On top of
   that, mutating `record.levelno` inside a filter does not re-apply the logger's
   level cut (that already happened before the filter ran), so the handler emits
   the record regardless.

Hence the current approach: **drop** the record (`return False`) instead of
downgrading it, and cover both logger names.

## How the scope is kept narrow

Dropping log records is dangerous: swallowing a genuinely new failure in that
branch would hide a bug. So the filter requires **three** simultaneous
conditions — target logger, that branch's exact message, **and** an exception
that is recognisably an abrupt disconnect. Any other exception under the same
message passes through untouched, at ERROR, and shows up in the terminal again.

That is stricter than the previous version, which matched only (logger, message)
and would therefore have hidden any future error from that branch.
"""
from __future__ import annotations

import logging

# The two names this record can come out under. `uvicorn.error` is what actually
# happens today (uvicorn injects its own logger); `websockets.server` is the
# library default, kept because uvicorn's override is an implementation detail of
# uvicorn's — if it ever goes away, the noise must not come back.
_TARGET_LOGGER_NAMES = ("uvicorn.error", "websockets.server")

_TARGET_MESSAGE = "data transfer failed"

# Windows codes for "the other side vanished without closing". 121 is the one
# observed on iPad sleep; the rest are the same class of event under slightly
# different network conditions, and would surface the same useless traceback.
#   121   ERROR_SEM_TIMEOUT        semaphore expired (pending read abandoned)
#   64    ERROR_NETNAME_DELETED    network name is no longer available
#   1236  ERROR_CONNECTION_ABORTED connection aborted by the local system
#   10053 WSAECONNABORTED          software caused connection abort
#   10054 WSAECONNRESET            connection reset by peer
_BENIGN_WINERRORS = frozenset({121, 64, 1236, 10053, 10054})

# Portable equivalents, for the same event on macOS/Linux (deploy.sh), where
# there is no `winerror`. Both are OSError subclasses.
_BENIGN_EXC_TYPES = (ConnectionResetError, ConnectionAbortedError)


def _is_benign_disconnect(exc: BaseException | None) -> bool:
    """True only when the exception is the known "client vanished" event.

    Returns False for `None` on purpose: with no exception there is no way to
    assert this is that event, and when in doubt the record must survive.
    """
    if exc is None:
        return False
    if isinstance(exc, _BENIGN_EXC_TYPES):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "winerror", None) in _BENIGN_WINERRORS
    return False


class _BenignTransferErrorFilter(logging.Filter):
    """Drops the "data transfer failed" record when it is a known abrupt
    disconnect. Anything else passes through untouched."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name not in _TARGET_LOGGER_NAMES:
            return True
        if record.getMessage() != _TARGET_MESSAGE:
            return True

        # `exc_info` arrives as a (type, value, traceback) tuple: logging
        # resolves the library's `exc_info=True` via sys.exc_info() when the
        # record is created, before any filter runs.
        exc = record.exc_info[1] if record.exc_info else None
        return not _is_benign_disconnect(exc)


_installed = False


def install_benign_transfer_error_filter() -> None:
    """Register the filter on the target loggers. Idempotent — safe to call
    multiple times (test setup, module reload)."""
    global _installed
    if _installed:
        return
    log_filter = _BenignTransferErrorFilter()
    for name in _TARGET_LOGGER_NAMES:
        logging.getLogger(name).addFilter(log_filter)
    _installed = True
