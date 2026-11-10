"""claude.ai connectors (ADR-43): off by default, gate per call, audit, discovery probe."""
from __future__ import annotations

import json

import pytest

from app.chat import connectors
from app.chat.engine import ChatSpec, ConnectorPolicy
from tests.chat_fakes import FakeChatEngine

NAMES = {
    "claude.ai Claude Docs": "mcp__claude_ai_Claude_Docs__",
    "claude.ai Atlassian MCP": "mcp__claude_ai_Atlassian_MCP__",
    "claude.ai Google Drive": "mcp__claude_ai_Google_Drive__",
    "claude.ai podesubir-staging": "mcp__claude_ai_podesubir-staging__",
    "claude.ai Atlassian Rovo": "mcp__claude_ai_Atlassian_Rovo__",
}


def _policy(*allowed: str) -> ConnectorPolicy:
    return ConnectorPolicy(
        allowed=tuple(allowed),
        known=tuple({"name": n, "tool_prefix": p} for n, p in NAMES.items()),
    )


@pytest.mark.parametrize("server,prefix", list(NAMES.items()))
def test_tool_prefix_follows_the_cli_rule_for_all_five_connectors(server, prefix):
    """Proved against the real CLI (07-dev-f1-1b.md, O11): Claude Docs, Atlassian MCP, Google
    Drive and podesubir-staging were seen in `init.tools`; Atlassian Rovo exposes no tool in the
    SDK while it needs authentication, so its prefix follows the same rule."""
    assert connectors.tool_prefix(server) == prefix


def test_an_empty_allowlist_switches_the_connectors_off_at_the_source():
    options = connectors.spawn_options(_policy())

    assert options.env == {"ENABLE_CLAUDEAI_MCP_SERVERS": "0"}
    assert json.loads(options.settings_json) == {"disableClaudeAiConnectors": True}
    assert options.disallowed_tools == ()


def test_a_partial_allowlist_blocks_the_others_with_disallowed_tools_never_a_toggle():
    options = connectors.spawn_options(_policy("claude.ai Claude Docs", "claude.ai podesubir-staging"))

    assert options.env == {} and options.settings_json is None
    assert set(options.disallowed_tools) == {
        "mcp__claude_ai_Atlassian_MCP", "mcp__claude_ai_Google_Drive", "mcp__claude_ai_Atlassian_Rovo",
    }


def test_the_discovery_probe_loads_everything_and_blocks_nothing():
    options = connectors.spawn_options(ConnectorPolicy(probe=True))

    assert (options.env, options.settings_json, options.disallowed_tools) == ({}, None, ())


@pytest.mark.parametrize("server,expected", [
    ({"name": "escritorio-x", "scope": "claudeai", "status": "connected"}, True),
    ({"name": "claude.ai Foo", "source": "claudeai"}, True),
    ({"name": "anything", "transport": "claudeai-proxy"}, True),
    ({"name": "anything", "config": {"type": "claudeai-proxy"}}, True),
    ({"name": "escritorio-cards", "scope": "dynamic", "source": "dynamic"}, False),
    ({"name": "claude.ai Claude Docs", "scope": "user"}, False),  # the NAME never decides
])
def test_a_connector_is_recognised_by_origin_never_by_display_name(server, expected):
    assert connectors.is_claudeai(server) is expected


def test_gate_denies_outside_the_allowlist_and_asks_inside_and_ignores_other_tools():
    policy = _policy("claude.ai Claude Docs")

    assert connectors.gate_pre_tool_use("mcp__claude_ai_Google_Drive__search_files", policy) == "deny"
    assert connectors.gate_pre_tool_use("mcp__claude_ai_Claude_Docs__guide", policy) == "ask"
    assert connectors.gate_pre_tool_use("mcp__escritorio-cards__listar_cards", policy) is None
    assert connectors.gate_pre_tool_use("Write", policy) is None
    assert connectors.gate_pre_tool_use("mcp__claude_ai_Claude_Docs__guide", _policy()) == "deny"
    assert connectors.connector_of_tool("mcp__claude_ai_Claude_Docs__guide", policy) == "claude.ai Claude Docs"
    assert connectors.connector_of_tool("Write", policy) is None


