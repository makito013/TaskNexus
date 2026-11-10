"""Best-effort import of a PTY conversation's history (R-AV): never blocks, never fails the switch."""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app.chat import history_import
from app.chat.history_import import ImportFailed, import_history

pytestmark = pytest.mark.asyncio


def _msg(role, content, **body):
    return SimpleNamespace(type=role, message={"role": role, "content": content, **body}, uuid="u", session_id="s")


TRANSCRIPT = [
    _msg("user", "The secret word is PTYWORD"),
    # the transcript stores one entry per block: same message id, thinking first
    _msg("assistant", [{"type": "thinking", "thinking": "", "signature": "x"}], id="msg_1", model="opus"),
    _msg("assistant", [{"type": "text", "text": "NOTED"}], id="msg_1", model="opus"),
    _msg("assistant", [{"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}}],
         id="msg_1", model="opus"),
    _msg("user", [{"type": "tool_result", "tool_use_id": "t1", "content": "file body", "is_error": False}]),
    _msg("assistant", [{"type": "thinking", "thinking": "only thinking"}], id="msg_2", model="opus"),
    _msg("user", [{"type": "text", "text": "and then?"}]),
]


async def test_messages_become_import_events_without_thinking_or_duplicates():
    events = await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: TRANSCRIPT)

    assert [e.kind for e in events] == ["message.user", "message.assistant", "tool.result", "message.user"]
    assistant = events[1].payload
    assert assistant["origin"] == "import" and assistant["message_id"] == "msg_1"
    assert [b["type"] for b in assistant["blocks"]] == ["text", "tool_use"]  # merged, no thinking
    assert events[0].payload["origin"] == "import" and events[0].payload["text"] == "The secret word is PTYWORD"
    assert events[2].payload["content"] == "file body"


async def test_the_reader_gets_the_session_id_and_the_folder():
    seen = []

    def reader(sid, cwd):
        seen.append((sid, cwd))
        return []

    assert await import_history("sid-1", "C:/work/proj", {}, reader=reader) == []
    assert seen == [("sid-1", "C:/work/proj")]


async def test_an_exception_of_the_reader_is_import_failed_unreadable_and_not_raised_raw():
    def reader(sid, cwd):
        raise FileNotFoundError("C:/Users/someone/.claude/projects/x.jsonl")

    with pytest.raises(ImportFailed) as failure:
        await import_history("sid", "C:/work", {}, reader=reader)

    assert failure.value.reason == "unreadable" and "someone" not in str(failure.value)


async def test_a_slow_reader_times_out_without_blocking():
    def reader(sid, cwd):
        time.sleep(1.5)
        return []

    started = time.monotonic()
    with pytest.raises(ImportFailed) as failure:
        await import_history("sid", "C:/work", {}, reader=reader, timeout=0.2)

    assert failure.value.reason == "timeout" and time.monotonic() - started < 1.0


async def test_an_agent_with_its_own_profile_is_not_read_from_the_default_one():
    """CT5: the SDK reader only knows ~/.claude, so a CLAUDE_CONFIG_DIR agent reports
    profile_unsupported instead of reading the wrong conversation."""
    called = []

    with pytest.raises(ImportFailed) as failure:
        await import_history("sid", "C:/work", {"CLAUDE_CONFIG_DIR": "C:/Users/x/.claude-work"},
                             reader=lambda sid, cwd: called.append(1) or [])

    assert failure.value.reason == "profile_unsupported" and called == []


async def test_a_malformed_transcript_is_unreadable_not_a_crash():
    with pytest.raises(ImportFailed) as failure:
        await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: [object()] if False else [SimpleNamespace(
            type="user", message=None)] and [SimpleNamespace(type="user", message={"role": "user", "content": [5]})])

    assert failure.value.reason == "unreadable"
    assert history_import.IMPORT_TIMEOUT_SECONDS == 30.0


# -- going back and forth: only what the log does not hold is imported -------------------------------------


def _known(assistant_ids=(), tool_use_ids=(), trailing=()):
    return {"assistant_ids": set(assistant_ids), "tool_use_ids": set(tool_use_ids),
            "trailing_user_texts": list(trailing)}


async def test_a_transcript_the_log_already_holds_imports_nothing():
    # the live assistant message_id is the transcript's message.id; its tool result is logged too
    known = _known(assistant_ids=["msg_1", "msg_2"], tool_use_ids=["t1"], trailing=["and then?"])

    events = await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: TRANSCRIPT, known=known)

    assert events == []


async def test_a_turn_done_in_the_terminal_in_between_is_imported_and_the_rest_is_not():
    transcript = TRANSCRIPT + [
        _msg("user", "typed in the terminal"),
        _msg("assistant", [{"type": "text", "text": "terminal answer"}], id="msg_3", model="opus"),
    ]
    known = _known(assistant_ids=["msg_1", "msg_2"], tool_use_ids=["t1"], trailing=["and then?"])

    events = await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: transcript, known=known)

    assert [(e.kind, e.payload.get("text") or e.payload["blocks"][0]["text"]) for e in events] == [
        ("message.user", "typed in the terminal"), ("message.assistant", "terminal answer")]


async def test_a_tool_result_the_log_holds_is_not_imported_again_after_the_cut():
    transcript = [
        _msg("user", "go"),
        _msg("assistant", [{"type": "tool_use", "id": "t9", "name": "Read", "input": {}}], id="msg_9", model="opus"),
        _msg("user", [{"type": "tool_result", "tool_use_id": "t9", "content": "body"}]),
    ]
    known = _known(assistant_ids=["msg_9"], tool_use_ids=["t9"])

    assert await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: transcript, known=known) == []


async def test_an_empty_log_imports_everything_and_a_log_with_only_a_user_message_skips_that_message():
    everything = await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: TRANSCRIPT, known=_known())
    only_user = await import_history(
        "sid", "C:/work", {}, reader=lambda sid, cwd: TRANSCRIPT[:1], known=_known(trailing=["The secret word is PTYWORD"]))

    assert len(everything) == 4
    assert only_user == []


async def test_a_log_whose_assistant_messages_are_not_in_the_transcript_imports_the_whole_transcript():
    # another conversation (the log is from before a reset): nothing to duplicate, all of it is new,
    # and the old log's trailing texts and tool results must not swallow anything of it
    known = _known(assistant_ids=["msg_other"], tool_use_ids=["t1"], trailing=["The secret word is PTYWORD"])

    events = await import_history("sid", "C:/work", {}, reader=lambda sid, cwd: TRANSCRIPT, known=known)

    assert len(events) == 4  # the same four events an unfiltered import yields
