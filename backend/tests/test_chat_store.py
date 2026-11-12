"""ChatStore: sessions, gapless event log, permission requests, agent settings."""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from types import SimpleNamespace

import pytest
import pytest_asyncio

from app.chat import store as store_module
from app.chat.store import MAX_EVENT_PAYLOAD_BYTES, ChatStore
from app.conversation_store import ConversationStore

KEY = "proj::claude::abc123"


def _session_row(key: str = KEY, **extra) -> dict:
    return {
        "session_key": key,
        "project_ref": "proj",
        "agent_id": "claude",
        "cwd": "C:/work/proj",
        **extra,
    }


def _permission_row(permission_id: str = "p1", key: str = KEY, **extra) -> dict:
    return {
        "id": permission_id,
        "session_key": key,
        "kind": "tool",
        "tool_name": "Write",
        "input": {"file_path": "a.txt"},
        **extra,
    }


@pytest_asyncio.fixture
async def store(tmp_path):
    s = ChatStore(db_path=str(tmp_path / "chat.db"))
    await s.initialize()
    await s.create_chat_session(_session_row())
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_initialize_is_idempotent_and_creates_the_four_tables(tmp_path):
    db_path = tmp_path / "chat.db"
    for _ in range(2):
        s = ChatStore(db_path=str(db_path))
        await s.initialize()
        await s.close()

    conn = sqlite3.connect(db_path)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert {"chat_sessions", "chat_events", "permission_requests", "agent_chat_settings"} <= names


@pytest.mark.asyncio
async def test_session_round_trip_with_defaults_and_json_fields(store):
    await store.create_chat_session(
        _session_row("k2", add_dirs=["C:/extra"], last_error={"code": "x"}, model="haiku")
    )

    default = await store.get_chat_session(KEY)
    full = await store.get_chat_session("k2")

    assert default["status"] == "new" and default["permission_mode"] == "default"
    assert default["add_dirs"] == [] and default["last_error"] is None
    assert default["last_seq"] == 0 and default["origin"] == "chat"
    assert full["add_dirs"] == ["C:/extra"] and full["last_error"] == {"code": "x"}
    assert full["model"] == "haiku"
    assert await store.get_chat_session("missing") is None


@pytest.mark.asyncio
async def test_list_chat_sessions_filters_by_project(store):
    # An explicit `created_at` keeps the order independent of the clock's resolution: two rows made
    # in the same tick tie, and the tie is broken by session_key.
    first = (await store.get_chat_session(KEY))["created_at"]
    await store.create_chat_session(_session_row("k2", project_ref="other", created_at=first + 1))

    assert [s["session_key"] for s in await store.list_chat_sessions()] == [KEY, "k2"]
    assert [s["session_key"] for s in await store.list_chat_sessions("other")] == ["k2"]


@pytest.mark.asyncio
async def test_update_chat_session_changes_fields_and_clears_the_error(store):
    before = (await store.get_chat_session(KEY))["updated_at"]
    await store.update_chat_session(KEY, status="running", last_error={"code": "boom"},
                                    runtime_owner_pid=4242)
    after = await store.get_chat_session(KEY)

    assert (after["status"], after["last_error"], after["runtime_owner_pid"]) == (
        "running", {"code": "boom"}, 4242)
    assert after["updated_at"] >= before

    await store.update_chat_session(KEY, last_error=None, runtime_owner_pid=None)
    cleared = await store.get_chat_session(KEY)
    assert cleared["last_error"] is None and cleared["runtime_owner_pid"] is None


@pytest.mark.asyncio
async def test_update_rejects_columns_it_does_not_own(store):
    with pytest.raises(ValueError):
        await store.update_chat_session(KEY, last_seq=99)


@pytest.mark.asyncio
async def test_concurrent_appends_get_gapless_seq(store):
    results = await asyncio.gather(
        *(store.append_event(KEY, "message.user", {"n": n}) for n in range(50))
    )

    assert sorted(seq for seq, _ts in results) == list(range(1, 51))
    assert (await store.get_chat_session(KEY))["last_seq"] == 50
    events, last_seq, has_more = await store.events_since(KEY, 0, 1000)
    assert [e["seq"] for e in events] == list(range(1, 51))
    assert (last_seq, has_more) == (50, False)


