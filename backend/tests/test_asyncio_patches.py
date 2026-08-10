"""Tests for the app.asyncio_patches workaround.

These prove, deterministically and without any network, both the CPython bug
described in that module's docstring AND that the workaround fixes it.

The transport instance is built with `object.__new__` instead of the real
`__init__` because `_ProactorBasePipeTransport.__init__` demands a live loop and
a real socket/pipe — while `_call_connection_lost` only reads four attributes,
all set by hand here. That keeps the test deterministic and cheap.
"""
from __future__ import annotations

import sys

import pytest

from app import asyncio_patches

pytestmark = pytest.mark.skipif(
    sys.platform != "win32",
    reason="_ProactorBasePipeTransport and this workaround are Windows-only",
)


class _FakeSocket:
    """Socket whose shutdown() fails the way a reset peer's socket does."""

    def __init__(self) -> None:
        self.closed = False
        self.shutdown_attempted = False

    def fileno(self) -> int:
        # A real socket returns -1 once closed, and that is exactly what the
        # stdlib guard consults.
        return -1 if self.closed else 1

    def shutdown(self, how: int) -> None:
        self.shutdown_attempted = True
        raise ConnectionResetError(
            10054, "An existing connection was forcibly closed by the remote host"
        )

    def close(self) -> None:
        self.closed = True


class _FakeProtocol:
    def __init__(self) -> None:
        self.connection_lost_calls = 0

    def connection_lost(self, exc) -> None:  # noqa: ANN001
        self.connection_lost_calls += 1


class _FakeServer:
    def __init__(self) -> None:
        self.detached = False

    def _detach(self, *args) -> None:
        # Accepts 0 or 1 argument: the signature changed between 3.12
        # (`_detach()`) and 3.14 (`_detach(transport)`), and the workaround lets
        # the stdlib call it the way its own version does — this fake must not
        # trip on that.
        self.detached = True


def _build_transport():
    from asyncio.proactor_events import _ProactorBasePipeTransport

    transport = object.__new__(_ProactorBasePipeTransport)
    transport._called_connection_lost = False
    transport._protocol = _FakeProtocol()
    transport._sock = _FakeSocket()
    transport._server = _FakeServer()
    # The transport's `__del__` reads `_closing`, and its `__repr__` reads
    # `_read_fut`; without both, garbage collection during the test emits a noisy
    # "Exception ignored in __del__" AttributeError.
    transport._closing = True
    transport._read_fut = None
    return transport


def test_unpatched_stdlib_aborts_the_cleanup():
    """Documents the bug: without the workaround, CPython's `finally` is aborted.

    This test does NOT exercise the workaround — it calls the original method
    that the module stashed away. It exists so that if CPython ever fixes the
    line, this test fails and announces that the workaround can be removed.
    """
    asyncio_patches.install_proactor_connection_lost_patch()
    original = asyncio_patches._original_call_connection_lost
    assert original is not None, "the workaround did not stash the original method"

    transport = _build_transport()
    sock = transport._sock  # the stdlib nulls _sock at the end of its finally
    server = transport._server

    with pytest.raises(ConnectionResetError):
        original(transport, None)

    # The three effects of the bug. If this ever fails, CPython fixed the line
    # and `app/asyncio_patches.py` can go.
    assert sock.closed is False
    assert server.detached is False
    assert transport._called_connection_lost is False


def test_patched_completes_the_cleanup_and_does_not_raise():
    """The case that used to break: an abrupt disconnect must not raise."""
    asyncio_patches.install_proactor_connection_lost_patch()

    transport = _build_transport()
    sock = transport._sock
    server = transport._server
    protocol = transport._protocol

    transport._call_connection_lost(None)

    # The shutdown WAS attempted (preserving the stdlib's intent), and its
    # failure blocked nothing.
    assert sock.shutdown_attempted is True

    # And the whole cleanup happened — the bug's three effects, fixed.
    assert sock.closed is True
    assert server.detached is True
    assert transport._called_connection_lost is True

    # The protocol was notified exactly ONCE: the workaround never re-runs the
    # original method, which was the risk of wrapping it in a try/except.
    assert protocol.connection_lost_calls == 1


