"""Unit tests for PushSubscriptionStore (Phase 3, Task 2/3 of the Web
Push/VAPID plan). Same fixture pattern as test_settings_store.py: a store
instance pointed at a throwaway file in tmp_path, initialized and closed
around each test."""
import pytest
import pytest_asyncio

from app.push_store import PushSubscriptionStore


@pytest_asyncio.fixture
async def store(tmp_path):
    s = PushSubscriptionStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


def _subscription(endpoint="https://fcm.example/one", p256dh="pub-1", auth="auth-1"):
    return {"endpoint": endpoint, "p256dh": p256dh, "auth": auth}


@pytest.mark.asyncio
async def test_list_all_is_empty_on_a_fresh_database(store):
    assert await store.list_all() == []


@pytest.mark.asyncio
async def test_upsert_then_list_all_returns_the_subscription(store):
    await store.upsert(**_subscription(), user_agent="TestAgent/1.0")
    rows = await store.list_all()
    assert len(rows) == 1
    assert rows[0]["endpoint"] == "https://fcm.example/one"
    assert rows[0]["p256dh"] == "pub-1"
    assert rows[0]["auth"] == "auth-1"
    assert rows[0]["user_agent"] == "TestAgent/1.0"
    assert rows[0]["created_at"] > 0


@pytest.mark.asyncio
async def test_upsert_is_idempotent_by_endpoint(store):
    # Two tabs of the same browser produce the SAME endpoint — registering
    # twice must not create a second row (which would send two pushes for
    # one device).
    await store.upsert(**_subscription())
    await store.upsert(**_subscription())
    assert len(await store.list_all()) == 1


@pytest.mark.asyncio
async def test_upsert_refreshes_the_keys_of_an_existing_endpoint(store):
    await store.upsert(**_subscription())
    await store.upsert(**_subscription(p256dh="pub-2", auth="auth-2"))
    rows = await store.list_all()
    assert len(rows) == 1
    assert rows[0]["p256dh"] == "pub-2"
    assert rows[0]["auth"] == "auth-2"


@pytest.mark.asyncio
async def test_upsert_preserves_created_at_of_an_existing_endpoint(store):
    await store.upsert(**_subscription())
    created_at = (await store.list_all())[0]["created_at"]
    await store.upsert(**_subscription(p256dh="pub-2"))
    assert (await store.list_all())[0]["created_at"] == created_at


@pytest.mark.asyncio
async def test_delete_removes_only_the_given_endpoint(store):
    await store.upsert(**_subscription())
    await store.upsert(**_subscription(endpoint="https://fcm.example/two"))
    await store.delete("https://fcm.example/one")
    rows = await store.list_all()
    assert [r["endpoint"] for r in rows] == ["https://fcm.example/two"]


@pytest.mark.asyncio
async def test_delete_of_an_unknown_endpoint_is_a_noop(store):
    await store.delete("https://fcm.example/ghost")  # must not raise
    assert await store.list_all() == []


@pytest.mark.asyncio
async def test_touch_success_records_the_timestamp(store):
    await store.upsert(**_subscription())
    assert (await store.list_all())[0]["last_success_at"] is None
    await store.touch_success("https://fcm.example/one")
    assert (await store.list_all())[0]["last_success_at"] > 0


@pytest.mark.asyncio
async def test_touch_success_of_an_unknown_endpoint_is_a_noop(store):
    await store.touch_success("https://fcm.example/ghost")  # must not raise


@pytest.mark.asyncio
async def test_data_persists_across_store_instances(tmp_path):
    db_path = str(tmp_path / "persist.db")
    first = PushSubscriptionStore(db_path=db_path)
    await first.initialize()
    await first.upsert(**_subscription())
    await first.close()

    second = PushSubscriptionStore(db_path=db_path)
    await second.initialize()
    try:
        assert len(await second.list_all()) == 1
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_initialize_twice_does_not_wipe_existing_rows(tmp_path):
    # The ad-hoc migration must be idempotent — a second initialize() over
    # the same file (another process, or a test reload) can't reset data.
    db_path = str(tmp_path / "twice.db")
    store = PushSubscriptionStore(db_path=db_path)
    await store.initialize()
    await store.upsert(**_subscription())
    await store.close()

    store = PushSubscriptionStore(db_path=db_path)
    await store.initialize()
    try:
        assert len(await store.list_all()) == 1
    finally:
        await store.close()


# ─── VAPID keypair persistence (Task 3, decision G-1: generated on first
# boot and persisted, never typed into .env by hand) ─────────────────────


@pytest.mark.asyncio
async def test_get_vapid_keys_is_none_on_a_fresh_database(store):
    assert await store.get_vapid_keys() is None


@pytest.mark.asyncio
async def test_save_then_get_vapid_keys_round_trips(store):
    await store.save_vapid_keys(private_pem="PEM", public_key="PUBLIC")
    stored = await store.get_vapid_keys()
    assert stored == {"private_pem": "PEM", "public_key": "PUBLIC"}


@pytest.mark.asyncio
async def test_save_vapid_keys_does_not_overwrite_an_existing_pair(store):
    # Critical: overwriting would silently invalidate every subscription
    # already registered against the old public key — they would keep
    # failing with 403 forever with no visible cause.
    await store.save_vapid_keys(private_pem="FIRST", public_key="FIRST-PUB")
    await store.save_vapid_keys(private_pem="SECOND", public_key="SECOND-PUB")
    assert (await store.get_vapid_keys())["private_pem"] == "FIRST"


@pytest.mark.asyncio
async def test_vapid_keys_persist_across_store_instances(tmp_path):
    db_path = str(tmp_path / "vapid.db")
    first = PushSubscriptionStore(db_path=db_path)
    await first.initialize()
    await first.save_vapid_keys(private_pem="PEM", public_key="PUBLIC")
    await first.close()

    second = PushSubscriptionStore(db_path=db_path)
    await second.initialize()
    try:
        assert (await second.get_vapid_keys())["public_key"] == "PUBLIC"
    finally:
        await second.close()
