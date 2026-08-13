"""Unit tests for app/vapid_keys.py (Phase 3, Task 3 — decision G-1: the
keypair is generated on first boot and persisted, not read from .env)."""
import base64

import pytest
import pytest_asyncio

from app.push_store import PushSubscriptionStore
from app.vapid_keys import (
    DEFAULT_VAPID_SUBJECT,
    VapidKeys,
    generate_vapid_keypair,
    load_or_create_vapid_keys,
    vapid_subject,
)


@pytest_asyncio.fixture
async def store(tmp_path):
    s = PushSubscriptionStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


class FailingImportStore:
    """Stands in for a machine without pywebpush/cryptography installed."""

    async def get_vapid_keys(self):
        return None

    async def save_vapid_keys(self, private_pem, public_key):  # pragma: no cover
        raise AssertionError("must not reach the write when generation failed")


def test_generate_vapid_keypair_returns_a_pem_and_a_base64url_public_key():
    keys = generate_vapid_keypair()
    assert keys["private_pem"].startswith("-----BEGIN PRIVATE KEY-----")
    # applicationServerKey must be the RAW uncompressed EC point (65 bytes:
    # the 0x04 prefix + two 32-byte coordinates), base64url without padding
    # — anything else makes pushManager.subscribe() fail in the browser.
    raw = base64.urlsafe_b64decode(keys["public_key"] + "==")
    assert len(raw) == 65
    assert raw[0] == 0x04
    assert "=" not in keys["public_key"]
    assert "+" not in keys["public_key"] and "/" not in keys["public_key"]


def test_generate_vapid_keypair_returns_a_different_pair_each_call():
    assert generate_vapid_keypair()["public_key"] != generate_vapid_keypair()["public_key"]


def test_vapid_subject_falls_back_to_the_default(monkeypatch):
    monkeypatch.delenv("VAPID_SUBJECT", raising=False)
    assert vapid_subject() == DEFAULT_VAPID_SUBJECT


def test_vapid_subject_honours_the_env_var(monkeypatch):
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:bruno@example.com")
    assert vapid_subject() == "mailto:bruno@example.com"


@pytest.mark.asyncio
async def test_load_or_create_generates_and_persists_on_first_boot(store):
    assert await store.get_vapid_keys() is None
    keys = await load_or_create_vapid_keys(store)
    assert isinstance(keys, VapidKeys)
    assert (await store.get_vapid_keys())["public_key"] == keys.public_key


@pytest.mark.asyncio
async def test_load_or_create_reuses_the_persisted_pair_on_the_next_boot(store):
    first = await load_or_create_vapid_keys(store)
    second = await load_or_create_vapid_keys(store)
    # Regenerating would invalidate every already-registered subscription.
    assert first.public_key == second.public_key
    assert first.private_pem == second.private_pem


@pytest.mark.asyncio
async def test_load_or_create_returns_none_when_the_dependency_is_missing(monkeypatch):
    def explode():
        raise ImportError("No module named 'py_vapid'")

    monkeypatch.setattr("app.vapid_keys.generate_vapid_keypair", explode)
    # Degrades to "push unavailable" instead of taking down the boot (R-2).
    assert await load_or_create_vapid_keys(FailingImportStore()) is None