@pytest.mark.asyncio
async def test_append_to_unknown_session_fails_and_writes_nothing(store):
    with pytest.raises(LookupError):
        await store.append_event("ghost", "message.user", {})

    conn = sqlite3.connect(store.db_path)
    assert conn.execute("SELECT COUNT(*) FROM chat_events").fetchone()[0] == 0
    conn.close()


@pytest.mark.asyncio
async def test_oversized_payload_is_replaced_and_its_content_is_not_logged(store, caplog):
    secret = "S" * (MAX_EVENT_PAYLOAD_BYTES + 10)

    with caplog.at_level(logging.WARNING, logger="app.chat.store"):
        seq, _ts = await store.append_event(KEY, "tool.result", {"content": secret})

    events, _, _ = await store.events_since(KEY, seq - 1, 10)
    assert events[0]["payload"] == {"truncated": True, "kind": "tool.result"}
    assert secret not in caplog.text and "tool.result" in caplog.text


@pytest.mark.asyncio
async def test_events_since_paginates_with_has_more(store):
    for n in range(5):
        await store.append_event(KEY, "message.user", {"n": n})

    first, last_seq, more = await store.events_since(KEY, 0, 2)
    second, _, more2 = await store.events_since(KEY, first[-1]["seq"], 2)
    third, _, more3 = await store.events_since(KEY, second[-1]["seq"], 2)

    assert ([e["seq"] for e in first], more, last_seq) == ([1, 2], True, 5)
    assert ([e["seq"] for e in second], more2) == ([3, 4], True)
    assert ([e["seq"] for e in third], more3) == ([5], False)
    assert first[0]["payload"] == {"n": 0} and first[0]["kind"] == "message.user"


@pytest.mark.asyncio
async def test_events_since_caps_the_page_size(store):
    await store.append_event(KEY, "message.user", {})

    events, _, _ = await store.events_since(KEY, 0, 10**6)  # must not raise

    assert len(events) == 1


@pytest.mark.asyncio
async def test_decide_permission_first_decision_wins(store):
    await store.create_permission(_permission_row())

    first = await store.decide_permission("p1", "allowed", {"behavior": "allow"}, "ws")
    second = await store.decide_permission("p1", "denied", {"behavior": "deny"}, "rest")

    assert (first, second) == (True, False)
    row = await store.get_permission("p1")
    assert row["status"] == "allowed" and row["decided_by"] == "ws"
    assert row["decision"] == {"behavior": "allow"} and row["decided_at"] is not None


@pytest.mark.asyncio
async def test_concurrent_decisions_have_exactly_one_winner(store):
    await store.create_permission(_permission_row())

    outcomes = await asyncio.gather(*(
        store.decide_permission("p1", "allowed", {"behavior": "allow"}, who)
        for who in ("ws", "rest", "ws", "rest")
    ))

    assert outcomes.count(True) == 1


@pytest.mark.asyncio
async def test_decide_permission_rejects_a_non_final_status(store):
    await store.create_permission(_permission_row())

    with pytest.raises(ValueError):
        await store.decide_permission("p1", "pending", {}, "ws")


@pytest.mark.asyncio
async def test_permission_defaults_and_input_cap(store):
    await store.create_permission(_permission_row("p2", input={"blob": "x" * 70_000}))
    await store.create_permission(_permission_row("p3", suggestions=[{"type": "addRules"}],
                                                  connector="podesubir-staging"))

    capped = await store.get_permission("p2")
    full = await store.get_permission("p3")

    assert capped["status"] == "pending" and capped["input"] == {"truncated": True}
    assert full["suggestions"] == [{"type": "addRules"}] and full["connector"] == "podesubir-staging"
    assert await store.get_permission("nope") is None


