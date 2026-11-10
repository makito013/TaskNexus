"""The SDK-bound half of the chat engine: the argv the real SDK builds, and its messages
translated into `EngineMessage`. Skipped where the package is not installed (the
`venv-nosdk` run); the pure validators are in `test_chat_argv_validation.py`."""
from __future__ import annotations

import asyncio

import pytest

from app.chat import engine as engine_module
from app.chat.engine import ArgvValueError, ChatSpec, EngineCallbacks
from app.chat.sdk_engine import AgentSdkEngine, SdkTranslator
from tests.test_chat_argv_validation import CALLBACKS, EVIL, GOOD_UUID, _spec

sdk = pytest.importorskip("claude_agent_sdk")


def _argv(spec: ChatSpec) -> list[str]:
    return AgentSdkEngine.build_argv(sdk, spec, CALLBACKS)


@pytest.mark.parametrize("evil", EVIL[:5])
@pytest.mark.parametrize("field", ["resume", "session_id", "model", "add_dirs"])
def test_no_invalid_value_reaches_the_argv_the_sdk_builds(field, evil):
    spec = _spec(session_id=None if field == "resume" else GOOD_UUID)
    setattr(spec, field, [evil] if field == "add_dirs" else evil)

    with pytest.raises(ArgvValueError):
        _argv(spec)


def test_control_without_the_validator_the_sdk_would_pass_the_flag_through():
    """Why the validator exists: the very same value, handed to the SDK directly, IS in argv."""
    evil = "--mcp-config=" + '{"mcpServers":{"x":{"command":"calc.exe"}}}'
    options = AgentSdkEngine._build_options(sdk, _spec(session_id=None), CALLBACKS, lambda line: None)
    options.resume = evil
    from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

    transport = SubprocessCLITransport(prompt=None, options=options)
    transport._cli_path = "C:/bin/claude.exe"

    assert evil in transport._build_command()


def test_a_valid_spec_builds_the_expected_argv_and_nothing_else():
    argv = _argv(_spec(model="haiku", add_dirs=["C:/work/b"], permission_mode="plan"))

    assert argv[0] == "C:/bin/claude.exe"
    assert argv[argv.index("--session-id") + 1] == GOOD_UUID
    assert argv[argv.index("--model") + 1] == "haiku"
    assert argv[argv.index("--permission-mode") + 1] == "plan"
    assert argv[argv.index("--add-dir") + 1] == "C:/work/b"
    assert "--resume" not in argv and "--strict-mcp-config" not in argv
    assert "--setting-sources=user,project,local" in argv


def test_resume_is_validated_as_a_uuid_on_its_way_to_the_cli():
    argv = _argv(_spec(session_id=None, resume=GOOD_UUID))

    assert argv[argv.index("--resume") + 1] == GOOD_UUID and "--session-id" not in argv


def test_an_agent_prompt_that_starts_with_a_dash_cannot_read_as_an_option():
    argv = _argv(_spec(system_prompt_append="--mcp-config=evil is just text"))

    appended = argv[argv.index("--append-system-prompt") + 1]
    assert not appended.startswith("-") and "--mcp-config=evil is just text" in appended


def test_the_empty_allowlist_mechanism_and_the_strict_net_land_where_proved_in_the_g0():
    argv = _argv(_spec(strict_mcp=True))

    assert "--strict-mcp-config" in argv
    settings = argv[argv.index("--settings") + 1]
    assert "disableClaudeAiConnectors" in settings
    options = AgentSdkEngine._build_options(sdk, _spec(), CALLBACKS, lambda line: None)
    assert options.env["ENABLE_CLAUDEAI_MCP_SERVERS"] == "0"
    assert options.system_prompt == {"type": "preset", "preset": "claude_code"}
    assert options.setting_sources == ["user", "project", "local"]


def test_the_options_register_the_pretooluse_hooks_for_connectors_and_edits():
    """The hooks are registered on the options the SDK receives (no binary needed). The matchers
    are compared with literals, so changing the constants in `sdk_engine` cannot pass unnoticed."""
    callbacks = EngineCallbacks(can_use_tool=CALLBACKS.can_use_tool, on_stop=CALLBACKS.on_stop,
                                connector_gate=lambda tool_name: "deny")
    options = AgentSdkEngine._build_options(sdk, _spec(), callbacks, lambda line: None)

    matchers = {m.matcher: m.hooks for m in options.hooks["PreToolUse"]}
    assert set(matchers) == {"mcp__claude_ai_.*", "Edit|MultiEdit|Write"}
    assert "Stop" in options.hooks

    async def run(matcher: str, tool_name: str, tool_input: dict) -> dict:
        (hook,) = matchers[matcher]
        return await hook({"tool_name": tool_name, "tool_input": tool_input}, None, None)

    connector = asyncio.run(run("mcp__claude_ai_.*", "mcp__claude_ai_Drive__read", {}))
    assert connector["hookSpecificOutput"]["permissionDecision"] == "deny"
    outside = asyncio.run(run("Edit|MultiEdit|Write", "Edit", {"file_path": "C:/elsewhere/x.txt"}))
    assert outside["hookSpecificOutput"]["permissionDecision"] == "ask"
    inside = asyncio.run(run("Edit|MultiEdit|Write", "Edit", {"file_path": "C:/work/proj/x.txt"}))
    assert inside == {}


