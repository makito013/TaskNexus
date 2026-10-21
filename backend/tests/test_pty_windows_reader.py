"""Tests for the Windows PTY output pump (`app.pty_manager._pump_winpty_output`).

pywinpty's own reader thread (`winpty.ptyprocess._read_in_thread`, 2.0.14)
stops at the first `pty.iseof()` that follows a read, so output conhost
renders after that instant is lost. That is typically the last thing a child
writes right before it exits. An empty read also ends the thread, through
the `b'0011Ignore'` sentinel and a TypeError. The pump replaces that thread.
It keeps draining for a short grace period after EOF and never stops on an
empty read.

The pump itself is plain Python over a socket, so the scripted-PTY tests run
on every platform. Only the end-to-end ConPTY test is Windows-only.
"""
import socket
import sys
import tempfile
import threading
import time

import pytest

from app import pty_manager


class ScriptedPty:
    """Stand-in for `winpty.PTY`. `read()` pops the scripted chunks (then
    returns "" forever) and `iseof()` turns true once `read()` has been
    called `eof_after_reads` times. That models a child that already exited
    while conhost still holds unread output."""

    def __init__(self, chunks, eof_after_reads):
        self._chunks = list(chunks)
        self._reads = 0
        self._eof_after_reads = eof_after_reads

    def read(self, size=4096, blocking=True):
        self._reads += 1
        return self._chunks.pop(0) if self._chunks else ""

    def iseof(self):
        return self._reads >= self._eof_after_reads


def _run_pump(pty, *, drain_seconds=0.25, timeout=5.0):
    """Wire the pump to a loopback socket the same way PtyProcess does
    (listen, start the thread, accept) and return everything it sent before
    closing, plus how long the pump thread took to finish."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    started = time.monotonic()
    thread = threading.Thread(
        target=pty_manager._pump_winpty_output,
        args=(server.getsockname(), pty, True),
        kwargs={"drain_seconds": drain_seconds},
        daemon=True,
    )
    thread.start()
    conn, _ = server.accept()
    conn.settimeout(timeout)
    received = b""
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                break
            received += data
    finally:
        conn.close()
        server.close()
    thread.join(timeout)
    assert not thread.is_alive(), "pump thread did not finish"
    return received, time.monotonic() - started


def test_pump_forwards_output_that_arrives_after_eof():
    pty = ScriptedPty(["frame-1 ", "GOT:hi"], eof_after_reads=1)
    received, _ = _run_pump(pty)
    assert received == b"frame-1 GOT:hi"


def test_pump_does_not_stop_on_an_empty_read():
    pty = ScriptedPty(["", "data"], eof_after_reads=2)
    received, _ = _run_pump(pty)
    assert received == b"data"


def test_pump_never_sends_the_empty_read_sentinel():
    pty = ScriptedPty(["a", "", "b"], eof_after_reads=3)
    received, _ = _run_pump(pty)
    assert b"0011Ignore" not in received
    assert received == b"ab"


def test_pump_drain_after_eof_is_bounded():
    pty = ScriptedPty(["only"], eof_after_reads=1)
    received, elapsed = _run_pump(pty, drain_seconds=0.2)
    assert received == b"only"
    assert elapsed < 2.0


@pytest.mark.skipif(sys.platform != "win32", reason="ConPTY backend is Windows-only")
@pytest.mark.asyncio
async def test_windows_ptyprocess_uses_the_draining_reader_end_to_end():
    proc = pty_manager.PTYProcess(
        [sys.executable, "-c", "import os; os.write(1, b'BYE-MARKER')"],
        cwd=tempfile.gettempdir(),
    )
    try:
        assert isinstance(proc._winpty_proc, pty_manager._DrainingPtyProcess)
        output = b""
        while True:
            chunk = await proc.read(timeout=10)
            if not chunk:
                break
            output += chunk
        assert b"BYE-MARKER" in output
    finally:
        proc.terminate()