@pytest.mark.parametrize("status,exposed", [
    ("connected", True), ("pending", True), ("disabled", False), ("failed", False), ("needs-auth", False),
])
def test_audit_with_an_empty_allowlist_flags_any_connector_that_is_not_off(status, exposed):
    mcp = {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": status},
                          {"name": "escritorio-cards", "scope": "dynamic", "status": "connected"}]}

    assert bool(connectors.audit(mcp, None, _policy())) is exposed


def test_audit_with_a_partial_allowlist_looks_at_tools_not_at_status():
    policy = _policy("claude.ai Claude Docs")
    connected = {"mcpServers": [{"name": "claude.ai Google Drive", "scope": "claudeai", "status": "connected"}]}

    assert connectors.audit(connected, None, policy) == []
    assert connectors.audit(connected, ["Read", "mcp__claude_ai_Claude_Docs__guide"], policy) == []
    assert connectors.audit(connected, ["mcp__claude_ai_Google_Drive__search_files"], policy) == [
        "claude_ai_Google_Drive"]
    assert connectors.audit(None, ["mcp__claude_ai_Brand_New__x"], policy) == ["claude_ai_Brand_New"]


def test_audit_never_complains_about_the_discovery_probe():
    mcp = {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected"}]}

    assert connectors.audit(mcp, ["mcp__claude_ai_Claude_Docs__guide"], ConnectorPolicy(probe=True)) == []


@pytest.mark.parametrize("bad", ["", "   ", "x" * 129, "line\nbreak", 5, None])
def test_connector_names_are_printable_text_of_at_most_128_characters(bad):
    with pytest.raises(connectors.InvalidConnectorName):
        connectors.validate_connector_name(bad)
    assert connectors.validate_connector_name("claude.ai Claude Docs") == "claude.ai Claude Docs"


@pytest.mark.asyncio
async def test_probe_lists_only_claudeai_servers_by_name_and_prefix_and_closes_the_process():
    engine = FakeChatEngine()
    seen = [
        {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "pending"}]},
        {"mcpServers": [
            {"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected",
             "config": {"url": "https://secret.example/mcp?token=abc"}, "serverInfo": {"name": "x"}},
            {"name": "escritorio-cards", "scope": "dynamic", "status": "connected"},
        ]},
    ]

    class Status:
        def __init__(self):
            self.n = 0

        @property
        def value(self):
            self.n += 1
            return seen[min(self.n - 1, len(seen) - 1)]

    status = Status()
    original_spawn = engine.spawn

    async def spawn(spec, callbacks):
        process = await original_spawn(spec, callbacks)

        async def get_mcp_status():
            return status.value

        process.get_mcp_status = get_mcp_status
        return process

    engine.spawn = spawn
    spec = ChatSpec(cli_path="C:/c.exe", cwd="C:/scratch", connector_policy=ConnectorPolicy(probe=True))

    found = await connectors.probe(engine, spec, settle_seconds=2, poll_seconds=0.01)

    assert found == [{"name": "claude.ai Claude Docs", "tool_prefix": "mcp__claude_ai_Claude_Docs__"}]
    assert "secret" not in json.dumps(found)
    assert engine.last.closed and engine.last.queries == []


@pytest.mark.asyncio
async def test_probe_keeps_waiting_while_the_list_is_still_empty_right_after_connect():
    """Real CLI behaviour: the first status after connect() has no connector yet."""
    engine = FakeChatEngine()
    answers = iter([
        {"mcpServers": []}, {"mcpServers": []},
        {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "pending"}]},
        {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected"}]},
    ])
    original_spawn = engine.spawn

    async def spawn(spec, callbacks):
        process = await original_spawn(spec, callbacks)

        async def get_mcp_status():
            return next(answers)

        process.get_mcp_status = get_mcp_status
        return process

    engine.spawn = spawn
    spec = ChatSpec(cli_path="C:/c.exe", cwd="C:/scratch", connector_policy=ConnectorPolicy(probe=True))

    found = await connectors.probe(engine, spec, settle_seconds=5, poll_seconds=0.01)

    assert [c["name"] for c in found] == ["claude.ai Claude Docs"]


@pytest.mark.asyncio
async def test_probe_of_an_account_without_connectors_ends_at_the_deadline_with_an_empty_list():
    engine = FakeChatEngine()

    found = await connectors.probe(
        engine, ChatSpec(cli_path="C:/c.exe", cwd="C:/s", connector_policy=ConnectorPolicy(probe=True)),
        settle_seconds=0.1, poll_seconds=0.01)

    assert found == [] and engine.last.closed
