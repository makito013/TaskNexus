# backend/app/pty_manager.py
from __future__ import annotations
import os, subprocess, asyncio, errno, sys
import struct
import signal
import time
import logging

if sys.platform != "win32":
    import termios
    import fcntl
else:
    import winpty

log = logging.getLogger(__name__)

# Tracks in-flight reaper tasks so asyncio never garbage-collects them mid-flight
# (a fire-and-forget task with no strong reference can be discarded by the GC
# before it finishes, silently dropping the SIGKILL escalation).
_PENDING_REAPS: set = set()


async def _wait_poll(proc: subprocess.Popen, timeout: float, interval: float = 0.05) -> bool:
    """Poll proc.poll() non-blockingly until it exits or the deadline passes.

    Never calls the blocking proc.wait() — uses asyncio.sleep so the event
    loop keeps running even if the process never dies. Returns True if the
    process exited within the timeout, False if the deadline was reached.
    """
    deadline = time.monotonic() + timeout
    while True:
        try:
            if proc.poll() is not None:
                return True
        except Exception:
            # If we can't poll it anymore, treat it as gone.
            return True
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(interval)


async def _reap(proc: subprocess.Popen, pgid: int) -> None:
    """Fire-and-forget reaper: waits for the process to exit after the
    SIGTERM already sent by `_schedule_reap`, escalating to SIGKILL if it
    doesn't. Never raises, never blocks the event loop. If the process is
    still alive after both signals, logs a warning and gives up rather than
    hanging forever.
    """
    if await _wait_poll(proc, 1.0):
        return

    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        return
    except Exception:
        log.warning("_reap: failed to send SIGKILL to pgid=%s", pgid, exc_info=True)

    if await _wait_poll(proc, 2.0):
        return

    log.warning(
        "_reap: process pid=%s pgid=%s did not die after SIGTERM+SIGKILL; giving up",
        getattr(proc, "pid", None), pgid,
    )


def _schedule_reap(loop: asyncio.AbstractEventLoop, proc: subprocess.Popen, pgid: int) -> None:
    """Send SIGTERM synchronously right now, then hand off the wait+escalate
    to a tracked background task. Keeps a strong reference to the task until
    it completes so asyncio can't GC it mid-flight.

    Sending SIGTERM here (synchronously, in the caller's own stack frame)
    rather than inside the async `_reap` task matters in practice: callers
    close the PTY master fd immediately after scheduling the reap, and
    closing master_fd hangs up the PTY, which the kernel turns into an
    implicit SIGHUP to the session. A process that only guards against
    SIGTERM (not SIGHUP) can die from that hangup *before* a deferred SIGTERM
    would have been sent — and on macOS, killpg() on the now-zombie process
    group's pgid then raises PermissionError instead of ProcessLookupError
    (confirmed empirically), which would misreport a clean kill as a failed
    signal. A single killpg() call is not a blocking operation (only the
    *wait* is), so sending it inline here is safe and avoids the race
    entirely — it reaches the still-alive process before any fd close does.

    `loop` is the loop captured at PTYProcess creation time, which is not
    always still alive: e.g. a PTYProcess created inside a short-lived task
    on one loop can outlive that loop (test harnesses that spin up a fresh
    loop per test are the main real-world case; production traffic all runs
    on the single app-lifetime loop). If `loop` is already closed, fall back
    to whatever loop is currently running so the wait+escalate still gets
    scheduled instead of raising `RuntimeError: Event loop is closed` out of
    terminate().
    """
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except Exception:
        log.warning("_schedule_reap: failed to send SIGTERM to pgid=%s", pgid, exc_info=True)

    if loop.is_closed():
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Nothing is running right now either — no loop left to schedule
            # the wait+SIGKILL escalation on. SIGTERM was already sent above;
            # that's the best effort available outside any event loop.
            log.warning(
                "_schedule_reap: no live event loop available for pid=%s pgid=%s; "
                "sent best-effort SIGTERM only, no SIGKILL escalation",
                getattr(proc, "pid", None), pgid,
            )
            return
    task = loop.create_task(_reap(proc, pgid))
    _PENDING_REAPS.add(task)
    task.add_done_callback(_PENDING_REAPS.discard)


