"""Best-effort import of a terminal (PTY) conversation's history into the chat log (R-AV).

Never blocks and never fails the switch: any problem becomes `history.import_failed`. The
reader runs in a thread with a timeout and is the SDK's own transcript reader (G0.13); it is
injectable, so the tests need no SDK and no transcript.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Mapping

from .sdk_engine import read_session_messages
from .normalizer import ChatEvent, TOOL_RESULT_MAX_BYTES, _content_text, _summary, truncate_utf8

logger = logging.getLogger(__name__)

IMPORT_TIMEOUT_SECONDS = 30.0


class ImportFailed(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _events_from(messages: list) -> list[ChatEvent]:
    """SDK transcript messages -> events. Thinking blocks are dropped and an assistant message
    the transcript stores in pieces (one entry per block) is merged back by its id."""
    events: list[ChatEvent] = []
    assistant_index: dict[str, int] = {}
    for item in messages:
        body = getattr(item, "message", None) or {}
        role = body.get("role") or getattr(item, "type", None)
        content = body.get("content")
        if role == "user":
            if isinstance(content, str):
                if content.strip():
                    events.append(ChatEvent("message.user", {"client_msg_id": None, "text": content, "origin": "import"}))
                continue
            for block in content or []:
                if block.get("type") == "text" and block.get("text", "").strip():
                    events.append(ChatEvent("message.user", {"client_msg_id": None, "text": block["text"], "origin": "import"}))
                elif block.get("type") == "tool_result":
                    text = _content_text(block.get("content"))
                    clipped, truncated = truncate_utf8(text, TOOL_RESULT_MAX_BYTES)
                    events.append(ChatEvent("tool.result", {
                        "tool_use_id": block.get("tool_use_id"), "is_error": bool(block.get("is_error")),
                        "summary": _summary(text), "content": clipped, "truncated": truncated,
                    }))
        elif role == "assistant":
            kept = []
            for block in content if isinstance(content, list) else []:
                if block.get("type") == "text" and block.get("text"):
                    kept.append({"type": "text", "text": block["text"]})
                elif block.get("type") == "tool_use":
                    kept.append({"type": "tool_use", "id": block.get("id"), "name": block.get("name"),
                                 "input": block.get("input") or {}})
            if not kept:
                continue
            message_id = body.get("id")
            if message_id in assistant_index:
                events[assistant_index[message_id]].payload["blocks"].extend(kept)
                continue
            if message_id:
                assistant_index[message_id] = len(events)
            events.append(ChatEvent("message.assistant", {
                "message_id": message_id, "model": body.get("model"), "blocks": kept, "origin": "import",
            }))
    return events


def _only_new(events: list[ChatEvent], known: Mapping) -> list[ChatEvent]:
    """Drop what the log already holds, so going back and forth between the terminal and the
    chat never duplicates a message, and a turn done in the terminal in between is still
    imported. The cut is the last transcript message the log has (by assistant message id);
    after it, a tool result the log has (by `tool_use_id`) and a user message the log has
    typed after its last assistant message are skipped."""
    anchor = -1
    for index, event in enumerate(events):
        if event.kind == "message.assistant" and event.payload.get("message_id") in known["assistant_ids"]:
            anchor = index
    if anchor == -1 and known["assistant_ids"]:
        # None of the log's assistant messages is in the transcript: another conversation (the
        # log is from before a reset), so there is nothing to duplicate and all of it is new.
        return events
    trailing = list(known["trailing_user_texts"])
    fresh: list[ChatEvent] = []
    for event in events[anchor + 1:]:
        if event.kind == "tool.result" and event.payload.get("tool_use_id") in known["tool_use_ids"]:
            continue
        if event.kind == "message.user" and event.payload.get("text") in trailing:
            trailing.remove(event.payload["text"])
            continue
        fresh.append(event)
    return fresh


async def import_history(
    claude_session_id: str,
    cwd: str,
    env: Mapping[str, str] | None = None,
    *,
    reader: Callable[[str, str], list] = read_session_messages,
    timeout: float = IMPORT_TIMEOUT_SECONDS,
    known: Mapping | None = None,
) -> list[ChatEvent]:
    """Raises ImportFailed(reason): `profile_unsupported` (an agent with its own
    CLAUDE_CONFIG_DIR: the SDK reader only knows the default profile, CT5), `timeout`,
    `unreadable`. `known` is what the chat log already holds (`ChatStore.logged_conversation`):
    only the rest of the transcript is returned."""
    if (env or {}).get("CLAUDE_CONFIG_DIR"):
        raise ImportFailed("profile_unsupported")
    try:
        messages = await asyncio.wait_for(asyncio.to_thread(reader, claude_session_id, cwd), timeout)
    except asyncio.TimeoutError:
        raise ImportFailed("timeout") from None
    except Exception as exc:  # noqa: BLE001 - best effort
        logger.warning("chat: history import failed (%s)", type(exc).__name__)
        raise ImportFailed("unreadable") from None
    try:
        events = _events_from(messages)
        return _only_new(events, known) if known is not None else events
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat: history import could not be translated (%s)", type(exc).__name__)
        raise ImportFailed("unreadable") from None
