"""The engine contract of the chat: what a conversation process looks like to the rest of
the backend, with no type from the SDK in sight.

`ChatEngine`/`ChatProcess` are Protocols: `sdk_engine.AgentSdkEngine` is the real one and
`tests/chat_fakes.py` the scripted one. Everything that reaches the `claude` command line
is validated here first (`validate_*`): the SDK 0.1.69 turns some options into raw argv
(`--resume <value>`, `--session-id`, `--model`, `--add-dir`), and a value that starts with
`-` would become a flag of the CLI (GHSA-h4mw-j7qp-8mwm), so nothing unvalidated goes on.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol

# -- values that end up in the CLI argv ------------------------------------------------------

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
# A model alias (`haiku`, `opus[1m]`) or id (`claude-sonnet-4-5-20250929`): starts with an
# alphanumeric, so it can never read as an option, and uses a small alphabet.
_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$")


class ArgvValueError(ValueError):
    """A value that must not reach the CLI. `field` names the option (resume, session_id,
    model, add_dirs)."""

    def __init__(self, field_name: str, message: str):
        super().__init__(f"invalid {field_name}: {message}")
        self.field = field_name


def validate_session_id(value: object, field_name: str = "session_id") -> str:
    """A Claude session id is a UUID. Returns it in canonical (lower case) form."""
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise ArgvValueError(field_name, "not a UUID")
    return value.lower()


def is_valid_session_id(value: object) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.fullmatch(value))


def validate_model(value: object) -> str:
    if not isinstance(value, str) or not _MODEL_RE.fullmatch(value):
        raise ArgvValueError("model", "not a model alias or id")
    return value


def is_valid_model(value: object) -> bool:
    return isinstance(value, str) and bool(_MODEL_RE.fullmatch(value))


def validate_add_dirs(paths: object) -> list[str]:
    """Absolute folders (they come from the project registry). Never anything that starts
    with `-`, never a control character."""
    if not isinstance(paths, (list, tuple)):
        raise ArgvValueError("add_dirs", "not a list")
    checked: list[str] = []
    for path in paths:
        if (
            not isinstance(path, str)
            or not path
            or path.startswith("-")
            or any(ord(char) < 32 for char in path)
            or not os.path.isabs(path)
        ):
            raise ArgvValueError("add_dirs", "every folder must be an absolute path")
        checked.append(path)
    return checked


# The modes a conversation may use: never bypassPermissions or dontAsk (ADR-40).
ALLOWED_PERMISSION_MODES = ("default", "acceptEdits", "plan")


# -- errors ----------------------------------------------------------------------------------


class EngineUnavailable(Exception):
    """The SDK package cannot be imported."""

    def __init__(self, detail: str = ""):
        super().__init__(detail)
        self.detail = detail


class SpawnFailed(Exception):
    """The process did not come up. `reason` is one of the `status.reason` codes of the WS
    contract (cli_not_found, cli_version_unsupported, cli_invalid, folder_unavailable,
    agent_unavailable, agent_not_chat_capable, agent_cmd_args_unsupported,
    connector_exposed, capacity_exceeded, process_error)."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail


class ResumeFailed(Exception):
    """`resume` was asked for and the conversation could not be picked up."""

    def __init__(self, detail: str = ""):
        super().__init__(detail)
        self.detail = detail


# -- spawn --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ConnectorPolicy:
    """Which claude.ai connectors of the account the conversation may use. `allowed` empty
    (the default) means none: they are switched off at the source."""

    allowed: tuple[str, ...] = ()
    # [{name, tool_prefix}] from the last discovery probe (names only, never URLs or ids).
    known: tuple[dict, ...] = ()
    # The discovery probe needs the connectors loaded and nothing blocked.
    probe: bool = False

    @property
    def mode(self) -> str:
        if self.probe:
            return "probe"
        return "allowlist" if self.allowed else "none"


