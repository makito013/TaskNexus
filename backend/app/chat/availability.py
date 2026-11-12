"""What the chat engine needs from the machine: the SDK package and the `claude` binary.

Nothing here makes the backend depend on the chat: `sdk_status()` swallows any
failure of the import and `CliResolver` reports problems as data, so the V2 keeps
booting and serving even when the package or the binary is missing or broken.

The SDK is imported through `importlib.import_module` only inside `sdk_status()`
(never at module level), and only `chat/sdk_engine.py` imports it for real work.
"""
from __future__ import annotations

import importlib
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import Callable, Mapping

logger = logging.getLogger(__name__)

# 2.1.317 is the only version the connector mechanisms were proven against (G0).
DEFAULT_MIN_CLI_VERSION = "2.1.317"
CLI_VERSION_TIMEOUT_SECONDS = 10
CLI_VERSION_CACHE_SECONDS = 10 * 60

# At most 9 digits per part: int() refuses numbers of thousands of digits (ValueError).
_VERSION_RE = re.compile(r"^(\d{1,9})\.(\d{1,9})\.(\d{1,9})")
_SCRIPT_EXTENSIONS = frozenset({".cmd", ".bat", ".ps1"})
_BUNDLED_CLI_MARKER = "claude_agent" + "_sdk/_bundled"  # split: see the SDK-import grep (F1.5 #5)
# Variables that make a child `claude` skip writing its transcript when the
# backend itself was started from inside a Claude Code session.
_INHERITED_SESSION_VARS = ("CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION")


def _parse_version(text: str) -> tuple[int, int, int] | None:
    match = _VERSION_RE.match(text.strip())
    return tuple(int(part) for part in match.groups()) if match else None


def _min_version_from_env(env: Mapping[str, str]) -> str:
    """The configured minimum, never below DEFAULT_MIN_CLI_VERSION: the default is the
    only version the connector mechanisms were proven against (G0), so the operator
    can raise the bar but not lower it."""
    configured = (env.get("CHAT_MIN_CLI_VERSION") or "").strip()
    if not configured:
        return DEFAULT_MIN_CLI_VERSION
    parsed = _parse_version(configured)
    if parsed is None:
        logger.warning("ignoring invalid CHAT_MIN_CLI_VERSION %r", configured)
        return DEFAULT_MIN_CLI_VERSION
    if parsed < _parse_version(DEFAULT_MIN_CLI_VERSION):
        logger.warning(
            "ignoring CHAT_MIN_CLI_VERSION %r: below the supported minimum %s",
            configured, DEFAULT_MIN_CLI_VERSION,
        )
        return DEFAULT_MIN_CLI_VERSION
    return configured


# -- the SDK package --------------------------------------------------------------------


@dataclass(frozen=True)
class SdkStatus:
    available: bool
    version: str | None
    detail: str | None


_sdk_status: SdkStatus | None = None


def sdk_status() -> SdkStatus:
    """Whether the SDK package imports. Tried once and cached.

    Catches ANY exception, not only ImportError: a package whose own dependency is
    broken (e.g. pydantic 2.14) can fail with something else, and the app must
    keep running with the chat reported as unavailable.
    """
    global _sdk_status
    if _sdk_status is None:
        try:
            module = importlib.import_module("claude_agent_sdk")
        except Exception as exc:  # noqa: BLE001 - see docstring
            _sdk_status = SdkStatus(False, None, f"{type(exc).__name__}: {exc}")
        else:
            _sdk_status = SdkStatus(True, getattr(module, "__version__", None), None)
    return _sdk_status


def reset_for_tests() -> None:
    global _sdk_status
    _sdk_status = None


# -- the `claude` binary ----------------------------------------------------------------


@dataclass(frozen=True)
class CliInfo:
    path: str | None
    version: str | None
    ok: bool
    # None when ok; else cli_not_found | cli_invalid | cli_version_unsupported
    reason: str | None = None
    detail: str | None = None