@pytest.mark.asyncio
async def test_close_pending_only_touches_pending_rows_of_the_session(store):
    await store.create_chat_session(_session_row("other"))
    await store.create_permission(_permission_row("p1"))
    await store.create_permission(_permission_row("p2"))
    await store.create_permission(_permission_row("p3", key="other"))
    await store.decide_permission("p2", "allowed", {"behavior": "allow"}, "ws")

    closed = await store.close_pending(KEY, "cancelled")

    assert [row["id"] for row in closed] == ["p1"]
    assert (await store.get_permission("p1"))["status"] == "cancelled"
    assert (await store.get_permission("p1"))["decided_by"] == "system"
    assert (await store.get_permission("p2"))["status"] == "allowed"
    assert (await store.get_permission("p3"))["status"] == "pending"
    assert await store.pending_count(KEY) == 0 and await store.pending_count("other") == 1


@pytest.mark.asyncio
async def test_close_pending_for_every_session_and_status_validation(store):
    await store.create_chat_session(_session_row("other"))
    await store.create_permission(_permission_row("p1"))
    await store.create_permission(_permission_row("p3", key="other"))

    closed = await store.close_pending(None, "expired")

    assert {row["id"] for row in closed} == {"p1", "p3"}
    assert (await store.get_permission("p3"))["status"] == "expired"
    with pytest.raises(ValueError):
        await store.close_pending(None, "allowed")


@pytest.mark.asyncio
async def test_delete_session_data_removes_only_that_key(store):
    await store.create_chat_session(_session_row("other"))
    for key in (KEY, "other"):
        await store.append_event(key, "message.user", {})
        await store.create_permission(_permission_row(f"p-{key}", key=key))

    await store.delete_session_data(KEY)

    assert await store.get_chat_session(KEY) is None
    assert (await store.events_since(KEY, 0, 10))[0] == []
    assert await store.pending_count(KEY) == 0
    assert await store.get_chat_session("other") is not None
    assert len((await store.events_since("other", 0, 10))[0]) == 1
    assert await store.pending_count("other") == 1


@pytest.mark.asyncio
async def test_agent_settings_defaults_then_json_round_trip(store):
    default = await store.get_agent_settings("claude")
    assert default["mcp_allowlist"] == [] and default["known_connectors"] == []
    assert default["connectors_probed_at"] is None

    stored = await store.put_agent_settings("claude", mcp_allowlist=["podesubir-staging"])
    assert stored["mcp_allowlist"] == ["podesubir-staging"]
    assert stored["updated_at"] is not None

    merged = await store.put_agent_settings(
        "claude",
        known_connectors=[{"name": "podesubir-staging", "tool_prefix": "mcp__claude_ai_podesubir-staging__"}],
        connectors_probed_at=123.5,
    )
    assert merged["mcp_allowlist"] == ["podesubir-staging"]  # untouched field kept
    assert merged["known_connectors"][0]["name"] == "podesubir-staging"
    assert merged["connectors_probed_at"] == 123.5
    assert json.dumps(merged)  # plain JSON types only

    with pytest.raises(ValueError):
        await store.put_agent_settings("claude", updated_at=1)


# -- a failed or cancelled write must not keep the shared database locked --------------------


async def _neighbour_write_is_prompt(tmp_path) -> None:
    """The ConversationStore shares the file; its write must not wait on the chat."""
    neighbour = ConversationStore(db_path=str(tmp_path / "chat.db"))
    await neighbour.initialize()
    try:
        await asyncio.wait_for(neighbour.set("v2-key", "uuid-1"), timeout=2)
        assert await neighbour.get("v2-key") == "uuid-1"
    finally:
        await neighbour.close()


@pytest.mark.asyncio
async def test_a_failing_insert_rolls_back_and_does_not_block_the_conversation_store(store, tmp_path):
    with pytest.raises(sqlite3.IntegrityError):
        await store.create_chat_session(_session_row())  # same primary key as the fixture's

    assert not store._conn.in_transaction
    await _neighbour_write_is_prompt(tmp_path)


@pytest.mark.asyncio
async def test_a_duplicate_permission_id_rolls_back(store, tmp_path):
    await store.create_permission(_permission_row())

    with pytest.raises(sqlite3.IntegrityError):
        await store.create_permission(_permission_row())

    assert not store._conn.in_transaction
    await _neighbour_write_is_prompt(tmp_path)