class PTYProcess:
    # Bounds the server-side scrollback ring buffer to a "last ~64KB" window —
    # a best-effort screen/scrollback replay, not a byte-perfect terminal-state
    # snapshot. A leading partial ANSI/UTF-8 sequence may render briefly oddly
    # right at the trim boundary; this is an accepted tradeoff since full
    # terminal-state-aware trimming is exactly the "high complexity" reason
    # TTERM-01 was originally deferred (see .planning/REQUIREMENTS.md v2).
    SCROLLBACK_MAX_BYTES = 65536

    def __init__(self, cmd: list, cwd: str, disable_echo: bool = False, on_eof=None,
                 cols: int = 80, rows: int = 24, extra_env: dict | None = None):
        self.cmd = cmd
        self.cwd = cwd
        self.disable_echo = disable_echo
        self.on_eof = on_eof
        self.cols = cols
        self.rows = rows
        # Override de ambiente por agente (Global Agent Registry, ex.: um
        # perfil "claude-work" precisa de CLAUDE_CONFIG_DIR próprio) — mesclado
        # sobre os.environ direto no spawn, nunca via shell/batch file. Ver
        # main.py:_build_agent_cmd e o comentário no handler do WS sobre por
        # que um `.cmd`/alias não pode ser resolvido nem invocado sem shell=True.
        self.extra_env = extra_env or {}
        self.master_fd = None
        self.slave_fd = None
        self.proc = None
        self._winpty_proc = None
        self._windows_read_task = None
        self.loop = asyncio.get_running_loop()
        self.reader_registered = False
        self.queue: asyncio.Queue = asyncio.Queue()
        self._write_lock = asyncio.Lock()
        self.active = False
        self._exit_code = None
        self.last_activity: float = self.loop.time()
        self._scrollback = bytearray()
        self._spawn()

    def _resolved_extra_env(self) -> dict:
        """Expande %VAR%/$VAR nos valores de self.extra_env (ex.: o usuário
        cadastra CLAUDE_CONFIG_DIR=%USERPROFILE%\\.claude-work na UI, portável
        entre máquinas — os.path.expandvars entende %...% no Windows e $VAR
        no POSIX automaticamente, de acordo com a plataforma atual)."""
        return {k: os.path.expandvars(v) for k, v in self.extra_env.items()}

    def _spawn(self):
        if sys.platform == "win32":
            self._spawn_windows()
        else:
            self._spawn_posix()

    def _spawn_posix(self):
        self.master_fd, self.slave_fd = os.openpty()
        try:
            # Must happen before Popen: some TUIs (e.g. Bubble Tea apps like
            # antigravity) query the window size exactly once at startup and
            # silently abort full-screen rendering if it's still 0x0 — the
            # frontend's first "resize" frame over the WebSocket arrives only
            # after the process is already running, too late to matter.
            winsize = struct.pack("HHHH", self.rows, self.cols, 0, 0)
            fcntl.ioctl(self.slave_fd, termios.TIOCSWINSZ, winsize)
            if self.disable_echo:
                try:
                    attrs = termios.tcgetattr(self.slave_fd)
                    attrs[1] &= ~termios.ONLCR
                    attrs[3] &= ~termios.ECHO
                    termios.tcsetattr(self.slave_fd, termios.TCSANOW, attrs)
                except Exception:
                    pass
            fl = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env.update(self._resolved_extra_env())
            self.proc = subprocess.Popen(
                self.cmd, cwd=self.cwd,
                stdin=self.slave_fd, stdout=self.slave_fd, stderr=self.slave_fd,
                start_new_session=True, close_fds=True, env=env,
            )
            os.close(self.slave_fd)
            self.slave_fd = None
            self.active = True
            self.loop.add_reader(self.master_fd, self._on_read)
            self.reader_registered = True
        except Exception:
            self._cleanup()
            raise

    def _spawn_windows(self):
        # ConPTY via pywinpty. Diferente do fd POSIX (não-bloqueante,
        # integrado via loop.add_reader), a API do pywinpty é bloqueante e
        # trabalha com str (já decodificado), não bytes crus — ver
        # _windows_read_loop pra fronteira bytes<->str.
        #
        # NOTA: disable_echo não é implementado neste backend. No POSIX ele é
        # aplicado via termios (ver _spawn_posix, ONLCR/ECHO). O pywinpty/
        # ConPTY não expõe um equivalente direto por essa API; o parâmetro é
        # aceito mas silenciosamente ignorado no Windows. Lacuna documentada,
        # não implementada nesta task.
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env.update(self._resolved_extra_env())
        try:
            self._winpty_proc = winpty.PtyProcess.spawn(
                self.cmd, cwd=self.cwd, env=env,
                dimensions=(self.rows, self.cols),
            )
            self.active = True
            self._windows_read_task = self.loop.create_task(self._windows_read_loop())
        except OSError:
            self._cleanup()
            raise
        except Exception as e:
            # winpty.WinptyError (e.g. an invalid/missing cwd) does NOT
            # inherit from OSError, unlike its POSIX equivalents
            # (FileNotFoundError/NotADirectoryError from os.openpty()+Popen).
            # main.py's WebSocket handler only knows how to gracefully
            # degrade a spawn failure it recognizes as OSError (the
            # reconnect-storm guard around pty_endpoint) — wrapping here
            # keeps that contract identical across platforms instead of
            # letting a Windows-only exception type escape it.
            self._cleanup()
            raise OSError(str(e)) from e

    async def _windows_read_loop(self):
        # proc.read() é bloqueante — roda numa thread (run_in_executor) pra
        # não travar o event loop. Cada iteração lê um chunk e empurra pra
        # mesma self.queue que o backend POSIX usa via _on_read/_append_scrollback,
        # então o resto do pipeline (scrollback, WebSocket, xterm.js) não
        # percebe diferença.
        while True:
            try:
                # asyncio.CancelledError (Python 3.8+) is a BaseException, not
                # an Exception — deliberately NOT caught here. terminate()
                # cancels this task directly and does its own cleanup; if the
                # cancellation were swallowed into a call to _handle_eof(), it
                # would double-run cleanup (queue.put_nowait, on_eof callback)
                # on top of what terminate() already did.
                text = await self.loop.run_in_executor(None, self._winpty_proc.read, 4096)
            except Exception:
                self._handle_eof()
                return
            if not text:
                self._handle_eof()
                return
            data = text.encode("utf-8", errors="replace")
            self.last_activity = self.loop.time()
            self._append_scrollback(data)
            self.queue.put_nowait(data)
            # Deliberately no proactive isalive() check here: pywinpty's
            # isalive() mutates proc.closed as a side effect, so calling it
            # here would poison the close() this same object needs later
            # (see the note in _handle_eof()/_cleanup()/terminate() below).
            # The next loop iteration's blocking read already detects death
            # reliably via EOFError/empty text once the child actually
            # exits — matching how the POSIX _on_read() path works (a
            # single post-read check, not a separate liveness probe).

    def _on_read(self):
        try:
            data = os.read(self.master_fd, 4096)
            if not data:
                self._handle_eof()
            else:
                self.last_activity = self.loop.time()
                self._append_scrollback(data)
                self.queue.put_nowait(data)
        except OSError as e:
            if e.errno == errno.EIO:
                self._handle_eof()
            elif e.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                self._handle_eof()

    def _handle_eof(self):
        self._close_reader()
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        self.active = False
        try:
            self.queue.put_nowait(b"")
        except Exception:
            pass
        if sys.platform == "win32":
            # _windows_read_loop reaches _handle_eof() via a read exception,
            # empty read, or a dead process check — none of those go through
            # terminate(), so without this the winpty process/socket would
            # never be released (orphaned handle) on that path.
            #
            # No isalive() guard here on purpose: pywinpty's isalive() has a
            # side effect of setting proc.closed = not alive, which makes a
            # LATER close() call a permanent no-op once isalive() has
            # observed a dead child — reinstating the exact thread leak this
            # backend already had one fix round for (see terminate() below).
            # close(force=True) is documented as safe to call repeatedly, so
            # skipping the liveness check costs nothing and avoids that trap.
            if self._winpty_proc is not None:
                proc, self._winpty_proc = self._winpty_proc, None
                try:
                    proc.close(force=True)
                except Exception:
                    pass
        if self.proc is not None:
            proc, self.proc = self.proc, None
            try:
                # Best-effort, non-blocking: may still be None if the process
                # hasn't exited yet — the reaper below handles that async.
                proc.poll()
                if proc.returncode is None:
                    try:
                        pgid = os.getpgid(proc.pid)
                        _schedule_reap(self.loop, proc, pgid)
                    except ProcessLookupError:
                        pass
                self._exit_code = proc.returncode
            except Exception:
                pass
        if self.on_eof:
            try:
                self.on_eof()
            except Exception:
                pass

    def _close_reader(self):
        if self.reader_registered and self.master_fd is not None:
            try:
                self.loop.remove_reader(self.master_fd)
            except Exception:
                pass
            self.reader_registered = False

    def _cleanup(self):
        self._close_reader()
        if sys.platform == "win32":
            if self._windows_read_task is not None:
                self._windows_read_task.cancel()
                self._windows_read_task = None
            proc, self._winpty_proc = self._winpty_proc, None
            # No isalive() guard — see the note in _handle_eof() above; it
            # would make close() a permanent no-op once the child is dead.
            if proc is not None:
                try:
                    proc.close(force=True)
                except Exception:
                    pass
            return
        for fd in [self.master_fd, self.slave_fd]:
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        self.master_fd = None
        self.slave_fd = None
        if self.proc is not None:
            proc, self.proc = self.proc, None
            try:
                pgid = os.getpgid(proc.pid)
                _schedule_reap(self.loop, proc, pgid)
            except ProcessLookupError:
                pass
            except Exception:
                pass

    async def write(self, data: bytes):
        if isinstance(data, str):
            data = data.encode()
        if sys.platform == "win32":
            # proc.pty.isalive() — NOT proc.isalive() — deliberately: the
            # wrapper's isalive() mutates proc.closed as a side effect (see
            # the notes on terminate()/_cleanup()/_handle_eof() above), which
            # would re-arm that same close()-becomes-a-no-op leak the moment
            # a write() lands on an already-dead-without-EOF child.
            # proc.pty.isalive() is the same underlying liveness check
            # without that side effect.
            if self._winpty_proc is None or not self._winpty_proc.pty.isalive():
                raise RuntimeError("PTY closed")
            async with self._write_lock:
                self._winpty_proc.write(data.decode("utf-8", errors="replace"))
            return
        if self.master_fd is None:
            raise RuntimeError("PTY closed")
        async with self._write_lock:
            sent = 0
            while sent < len(data):
                if self.master_fd is None:
                    raise RuntimeError("PTY closed")
                try:
                    n = os.write(self.master_fd, data[sent:])
                    sent += n
                except OSError as e:
                    if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                        await asyncio.sleep(0.01)
                    else:
                        raise

    async def read(self, timeout: float = None) -> bytes:
        try:
            if timeout is not None:
                return await asyncio.wait_for(self.queue.get(), timeout=timeout)
            return await self.queue.get()
        except asyncio.TimeoutError:
            raise TimeoutError("read timed out")

    def _append_scrollback(self, data: bytes) -> None:
        self._scrollback.extend(data)
        if len(self._scrollback) > self.SCROLLBACK_MAX_BYTES:
            del self._scrollback[: len(self._scrollback) - self.SCROLLBACK_MAX_BYTES]

    def snapshot(self) -> bytes:
        return bytes(self._scrollback)

    def terminate(self):
        self._close_reader()
        self.active = False
        try:
            self.queue.put_nowait(b"")
        except Exception:
            pass
        if sys.platform == "win32":
            if self._windows_read_task is not None:
                try:
                    # Task.cancel() schedules itself on the loop that created
                    # the task (self.loop, captured at __init__ time) — that
                    # loop is normally still the one running this very call,
                    # but not always: a PTYProcess reused across a WS
                    # reconnect (single-reader eviction/session reuse) can
                    # outlive the specific loop its _windows_read_task was
                    # scheduled on (e.g. test harnesses that spin up a fresh
                    # loop per WebSocket connection — production runs one
                    # loop for the app's whole lifetime, so this is mostly a
                    # test-harness concern, but cheap to guard regardless). A
                    # task whose loop is already closed can never run again
                    # anyway, so a RuntimeError here is a no-op, not a leak.
                    self._windows_read_task.cancel()
                except RuntimeError:
                    pass
                self._windows_read_task = None
            proc, self._winpty_proc = self._winpty_proc, None
            # No isalive() guard: pywinpty's isalive() mutates proc.closed as
            # a side effect, so checking it here before close() would make
            # close() a permanent no-op whenever the child already died
            # before terminate() was called (e.g. it crashed on its own, or
            # was killed externally) — reintroducing the exact leak below,
            # just for a different trigger. close() is safe to call
            # unconditionally and repeatedly.
            if proc is not None:
                try:
                    # close(force=True) — not terminate(force=True) — closes
                    # the underlying fileobj/socket that _windows_read_loop's
                    # blocking proc.read() is parked on (via
                    # run_in_executor's default, non-daemon thread pool).
                    # terminate() alone only kills the child process; it
                    # never touches that socket, so if the read is currently
                    # blocked waiting for output that will never come, the
                    # executor thread never returns and the event loop's
                    # shutdown_default_executor() hangs forever waiting for
                    # it. close() closes the socket first, which unblocks the
                    # pending read immediately.
                    proc.close(force=True)
                except Exception:
                    log.warning("terminate: failed to terminate winpty process", exc_info=True)
            return
        # Capture-and-clear first so a double call to terminate() (e.g. from
        # both an explicit close and a racing _handle_eof) is idempotent —
        # only the first caller schedules a reaper.
        proc, self.proc = self.proc, None
        if proc is not None:
            try:
                pgid = os.getpgid(proc.pid)
                _schedule_reap(self.loop, proc, pgid)
            except ProcessLookupError:
                pass
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

    def resize(self, cols: int, rows: int) -> None:
        if sys.platform == "win32":
            # proc.pty.isalive() — see the comment in write() above; resize()
            # is reachable on every WebSocket reconnect/resize frame
            # (main.py's pty_endpoint calls it on the "reused" branch), so
            # using the mutating proc.isalive() here would re-arm the
            # close()-becomes-a-no-op leak on any dead-without-EOF child.
            if self._winpty_proc is None or not self._winpty_proc.pty.isalive():
                return
        else:
            if self.master_fd is None:
                return
        if not isinstance(cols, int) or not isinstance(rows, int):
            raise ValueError("cols and rows must be int")
        if not (0 < cols <= 65535) or not (0 < rows <= 65535):
            raise ValueError("cols and rows must be in range 1..65535")
        if sys.platform == "win32":
            self._winpty_proc.setwinsize(rows, cols)
        else:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
        # Mantém self.cols/self.rows em sincronia com a geometria real do PTY —
        # antes, ficavam congelados na geometria do spawn, então o reconnect
        # não conseguia detectar que o scrollback gravado (_append_scrollback)
        # correspondia a uma geometria diferente da atual do cliente.
        self.cols = cols
        self.rows = rows