@dataclass
class ChatSpec:
    cli_path: str
    cwd: str
    add_dirs: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    # New conversation: session_id; picking one up again: resume (never both).
    session_id: str | None = None
    resume: str | None = None
    model: str | None = None
    permission_mode: str = "default"
    system_prompt_append: str | None = None
    mcp_servers: dict[str, Any] = field(default_factory=dict)
    setting_sources: tuple[str, ...] = ("user", "project", "local")
    include_partial_messages: bool = True
    connector_policy: ConnectorPolicy = field(default_factory=ConnectorPolicy)
    # Safety net for the empty-allowlist mode: `--strict-mcp-config`, so only the servers
    # in `mcp_servers` load at all (used when the audit still found connectors).
    strict_mcp: bool = False
    connect_timeout: float = 60.0

    def validate(self) -> None:
        """Raise ArgvValueError for anything that must not reach the command line."""
        if self.resume is not None:
            validate_session_id(self.resume, "resume")
        if self.session_id is not None:
            validate_session_id(self.session_id, "session_id")
        if self.model is not None:
            validate_model(self.model)
        if self.permission_mode not in ALLOWED_PERMISSION_MODES:
            raise ArgvValueError("permission_mode", "not an allowed mode")
        validate_add_dirs(self.add_dirs)


# -- what the process reports and asks ---------------------------------------------------------


@dataclass
class EngineMessage:
    """One normalised message of the process. `kind` is init | text_delta | assistant |
    user_tool_result | user_text | result | rate_limit | system_other.

    Field use by kind:
      init             session_id, model, data (permission_mode, cwd, additional_directories,
                       claude_code_version, api_key_source, mcp_servers, tools, slash_commands)
      text_delta       message_id, text
      assistant        message_id, model, blocks ([{type: text|tool_use|thinking, ...}])
      user_tool_result results ([{tool_use_id, is_error, content}])
      user_text        text
      result           data (subtype, is_error, terminal_reason, cost_usd, duration_ms,
                       num_turns, permission_denials)
      rate_limit       data
      system_other     subtype
    """

    kind: str
    session_id: str | None = None
    model: str | None = None
    message_id: str | None = None
    text: str | None = None
    subtype: str | None = None
    blocks: list[dict] = field(default_factory=list)
    results: list[dict] = field(default_factory=list)
    data: dict = field(default_factory=dict)


@dataclass
class PermissionContext:
    tool_use_id: str | None = None
    # Suggestions as plain dicts ({type, rules, behavior, destination, ...}), unsanitised.
    suggestions: list[dict] = field(default_factory=list)


@dataclass
class PermissionDecision:
    """What `can_use_tool` answers; `sdk_engine` turns it into the SDK classes."""

    behavior: str  # "allow" | "deny"
    updated_input: dict | None = None
    # Sanitised rules to remember for the conversation ("session" destination).
    updated_permissions: list[dict] = field(default_factory=list)
    message: str = ""
    interrupt: bool = False


CanUseTool = Callable[[str, dict, PermissionContext], Awaitable[PermissionDecision]]


@dataclass
class EngineCallbacks:
    can_use_tool: CanUseTool
    # The Stop hook, in process (never through `--settings`, which would push twice).
    on_stop: Callable[[dict], Awaitable[None]]
    # PreToolUse gate for connector tools: "ask" | "deny" | None.
    connector_gate: Callable[[str], str | None] = lambda tool_name: None
    # Text the CLI wrote to stderr (used to tell a refused `resume`).
    on_stderr: Callable[[str], None] = lambda line: None


class ChatProcess(Protocol):
    """A live conversation process. Every method is called from the owner task of the
    runtime (ADR-39) and only from there. There is deliberately no toggle of MCP servers:
    the SDK persists that into the user's `~/.claude.json`, so the product never uses it."""

    pid: int | None

    async def query(self, text: str) -> None: ...

    async def interrupt(self) -> None: ...

    async def set_model(self, alias: str) -> None: ...

    async def set_permission_mode(self, mode: str) -> None: ...

    async def get_mcp_status(self) -> dict: ...

    async def get_server_info(self) -> dict: ...

    def messages(self) -> AsyncIterator[EngineMessage]: ...

    async def close(self) -> None: ...


class ChatEngine(Protocol):
    async def spawn(self, spec: ChatSpec, callbacks: EngineCallbacks) -> ChatProcess:
        """Start (or resume) the process and return once it is connected. Raises
        SpawnFailed, ResumeFailed or EngineUnavailable."""
        ...
