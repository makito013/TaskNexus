"""The real engine: the Claude Agent SDK driving the installed `claude` binary (ADR-30).

This is the ONLY module that loads the SDK, and only inside functions (ADR-41), so the
backend boots and serves the V2 even when the package is missing or broken.

Everything that reaches the command line was validated by `ChatSpec.validate()` first
(GHSA-h4mw-j7qp-8mwm: a value starting with `-` would become a flag of the CLI).
"""
from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import importlib
import logging
import os
import signal
from collections import deque
from typing import Any, AsyncIterator

from . import connectors, permissions
from .engine import (
    ArgvValueError,
    ChatProcess,
    ChatSpec,
    EngineCallbacks,
    EngineMessage,
    EngineUnavailable,
    PermissionContext,
    ResumeFailed,
    SpawnFailed,
)

logger = logging.getLogger(__name__)

CLOSE_TIMEOUT_SECONDS = 10.0
_STDERR_KEEP = 20
_RESUME_REFUSED_MARK = "No conversation found"
EDIT_HOOK_MATCHER = "|".join(sorted(permissions.SESSION_ALLOWED_TOOLS))


def load_sdk() -> Any:
    try:
        return importlib.import_module("claude_agent_sdk")
    except Exception as exc:  # noqa: BLE001 - a broken dependency can raise anything
        raise EngineUnavailable(f"{type(exc).__name__}: {exc}") from exc


def read_session_messages(claude_session_id: str, cwd: str) -> list:
    """The SDK's own transcript reader (G0.13), for the history import. Blocking: callers run
    it in a thread."""
    return load_sdk().get_session_messages(claude_session_id, directory=cwd)


def _safe_append(text: str | None) -> str | None:
    """The agent's own prompt goes to the CLI as `--append-system-prompt <text>`: a text that
    starts with a dash must not read as an option."""
    if not text:
        return None
    return "\n" + text if text.lstrip().startswith("-") else text


# -- SDK message -> EngineMessage --------------------------------------------------------------


class SdkTranslator:
    """Stateful only for the id of the assistant message a stream of deltas belongs to."""

    def __init__(self) -> None:
        self._stream_message_id: str | None = None

    def translate(self, message: Any) -> list[EngineMessage]:
        handler = getattr(self, f"_{type(message).__name__}", None)
        return handler(message) if handler else self._other(message)

    def _other(self, message: Any) -> list[EngineMessage]:
        return [EngineMessage(kind="system_other", subtype=type(message).__name__)]

    def _SystemMessage(self, message: Any) -> list[EngineMessage]:
        data = message.data if isinstance(message.data, dict) else {}
        if message.subtype != "init":
            return [EngineMessage(kind="system_other", subtype=message.subtype)]
        return [EngineMessage(
            kind="init",
            session_id=data.get("session_id"),
            model=data.get("model"),
            data={
                "permission_mode": data.get("permissionMode"),
                "cwd": data.get("cwd"),
                "additional_directories": data.get("additional_directories") or [],
                "claude_code_version": data.get("claude_code_version"),
                "api_key_source": data.get("apiKeySource"),
                "mcp_servers": data.get("mcp_servers") or [],
                "tools": data.get("tools") or [],
                "slash_commands": data.get("slash_commands") or [],
            },
        )]

    def _StreamEvent(self, message: Any) -> list[EngineMessage]:
        event = message.event if isinstance(message.event, dict) else {}
        if event.get("type") == "message_start":
            self._stream_message_id = (event.get("message") or {}).get("id")
            return []
        delta = event.get("delta") or {}
        if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
            return [EngineMessage(
                kind="text_delta", message_id=self._stream_message_id, text=delta.get("text", "")
            )]
        return []

    def _AssistantMessage(self, message: Any) -> list[EngineMessage]:
        blocks: list[dict] = []
        for block in message.content or []:
            name = type(block).__name__
            if name == "TextBlock":
                blocks.append({"type": "text", "text": block.text})
            elif name == "ToolUseBlock":
                blocks.append({"type": "tool_use", "id": block.id, "name": block.name,
                               "input": block.input})
            elif name == "ThinkingBlock":
                blocks.append({"type": "thinking"})
        self._stream_message_id = None
        return [EngineMessage(
            kind="assistant", message_id=getattr(message, "message_id", None),
            model=message.model, blocks=blocks,
        )]

    def _UserMessage(self, message: Any) -> list[EngineMessage]:
        content = message.content
        if isinstance(content, str):
            return [EngineMessage(kind="user_text", text=content)]
        results, texts = [], []
        for block in content or []:
            name = type(block).__name__
            if name == "ToolResultBlock":
                results.append({"tool_use_id": block.tool_use_id, "is_error": bool(block.is_error),
                                "content": block.content})
            elif name == "TextBlock":
                texts.append(block.text)
        if results:
            return [EngineMessage(kind="user_tool_result", results=results)]
        return [EngineMessage(kind="user_text", text="\n".join(texts))]

    def _ResultMessage(self, message: Any) -> list[EngineMessage]:
        return [EngineMessage(kind="result", data={
            "subtype": message.subtype,
            "is_error": message.is_error,
            "terminal_reason": getattr(message, "terminal_reason", None) or message.stop_reason,
            "cost_usd": message.total_cost_usd,
            "duration_ms": message.duration_ms,
            "num_turns": message.num_turns,
            "permission_denials": message.permission_denials or [],
        })]

    def _RateLimitEvent(self, message: Any) -> list[EngineMessage]:
        data = dataclasses.asdict(message) if dataclasses.is_dataclass(message) else {}
        return [EngineMessage(kind="rate_limit", data=data)]


