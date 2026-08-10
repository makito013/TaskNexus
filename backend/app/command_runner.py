"""One-shot command execution with output capture ("run it, capture stdout,
throw the process away") — the ephemeral counterpart to `pty_manager.py`.

Why a separate file instead of a function inside `pty_manager.py`: that module
deals with a long-lived INTERACTIVE process behind a pseudo-terminal, guarded by
extremely delicate liveness/close logic (see the `isalive()` block over there).
This is the opposite: short-lived, no TTY, dead before the function returns.
Mixing the two would invite reusing the wrong guards.

First use case: `cursor-agent create-chat` (see `session_provisioner.py`), which
has to emit the chat id BEFORE the PTY is spawned.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from typing import NamedTuple


class CommandResult(NamedTuple):
    """Result of a finished command. `stdout`/`stderr` are kept SEPARATE on
    purpose (never `stderr=STDOUT`): callers typically parse a useful value out
    of stdout and use stderr only as error-message material — interleaving the
    two would make that parse impossible."""
    exit_code: int
    stdout: str
    stderr: str


def _run_capture_blocking(
    argv: list[str], cwd: str | None, timeout: float, extra_env: dict | None
) -> CommandResult:
    """Blocking body of `run_capture`. Runs on a thread — never call this
    directly from the event loop."""
    env = os.environ.copy()
    if extra_env:
        # Same expansion rule as `pty_manager.PTYProcess._resolved_extra_env`
        # (%VAR% on Windows, $VAR on POSIX, via os.path.expandvars), duplicated
        # here ON PURPOSE rather than extracted into a shared helper: it is a
        # one-liner, and coupling this module (ephemeral, one-shot) to
        # pty_manager (interactive, long-lived) is exactly the mixing that
        # motivated splitting the two files. If the rule changes in one, change
        # it in the other — otherwise a `CURSOR_API_KEY=%SECRETS%\...` works in
        # the PTY and silently fails here.
        env.update({k: os.path.expandvars(v) for k, v in extra_env.items()})

    kwargs: dict = {}
    if sys.platform == "win32":
        # Without this, every execution flashes a black console window on the
        # user's screen — the backend runs as a desktop/service process, not
        # inside a dedicated terminal.
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    completed = subprocess.run(
        argv,
        cwd=cwd,
        env=env,
        capture_output=True,
        # text=False (bytes) + manual decode is mandatory: with text=True,
        # Python decodes using the Windows console code page (cp1252/cp850) and
        # SILENTLY CORRUPTS UTF-8. Same policy pty_manager applies on the
        # Windows path.
        text=False,
        timeout=timeout,
        # Never shell=True: argv is already a list, and shell=True would
        # reintroduce metacharacter interpretation over values that come from
        # the agent registry (agent.cmd) — an injection surface with no upside.
        shell=False,
        **kwargs,
    )
    return CommandResult(
        exit_code=completed.returncode,
        stdout=(completed.stdout or b"").decode("utf-8", errors="replace"),
        stderr=(completed.stderr or b"").decode("utf-8", errors="replace"),
    )


async def run_capture(
    argv: list[str],
    cwd: str | None = None,
    timeout: float = 10.0,
    extra_env: dict | None = None,
) -> CommandResult:
    """Run `argv` to completion and return decoded output plus exit code.

    Implemented with `subprocess.run` inside `asyncio.to_thread`, and NEVER with
    `asyncio.create_subprocess_exec`: the latter requires `ProactorEventLoop` and
    raises `NotImplementedError` under `WindowsSelectorEventLoopPolicy` — which
    is precisely the policy uvicorn installs on Windows when running with
    `--reload`/`--workers` (uvicorn/loops/asyncio.py). In other words: adding
    `--reload` to the deploy would break this feature. `subprocess.run` on a
    thread is event-loop agnostic, and there is already precedent in this repo
    (`main.py`: `await asyncio.to_thread(_pretrust_projects)`).

    Raises:
    - `subprocess.TimeoutExpired` when `timeout` elapses. The timeout belongs to
      `subprocess.run` itself (which kills the child), not a manual timeout
      wrapped around the thread: without it the thread would hang forever and
      block the event loop's `shutdown_default_executor()` — the same thread
      leak that already cost two rounds of fixes in `pty_manager`. Note that
      `TimeoutExpired` is a `SubprocessError`, **not** an `OSError`.
    - `OSError` (`FileNotFoundError`, `NotADirectoryError`, `PermissionError`…)
      when the binary or `cwd` does not exist, or permissions are missing.

    Cancelling the task awaiting this coroutine does NOT interrupt a thread that
    is already running (a `to_thread` limitation), but that thread is always
    bounded by `timeout` — it cannot leak indefinitely.

    `TERM` is deliberately not injected (unlike `pty_manager`): there is no TTY
    here, and advertising a capable terminal would coax the CLI into emitting
    ANSI sequences on stdout, polluting the caller's parse.
    """
    return await asyncio.to_thread(
        _run_capture_blocking, list(argv), cwd, timeout, extra_env
    )
