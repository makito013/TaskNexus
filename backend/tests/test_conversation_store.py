import pytest
import pytest_asyncio
import tempfile
import os
from app.conversation_store import ConversationStore


@pytest_asyncio.fixture
async def store(tmp_path):
    s = ConversationStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_get_missing_returns_none(store):
    result = await store.get("nonexistent-key")
    assert result is None


@pytest.mark.asyncio
async def test_set_and_get(store):
    await store.set("key1", "claude-uuid-abc")
    result = await store.get("key1")
    assert result == "claude-uuid-abc"


@pytest.mark.asyncio
async def test_set_overwrites(store):
    await store.set("key1", "old-uuid")
    await store.set("key1", "new-uuid")
    result = await store.get("key1")
    assert result == "new-uuid"


@pytest.mark.asyncio
async def test_clear_removes_entry(store):
    await store.set("key1", "some-uuid")
    await store.clear("key1")
    result = await store.get("key1")
    assert result is None


@pytest.mark.asyncio
async def test_clear_nonexistent_is_noop(store):
    await store.clear("ghost")  # must not raise


@pytest.mark.asyncio
async def test_mark_needs_attention_then_ack_clears_it(store):
    await store.set("key1", "uuid-1")
    await store.mark_needs_attention("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["needs_attention"] is True

    await store.ack("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["needs_attention"] is False


@pytest.mark.asyncio
async def test_mark_needs_attention_nonexistent_is_noop(store):
    await store.mark_needs_attention("ghost")  # must not raise


@pytest.mark.asyncio
async def test_rename_sets_display_name(store):
    await store.set("key1", "uuid-1")
    await store.rename("key1", "Meu Chat")
    meta = await store.get_all_meta()
    assert meta["key1"]["display_name"] == "Meu Chat"


@pytest.mark.asyncio
async def test_rename_nonexistent_is_noop(store):
    await store.rename("ghost", "Nome")  # must not raise


@pytest.mark.asyncio
async def test_get_session_key_by_claude_id_found(store):
    await store.set("proj::claude", "uuid-abc")
    result = await store.get_session_key_by_claude_id("uuid-abc")
    assert result == "proj::claude"


@pytest.mark.asyncio
async def test_get_session_key_by_claude_id_not_found(store):
    result = await store.get_session_key_by_claude_id("no-such-uuid")
    assert result is None


@pytest.mark.asyncio
async def test_set_upsert_preserves_display_name_and_needs_attention(store):
    """Bug 2 fix: set() must be a real upsert (ON CONFLICT DO UPDATE), not the
    old INSERT OR REPLACE which silently reset display_name/needs_attention
    back to defaults on every respawn. A repeated set() with a NEW
    claude_session_id (simulating a PTY respawn after a resume failure) must
    leave display_name and needs_attention exactly as they were."""
    await store.set("key1", "old-uuid")
    await store.rename("key1", "Meu Chat")
    await store.mark_needs_attention("key1")

    await store.set("key1", "new-uuid")

    result = await store.get("key1")
    assert result == "new-uuid"
    meta = await store.get_all_meta()
    assert meta["key1"]["display_name"] == "Meu Chat"
    assert meta["key1"]["needs_attention"] is True


@pytest.mark.asyncio
async def test_reset_claude_session_id_clears_field(store):
    """Bug 2 fix: reset_claude_session_id() zeros only claude_session_id
    (empty string sentinel, since the column is NOT NULL), preserving
    display_name/needs_attention — unlike clear(), which deletes the whole row."""
    await store.set("key1", "old-uuid")
    await store.rename("key1", "Meu Chat")
    await store.mark_needs_attention("key1")

    await store.reset_claude_session_id("key1")

    result = await store.get("key1")
    assert result == ""  # falsy, same as None for every existing consumer
    meta = await store.get_all_meta()
    assert meta["key1"]["display_name"] == "Meu Chat"
    assert meta["key1"]["needs_attention"] is True


@pytest.mark.asyncio
async def test_reset_claude_session_id_nonexistent_is_noop(store):
    await store.reset_claude_session_id("ghost")  # must not raise
    result = await store.get("ghost")
    assert result is None


@pytest.mark.asyncio
async def test_persists_across_instances(tmp_path):
    db = str(tmp_path / "persist.db")
    s1 = ConversationStore(db_path=db)
    await s1.initialize()
    await s1.set("k", "v")
    await s1.close()

    s2 = ConversationStore(db_path=db)
    await s2.initialize()
    result = await s2.get("k")
    await s2.close()
    assert result == "v"


# ─── push_notified ledger (Phase 3 of the notification plan) ────────────────


@pytest.mark.asyncio
async def test_push_notified_defaults_to_false(store):
    await store.set("key1", "sid")
    meta = await store.get_all_meta()
    assert meta["key1"]["push_notified"] is False


@pytest.mark.asyncio
async def test_mark_push_notified_is_visible_in_get_all_meta(store):
    await store.set("key1", "sid")
    await store.mark_push_notified("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["push_notified"] is True


@pytest.mark.asyncio
async def test_ack_resets_push_notified(store):
    # The pause was seen, so the NEXT pause of this session must be able to
    # play the local sound again.
    await store.set("key1", "sid")
    await store.mark_needs_attention("key1")
    await store.mark_push_notified("key1")
    await store.ack("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["push_notified"] is False
    assert meta["key1"]["needs_attention"] is False


@pytest.mark.asyncio
async def test_mark_needs_attention_resets_push_notified(store):
    # Without this reset, a second pause of the same session would inherit
    # the first pause's mark and the local sound would stay suppressed
    # forever.
    await store.set("key1", "sid")
    await store.mark_push_notified("key1")
    await store.mark_needs_attention("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["push_notified"] is False
    assert meta["key1"]["needs_attention"] is True


@pytest.mark.asyncio
async def test_mark_push_notified_nonexistent_is_noop(store):
    await store.mark_push_notified("ghost")  # must not raise


@pytest.mark.asyncio
async def test_mark_push_notified_does_not_touch_other_sessions(store):
    await store.set("key1", "sid1")
    await store.set("key2", "sid2")
    await store.mark_push_notified("key1")
    meta = await store.get_all_meta()
    assert meta["key1"]["push_notified"] is True
    assert meta["key2"]["push_notified"] is False