# -- the process ---------------------------------------------------------------------------------


def _client_pid(client: Any) -> int | None:
    process = getattr(getattr(client, "_transport", None), "_process", None)
    pid = getattr(process, "pid", None)
    return pid if isinstance(pid, int) else None


class SdkProcess:
    def __init__(self, client: Any):
        self._client = client
        self._translator = SdkTranslator()
        self.pid: int | None = _client_pid(client)

    async def query(self, text: str) -> None:
        await self._client.query(text)

    async def interrupt(self) -> None:
        await self._client.interrupt()

    async def set_model(self, alias: str) -> None:
        await self._client.set_model(alias)

    async def set_permission_mode(self, mode: str) -> None:
        await self._client.set_permission_mode(mode)

    async def get_mcp_status(self) -> dict:
        return await self._client.get_mcp_status()

    async def get_server_info(self) -> dict:
        return await self._client.get_server_info() or {}

    async def messages(self) -> AsyncIterator[EngineMessage]:
        async for message in self._client.receive_messages():
            for translated in self._translator.translate(message):
                yield translated

    async def close(self) -> None:
        try:
            await asyncio.wait_for(self._client.disconnect(), CLOSE_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001 - closing must finish
            logger.warning("chat: disconnect did not finish cleanly (%s); killing the process", type(exc).__name__)
            self._kill()

    def _kill(self) -> None:
        if self.pid is None:
            return
        with contextlib.suppress(OSError, ProcessLookupError):
            os.kill(self.pid, signal.SIGTERM)


# -- the engine ----------------------------------------------------------------------------------


class AgentSdkEngine:
    async def spawn(self, spec: ChatSpec, callbacks: EngineCallbacks) -> ChatProcess:
        try:
            spec.validate()
        except ArgvValueError as exc:
            if exc.field == "resume":
                raise ResumeFailed(str(exc)) from exc
            raise SpawnFailed("process_error", str(exc)) from exc

        sdk = load_sdk()
        stderr_lines: deque[str] = deque(maxlen=_STDERR_KEEP)

        def on_stderr(line: str) -> None:
            stderr_lines.append(line)
            callbacks.on_stderr(line)

        client = sdk.ClaudeSDKClient(self._build_options(sdk, spec, callbacks, on_stderr))
        try:
            await asyncio.wait_for(client.connect(), spec.connect_timeout)
        except asyncio.CancelledError:
            await self._abandon(client)
            raise
        except Exception as exc:  # noqa: BLE001 - mapped below
            await self._abandon(client)
            raise self._connect_error(sdk, spec, exc, list(stderr_lines)) from exc
        return SdkProcess(client)

    @staticmethod
    async def _abandon(client: Any) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(client.disconnect(), CLOSE_TIMEOUT_SECONDS)

    @staticmethod
    def _connect_error(sdk: Any, spec: ChatSpec, exc: Exception, stderr: list[str]) -> Exception:
        tail = " | ".join(stderr)[-300:]
        detail = f"{type(exc).__name__}: {exc}"
        if tail:
            detail += f" ({tail})"
        if spec.resume:
            # The refused `resume` only shows in stderr (G0.6); any failed connect that was
            # asked to pick a conversation up is a failed resume.
            if _RESUME_REFUSED_MARK in tail:
                detail = f"{_RESUME_REFUSED_MARK} with session ID {spec.resume}"
            return ResumeFailed(detail)
        if isinstance(exc, asyncio.TimeoutError):
            return SpawnFailed("process_error", f"connect timed out after {spec.connect_timeout:g}s")
        if isinstance(exc, sdk.CLINotFoundError):
            return SpawnFailed("cli_not_found", detail)
        return SpawnFailed("process_error", detail)

    @staticmethod
    def _build_options(sdk: Any, spec: ChatSpec, callbacks: EngineCallbacks, on_stderr) -> Any:
        mechanism = connectors.spawn_options(spec.connector_policy)
        # Ours last: an agent's own env must never switch the connectors back on.
        env = {**spec.env, **mechanism.env}
        # Defensive (G0.12/CT22): harmless where transcripts are written anyway, and it
        # protects a backend started from inside a Claude Code session.
        env.setdefault("CLAUDE_CODE_CHILD_SESSION", "")

        system_prompt: dict[str, Any] = {"type": "preset", "preset": "claude_code"}
        append = _safe_append(spec.system_prompt_append)
        if append:
            system_prompt["append"] = append

        async def can_use_tool(tool_name: str, tool_input: dict, context: Any):
            suggestions = [
                item.to_dict() if hasattr(item, "to_dict") else dict(item)
                for item in getattr(context, "suggestions", None) or []
            ]
            decision = await callbacks.can_use_tool(
                tool_name, tool_input,
                PermissionContext(tool_use_id=getattr(context, "tool_use_id", None),
                                  suggestions=suggestions),
            )
            if decision.behavior == "allow":
                return permissions.build_allow(
                    sdk.PermissionResultAllow, sdk.PermissionUpdate,
                    sdk.types.PermissionRuleValue, decision,
                )
            return permissions.build_deny(sdk.PermissionResultDeny, decision)

        async def stop_hook(input_data: dict, tool_use_id: str | None, context: Any) -> dict:
            await callbacks.on_stop(dict(input_data))
            return {}

        async def connector_gate(input_data: dict, tool_use_id: str | None, context: Any) -> dict:
            verdict = callbacks.connector_gate(str(input_data.get("tool_name", "")))
            if verdict is None:
                return {}
            return {"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": verdict,
                "permissionDecisionReason": "claude.ai connector tools need an explicit allowlist and approval",
            }}

        async def edit_path_gate(input_data: dict, tool_use_id: str | None, context: Any) -> dict:
            verdict = permissions.edit_path_verdict(
                str(input_data.get("tool_name", "")), input_data.get("tool_input"), spec.cwd, spec.add_dirs
            )
            if verdict is None:
                return {}
            return {"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": verdict,
                "permissionDecisionReason": "this edit is outside the conversation's folders",
            }}

        kwargs: dict[str, Any] = dict(
            cli_path=spec.cli_path,
            cwd=spec.cwd,
            add_dirs=list(spec.add_dirs),
            env=env,
            model=spec.model,
            permission_mode=spec.permission_mode,
            system_prompt=system_prompt,
            setting_sources=list(spec.setting_sources),
            include_partial_messages=spec.include_partial_messages,
            mcp_servers=dict(spec.mcp_servers),
            can_use_tool=can_use_tool,
            hooks={
                "Stop": [sdk.HookMatcher(hooks=[stop_hook])],
                "PreToolUse": [
                    sdk.HookMatcher(matcher=connectors.CLAUDEAI_HOOK_MATCHER, hooks=[connector_gate]),
                    sdk.HookMatcher(matcher=EDIT_HOOK_MATCHER, hooks=[edit_path_gate]),
                ],
            },
            stderr=on_stderr,
        )
        if spec.resume:
            kwargs["resume"] = spec.resume
        if spec.session_id:
            kwargs["session_id"] = spec.session_id
        if mechanism.settings_json:
            kwargs["settings"] = mechanism.settings_json
        if mechanism.disallowed_tools:
            kwargs["disallowed_tools"] = list(mechanism.disallowed_tools)
        if spec.strict_mcp:
            kwargs["extra_args"] = {"strict-mcp-config": None}
        return sdk.ClaudeAgentOptions(**kwargs)

    @staticmethod
    def build_argv(sdk: Any, spec: ChatSpec, callbacks: EngineCallbacks) -> list[str]:
        """The exact command line the SDK would run for `spec` (what the argv-injection test
        inspects). Validates first, like `spawn`."""
        spec.validate()
        options = AgentSdkEngine._build_options(sdk, spec, callbacks, lambda line: None)
        from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

        transport = SubprocessCLITransport(prompt=None, options=options)
        transport._cli_path = spec.cli_path
        return transport._build_command()
