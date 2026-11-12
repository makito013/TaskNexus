"""Regression tests for the subprocess-pipe case of app.asyncio_patches.

The Proactor workaround used to call `sock.shutdown()` on every transport's
`_sock`. A subprocess pipe holds a `PipeHandle` there, which has no `shutdown`,
so the wrapper raised `AttributeError` before delegating to the original. These
tests prove the pipe path now delegates untouched and that a real subprocess
(the way the chat engine talks to the `claude` CLI) shuts down cleanly.
"""
from __future__ import annotations

import asyncio
import gc
import sys
import warnings

import pytest

from app import asyncio_patches

pytestmark = pytest.mark.skipif(
    sys.platform != "win32",
    reason="_ProactorBasePipeTransport and this workaround are Windows-only",
)


class _PipeHandleLike:
    """Stand-in for a PipeHandle: closable, but without `shutdown()`."""

    def __init__(self) -> None:
        self.close_calls = 0

    def fileno(self) -> int:
        return 7

    def close(self) -> None:
        self.close_calls += 1


class _Protocol:
    def __init__(self) -> None:
        self.connection_lost_calls = 0

    def connection_lost(self, exc) -> None:  # noqa: ANN001
        self.connection_lost_calls += 1


def _build_pipe_transport():
    from asyncio.proactor_events import _ProactorBasePipeTransport

    transport = object.__new__(_ProactorBasePipeTransport)
    transport._called_connection_lost = False
    transport._protocol = _Protocol()
    transport._sock = _PipeHandleLike()
    transport._server = None
    transport._closing = True
    transport._read_fut = None
    return transport


def test_pipe_transport_delegates_to_original_and_closes_the_handle_once():
    asyncio_patches.install_proactor_connection_lost_patch()

    transport = _build_pipe_transport()
    handle = transport._sock
    protocol = transport._protocol

    transport._call_connection_lost(None)  # must not raise AttributeError

    # The stdlib original ran exactly once: the protocol was notified, the
    # idempotency flag is set and its own `close()` released the handle. A
    # wrapper that pre-closed the handle would make `close_calls` 2.
    assert protocol.connection_lost_calls == 1
    assert transport._called_connection_lost is True
    assert handle.close_calls == 1
    assert transport._sock is None


def _run_real_subprocess() -> tuple[list[dict], list[bool]]:
    """Run a short subprocess on a fresh ProactorEventLoop and collect diagnostics.

    Returns the contexts the loop's exception handler received and the
    `is_closing()` state of each pipe transport after the process ended.
    """
    contexts: list[dict] = []
    closing: list[bool] = []

    async def scenario() -> None:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "print(1)",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        await proc.wait()
        # Let the scheduled `_call_connection_lost` callbacks run.
        await asyncio.sleep(0.2)
        for fd in (0, 1, 2):
            pipe = proc._transport.get_pipe_transport(fd)
            if pipe is not None:
                closing.append(pipe.is_closing())

    loop = asyncio.ProactorEventLoop()
    loop.set_exception_handler(lambda _loop, context: contexts.append(context))
    try:
        # Without the pipe fix the process is never reported as finished and
        # `wait()` hangs; the timeout turns that into a test failure.
        loop.run_until_complete(asyncio.wait_for(scenario(), timeout=20))
    finally:
        loop.close()
    return contexts, closing


def test_real_subprocess_shuts_down_cleanly_with_the_patch():
    asyncio_patches.install_proactor_connection_lost_patch()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        contexts, closing = _run_real_subprocess()
        gc.collect()

    attribute_errors = [
        c for c in contexts if isinstance(c.get("exception"), AttributeError)
    ]
    assert attribute_errors == []
    assert contexts == []
    assert [w for w in caught if issubclass(w.category, ResourceWarning)] == []
    assert closing and all(closing)


def test_canary_real_subprocess_is_clean_without_the_patch(monkeypatch):
    """The bug lives only in the wrapper: the stdlib method alone is fine here."""
    asyncio_patches.install_proactor_connection_lost_patch()
    from asyncio.proactor_events import _ProactorBasePipeTransport

    original = asyncio_patches._original_call_connection_lost
    monkeypatch.setattr(_ProactorBasePipeTransport, "_call_connection_lost", original)

    contexts, closing = _run_real_subprocess()

    assert contexts == []
    assert closing and all(closing)
