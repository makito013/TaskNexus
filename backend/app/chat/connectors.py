"""claude.ai connectors of the account in the chat (ADR-43, DP1): off unless the agent's
allowlist says otherwise, and never exposed silently.

Layers (proved in the G0, `07-dev-f1-g0.md`):
1. Load. Empty allowlist: `ENABLE_CLAUDEAI_MCP_SERVERS=0` in the child env plus the
   `disableClaudeAiConnectors` setting passed inline (`--settings`), so the connectors never
   load. Partial allowlist: they load and the others are blocked with `disallowed_tools`
   (`mcp__claude_ai_<server>`). `toggle_mcp_server` is NEVER used: the CLI persists it into
   the user's `~/.claude.json` (G0.2-C).
2. Gate per call: a `PreToolUse` hook denies a connector tool outside the allowlist and
   makes an allowed one `ask`, so the permission card appears even if the user has an
   `allow` rule for it (CA16d).
3. Audit: a connector is recognised by `scope`/`source`/transport, never by its display
   name; any exposure closes the process (`connector_exposed`).
4. Discovery probe: connect without a query, read the connector names, disconnect.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Iterable

from .engine import ChatEngine, ChatSpec, ConnectorPolicy, EngineCallbacks, PermissionContext, PermissionDecision

CLAUDEAI_TOOL_PREFIX = "mcp__claude_ai_"
CLAUDEAI_HOOK_MATCHER = "mcp__claude_ai_.*"  # the form proved in the G0 (G0.3)
_TRANSPORT = "claudeai-proxy"
_SILENT_STATUSES = frozenset({"disabled", "failed", "needs-auth"})
_NAME_MAX = 128
_PROBE_SETTLE_SECONDS = 20.0
_PROBE_POLL_SECONDS = 1.0


class InvalidConnectorName(ValueError):
    pass


def validate_connector_name(name: object) -> str:
    if not isinstance(name, str) or not name.strip() or len(name) > _NAME_MAX or not name.isprintable():
        raise InvalidConnectorName("connector names are printable text of at most 128 characters")
    return name


def tool_prefix(server_name: str) -> str:
    """The prefix the CLI gives the tools of an MCP server: `mcp__` + the server name with
    every character outside [A-Za-z0-9_-] replaced by `_`. Checked against the real CLI for
    `claude.ai Claude Docs`, `claude.ai Atlassian MCP`, `claude.ai Google Drive` and
    `claude.ai podesubir-staging` (hyphens stay); `claude.ai Atlassian Rovo` follows the same
    rule (it exposes no tool in the SDK while it needs authentication)."""
    return "mcp__" + re.sub(r"[^A-Za-z0-9_-]", "_", server_name) + "__"


def is_claudeai(server: dict) -> bool:
    """By origin, never by display name: a server called `escritorio-x` with scope
    `claudeai` is a connector; one with scope `dynamic` is not."""
    config = server.get("config") if isinstance(server.get("config"), dict) else {}
    return (
        server.get("scope") == "claudeai"
        or server.get("source") == "claudeai"
        or server.get("transport") == _TRANSPORT
        or config.get("type") == _TRANSPORT
    )


@dataclass(frozen=True)
class SpawnOptions:
    env: dict[str, str] = field(default_factory=dict)
    settings_json: str | None = None
    disallowed_tools: tuple[str, ...] = ()


def spawn_options(policy: ConnectorPolicy) -> SpawnOptions:
    if policy.probe:
        return SpawnOptions()
    if not policy.allowed:
        return SpawnOptions(
            env={"ENABLE_CLAUDEAI_MCP_SERVERS": "0"},
            settings_json=json.dumps({"disableClaudeAiConnectors": True}),
        )
    blocked = tuple(
        entry["tool_prefix"][: -len("__")] if entry["tool_prefix"].endswith("__") else entry["tool_prefix"]
        for entry in policy.known
        if entry.get("name") not in policy.allowed and entry.get("tool_prefix")
    )
    return SpawnOptions(disallowed_tools=blocked)


def _allowed_prefixes(policy: ConnectorPolicy) -> tuple[str, ...]:
    return tuple(tool_prefix(name) for name in policy.allowed)


def gate_pre_tool_use(tool_name: str, policy: ConnectorPolicy) -> str | None:
    """deny: a connector tool outside the allowlist; ask: an allowed one; None: not a connector tool."""
    if not tool_name.startswith(CLAUDEAI_TOOL_PREFIX):
        return None
    return "ask" if tool_name.startswith(_allowed_prefixes(policy)) else "deny"


def connector_of_tool(tool_name: str, policy: ConnectorPolicy) -> str | None:
    """The allowed connector a tool belongs to (for the card), else None."""
    for name in policy.allowed:
        if tool_name.startswith(tool_prefix(name)):
            return name
    return None


def audit(mcp_status: dict | None, init_tools: Iterable[str] | None, policy: ConnectorPolicy) -> list[str]:
    """Names (or tool prefixes) of exposed connectors; empty means clean.

    Status (`mcp_status` is `get_mcp_status()` or the `init`'s `mcp_servers` in the same shape):
    with the allowlist empty the connectors must not be there at all, so any that is not
    disabled/failed/needs-auth counts, `pending` included (it may connect later). With an
    allowlist the blocked ones are loaded on purpose (their tools are denied) and only a
    connector that is neither allowed nor known counts: nothing blocks it (CA16f).
    Tools (when `init_tools` is known): any connector tool outside the allowlist.
    """
    exposed: set[str] = set()
    if policy.mode == "probe":
        return []
    known_names = {entry.get("name") for entry in policy.known}
    for server in (mcp_status or {}).get("mcpServers") or []:
        if not is_claudeai(server) or server.get("status") in _SILENT_STATUSES:
            continue
        if policy.mode == "none" or (server.get("name") not in policy.allowed and server.get("name") not in known_names):
            exposed.add(str(server.get("name")))
    allowed_prefixes = _allowed_prefixes(policy)
    for tool in init_tools or ():
        if tool.startswith(CLAUDEAI_TOOL_PREFIX) and not (allowed_prefixes and tool.startswith(allowed_prefixes)):
            exposed.add(tool.split("__")[1] if tool.count("__") >= 2 else tool)
    return sorted(exposed)


async def _deny_everything(tool_name: str, tool_input: dict, context: PermissionContext) -> PermissionDecision:
    return PermissionDecision(behavior="deny", message="Discovery probe: no tool may run.")


async def _ignore(payload: dict) -> None:
    return None


async def probe(engine: ChatEngine, spec: ChatSpec, *, settle_seconds: float = _PROBE_SETTLE_SECONDS,
                poll_seconds: float = _PROBE_POLL_SECONDS) -> list[dict]:
    """List the connectors of the account: `connect()` without a query (no turn, no tokens),
    wait for the statuses to settle, keep `[{name, tool_prefix}]` of the claude.ai ones only,
    disconnect. `spec` must have the connectors ON (`ConnectorPolicy(probe=True)`) and an empty
    scratch cwd."""
    process = await engine.spawn(
        spec,
        EngineCallbacks(can_use_tool=_deny_everything, on_stop=_ignore),
    )
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + settle_seconds
        while True:
            status = await process.get_mcp_status()
            servers = [s for s in (status or {}).get("mcpServers") or [] if is_claudeai(s)]
            # Right after connect() the list can still be empty: the connectors show up
            # `pending` a moment later (G0.4), so "nothing yet" is not "settled".
            if loop.time() >= deadline or (servers and all(s.get("status") != "pending" for s in servers)):
                break
            await asyncio.sleep(poll_seconds)
        return [
            {"name": str(s.get("name")), "tool_prefix": tool_prefix(str(s.get("name")))}
            for s in servers
        ]
    finally:
        await process.close()