@pytest.mark.asyncio
async def test_a_cancelled_decision_is_rolled_back_and_can_be_decided_again(store, monkeypatch):
    await store.create_permission(_permission_row())
    commit_started = asyncio.Event()
    store.commit_grace = 0.2  # a commit that never ends is abandoned quickly (real ones keep the default)

    async def hanging_commit():
        commit_started.set()
        await asyncio.Event().wait()

    with monkeypatch.context() as patched:
        patched.setattr(store._conn, "commit", hanging_commit)
        task = asyncio.create_task(
            store.decide_permission("p1", "allowed", {"behavior": "allow"}, "ws")
        )
        await asyncio.wait_for(commit_started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert not store._conn.in_transaction
    assert (await store.get_permission("p1"))["status"] == "pending"
    # Nobody got True from the cancelled call, so the next caller still can.
    assert await store.decide_permission("p1", "denied", {"behavior": "deny"}, "rest") is True


@pytest.mark.asyncio
async def test_a_cancelled_event_append_leaves_no_gap_and_no_open_transaction(store, monkeypatch):
    await store.append_event(KEY, "a", {})
    commit_started = asyncio.Event()
    store.commit_grace = 0.2  # a commit that never ends is abandoned quickly (real ones keep the default)

    async def hanging_commit():
        commit_started.set()
        await asyncio.Event().wait()

    with monkeypatch.context() as patched:
        patched.setattr(store._conn, "commit", hanging_commit)
        task = asyncio.create_task(store.append_event(KEY, "b", {}))
        await asyncio.wait_for(commit_started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert not store._conn.in_transaction
    assert (await store.append_event(KEY, "c", {}))[0] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("write", [
    lambda s: s.update_chat_session(KEY, status="running"),
    lambda s: s.close_pending(KEY, "expired"),
    lambda s: s.delete_session_data(KEY),
    lambda s: s.put_agent_settings("claude", mcp_allowlist=["x"]),
])
async def test_every_other_write_rolls_back_when_cancelled(store, monkeypatch, write):
    await store.create_permission(_permission_row())
    commit_started = asyncio.Event()
    store.commit_grace = 0.2  # a commit that never ends is abandoned quickly (real ones keep the default)

    async def hanging_commit():
        commit_started.set()
        await asyncio.Event().wait()

    with monkeypatch.context() as patched:
        patched.setattr(store._conn, "commit", hanging_commit)
        task = asyncio.create_task(write(store))
        await asyncio.wait_for(commit_started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert not store._conn.in_transaction
    assert (await store.get_chat_session(KEY))["status"] == "new"
    assert (await store.get_permission("p1"))["status"] == "pending"
    assert (await store.get_agent_settings("claude"))["mcp_allowlist"] == []


# -- O13: cancellation while the commit is in flight, with the REAL commit -------------------------


async def _cancel_after(store, steps: int, make_call):
    """Start `make_call()`, let the loop turn `steps` times, cancel it. Real aiosqlite, no fake."""
    task = asyncio.create_task(make_call())
    for _ in range(steps):
        await asyncio.sleep(0)
    task.cancel()
    return await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_a_decision_is_never_on_disk_without_somebody_to_act_on_it(store):
    """Whatever the moment of the cancel (a sweep over loop turns), either the row is still
    pending and decidable, or it is decided and the delivery callback ran exactly once. Which
    moments land inside the commit depends on thread timing, so the in-flight window itself is
    proved deterministically by the tests that follow, not by counting on this sweep to hit it."""
    for steps in range(0, 24):
        permission_id = f"p{steps}"
        await store.create_permission(_permission_row(permission_id))
        delivered: list[str] = []

        await _cancel_after(
            store, steps,
            lambda: store.decide_permission(
                permission_id, "allowed", {"behavior": "allow"}, "ws",
                on_committed=lambda: delivered.append(permission_id),
            ),
        )

        on_disk = (await store.get_permission(permission_id))["status"]
        assert not store._conn.in_transaction
        if on_disk == "pending":
            assert delivered == []
            assert await store.decide_permission(permission_id, "denied", {}, "rest") is True
        else:
            assert on_disk == "allowed" and delivered == [permission_id]
            # Nobody else can decide it again, and the one who could was told.
            assert await store.decide_permission(permission_id, "denied", {}, "rest") is False


@pytest.mark.asyncio
@pytest.mark.parametrize("delay_turns", range(0, 8))
async def test_cancelling_at_every_point_inside_the_commit_always_delivers(store, delay_turns):
    """Deterministic: the REAL commit is dispatched only after `delay_turns` loop turns, and
    the cancel lands as soon as it was dispatched, so the cancel is always inside the commit."""
    await store.create_permission(_permission_row())
    real_commit = store._conn.commit
    dispatched = asyncio.Event()

    async def late_commit():
        for _ in range(delay_turns):
            await asyncio.sleep(0)
        dispatched.set()
        await real_commit()

    delivered = []
    store._conn.commit = late_commit
    try:
        task = asyncio.create_task(store.decide_permission(
            "p1", "allowed", {"behavior": "allow"}, "ws", on_committed=lambda: delivered.append(1)))
        await asyncio.wait_for(dispatched.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        store._conn.commit = real_commit

    assert delivered == [1]
    assert (await store.get_permission("p1"))["status"] == "allowed"
    assert await store.decide_permission("p1", "denied", {}, "rest") is False
    assert not store._conn.in_transaction


@pytest.mark.asyncio
async def test_cancelling_right_after_the_real_commit_was_dispatched_still_delivers(store):
    await store.create_permission(_permission_row())
    real_commit = store._conn.commit
    dispatched = asyncio.Event()

    async def spying_commit():
        dispatched.set()            # the commit has been handed to the sqlite thread ...
        await real_commit()         # ... and it is the real one

    delivered = []
    store._conn.commit = spying_commit
    try:
        task = asyncio.create_task(store.decide_permission(
            "p1", "allowed", {"behavior": "allow"}, "ws", on_committed=lambda: delivered.append(1),
        ))
        await asyncio.wait_for(dispatched.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        store._conn.commit = real_commit

    assert delivered == [1]
    assert (await store.get_permission("p1"))["status"] == "allowed"
    assert await store.decide_permission("p1", "denied", {}, "rest") is False
    assert not store._conn.in_transaction


@pytest.mark.asyncio
async def test_a_cancelled_event_append_with_the_commit_in_flight_still_reaches_the_readers(store):
    real_commit = store._conn.commit
    dispatched = asyncio.Event()

    async def spying_commit():
        dispatched.set()
        await real_commit()

    seen = []
    store._conn.commit = spying_commit
    try:
        task = asyncio.create_task(store.append_event(
            KEY, "message.user", {"text": "hi"}, on_committed=lambda seq, ts: seen.append(seq),
        ))
        await asyncio.wait_for(dispatched.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        store._conn.commit = real_commit

    events, last_seq, _ = await store.events_since(KEY, 0, 10)
    assert seen == [1]
    assert [e["seq"] for e in events] == [1] and last_seq == 1
    # No gap: the next event is 2.
    assert (await store.append_event(KEY, "b", {}))[0] == 2


@pytest.mark.asyncio
async def test_every_event_on_disk_was_delivered_whatever_the_cancel_moment(store):
    previous_count = 0
    for steps in range(0, 20):
        seen: list[int] = []
        await _cancel_after(
            store, steps,
            lambda: store.append_event(KEY, "x", {"n": steps}, on_committed=lambda seq, ts: seen.append(seq)),
        )
        events, last_seq, _ = await store.events_since(KEY, 0, 1000)
        on_disk = [e["seq"] for e in events]
        assert on_disk == list(range(1, len(on_disk) + 1)), "no gap"
        assert last_seq == len(on_disk)
        grew = len(on_disk) - previous_count
        assert grew in (0, 1)
        # exactly the event that reached the disk this round was delivered, and nothing else
        assert seen == ([on_disk[-1]] if grew else [])
        previous_count = len(on_disk)


@pytest.mark.asyncio
async def test_a_commit_that_never_finishes_is_abandoned_and_rolled_back(store):
    async def never():
        await asyncio.Event().wait()

    store.commit_grace = 0.2
    store._conn.commit = never
    delivered = []
    try:
        with pytest.raises(TimeoutError):
            await store.decide_permission("none", "allowed", {}, "ws", on_committed=lambda: delivered.append(1))
    finally:
        del store._conn.commit
    assert delivered == []
    assert not store._conn.in_transaction


# -- O9 / O10: failure modes of the store ------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_trigger_that_aborts_the_insert_leaves_no_gap_and_no_open_transaction(store, tmp_path):
    conn = sqlite3.connect(tmp_path / "chat.db")
    conn.execute(
        "CREATE TRIGGER no_boom BEFORE INSERT ON chat_events WHEN NEW.kind = 'boom' "
        "BEGIN SELECT RAISE(ABORT, 'nope'); END"
    )
    conn.commit()
    conn.close()
    await store.append_event(KEY, "a", {})

    with pytest.raises(sqlite3.Error):
        await store.append_event(KEY, "boom", {})

    assert not store._conn.in_transaction
    assert (await store.get_chat_session(KEY))["last_seq"] == 1
    assert (await store.append_event(KEY, "c", {}))[0] == 2
    await _neighbour_write_is_prompt(tmp_path)


@pytest.mark.asyncio
async def test_the_payload_limit_is_counted_in_bytes_not_characters(store):
    # 90k characters, 3 bytes each: over 256 KB although under 256k characters.
    await store.append_event(KEY, "big", {"text": "€" * 90_000})
    events, _, _ = await store.events_since(KEY, 0, 10)
    assert events[0]["payload"] == {"truncated": True, "kind": "big"}


@pytest.mark.asyncio
async def test_append_event_bumps_updated_at(store, monkeypatch):
    # A controlled clock instead of a `sleep`: the Windows tick (15.625 ms) is longer than any
    # short sleep, so two real reads can land in the same tick and tie.
    before = (await store.get_chat_session(KEY))["updated_at"]
    monkeypatch.setattr(store_module, "time", SimpleNamespace(time=lambda: before + 1))
    await store.append_event(KEY, "a", {})
    assert (await store.get_chat_session(KEY))["updated_at"] == before + 1


@pytest.mark.asyncio
async def test_a_lone_surrogate_in_an_event_or_a_permission_does_not_break_the_write(store):
    await store.append_event(KEY, "message.assistant", {"text": "ok \ud83d broken"})
    await store.create_permission(_permission_row("s1", input={"command": "echo \udcff"}))

    events, _, _ = await store.events_since(KEY, 0, 10)
    assert events[0]["payload"]["text"].startswith("ok ")
    assert (await store.get_permission("s1"))["input"]["command"].startswith("echo ")
    assert not store._conn.in_transaction


@pytest.mark.asyncio
async def test_started_since_last_reset_ignores_what_came_before_the_reset(store):
    kinds = ("session.started", "session.resumed")
    assert await store.started_since_last_reset(KEY, kinds) is False

    await store.append_event(KEY, "session.started", {})
    assert await store.started_since_last_reset(KEY, kinds) is True

    await store.append_event(KEY, "session.reset", {})
    assert await store.started_since_last_reset(KEY, kinds) is False

    await store.append_event(KEY, "session.resumed", {})
    assert await store.started_since_last_reset(KEY, kinds) is True


@pytest.mark.asyncio
async def test_logged_conversation_lists_what_a_history_import_must_not_repeat(store):
    await store.append_event(KEY, "message.user", {"text": "one"})
    await store.append_event(KEY, "message.assistant", {"message_id": "m1", "blocks": []})
    await store.append_event(KEY, "tool.result", {"tool_use_id": "t1"})
    await store.append_event(KEY, "message.user", {"text": "two"})
    await store.append_event(KEY, "message.user", {"text": "three"})
    await store.append_event(KEY, "status", {"code": "closed"})

    known = await store.logged_conversation(KEY)

    assert known == {"assistant_ids": {"m1"}, "tool_use_ids": {"t1"}, "trailing_user_texts": ["two", "three"]}


@pytest.mark.asyncio
async def test_cancel_permission_closes_one_pending_request_once(store):
    await store.create_permission(_permission_row("p1"))
    await store.create_permission(_permission_row("p2"))

    row = await store.cancel_permission("p1")
    again = await store.cancel_permission("p1")

    assert row["id"] == "p1" and again is None
    assert (await store.get_permission("p1"))["status"] == "cancelled"
    assert (await store.get_permission("p2"))["status"] == "pending"
    assert await store.pending_count(KEY) == 1
