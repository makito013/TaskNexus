# backend/tests/test_pty_manager.py
import pytest
import pytest_asyncio
import asyncio
import os
import signal
import struct
import sys
import time

# fcntl/termios don't exist on Windows. This whole module is POSIX-only (see
# pytestmark below, mirroring the inverse skipif in
# test_pty_manager_windows.py) — but pytest must import the module to even
# discover pytestmark, so the imports themselves must be guarded, not just
# the marker.
if sys.platform != "win32":
    import fcntl
    import termios

from app.pty_manager import PTYManager, _wait_poll, _reap, _PENDING_REAPS

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX-only backend")


@pytest_asyncio.fixture(autouse=True)
async def _drain_pending_reaps():
    """Every test that terminates a PTYProcess schedules a fire-and-forget
    reaper task. Without draining them here, a test's event loop can close
    (pytest-asyncio uses a fresh loop per test) before SIGKILL escalation
    finishes, leaving orphan child processes behind. Wait for whatever is
    still pending after each test so the suite never leaks processes."""
    yield
    pending = [t for t in _PENDING_REAPS if not t.done()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

@pytest.mark.asyncio
async def test_spawn_and_read():
    mgr = PTYManager()
    proc = mgr.spawn("test", [sys.executable, "-c", "print('hello')"], cwd="/tmp")
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
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
    proc = mgr.spawn("s1", [sys.executable, "-c", "import time; time.sleep(0.2)"], cwd="/tmp")
    assert proc.active is True
    mgr.terminate("s1")

@pytest.mark.asyncio
async def test_terminate_removes_session():
    mgr = PTYManager()
    mgr.spawn("s2", [sys.executable, "-c", "import time; time.sleep(1)"], cwd="/tmp")
    mgr.terminate("s2")
    assert mgr.get("s2") is None

@pytest.mark.asyncio
async def test_write_and_read():
    mgr = PTYManager()
    proc = mgr.spawn("s3", [sys.executable, "-c", "import sys; line=sys.stdin.readline(); print('echo:'+line.strip())"], cwd="/tmp")
    await asyncio.sleep(0.1)
    await proc.write(b"world\n")
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
            if not chunk:
                break
            output += chunk
        except TimeoutError:
            break
    mgr.terminate("s3")
    assert b"echo:world" in output

@pytest.mark.asyncio
async def test_term_env_is_xterm_256color():
    mgr = PTYManager()
    proc = mgr.spawn(
        "term-test",
        [sys.executable, "-c", "import os,sys; sys.stdout.write(os.environ.get('TERM',''))"],
        cwd="/tmp",
    )
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
            if not chunk:
                break
            output += chunk
        except TimeoutError:
            break
    mgr.terminate("term-test")
    assert output == b"xterm-256color"

@pytest.mark.asyncio
async def test_resize_changes_winsize():
    mgr = PTYManager()
    proc = mgr.spawn("resize-test", [sys.executable, "-c", "import time; time.sleep(1)"], cwd="/tmp")
    proc.resize(120, 40)
    winsize = fcntl.ioctl(proc.master_fd, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
    rows, cols, _, _ = struct.unpack("HHHH", winsize)
    mgr.terminate("resize-test")
    assert (rows, cols) == (40, 120)

@pytest.mark.asyncio
async def test_resize_updates_instance_cols_and_rows():
    """Regression test for the 'texto desconfigurado' root cause: resize()
    used to update only the kernel-level winsize (TIOCSWINSZ) but left
    self.cols/self.rows frozen at their spawn-time values forever after.
    That made proc.cols/proc.rows lie about the PTY's actual current
    geometry, so pty_endpoint's reconnect path had no way to detect a
    geometry mismatch between the reconnecting client and the scrollback it
    was about to replay."""
    mgr = PTYManager()
    proc = mgr.spawn(
        "resize-attrs-test",
        [sys.executable, "-c", "import time; time.sleep(1)"],
        cwd="/tmp", cols=80, rows=24,
    )
    assert (proc.cols, proc.rows) == (80, 24)
    proc.resize(120, 40)
    assert (proc.cols, proc.rows) == (120, 40)
    mgr.terminate("resize-attrs-test")


@pytest.mark.asyncio
async def test_resize_on_closed_pty_is_noop_and_does_not_update_cols_rows():
    """resize() early-returns when master_fd is None (PTY already closed) —
    confirms that no-op path also skips the cols/rows assignment, not just
    the ioctl call."""
    mgr = PTYManager()
    proc = mgr.spawn(
        "resize-closed-test",
        [sys.executable, "-c", "print('bye')"],
        cwd="/tmp", cols=80, rows=24,
    )
    await asyncio.sleep(0.3)  # let it exit naturally; master_fd becomes None
    assert proc.master_fd is None
    proc.resize(120, 40)  # must not raise
    assert (proc.cols, proc.rows) == (80, 24)  # unchanged — no-op confirmed
    mgr.terminate("resize-closed-test")


@pytest.mark.asyncio
async def test_spawn_sets_initial_winsize_before_process_starts():
    """The pty must already have a real winsize the instant the child is
    exec'd — not just after an explicit resize() call. Root cause of the
    "tela preta" bug with TUIs like antigravity/Bubble Tea: they query the
    window size once at startup, and the frontend's first resize frame only
    arrives over the WebSocket after the process is already running, which
    is too late if the pty was born at 0x0."""
    mgr = PTYManager()
    proc = mgr.spawn(
        "initial-winsize-test",
        [sys.executable, "-c", "import time; time.sleep(1)"],
        cwd="/tmp",
        cols=120, rows=30,
    )
    winsize = fcntl.ioctl(proc.master_fd, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
    rows, cols, _, _ = struct.unpack("HHHH", winsize)
    mgr.terminate("initial-winsize-test")
    assert (rows, cols) == (30, 120)


@pytest.mark.asyncio
async def test_spawn_defaults_to_80x24_winsize_when_not_specified():
    mgr = PTYManager()
    proc = mgr.spawn(
        "default-winsize-test",
        [sys.executable, "-c", "import time; time.sleep(1)"],
        cwd="/tmp",
    )
    winsize = fcntl.ioctl(proc.master_fd, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
    rows, cols, _, _ = struct.unpack("HHHH", winsize)
    mgr.terminate("default-winsize-test")
    assert (rows, cols) == (24, 80)


@pytest.mark.asyncio
async def test_terminate_kills_process_group():
    mgr = PTYManager()
    proc = mgr.spawn(
        "pg-test",
        [sys.executable, "-c", "import subprocess, time, os; p = subprocess.Popen(['sleep', '5']); os.write(1, str(p.pid).encode()); time.sleep(5)"],
        cwd="/tmp",
    )
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
            if not chunk:
                break
            output += chunk
            if output.strip().isdigit():
                break
        except TimeoutError:
            break
    child_pid = int(output.strip())
    parent_pid = proc.proc.pid
    mgr.terminate("pg-test")
    await asyncio.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(parent_pid, 0)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)

@pytest.mark.asyncio
async def test_session_persists_until_explicit_terminate():
    mgr = PTYManager()
    mgr.spawn("eof-test", [sys.executable, "-c", "print('bye')"], cwd="/tmp")
    await asyncio.sleep(0.3)
    assert mgr.get("eof-test") is not None
    mgr.terminate("eof-test")
    assert mgr.get("eof-test") is None


@pytest.mark.asyncio
async def test_last_activity_increases_after_pty_output():
    mgr = PTYManager()
    proc = mgr.spawn(
        "activity-test",
        [sys.executable, "-c", "import time; time.sleep(0.2); print('later')"],
        cwd="/tmp",
    )
    initial = proc.last_activity
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
            if not chunk:
                break
            if b"later" in chunk:
                break
        except TimeoutError:
            break
    mgr.terminate("activity-test")
    assert proc.last_activity > initial


@pytest.mark.asyncio
async def test_active_sessions_excludes_dead_processes():
    mgr = PTYManager()
    mgr.spawn("dead-test", [sys.executable, "-c", "print('bye')"], cwd="/tmp")
    # Give the event loop time to fire _on_read for both the data and the
    # subsequent EOF, which flips proc.active to False (Pitfall 4).
    await asyncio.sleep(0.3)
    # The dict entry survives until explicit terminate (reconnect-reuse
    # window), but active_sessions() must already exclude it.
    assert mgr.get("dead-test") is not None
    assert "dead-test" not in mgr.active_sessions()
    mgr.terminate("dead-test")


@pytest.mark.asyncio
async def test_snapshot_retains_output_after_queue_drained():
    """snapshot() still contains previously-printed text after it has been
    drained from the queue via read() — the scrollback buffer is populated
    independently of queue consumption."""
    mgr = PTYManager()
    proc = mgr.spawn(
        "snapshot-test",
        [sys.executable, "-c", "print('hello-scrollback')"],
        cwd="/tmp",
    )
    output = b""
    for _ in range(20):
        try:
            chunk = await proc.read(timeout=0.3)
            if not chunk:
                break
            output += chunk
            if b"hello-scrollback" in output:
                break
        except TimeoutError:
            break
    mgr.terminate("snapshot-test")
    assert b"hello-scrollback" in output
    assert b"hello-scrollback" in proc.snapshot()


@pytest.mark.asyncio
async def test_append_scrollback_trims_to_max_bytes_from_oldest_end():
    """_append_scrollback bounds the buffer to SCROLLBACK_MAX_BYTES, trimming
    from the front (oldest data first) — deterministic, no subprocess timing."""
    mgr = PTYManager()
    proc = mgr.spawn("trim-test", [sys.executable, "-c", "import time; time.sleep(1)"], cwd="/tmp")
    proc._append_scrollback(b"a" * proc.SCROLLBACK_MAX_BYTES)
    proc._append_scrollback(b"b" * 5000)
    snapshot = proc.snapshot()
    mgr.terminate("trim-test")
    assert len(snapshot) == proc.SCROLLBACK_MAX_BYTES
    # The last 5000 bytes survive ("b"s); the oldest "a"s were trimmed off the front.
    assert snapshot[-5000:] == b"b" * 5000
    assert snapshot[:5000] == b"a" * 5000


# --- Regression coverage for the non-blocking reap fix -------------------
#
# Root cause: terminate()/_handle_eof()/_cleanup() used to call the blocking
# subprocess.Popen.wait() directly inside the asyncio event loop thread. If
# the target process ever entered a non-interruptible ("D") kernel state,
# wait() never returned and the *entire* event loop froze — not just the one
# session. The fix replaces every blocking wait() with a non-blocking
# poll()+asyncio.sleep() loop (_wait_poll), escalating SIGTERM -> SIGKILL via
# a tracked fire-and-forget task (_reap/_schedule_reap) instead of waiting
# inline.


class _FakeDiesImmediately:
    """poll() reports exited on the very first call."""

    def __init__(self, pid=90001):
        self.pid = pid
        self.returncode = None

    def poll(self):
        self.returncode = 0
        return self.returncode


class _FakeNeverDies:
    """poll() always reports still-running, no matter how long we wait."""

    def __init__(self, pid=90002):
        self.pid = pid
        self.returncode = None

    def poll(self):
        return None


class _FakeDiesOnSignal:
    """poll() keeps reporting alive until a specific signal is 'received'."""

    def __init__(self, pid=90003, dies_on=None):
        self.pid = pid
        self.returncode = None
        self.dies_on = dies_on
        self.signals_received = []

    def receive(self, sig):
        self.signals_received.append(sig)
        if sig == self.dies_on:
            self.returncode = -sig

    def poll(self):
        return self.returncode


def _fast_forward_monotonic(monkeypatch, jump=1000.0):
    """Patch app.pty_manager.time.monotonic so that any _wait_poll deadline
    (timeout <= jump) is judged as expired on its very next check — without
    an actual real-time sleep. Used only for the "process never dies" cases,
    where we want to assert the *give-up* behavior without burning multiple
    real seconds per test."""
    state = {"n": 0}

    def fake_monotonic():
        state["n"] += 1
        return state["n"] * jump

    monkeypatch.setattr("app.pty_manager.time.monotonic", fake_monotonic)


@pytest.mark.asyncio
async def test_wait_poll_returns_true_quickly_when_process_exits():
    proc = _FakeDiesImmediately()
    start = time.monotonic()
    result = await _wait_poll(proc, timeout=5.0, interval=0.01)
    elapsed = time.monotonic() - start
    assert result is True
    assert elapsed < 0.5


@pytest.mark.asyncio
async def test_wait_poll_returns_false_within_deadline_when_process_never_exits():
    proc = _FakeNeverDies()
    start = time.monotonic()
    result = await _wait_poll(proc, timeout=0.2, interval=0.05)
    elapsed = time.monotonic() - start
    assert result is False
    # Proves it did not block forever: real time spent stays close to the
    # requested deadline, not unbounded.
    assert elapsed < 1.0


# NOTE on the split between _schedule_reap and _reap: the initial SIGTERM is
# sent synchronously by _schedule_reap (see its docstring for why — in short,
# sending it inline, before the caller closes the PTY master fd, avoids a
# real macOS race where an implicit SIGHUP from the fd close can kill the
# process first, and a subsequent killpg() on the now-zombie pgid raises
# PermissionError instead of ProcessLookupError). _reap only ever needs to
# wait for the already-sent SIGTERM to take effect and escalate to SIGKILL.


@pytest.mark.asyncio
async def test_reap_escalates_to_sigkill_when_process_outlives_sigterm(monkeypatch):
    """_reap assumes SIGTERM was already sent by _schedule_reap; it must
    still escalate to SIGKILL if the process outlives the SIGTERM wait."""
    proc = _FakeDiesOnSignal(dies_on=signal.SIGKILL)
    sent = []

    def fake_killpg(pgid, sig):
        sent.append(sig)
        proc.receive(sig)

    monkeypatch.setattr("app.pty_manager.os.killpg", fake_killpg)
    _fast_forward_monotonic(monkeypatch)

    await _reap(proc, pgid=12345)

    assert sent == [signal.SIGKILL]


@pytest.mark.asyncio
async def test_reap_logs_warning_and_returns_when_process_survives_sigkill(caplog):
    import logging as _logging

    proc = _FakeNeverDies()

    def fake_killpg(pgid, sig):
        pass  # process ignores every signal

    import app.pty_manager as pm

    # Patch killpg directly (module attribute) rather than via monkeypatch
    # fixture so this test can also drive its own fast-forwarded clock.
    orig_killpg = pm.os.killpg
    orig_monotonic = pm.time.monotonic
    try:
        pm.os.killpg = fake_killpg
        state = {"n": 0}

        def fake_monotonic():
            state["n"] += 1
            return state["n"] * 1000.0

        pm.time.monotonic = fake_monotonic

        with caplog.at_level(_logging.WARNING, logger="app.pty_manager"):
            await _reap(proc, pgid=54321)  # must not raise

        assert any("did not die" in r.message for r in caplog.records)
    finally:
        pm.os.killpg = orig_killpg
        pm.time.monotonic = orig_monotonic


@pytest.mark.asyncio
async def test_reap_treats_missing_process_group_as_success_on_sigkill(monkeypatch):
    proc = _FakeNeverDies()

    def fake_killpg(pgid, sig):
        raise ProcessLookupError()

    monkeypatch.setattr("app.pty_manager.os.killpg", fake_killpg)
    _fast_forward_monotonic(monkeypatch)

    # Must return without raising even though the SIGKILL attempt hits a
    # process group that's already gone.
    await _reap(proc, pgid=1)


def test_schedule_reap_sends_sigterm_synchronously_before_scheduling(monkeypatch):
    """_schedule_reap must send SIGTERM inline (not deferred into the async
    task) — this is what lets callers close the PTY master fd right after
    without racing an implicit SIGHUP against our own SIGTERM."""
    import app.pty_manager as pm

    proc = _FakeNeverDies()
    sent = []
    monkeypatch.setattr(pm.os, "killpg", lambda pgid, sig: sent.append(sig))

    loop = asyncio.new_event_loop()
    try:
        pm._schedule_reap(loop, proc, pgid=999)
        # SIGTERM must already have been sent by the time this function
        # returns — before any task even gets a chance to run.
        assert sent == [signal.SIGTERM]
        pending = [t for t in pm._PENDING_REAPS if not t.done()]
        assert pending, "expected a wait/escalate task to have been scheduled"
        loop.run_until_complete(asyncio.gather(*pending))
    finally:
        loop.close()


def test_schedule_reap_treats_missing_process_group_as_success(monkeypatch):
    import app.pty_manager as pm

    proc = _FakeNeverDies()
    monkeypatch.setattr(pm.os, "killpg", lambda pgid, sig: (_ for _ in ()).throw(ProcessLookupError()))

    loop = asyncio.new_event_loop()
    try:
        # Must not raise, and must not schedule a wait task since the
        # process is already confirmed gone.
        before = set(pm._PENDING_REAPS)
        pm._schedule_reap(loop, proc, pgid=1)
        assert set(pm._PENDING_REAPS) == before
    finally:
        loop.close()


@pytest.mark.asyncio
async def test_terminate_returns_immediately_for_process_that_ignores_sigterm():
    """Direct regression test for the live freeze Bruno hit: terminate() on
    a process that ignores SIGTERM must still return in well under a second
    (no inline blocking wait()), and the event loop must keep serving other
    concurrent coroutines while the SIGKILL escalation runs in the
    background reaper task."""
    mgr = PTYManager()
    # `exec` replaces the shell process image with `sleep` itself; POSIX
    # preserves a SIG_IGN disposition (set by `trap "" ...`) across exec(),
    # so the resulting `sleep` process genuinely ignores the trapped signals.
    # Both HUP and TERM must be trapped: terminate() closes the PTY master
    # fd right after scheduling the reap, and on a session leader that
    # hangs up the controlling terminal — the kernel sends an *implicit*
    # SIGHUP as a side effect. A process that only traps TERM would die from
    # that implicit SIGHUP instead, never actually exercising the SIGKILL
    # escalation path this test exists to cover. Trapping both forces this
    # process to be reachable only via our own explicit SIGKILL.
    proc = mgr.spawn(
        "stubborn-sigterm",
        ["sh", "-c", "trap '' HUP TERM; exec sleep 100"],
        cwd="/tmp",
    )
    await asyncio.sleep(0.2)  # let the shell install the trap and exec
    child_pid = proc.proc.pid

    ticks = []

    # 20 x 50ms = ~1.0s, spanning the whole SIGTERM-wait window before the
    # reaper escalates to SIGKILL — so this genuinely proves the loop keeps
    # serving other coroutines for the entire duration of the escalation,
    # not just a fraction of it.
    async def ticker():
        for _ in range(20):
            await asyncio.sleep(0.05)
            ticks.append(1)

    ticker_task = asyncio.create_task(ticker())

    start = time.monotonic()
    mgr.terminate("stubborn-sigterm")
    elapsed = time.monotonic() - start

    assert elapsed < 0.05, f"terminate() blocked the event loop for {elapsed:.3f}s"

    pending = [t for t in _PENDING_REAPS if not t.done()]
    assert pending, "expected terminate() to have scheduled a reaper task"

    # Prove the loop is still alive: the ticker keeps making progress
    # concurrently with the SIGTERM->SIGKILL escalation happening in the
    # background.
    await ticker_task
    assert len(ticks) == 20

    # Let the reaper finish escalating (SIGTERM ignored -> SIGKILL) and
    # confirm the child process is actually gone — no zombie/orphan left.
    await asyncio.gather(*pending)
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)


@pytest.mark.asyncio
async def test_terminate_is_idempotent_when_called_twice():
    mgr = PTYManager()
    proc = mgr.spawn(
        "idempotent-terminate", [sys.executable, "-c", "import time; time.sleep(2)"], cwd="/tmp"
    )
    proc.terminate()
    # Second call must be a safe no-op (self.proc is already None).
    proc.terminate()


@pytest.mark.asyncio
async def test_terminate_noop_when_proc_already_none():
    mgr = PTYManager()
    proc = mgr.spawn("already-exited", [sys.executable, "-c", "print('bye')"], cwd="/tmp")
    await asyncio.sleep(0.3)  # let it exit naturally; _handle_eof sets proc.proc = None
    assert proc.proc is None
    proc.terminate()  # must not raise with self.proc already None


@pytest.mark.asyncio
async def test_terminate_handles_process_already_reaped_out_of_band():
    """Simulates a race where something else already reaped the child
    (os.getpgid then legitimately raises ProcessLookupError) — terminate()
    must swallow that instead of propagating."""
    mgr = PTYManager()
    proc = mgr.spawn("reaped-oob", [sys.executable, "-c", "pass"], cwd="/tmp")
    proc.proc.wait()  # reap it out-of-band so the pid is fully released
    proc.terminate()  # must not raise despite os.getpgid(pid) now failing


@pytest.mark.asyncio
async def test_terminate_handles_master_fd_already_closed():
    mgr = PTYManager()
    proc = mgr.spawn(
        "fd-already-closed", [sys.executable, "-c", "import time; time.sleep(2)"], cwd="/tmp"
    )
    os.close(proc.master_fd)  # simulate fd closed by something else already
    proc.terminate()  # must not raise on the redundant os.close()


# --- Regression coverage for PTYManager.shutdown()'s reaper-cancellation bug -
#
# Root cause: shutdown() used to await asyncio.wait_for(gather(*pending),
# timeout=...) directly. asyncio.wait_for() cancels the awaitable it was
# given when the deadline expires -- and cancelling a gather() cascades into
# cancelling every task passed to it that hasn't finished yet. So any _reap()
# task still mid-escalation (e.g. still waiting out the 1.0s SIGTERM window)
# got cancelled instead of continuing to SIGKILL. The docstring claimed
# "any reaper still pending after that keeps running in the background", but
# that was false: the reaper was aborted, silently orphaning the process
# forever whenever it outlived `timeout`. Fixed by wrapping the gather in
# asyncio.shield(), so wait_for's timeout only abandons *waiting* -- the
# shielded gather (and every task inside it) keeps running detached.


@pytest.mark.asyncio
async def test_shutdown_lets_reaper_finish_after_timeout_expires():
    """Reproduces exactly the scenario QA found manually: shutdown() with a
    very short timeout against a process that ignores SIGTERM/SIGHUP. It
    must (a) return quickly, respecting the short timeout, and (b) NOT
    cancel the reaper doing so -- the stubborn process must still end up
    SIGKILLed and reaped once the (uncancelled) reaper task is given time
    to finish, proving it survived the timeout instead of being aborted."""
    mgr = PTYManager()
    proc = mgr.spawn(
        "shutdown-stubborn",
        ["sh", "-c", "trap '' HUP TERM; exec sleep 100"],
        cwd="/tmp",
    )
    await asyncio.sleep(0.2)  # let the shell install the trap and exec
    child_pid = proc.proc.pid

    start = time.monotonic()
    await mgr.shutdown(timeout=0.05)
    elapsed = time.monotonic() - start

    # shutdown() must respect the short timeout, not block for the ~1s+
    # SIGTERM-wait/SIGKILL-escalation the reaper needs to fully finish.
    assert elapsed < 0.5, f"shutdown() blocked for {elapsed:.3f}s despite timeout=0.05"

    # The process must still be alive right as shutdown() returns -- proving
    # the timeout genuinely fired *before* the reaper's escalation completed
    # (SIGTERM/SIGHUP are trapped, so only a later SIGKILL can kill it, and
    # _reap doesn't send that until after its own 1.0s SIGTERM-wait).
    os.kill(child_pid, 0)  # must not raise: process is still alive here

    pending = [t for t in _PENDING_REAPS if not t.done()]
    assert pending, "expected the reaper task to still be running after shutdown() timed out"

    # Without the shield() fix this task would already have been cancelled
    # by wait_for's timeout, and this gather would return immediately with
    # nothing left to wait for -- the process would stay alive forever.
    # With the fix, the reaper is untouched and keeps escalating on its own.
    await asyncio.gather(*pending, return_exceptions=True)

    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
