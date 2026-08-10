"""Testes do backend Windows de PTYProcess (ConPTY via pywinpty). Só roda em
Windows — em Mac/Linux, pytest.mark.skipif pula o módulo inteiro, mesmo
espírito de test_pty_manager.py ser POSIX-only (roda só no seu SO)."""
import concurrent.futures
import os
import subprocess
import sys
import tempfile
import threading

import pytest
import pytest_asyncio
import asyncio

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows-only backend")

from app.pty_manager import PTYManager, PTYProcess, _PENDING_REAPS


@pytest_asyncio.fixture(autouse=True)
async def _drain_pending_reaps():
    yield
    pending = [t for t in _PENDING_REAPS if not t.done()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


@pytest.mark.asyncio
async def test_spawn_and_read():
    mgr = PTYManager()
    proc = mgr.spawn("test", [sys.executable, "-c", "print('hello')"], cwd=tempfile.gettempdir())
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.5)
            if not chunk:
                break
            output += chunk
        except TimeoutError:
            break
    mgr.terminate("test")
    assert b"hello" in output


@pytest.mark.asyncio
async def test_spawn_creates_active_process():
    mgr = PTYManager()
    proc = mgr.spawn("s1", [sys.executable, "-c", "import time; time.sleep(0.5)"], cwd=tempfile.gettempdir())
    assert proc.active is True
    mgr.terminate("s1")


@pytest.mark.asyncio
async def test_terminate_removes_session():
    mgr = PTYManager()
    mgr.spawn("s2", [sys.executable, "-c", "import time; time.sleep(2)"], cwd=tempfile.gettempdir())
    mgr.terminate("s2")
    assert mgr.get("s2") is None


@pytest.mark.asyncio
async def test_write_and_read():
    mgr = PTYManager()
    proc = mgr.spawn(
        "s3",
        [sys.executable, "-c", "import sys; line=sys.stdin.readline(); print('echo:'+line.strip())"],
        cwd=tempfile.gettempdir(),
    )
    await asyncio.sleep(0.3)
    # Windows console cooked-mode line input completes a line on CR, unlike
    # POSIX canonical mode where a bare LF already is the EOL character (see
    # the equivalent test_write_and_read in test_pty_manager.py, which writes
    # b"world\n" and works because POSIX doesn't need the CR). Confirmed
    # empirically against real ConPTY: b"oi\n" alone never reaches the
    # child's stdin.readline() — the console just buffers it as a
    # not-yet-terminated line until the process is killed.
    await proc.write(b"oi\r\n")
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.5)
            if not chunk:
                break
            output += chunk
            if b"echo:oi" in output:
                break
        except TimeoutError:
            break
    mgr.terminate("s3")
    assert b"echo:oi" in output


@pytest.mark.asyncio
async def test_resize_does_not_raise():
    mgr = PTYManager()
    proc = mgr.spawn("s4", [sys.executable, "-c", "import time; time.sleep(1)"], cwd=tempfile.gettempdir())
    proc.resize(120, 40)
    assert proc.cols == 120
    assert proc.rows == 40
    mgr.terminate("s4")


@pytest.mark.asyncio
async def test_terminate_while_read_blocked_does_not_leak_thread():
    """Regression test for the executor-thread leak in terminate().

    _windows_read_loop reads via
    `self.loop.run_in_executor(None, self._winpty_proc.read, 4096)` — the
    default executor, whose worker threads are NOT daemon threads. If the
    child process is alive but has produced no output yet, that call is
    genuinely blocked inside pywinpty's `PtyProcess.read()`
    (`self.fileobj.recv(size)`, a blocking socket recv).

    Before the fix, terminate()/`_cleanup()` called
    `self._winpty_proc.terminate(force=True)`, which kills the child process
    but never touches the fileobj/socket the executor thread is blocked
    reading from — so that thread's work item never returns.

    Note this can't be observed via `Thread.is_alive()` on the executor's
    worker thread: `ThreadPoolExecutor` worker threads loop forever waiting
    for the *next* submitted work item — they stay alive regardless of
    whether any given work item (here, the blocking `read()` call) ever
    completes. The actual observable symptom (matching the real-world bug —
    `shutdown_default_executor()` hanging at interpreter/loop shutdown) is
    that `executor.shutdown(wait=True)` blocks forever, because it joins
    every worker thread and a thread stuck mid-work-item never reaches the
    "check for shutdown sentinel" point in its loop. So this test proves the
    leak by running `executor.shutdown(wait=True)` on a background thread
    and asserting that background thread finishes within a bounded time.

    Before the fix: the blocked `recv()` never unblocks, `shutdown(wait=True)`
    never returns, and the join below times out (proving the leak).
    After the fix: `terminate()` calls `self._winpty_proc.close(force=True)`,
    which explicitly closes the fileobj/socket first — unblocking the
    pending `recv()` promptly, the work item completes, and
    `shutdown(wait=True)` returns well within the timeout.

    A dedicated ThreadPoolExecutor is installed as this test's event loop
    default executor so we control exactly which pool is being shut down (no
    interference/reuse from other tests' executor threads).
    """
    loop = asyncio.get_running_loop()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    loop.set_default_executor(executor)

    mgr = PTYManager()
    proc = mgr.spawn(
        "s5",
        [sys.executable, "-c", "import time; time.sleep(30)"],
        cwd=tempfile.gettempdir(),
    )
    # Give _windows_read_loop time to actually enter run_in_executor and
    # block inside proc.read() — the child process just sleeps, so it never
    # produces output for the read to return.
    await asyncio.sleep(0.5)
    assert executor._threads, "expected the blocking read to have spawned an executor thread"

    mgr.terminate("s5")

    shutdown_thread = threading.Thread(target=executor.shutdown, kwargs={"wait": True})
    shutdown_thread.start()
    shutdown_thread.join(timeout=5.0)

    # This is the assertion that would fail (thread still alive, meaning
    # shutdown(wait=True) is stuck) before the fix, and passes after it.
    assert not shutdown_thread.is_alive(), (
        "executor.shutdown(wait=True) is still blocked 5s after terminate() — "
        "the blocking winpty read leaked a non-daemon executor thread"
    )


