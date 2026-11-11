"""Additive `engine` column and `session_claude_ids` aliases in ConversationStore."""
from __future__ import annotations

import sqlite3

import pytest
import pytest_asyncio

from app.conversation_store import ConversationStore

# The `sessions` schema exactly as c4c5dee's ConversationStore.initialize() leaves it.
OLD_SESSIONS_DDL = (
    """CREATE TABLE sessions (
        session_key TEXT PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        updated_at REAL DEFAULT ((julianday('now') - 2440587.5) * 86400.0)
    )""",
    "ALTER TABLE sessions ADD COLUMN display_name TEXT",
    "ALTER TABLE sessions ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sessions ADD COLUMN last_activity_seen_at REAL",
    "ALTER TABLE sessions ADD COLUMN push_notified INTEGER NOT NULL DEFAULT 0",
)


def _schema(db_path) -> tuple[dict[str, str], list[tuple]]:
    conn = sqlite3.connect(db_path)
    try:
        master = dict(
            conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
            ).fetchall()
        )
        columns = conn.execute("PRAGMA table_info(sessions)").fetchall()
    finally:
        conn.close()
    return master, columns


def _make_old_db(db_path) -> None:
    conn = sqlite3.connect(db_path)
    for statement in OLD_SESSIONS_DDL:
        conn.execute(statement)
    conn.execute(
        "INSERT INTO sessions (session_key, claude_session_id, display_name, "
        "needs_attention, push_notified) VALUES ('old-1', 'uuid-1', 'Old one', 1, 1)"
    )
    conn.execute(
        "INSERT INTO sessions (session_key, claude_session_id) VALUES ('old-2', 'uuid-2')"
    )
    conn.commit()
    conn.close()


@pytest_asyncio.fixture
async def store(tmp_path):
    s = ConversationStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_initialize_migrates_an_old_schema_to_engine_pty(tmp_path):
    db_path = tmp_path / "old.db"
    _make_old_db(db_path)
    before_master, before_columns = _schema(db_path)

    s = ConversationStore(db_path=str(db_path))
    await s.initialize()
    try:
        assert await s.get_engine("old-1") == "pty"
        assert await s.get_engine("old-2") == "pty"
    finally:
        await s.close()

    after_master, after_columns = _schema(db_path)
    # Only the `engine` column, the alias table (plus its index) and the "was a chat" mark table are new.
    assert [c[1] for c in after_columns][: len(before_columns)] == [c[1] for c in before_columns]
    assert [c[1] for c in after_columns][len(before_columns):] == ["engine"]
    assert set(after_master) - set(before_master) == {
        "session_claude_ids",
        "idx_session_claude_ids_key",
        "session_was_chat",
    }
    assert after_master["sessions"] != before_master["sessions"]  # ALTER rewrote the DDL text


@pytest.mark.asyncio
async def test_initialize_twice_is_harmless(tmp_path):
    db_path = tmp_path / "old.db"
    _make_old_db(db_path)
    for _ in range(2):
        s = ConversationStore(db_path=str(db_path))
        await s.initialize()
        await s.close()

    _, columns = _schema(db_path)
    assert [c[1] for c in columns].count("engine") == 1


@pytest.mark.asyncio
async def test_existing_rows_survive_the_migration_untouched(tmp_path):
    db_path = tmp_path / "old.db"
    _make_old_db(db_path)
    s = ConversationStore(db_path=str(db_path))
    await s.initialize()
    try:
        assert await s.get("old-1") == "uuid-1"
        assert await s.get_all_meta() == {
            "old-1": {"display_name": "Old one", "needs_attention": True, "push_notified": True},
            "old-2": {"display_name": None, "needs_attention": False, "push_notified": False},
        }
    finally:
        await s.close()


@pytest.mark.asyncio
async def test_set_keeps_the_default_pty_engine(store):
    await store.set("k", "cid")

    assert await store.get_engine("k") == "pty"


@pytest.mark.asyncio
async def test_create_if_absent_creates_once_and_never_overwrites(store):
    assert await store.create_if_absent("k", "first", "chat") is True
    assert await store.create_if_absent("k", "second", "pty") is False

    assert await store.get("k") == "first"
    assert await store.get_engine("k") == "chat"


@pytest.mark.asyncio
async def test_create_if_absent_does_not_touch_a_v2_conversation(store):
    await store.set("v2-key", "v2-uuid")

    assert await store.create_if_absent("v2-key", "other", "chat") is False

    assert await store.get("v2-key") == "v2-uuid"
    assert await store.get_engine("v2-key") == "pty"


@pytest.mark.asyncio
async def test_get_engine_is_none_for_an_unknown_key(store):
    assert await store.get_engine("nope") is None