def test_second_call_is_a_no_op():
    """With the idempotency flag set, calling again must do nothing.

    This is the guarantee the bug disarmed: without the workaround,
    `_called_connection_lost` stayed False and `protocol.connection_lost()` would
    run a second time.
    """
    asyncio_patches.install_proactor_connection_lost_patch()

    transport = _build_transport()
    transport._call_connection_lost(None)
    protocol = transport._protocol

    transport._call_connection_lost(None)

    assert protocol.connection_lost_calls == 1


def test_healthy_socket_is_also_cleaned_up():
    """Happy path: a shutdown that succeeds must not change the outcome."""
    asyncio_patches.install_proactor_connection_lost_patch()

    class _HealthySocket(_FakeSocket):
        def shutdown(self, how: int) -> None:
            self.shutdown_attempted = True  # no raise

    transport = _build_transport()
    transport._sock = _HealthySocket()
    sock = transport._sock
    server = transport._server

    transport._call_connection_lost(None)

    assert sock.closed is True
    assert server.detached is True
    assert transport._called_connection_lost is True
    # A nulled _sock is itself proof that the stdlib's finally ran to the end.
    assert transport._sock is None


def test_missing_socket_does_not_break():
    """An already-cleaned transport (e.g. via _force_close) must not raise."""
    asyncio_patches.install_proactor_connection_lost_patch()

    transport = _build_transport()
    transport._sock = None
    transport._called_connection_lost = True  # the stdlib returns early here

    transport._call_connection_lost(None)  # must not raise


def test_install_is_idempotent():
    """Installing twice must not stack wrappers.

    Stacking would be functionally harmless here, but every extra layer is one
    more shutdown()/close() per disconnect — and a sign the install guard broke.
    """
    from asyncio.proactor_events import _ProactorBasePipeTransport

    asyncio_patches.install_proactor_connection_lost_patch()
    after_first = _ProactorBasePipeTransport._call_connection_lost

    asyncio_patches.install_proactor_connection_lost_patch()
    asyncio_patches.install_proactor_connection_lost_patch()

    assert _ProactorBasePipeTransport._call_connection_lost is after_first


def test_main_actually_wires_the_patch():
    """Guards against the workaround existing but never being installed.

    This is the same failure class as the wrong-logger bug in logging_filters:
    the unit tests above all call `install_...()` themselves, so they would keep
    passing while production never ran it — which is exactly what happened when
    this module was first written and nothing imported it.

    Asserting on `asyncio_patches._installed` would NOT catch it: other tests in
    the same process already flip that flag. So this inspects `app.main` itself —
    that it imports the symbol, and that it actually calls it.
    """
    import inspect

    import app.main

    assert (
        app.main.install_proactor_connection_lost_patch
        is asyncio_patches.install_proactor_connection_lost_patch
    ), "app.main does not import the installer"

    source = inspect.getsource(app.main)
    assert "install_proactor_connection_lost_patch()" in source, (
        "app.main imports the installer but never calls it — the workaround "
        "would be dead code in production"
    )


def test_no_op_outside_windows(monkeypatch):
    """Sanity-check the platform guard without needing to run on POSIX."""
    monkeypatch.setattr(asyncio_patches, "_installed", False)
    monkeypatch.setattr(asyncio_patches.sys, "platform", "linux")

    from asyncio.proactor_events import _ProactorBasePipeTransport

    before = _ProactorBasePipeTransport._call_connection_lost
    asyncio_patches.install_proactor_connection_lost_patch()

    assert _ProactorBasePipeTransport._call_connection_lost is before
    assert asyncio_patches._installed is False