class PTYManager:
    def __init__(self):
        self._sessions: dict[str, PTYProcess] = {}

    def spawn(self, session_id: str, cmd: list, cwd: str, disable_echo: bool = False,
              cols: int = 80, rows: int = 24, extra_env: dict | None = None) -> PTYProcess:
        self.terminate(session_id)
        proc = PTYProcess(cmd, cwd=cwd, disable_echo=disable_echo,
                          on_eof=None, cols=cols, rows=rows, extra_env=extra_env)
        self._sessions[session_id] = proc
        return proc

    def get(self, session_id: str) -> "PTYProcess | None":
        return self._sessions.get(session_id)

    def active_sessions(self) -> dict[str, PTYProcess]:
        """Sessions whose underlying process is still alive (excludes
        dead-but-not-yet-reaped entries kept around for reconnect reuse
        during the CLEANUP_DELAY grace period — RESEARCH.md Pitfall 4)."""
        return {k: p for k, p in self._sessions.items() if p.active}

    def terminate(self, session_id: str):
        proc = self._sessions.pop(session_id, None)
        if proc:
            proc.terminate()

    def terminate_all(self):
        for sid in list(self._sessions):
            self.terminate(sid)

    async def shutdown(self, timeout: float = 3.0) -> None:
        """terminate_all() plus a bounded wait for the scheduled reapers to
        finish, so process-group cleanup has a chance to complete before the
        app exits.

        Never blocks longer than `timeout` — but critically, the reaper
        tasks are never cancelled when that deadline hits. The wait is
        wrapped in `asyncio.shield()`, so `wait_for`'s timeout only cancels
        the *waiting*, not the shielded `gather(*pending)` future itself:
        each `_reap()` task keeps running loose in the background, detached
        from this call, all the way through its SIGTERM-wait -> SIGKILL ->
        SIGKILL-wait escalation (see `_reap`'s own deadlines, up to ~3s
        worst case). `_reap` already logs a warning if a process survives
        even that. Without `shield()`, `wait_for` would cancel the gather
        on timeout, which cascades into cancelling every pending `_reap()`
        mid-escalation — silently orphaning any process that takes longer
        than `timeout` to die, with no SIGKILL ever delivered. That was the
        bug here previously: the docstring claimed pending reapers "keep
        running in the background" but `wait_for` was actually cancelling
        them.
        """
        self.terminate_all()
        pending = [t for t in _PENDING_REAPS if not t.done()]
        if not pending:
            return
        try:
            await asyncio.wait_for(
                asyncio.shield(asyncio.gather(*pending, return_exceptions=True)),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            log.warning(
                "shutdown: %d reaper task(s) still pending after %.1fs; "
                "they are NOT cancelled and will keep running in the "
                "background until they finish their SIGKILL escalation",
                len(pending), timeout,
            )