@pytest.mark.asyncio
async def test_set_engine_round_trip_keeps_the_rest_of_the_row(store):
    await store.set("k", "cid")
    await store.rename("k", "Name")

    await store.set_engine("k", "chat")
    assert await store.get_engine("k") == "chat"
    await store.set_engine("k", "pty")

    assert await store.get_engine("k") == "pty"
    assert await store.get("k") == "cid"
    assert (await store.get_all_meta())["k"]["display_name"] == "Name"


@pytest.mark.asyncio
async def test_alias_resolves_the_previous_and_the_new_id_to_the_same_key(store):
    await store.create_if_absent("k", "id-1", "chat")

    await store.set_claude_session_id_with_alias("k", "id-2")

    assert await store.get("k") == "id-2"
    assert await store.get_session_key_by_claude_id("id-2") == "k"
    assert await store.get_session_key_by_claude_id("id-1") == "k"


@pytest.mark.asyncio
async def test_alias_chain_keeps_every_earlier_id(store):
    await store.create_if_absent("k", "id-1", "chat")
    await store.set_claude_session_id_with_alias("k", "id-2")
    await store.set_claude_session_id_with_alias("k", "id-3")

    for old_id in ("id-1", "id-2", "id-3"):
        assert await store.get_session_key_by_claude_id(old_id) == "k"
    assert await store.get("k") == "id-3"


@pytest.mark.asyncio
async def test_same_id_swap_adds_no_alias(store):
    await store.create_if_absent("k", "id-1", "chat")

    await store.set_claude_session_id_with_alias("k", "id-1")

    conn = sqlite3.connect(store.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM session_claude_ids").fetchone()[0] == 0
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_sessions_table_wins_over_an_alias(store):
    await store.set("owner", "shared-id")
    await store.set("stale", "shared-id")
    await store.set_claude_session_id_with_alias("stale", "moved-on")  # leaves the alias shared-id -> stale
    conn = sqlite3.connect(store.db_path)
    try:
        assert conn.execute("SELECT session_key FROM session_claude_ids WHERE claude_session_id = 'shared-id'"
                            ).fetchone() == ("stale",)
    finally:
        conn.close()

    assert await store.get_session_key_by_claude_id("shared-id") == "owner"


@pytest.mark.asyncio
async def test_unknown_claude_id_resolves_to_none(store):
    assert await store.get_session_key_by_claude_id("never-seen") is None


@pytest.mark.asyncio
async def test_clear_removes_the_aliases_of_the_key_only(store):
    await store.create_if_absent("a", "a-1", "chat")
    await store.set_claude_session_id_with_alias("a", "a-2")
    await store.create_if_absent("b", "b-1", "chat")
    await store.set_claude_session_id_with_alias("b", "b-2")

    await store.clear("a")

    assert await store.get_session_key_by_claude_id("a-1") is None
    assert await store.get_session_key_by_claude_id("b-1") == "b"


@pytest.mark.asyncio
async def test_get_all_meta_without_arguments_keeps_exactly_the_v2_keys(store):
    await store.create_if_absent("c", "x", "chat")
    await store.set("p", "y")

    meta = await store.get_all_meta()

    assert set(meta) == {"c", "p"}  # "all rows" for the internal callers
    for entry in meta.values():
        assert set(entry) == {"display_name", "needs_attention", "push_notified"}


@pytest.mark.asyncio
async def test_get_all_meta_filters_by_engine_and_can_include_it(store):
    await store.set("p1", "y")
    await store.create_if_absent("c1", "x", "chat")
    await store.set("p2", "z")

    assert list(await store.get_all_meta(engine="pty")) == ["p1", "p2"]
    assert list(await store.get_all_meta(engine="chat")) == ["c1"]
    tagged = await store.get_all_meta(include_engine=True)
    assert {key: entry["engine"] for key, entry in tagged.items()} == {
        "p1": "pty", "c1": "chat", "p2": "pty",
    }
    assert "engine" not in (await store.get_all_meta(engine="pty"))["p1"]


@pytest.mark.asyncio
async def test_a_locked_database_aborts_the_migration_instead_of_skipping_the_column(tmp_path):
    # c4c5dee schema WITH the alias table and its index already there, so the only
    # write initialize() still has to make is `ALTER TABLE ... ADD COLUMN engine`.
    # Another connection holds the write lock for the whole call.
    db_path = tmp_path / "locked.db"
    _make_old_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "CREATE TABLE session_claude_ids (claude_session_id TEXT PRIMARY KEY, "
        "session_key TEXT NOT NULL, created_at REAL NOT NULL)"
    )
    conn.execute("CREATE INDEX idx_session_claude_ids_key ON session_claude_ids(session_key)")
    conn.commit()
    conn.close()

    holder = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
    holder.execute("BEGIN IMMEDIATE")
    s = ConversationStore(db_path=str(db_path))
    try:
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            await s.initialize()
    finally:
        holder.execute("ROLLBACK")
        holder.close()
        if s._conn:
            await s._conn.close()

    # The failed boot left the table untouched, so the next boot migrates normally.
    s2 = ConversationStore(db_path=str(db_path))
    await s2.initialize()
    try:
        assert await s2.get_engine("old-1") == "pty"
    finally:
        await s2.close()


