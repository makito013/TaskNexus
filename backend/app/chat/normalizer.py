"""EngineMessage -> chat events (ADR-46). Pure: no SDK, no I/O, no clock.

One `Normalizer` per runtime keeps the little state it needs (which session id and model the
process reported last) and turns each message into zero or more events. `persist=False`
events (deltas, rate limits) are live only: they get `seq: null` and never reach the log.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from .engine import EngineMessage

logger = logging.getLogger(__name__)

TOOL_RESULT_MAX_BYTES = 64 * 1024
_SUMMARY_CHARS = 160
_LOCAL_COMMAND_RE = re.compile(
    r"<local-command-(?:stdout|stderr)>(.*?)</local-command-(?:stdout|stderr)>", re.DOTALL
)
_INTERRUPT_MARK = "[Request interrupted by user"
_SYNTHETIC_MODEL = "<synthetic>"
_KEPT_BLOCKS = ("text", "tool_use")


@dataclass
class ChatEvent:
    kind: str
    payload: dict
    persist: bool = True


@dataclass
class NormalizerState:
    claude_session_id: str | None = None
    model: str | None = None
    # True when the process was started with `resume` (the first init is "resumed").
    resuming: bool = False
    started: bool = False


def truncate_utf8(text: str, limit: int) -> tuple[str, bool]:
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text, False
    return raw[:limit].decode("utf-8", errors="ignore"), True


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return "" if content is None else str(content)


def _summary(text: str) -> str:
    line = " ".join(text.split())
    return line if len(line) <= _SUMMARY_CHARS else line[: _SUMMARY_CHARS - 1] + "…"


@dataclass
class Normalizer:
    state: NormalizerState = field(default_factory=NormalizerState)

    def feed(self, message: EngineMessage) -> list[ChatEvent]:
        handler = getattr(self, f"_on_{message.kind}", None)
        if handler is None:
            logger.debug("chat: ignoring engine message kind=%s", message.kind)
            return []
        return handler(message)

    # -- init ---------------------------------------------------------------------------

    def _on_init(self, message: EngineMessage) -> list[ChatEvent]:
        data = message.data
        state = self.state
        events: list[ChatEvent] = []
        if not state.started:
            state.started = True
            requested = state.claude_session_id
            state.claude_session_id = message.session_id
            state.model = message.model
            payload = {
                "claude_session_id": message.session_id,
                "model": message.model,
                "permission_mode": data.get("permission_mode"),
                "cwd": data.get("cwd"),
                "additional_directories": data.get("additional_directories") or [],
                "claude_code_version": data.get("claude_code_version"),
                "api_key_source": data.get("api_key_source"),
                "mcp_servers": [
                    {"name": s.get("name"), "status": s.get("status"),
                     "scope": s.get("scope") or s.get("source")}
                    for s in data.get("mcp_servers") or []
                ],
                "tools_count": len(data.get("tools") or []),
            }
            kind = "session.resumed" if state.resuming else "session.started"
            events.append(ChatEvent(kind, payload))
            if requested and message.session_id and message.session_id != requested:
                # A first message like `/clear` makes the very first `init` carry the new id:
                # the id the product keeps must follow it, or the next open brings the old
                # conversation back.
                events.append(ChatEvent(
                    "session.id_changed", {"previous": requested, "current": message.session_id}
                ))
            return events
        if message.session_id and message.session_id != state.claude_session_id:
            events.append(ChatEvent(
                "session.id_changed",
                {"previous": state.claude_session_id, "current": message.session_id},
            ))
            state.claude_session_id = message.session_id
        if message.model and message.model != state.model:
            events.append(ChatEvent("model.changed", {"model": message.model}))
            state.model = message.model
        return events

    # -- stream and turns ---------------------------------------------------------------

    def _on_text_delta(self, message: EngineMessage) -> list[ChatEvent]:
        return [ChatEvent(
            "message.delta", {"message_id": message.message_id, "text": message.text or ""},
            persist=False,
        )]

    def _on_assistant(self, message: EngineMessage) -> list[ChatEvent]:
        blocks = [b for b in message.blocks if b.get("type") in _KEPT_BLOCKS]
        if message.model == _SYNTHETIC_MODEL:
            text = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
            return [ChatEvent("system.notice", {"kind": "synthetic", "text": text})] if text else []
        if not blocks:
            return []
        return [ChatEvent("message.assistant", {
            "message_id": message.message_id,
            "model": message.model,
            "blocks": blocks,
            "origin": "live",
        })]

    def _on_user_tool_result(self, message: EngineMessage) -> list[ChatEvent]:
        events = []
        for result in message.results:
            text = _content_text(result.get("content"))
            content, truncated = truncate_utf8(text, TOOL_RESULT_MAX_BYTES)
            events.append(ChatEvent("tool.result", {
                "tool_use_id": result.get("tool_use_id"),
                "is_error": bool(result.get("is_error")),
                "summary": _summary(text),
                "content": content,
                "truncated": truncated,
            }))
        return events

    def _on_user_text(self, message: EngineMessage) -> list[ChatEvent]:
        text = message.text or ""
        if _INTERRUPT_MARK in text:
            return []
        local = _LOCAL_COMMAND_RE.findall(text)
        if local:
            joined = "\n".join(part.strip() for part in local if part.strip())
            return [ChatEvent("system.notice", {"kind": "local_command", "text": joined})] if joined else []
        # The user's own text is persisted by the runtime before the query; an echo of it
        # coming back from the process is not a second message.
        return []

    def _on_result(self, message: EngineMessage) -> list[ChatEvent]:
        data = message.data
        return [ChatEvent("turn.ended", {
            "subtype": data.get("subtype"),
            "is_error": bool(data.get("is_error")),
            "terminal_reason": data.get("terminal_reason") or data.get("stop_reason"),
            "cost_usd": data.get("cost_usd"),
            "duration_ms": data.get("duration_ms"),
            "num_turns": data.get("num_turns"),
            "permission_denials": data.get("permission_denials") or [],
        })]

    def _on_rate_limit(self, message: EngineMessage) -> list[ChatEvent]:
        return [ChatEvent("rate_limit", {"detail": message.data}, persist=False)]