def _default_run_version(path: str) -> str:
    """`<cli> --version` stdout. Blocking: callers run it in a thread.

    The output goes to a temporary FILE, not a pipe: a grandchild that inherits a pipe and
    keeps it open would make `subprocess.run(timeout=...)` wait far beyond the timeout
    (`communicate()` only returns when the pipe closes). With a file, `wait(timeout)` is the
    only thing waited for."""
    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    with tempfile.TemporaryFile() as out:
        process = subprocess.Popen(
            [path, "--version"], stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.DEVNULL,
            **kwargs,
        )
        try:
            process.wait(timeout=CLI_VERSION_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise
        out.seek(0)
        # Not the console code page: a CLI that prints non-ASCII (an emoji in a warning,
        # say) must not kill the read; and only the head matters.
        return out.read(64 * 1024).decode("utf-8", errors="replace")


def _which_on_path(name: str) -> str | None:
    """`shutil.which` over PATH only. With no `path=` Windows looks in the current directory
    first, so a `claude.exe` dropped into the folder the backend was started from would be
    found (and run for `--version`, then spawned) before the real one. An explicit `path=`
    leaves the current directory out (checked on 3.12.10); the second test below refuses it
    anyway when PATH itself lists the current directory."""
    found = shutil.which(name, path=os.environ.get("PATH", ""))
    if found and os.path.normcase(os.path.dirname(os.path.abspath(found))) == os.path.normcase(os.getcwd()):
        return None
    return found


class CliResolver:
    """Resolves and validates the binary the chat spawns (ADR-42). It never falls
    back to the CLI bundled inside the SDK package.

    `resolve` blocks for up to CLI_VERSION_TIMEOUT_SECONDS the first time a binary
    is seen, so async callers run it with `asyncio.to_thread`.
    """

    def __init__(
        self,
        min_version: str | None = None,
        env: Mapping[str, str] = os.environ,
        which: Callable[[str], str | None] = _which_on_path,
        run_version: Callable[[str], str] = _default_run_version,
        clock: Callable[[], float] = time.monotonic,
    ):
        # Read from `env` when the resolver is built (not at import), so a value that
        # only `load_dotenv()` put there counts.
        if min_version is None:
            min_version = _min_version_from_env(env)
        parsed = _parse_version(min_version)
        if parsed is None:
            raise ValueError(f"invalid minimum CLI version: {min_version!r}")
        self.min_version = min_version
        self._min_parsed = parsed
        self._env = env
        self._which = which
        self._run_version = run_version
        self._clock = clock
        # (path, mtime) -> (expires_at, version text)
        self._version_cache: dict[tuple[str, float], tuple[float, str]] = {}

    def resolve(self, agent=None) -> CliInfo:
        """Precedence: CHAT_CLI_PATH, then the agent's `cmd[0]`, then `claude` on PATH."""
        candidate = (self._env.get("CHAT_CLI_PATH") or "").strip()
        if not candidate:
            cmd = getattr(agent, "cmd", None) or []
            candidate = cmd[0] if cmd and cmd[0] else "claude"

        path = candidate if os.path.isabs(candidate) else self._which(candidate)
        if not path or not os.path.isfile(path):
            return CliInfo(None, None, False, "cli_not_found", f"not found: {candidate}")

        if os.path.splitext(path)[1].lower() in _SCRIPT_EXTENSIONS:
            return CliInfo(path, None, False, "cli_invalid",
                           "script wrappers (.cmd/.bat/.ps1) cannot be spawned by the SDK")
        # Normalised first: a `.\` or `..\` spelling of the bundled path must not slip through.
        if _BUNDLED_CLI_MARKER in os.path.realpath(path).replace("\\", "/").lower():
            return CliInfo(path, None, False, "cli_invalid",
                           "the CLI bundled inside the SDK package is not allowed")

        try:
            version_text = self._version_of(path)
        except (subprocess.TimeoutExpired, TimeoutError):
            return CliInfo(path, None, False, "cli_invalid", "`--version` timed out")
        except OSError as exc:
            return CliInfo(path, None, False, "cli_invalid", f"cannot run `--version`: {exc}")

        parsed = _parse_version(version_text)
        if parsed is None:
            return CliInfo(path, None, False, "cli_invalid",
                           "`--version` did not print a version number")
        version = ".".join(str(part) for part in parsed)
        if parsed < self._min_parsed:
            return CliInfo(path, version, False, "cli_version_unsupported",
                           f"found {version}, need at least {self.min_version}")
        return CliInfo(path, version, True)

    def _version_of(self, path: str) -> str:
        key = (path, os.path.getmtime(path))
        cached = self._version_cache.get(key)
        now = self._clock()
        if cached and cached[0] > now:
            return cached[1]
        text = self._run_version(path)
        # Only a real version is worth remembering; anything else is re-checked.
        if _parse_version(text):
            self._version_cache[key] = (now + CLI_VERSION_CACHE_SECONDS, text)
        return text


# -- boot warning -----------------------------------------------------------------------


def warn_if_session_env_inherited(env: Mapping[str, str] = os.environ) -> bool:
    """Print a warning when the backend was started from inside a Claude Code
    session. Returns whether it warned.

    print(), not logging, like the other boot lines: the production log level
    would hide it.
    """
    present = [name for name in _INHERITED_SESSION_VARS if name in env]
    if not present:
        return False
    print(
        f"==> Warning: {', '.join(present)} set in the backend environment; "
        "chat transcripts may be disabled (start the backend from a plain terminal).",
        flush=True,
    )
    return True
