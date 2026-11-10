"""EngineMessage -> chat events (ADR-46): pure, no SDK."""
from __future__ import annotations

import logging

from app.chat.engine import EngineMessage
from app.chat.normalizer import TOOL_RESULT_MAX_BYTES, Normalizer, NormalizerState

from tests.chat_fakes import assistant_text, init_message, result_message

SID = "11111111-1111-4111-8111-111111111111"
SID2 = "22222222-2222-4222-8222-222222222222"


def _kinds(events):
    return [e.kind for e in events]


def test_first_init_starts_the_session_with_the_contract_fields():
    events = Normalizer().feed(init_message(
        SID, model="claude-haiku-5-5", additional_directories=["C:/work/b"],
        mcp_servers=[{"name": "escritorio-cards", "status": "connected", "source": "dynamic"}],
    ))

    assert _kinds(events) == ["session.started"]
    payload = events[0].payload
    assert payload["claude_session_id"] == SID
    assert payload["additional_directories"] == ["C:/work/b"]
    assert payload["mcp_servers"] == [{"name": "escritorio-cards", "status": "connected", "scope": "dynamic"}]
    assert payload["tools_count"] == 3 and payload["api_key_source"] == "none"


def test_init_of_a_resumed_process_is_session_resumed():
    events = Normalizer(NormalizerState(claude_session_id=SID, resuming=True)).feed(init_message(SID))

    assert _kinds(events) == ["session.resumed"]


def test_repeated_init_with_a_new_id_or_model_reports_the_change_only():
    n = Normalizer()
    n.feed(init_message(SID, model="haiku"))

    assert n.feed(init_message(SID, model="haiku")) == []
    changed_id = n.feed(init_message(SID2, model="haiku"))
    changed_model = n.feed(init_message(SID2, model="sonnet"))

    assert _kinds(changed_id) == ["session.id_changed"]
    assert changed_id[0].payload == {"previous": SID, "current": SID2}
    assert _kinds(changed_model) == ["model.changed"] and changed_model[0].payload == {"model": "sonnet"}


def test_text_delta_is_live_only():
    event, = Normalizer().feed(EngineMessage(kind="text_delta", message_id="m1", text="he"))

    assert (event.kind, event.persist, event.payload) == ("message.delta", False, {"message_id": "m1", "text": "he"})


def test_assistant_message_drops_thinking_and_keeps_text_and_tool_use():
    message = EngineMessage(kind="assistant", message_id="m1", model="haiku", blocks=[
        {"type": "thinking"}, {"type": "text", "text": "ok"},
        {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a"}},
    ])

    event, = Normalizer().feed(message)

    assert event.kind == "message.assistant"
    assert [b["type"] for b in event.payload["blocks"]] == ["text", "tool_use"]
    assert event.payload["origin"] == "live"


def test_an_assistant_message_with_only_thinking_produces_nothing():
    assert Normalizer().feed(EngineMessage(kind="assistant", model="haiku", blocks=[{"type": "thinking"}])) == []


def test_synthetic_model_becomes_a_system_notice():
    event, = Normalizer().feed(assistant_text("Set model to sonnet", model="<synthetic>"))

    assert (event.kind, event.payload["kind"], event.payload["text"]) == (
        "system.notice", "synthetic", "Set model to sonnet")


def test_tool_result_is_truncated_to_64_kb_and_flagged():
    big = "€" * 30_000  # 90 KB in UTF-8
    event, = Normalizer().feed(EngineMessage(kind="user_tool_result", results=[
        {"tool_use_id": "t1", "is_error": False, "content": big},
    ]))

    assert event.kind == "tool.result" and event.payload["truncated"] is True
    assert len(event.payload["content"].encode("utf-8")) <= TOOL_RESULT_MAX_BYTES
    assert len(event.payload["summary"]) <= 160


def test_tool_result_with_block_content_and_error_flag():
    event, = Normalizer().feed(EngineMessage(kind="user_tool_result", results=[
        {"tool_use_id": "t1", "is_error": True, "content": [{"type": "text", "text": "boom"}]},
    ]))

    assert event.payload["is_error"] is True and event.payload["content"] == "boom"


def test_local_command_output_becomes_a_notice_and_the_interrupt_marker_is_dropped():
    n = Normalizer()
    notice, = n.feed(EngineMessage(kind="user_text", text="<local-command-stdout>Compacted</local-command-stdout>"))

    assert (notice.kind, notice.payload) == ("system.notice", {"kind": "local_command", "text": "Compacted"})
    assert n.feed(EngineMessage(kind="user_text", text="[Request interrupted by user]")) == []
    assert n.feed(EngineMessage(kind="user_text", text="plain echo of the prompt")) == []


def test_result_becomes_turn_ended_with_cost_and_reason():
    event, = Normalizer().feed(result_message(cost_usd=0.5, terminal_reason="aborted_streaming",
                                               permission_denials=[{"tool": "Write"}]))

    assert event.kind == "turn.ended"
    assert event.payload["cost_usd"] == 0.5 and event.payload["terminal_reason"] == "aborted_streaming"
    assert event.payload["permission_denials"] == [{"tool": "Write"}]


def test_rate_limit_is_live_only_and_unknown_kinds_are_ignored_without_logging_their_content(caplog):
    n = Normalizer()
    limit, = n.feed(EngineMessage(kind="rate_limit", data={"status": "allowed_warning"}))
    with caplog.at_level(logging.DEBUG):
        ignored = n.feed(EngineMessage(kind="system_other", subtype="hook_started", data={"secret": "TOPSECRET"}))
        mystery = n.feed(EngineMessage(kind="something_new", text="TOPSECRET"))

    assert (limit.kind, limit.persist) == ("rate_limit", False)
    assert ignored == [] and mystery == []
    assert "TOPSECRET" not in caplog.text


def test_a_first_init_with_another_id_than_the_requested_one_reports_the_change():
    """`/clear` as the first message of a process: the first `init` already carries the new id."""
    for resuming, kind in ((True, "session.resumed"), (False, "session.started")):
        events = Normalizer(NormalizerState(claude_session_id=SID, resuming=resuming)).feed(init_message(SID2))

        assert _kinds(events) == [kind, "session.id_changed"]
        assert events[0].payload["claude_session_id"] == SID2
        assert events[1].payload == {"previous": SID, "current": SID2}


def test_a_first_init_with_the_requested_id_or_with_nothing_requested_reports_no_change():
    assert _kinds(Normalizer(NormalizerState(claude_session_id=SID, resuming=True)).feed(init_message(SID))) == [
        "session.resumed"]
    assert _kinds(Normalizer().feed(init_message(SID))) == ["session.started"]