# -- O6: the engine value is validated in code ------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["", "bogus", "PTY", None])
async def test_create_if_absent_rejects_an_unknown_engine_instead_of_reporting_a_collision(store, bad):
    await store.create_if_absent("v2-key", "uuid-1", "pty")

    with pytest.raises(ValueError, match="invalid engine"):
        await store.create_if_absent("fresh-key", "uuid-2", bad)

    # Nothing was created, and "False" still only means "the key was already there".
    assert await store.get_engine("fresh-key") is None
    assert await store.create_if_absent("v2-key", "uuid-3", "chat") is False


@pytest.mark.asyncio
async def test_set_engine_rejects_an_unknown_engine_and_leaves_the_row_alone(store):
    await store.create_if_absent("k", "uuid-1", "chat")

    with pytest.raises(ValueError, match="invalid engine"):
        await store.set_engine("k", "bogus")

    assert await store.get_engine("k") == "chat"


# -- O7: the alias swap is serialised and never rolls back the shared connection ----------------------


@pytest.mark.asyncio
async def test_concurrent_swaps_of_one_key_keep_every_id_resolvable(store):
    import asyncio

    await store.create_if_absent("k", "id-0", "chat")

    await asyncio.gather(*(store.set_claude_session_id_with_alias("k", f"id-{n}") for n in range(1, 9)))

    final = await store.get("k")
    assert final.startswith("id-")
    for n in range(0, 9):
        # every id that was ever current still resolves to the key (as the id or as an alias)
        assert await store.get_session_key_by_claude_id(f"id-{n}") == "k"


@pytest.mark.asyncio
async def test_a_failing_swap_does_not_discard_an_uncommitted_write_of_another_coroutine(store, monkeypatch):
    await store.create_if_absent("k", "id-0", "chat")
    await store.create_if_absent("other", "uuid-o", "pty")
    # Another coroutine has executed (not yet committed) a V2 write on the shared connection.
    await store._conn.execute("UPDATE sessions SET display_name = 'unsaved' WHERE session_key = 'other'")

    real_execute = store._conn.execute

    def failing_execute(sql, *args, **kwargs):
        if sql.lstrip().upper().startswith("UPDATE SESSIONS SET CLAUDE_SESSION_ID"):
            raise sqlite3.OperationalError("boom")
        return real_execute(sql, *args, **kwargs)

    monkeypatch.setattr(store._conn, "execute", failing_execute)
    with pytest.raises(sqlite3.OperationalError):
        await store.set_claude_session_id_with_alias("k", "id-1")
    monkeypatch.undo()

    await store._conn.commit()
    meta = await store.get_all_meta()
    assert meta["other"]["display_name"] == "unsaved"
    assert await store.get("k") == "id-0"


@pytest.mark.asyncio
async def test_a_failed_swap_leaves_no_write_lock_held_for_the_other_stores_of_the_file(store, tmp_path, monkeypatch):
    """The alias INSERT of a swap opens a transaction; if the UPDATE then fails, that transaction
    must not stay open (it would hold SQLite's write lock until the next commit of this store)."""
    import time

    await store.create_if_absent("k", "id-0", "chat")
    real_execute = store._conn.execute

    def failing_execute(sql, *args, **kwargs):
        if sql.lstrip().upper().startswith("UPDATE SESSIONS SET CLAUDE_SESSION_ID"):
            raise sqlite3.OperationalError("boom")
        return real_execute(sql, *args, **kwargs)

    monkeypatch.setattr(store._conn, "execute", failing_execute)
    with pytest.raises(sqlite3.OperationalError):
        await store.set_claude_session_id_with_alias("k", "id-1")
    monkeypatch.undo()

    assert not store._conn.in_transaction
    other = sqlite3.connect(tmp_path / "test.db", timeout=2)
    started = time.monotonic()
    other.execute("INSERT INTO sessions (session_key, claude_session_id) VALUES ('neighbour', 'x')")
    other.commit()
    other.close()
    assert time.monotonic() - started < 1.0
    assert await store.get("k") == "id-0"


@pytest.mark.asyncio
async def test_the_was_chat_mark_is_idempotent_and_goes_away_with_the_session(store):
    await store.set("k", "uuid-k")
    assert await store.was_chat("k") is False

    await store.mark_was_chat("k")
    await store.mark_was_chat("k")
    assert await store.was_chat("k") is True
    assert await store.was_chat("other") is False

    await store.clear("k")
    assert await store.was_chat("k") is False