def test_the_product_never_toggles_mcp_servers():
    """`toggle_mcp_server` persists into the user's ~/.claude.json (G0.2-C)."""
    import ast
    import pathlib

    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for path in app_dir.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            name = getattr(node, "attr", None) or getattr(node, "id", None)
            if name == "toggle_mcp_server":
                offenders.append(str(path))
    assert offenders == []
    assert not hasattr(engine_module.ChatProcess, "toggle_mcp_server")


def test_cancelling_a_spawn_does_not_leak(monkeypatch):
    """A cancelled connect disconnects the half-open client."""
    calls = []

    class SlowClient:
        def __init__(self, options): pass
        async def connect(self): await asyncio.Event().wait()
        async def disconnect(self): calls.append("disconnect")

    monkeypatch.setattr(sdk, "ClaudeSDKClient", SlowClient)

    async def scenario():
        task = asyncio.ensure_future(AgentSdkEngine().spawn(_spec(), CALLBACKS))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert calls == ["disconnect"]


# -- SDK messages -> EngineMessage -----------------------------------------------------------------------------


def _translate(message):
    return SdkTranslator().translate(message)


def test_init_system_message():
    message = sdk.SystemMessage(subtype="init", data={
        "session_id": GOOD_UUID, "model": "claude-haiku-5-5", "permissionMode": "default", "cwd": "C:/w",
        "tools": ["Read"], "mcp_servers": [{"name": "m", "status": "connected"}],
        "slash_commands": ["clear"], "apiKeySource": "none", "claude_code_version": "2.1.317",
        "additional_directories": ["C:/b"],
    })

    init, = _translate(message)

    assert (init.kind, init.session_id, init.model) == ("init", GOOD_UUID, "claude-haiku-5-5")
    assert init.data["api_key_source"] == "none" and init.data["permission_mode"] == "default"
    assert init.data["additional_directories"] == ["C:/b"] and init.data["tools"] == ["Read"]


def test_other_system_messages_are_system_other():
    out, = _translate(sdk.SystemMessage(subtype="hook_started", data={"x": 1}))

    assert (out.kind, out.subtype) == ("system_other", "hook_started")


def test_assistant_message_blocks_including_thinking():
    message = sdk.AssistantMessage(content=[
        sdk.ThinkingBlock(thinking="", signature="s"), sdk.TextBlock(text="hi"),
        sdk.ToolUseBlock(id="t1", name="Read", input={"file_path": "a"}),
    ], model="haiku", message_id="msg_1")

    out, = _translate(message)

    assert out.kind == "assistant" and out.message_id == "msg_1"
    assert [b["type"] for b in out.blocks] == ["thinking", "text", "tool_use"]
    assert out.blocks[2] == {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}}


def test_user_message_with_tool_results_and_with_plain_text():
    results, = _translate(sdk.UserMessage(content=[
        sdk.ToolResultBlock(tool_use_id="t1", content="out", is_error=True)]))
    plain, = _translate(sdk.UserMessage(content="hello"))

    assert results.kind == "user_tool_result"
    assert results.results == [{"tool_use_id": "t1", "is_error": True, "content": "out"}]
    assert (plain.kind, plain.text) == ("user_text", "hello")


def test_result_message():
    out, = _translate(sdk.ResultMessage(
        subtype="success", duration_ms=5, duration_api_ms=4, is_error=False, num_turns=2, session_id="s",
        stop_reason="end_turn", total_cost_usd=0.25, permission_denials=[{"tool_name": "Write"}],
    ))

    assert out.kind == "result" and out.data["cost_usd"] == 0.25 and out.data["num_turns"] == 2
    assert out.data["terminal_reason"] == "end_turn" and out.data["permission_denials"] == [{"tool_name": "Write"}]


def test_stream_events_give_text_deltas_tied_to_the_message_id():
    translator = SdkTranslator()
    start = sdk.StreamEvent(uuid="u", session_id="s", event={"type": "message_start", "message": {"id": "msg_9"}})
    delta = sdk.StreamEvent(uuid="u", session_id="s", event={
        "type": "content_block_delta", "delta": {"type": "text_delta", "text": "he"}})
    other = sdk.StreamEvent(uuid="u", session_id="s", event={"type": "content_block_start"})

    assert translator.translate(start) == []
    out, = translator.translate(delta)
    assert (out.kind, out.message_id, out.text) == ("text_delta", "msg_9", "he")
    assert translator.translate(other) == []


def test_unknown_message_types_are_reported_as_system_other():
    class Mystery: pass

    out, = _translate(Mystery())

    assert (out.kind, out.subtype) == ("system_other", "Mystery")