@pytest.mark.asyncio
async def test_terminate_after_child_killed_externally_does_not_leak_thread():
    """Regression test for a residual leak found in the final whole-branch
    review, one layer deeper than test_terminate_while_read_blocked_does_not_
    leak_thread above: pywinpty's `isalive()` mutates `proc.closed = not
    alive` as a side effect, and `close()` starts with `if not self.closed:
    ...` — so if ANYTHING calls `isalive()` on an already-dead child before
    `close()` runs, `close()` silently becomes a permanent no-op regardless
    of whether the caller (terminate()/_cleanup()/_handle_eof()) still gates
    on isalive() itself or not.

    Reproduces the specific real-world trigger the review identified: a
    child killed abruptly via TerminateProcess (Task Manager, `taskkill /F`,
    an external supervisor) does NOT deliver EOF through ConPTY — confirmed
    empirically that a normal process exit delivers EOF in ~0.1s, but a
    TerminateProcess'd one does not. So the blocking read stays parked even
    though the child is already dead, and `terminate()` gets called on a
    proc whose child died entirely outside any pywinpty-mediated path (no
    prior isalive()/close() call has touched `proc.closed` yet).

    Before the fix (this test targets the SAME code as the test above, just
    a different trigger for the identical no-op): if any isalive() gate
    remained ahead of close(), this would hang identically to the previous
    test. After the fix (no isalive() gate anywhere ahead of close() in this
    file's code paths), `close()` runs for real and the socket unblocks.
    """
    loop = asyncio.get_running_loop()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    loop.set_default_executor(executor)

    mgr = PTYManager()
    proc = mgr.spawn(
        "s6",
        [sys.executable, "-c", "import time; time.sleep(30)"],
        cwd=tempfile.gettempdir(),
    )
    await asyncio.sleep(0.5)
    assert executor._threads, "expected the blocking read to have spawned an executor thread"

    # Kill the real OS process directly (bypassing every pywinpty method),
    # matching the TerminateProcess trigger the review reproduced against
    # real ConPTY — nothing here touches proc._winpty_proc.closed.
    child_pid = proc._winpty_proc.pid
    subprocess.run(["taskkill", "/F", "/PID", str(child_pid)], capture_output=True)
    await asyncio.sleep(0.3)

    mgr.terminate("s6")

    shutdown_thread = threading.Thread(target=executor.shutdown, kwargs={"wait": True})
    shutdown_thread.start()
    shutdown_thread.join(timeout=5.0)

    assert not shutdown_thread.is_alive(), (
        "executor.shutdown(wait=True) is still blocked 5s after terminate() on an "
        "externally-killed child — close() likely became a no-op because something "
        "called isalive() (which mutates proc.closed) before close() ran"
    )


@pytest.mark.asyncio
async def test_spawn_with_invalid_cwd_raises_oserror_not_winpty_error():
    """Regression test: winpty.PtyProcess.spawn raises winpty.WinptyError for
    an invalid/missing cwd — which does NOT inherit from OSError, unlike the
    POSIX backend's FileNotFoundError/NotADirectoryError for the equivalent
    case. main.py's WebSocket handler (`pty_endpoint`) only gracefully
    degrades a spawn failure it recognizes as OSError, to avoid an
    unconditional-reconnect storm on real spawn errors — _spawn_windows must
    wrap any non-OSError spawn failure into an OSError so that contract
    holds identically on both platforms."""
    missing_dir = os.path.join(tempfile.gettempdir(), "this-directory-does-not-exist-xyz123")
    with pytest.raises(OSError):
        PTYProcess([sys.executable, "-c", "pass"], cwd=missing_dir)
