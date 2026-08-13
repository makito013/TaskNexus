"""Integration tests for the Web Push routes and the Stop-hook dispatch
(Phase 3, Tasks 7 and 9).

Same fixture pattern as test_settings_endpoints.py: reload of app.main with
SESSIONS_DB pointed at a fresh file in tmp_path, so each test gets its own
database — which, because the VAPID keypair is persisted in that same
database (decision G-1), also means each test gets a freshly generated
keypair and can never touch Bruno's real one.

`pywebpush.webpush` is mocked wherever a send could actually happen: no test
in this file may reach a real push service.
"""
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def client(tmp_path):
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


@pytest.fixture
def fake_webpush(monkeypatch):
    """Fake `pywebpush` module, resolved by push_service's lazy import."""
    module = types.ModuleType("pywebpush")
    module.webpush = MagicMock(return_value=None)
    monkeypatch.setitem(sys.modules, "pywebpush", module)
    return module.webpush


def _subscription_body(endpoint="https://push.example/device-a"):
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": "BPublicKeyValue", "auth": "AuthSecretValue"},
        "user_agent": "TestBrowser/1.0",
    }


# ─── GET /api/push/vapid-public-key ────────────────────────────────────────


def test_vapid_public_key_is_provisioned_on_first_boot(client):
    r = client.get("/api/push/vapid-public-key")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["public_key"]
    # base64url, unpadded — anything else is rejected by the browser.
    assert "=" not in body["public_key"]


def test_vapid_public_key_is_stable_across_calls(client):
    first = client.get("/api/push/vapid-public-key").json()["public_key"]
    second = client.get("/api/push/vapid-public-key").json()["public_key"]
    # Regenerating would invalidate every already-registered device.
    assert first == second


def test_vapid_public_key_route_does_not_return_the_spa_shell(client):
    # Same regression class as /sw.js in test_pwa_static_routes.py: a route
    # shadowed by the catch-all would answer index.html with a 200.
    r = client.get("/api/push/vapid-public-key")
    assert "public_key" in r.json()


# ─── POST/DELETE /api/push/subscriptions ───────────────────────────────────


def test_register_subscription_returns_201(client):
    r = client.post("/api/push/subscriptions", json=_subscription_body())
    assert r.status_code == 201
    assert r.json()["endpoint"] == "https://push.example/device-a"


def test_register_subscription_is_idempotent_for_the_same_endpoint(client, fake_webpush):
    # Two tabs of the same browser hand back the SAME endpoint. A second row
    # would mean two pushes for one device — observable here as two webpush
    # calls for a single Stop hook.
    client.post("/api/push/subscriptions", json=_subscription_body())
    r = client.post("/api/push/subscriptions", json=_subscription_body())
    assert r.status_code == 201
    _fire_stop_hook(client, "sid-1")
    _wait_for_push_calls(fake_webpush, 1)
    assert fake_webpush.call_count == 1


def test_register_subscription_rejects_a_non_http_endpoint(client):
    body = _subscription_body(endpoint="not-a-url")
    assert client.post("/api/push/subscriptions", json=body).status_code == 422


def test_register_subscription_rejects_blank_keys(client):
    body = _subscription_body()
    body["keys"]["auth"] = "   "
    assert client.post("/api/push/subscriptions", json=body).status_code == 422


def test_register_subscription_rejects_a_missing_keys_object(client):
    assert client.post(
        "/api/push/subscriptions", json={"endpoint": "https://push.example/x"}
    ).status_code == 422


def test_delete_subscription_removes_it(client, fake_webpush):
    client.post("/api/push/subscriptions", json=_subscription_body())
    r = client.request(
        "DELETE", "/api/push/subscriptions",
        json={"endpoint": "https://push.example/device-a"},
    )
    assert r.status_code == 200
    _fire_stop_hook(client, "session-x")
    assert fake_webpush.call_count == 0


def test_delete_of_an_unknown_endpoint_is_tolerated(client):
    r = client.request(
        "DELETE", "/api/push/subscriptions", json={"endpoint": "https://push.example/ghost"}
    )
    assert r.status_code == 200


# ─── POST /api/hooks/stop — the dispatch decision ──────────────────────────


def _seed_session(claude_session_id, session_key="meu-projeto::claude"):
    """Writes the session_key <-> claude_session_id mapping the Stop hook
    resolves through.

    Done with a plain sqlite3 connection to the same file rather than
    through the app's ConversationStore: that store's aiosqlite connection
    belongs to the TestClient's own event loop (running in a worker
    thread), which the test thread has no clean way to schedule onto. WAL
    makes the committed row visible to the app's connection immediately.
    """
    import sqlite3
    import app.main as main_mod

    conn = sqlite3.connect(main_mod.SESSIONS_DB)
    try:
        conn.execute(
            "INSERT INTO sessions (session_key, claude_session_id) VALUES (?, ?) "
            "ON CONFLICT(session_key) DO UPDATE SET claude_session_id = excluded.claude_session_id",
            (session_key, claude_session_id),
        )
        conn.commit()
    finally:
        conn.close()
    return session_key


def _fire_stop_hook(client, claude_session_id, session_key="meu-projeto::claude"):
    _seed_session(claude_session_id, session_key)
    return client.post("/api/hooks/stop", json={"session_id": claude_session_id})


def _meta(client, session_key="meu-projeto::claude"):
    return client.get("/api/sessions/persisted").json().get(session_key, {})


def _wait_for_push_calls(mock, expected, timeout=3.0):
    """Waits for the DETACHED broadcast task to reach `expected` deliveries.

    The Stop hook returns as soon as the ledger is written — the send itself
    is an asyncio.create_task running on the TestClient's own loop thread,
    plus an asyncio.to_thread hop inside it. Asserting straight after the
    POST would race that, so the test polls instead of sleeping a fixed
    amount. This delay is exactly the window Risk R-1 is about, and exactly
    why the ledger is written before the task is created."""
    import time as _time

    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        if mock.call_count >= expected:
            return
        _time.sleep(0.02)
    assert mock.call_count == expected, f"expected {expected} sends, got {mock.call_count}"


def test_persisted_sessions_exposes_push_notified(client):
    _fire_stop_hook(client, "sid-1")
    assert _meta(client)["push_notified"] is False


def test_stop_hook_without_subscriptions_does_not_send_and_does_not_mark(client, fake_webpush):
    # The real no-op path under decision G-1: the keys always exist after
    # boot, so "nobody enabled push" is what gates the send.
    _fire_stop_hook(client, "sid-1")
    assert fake_webpush.call_count == 0
    assert _meta(client)["push_notified"] is False
    assert _meta(client)["needs_attention"] is True


def test_stop_hook_with_a_subscription_sends_and_marks_the_ledger(client, fake_webpush):
    client.post("/api/push/subscriptions", json=_subscription_body())
    _fire_stop_hook(client, "sid-1")
    # The ledger is written at DECISION time (R-1), so it is already true
    # here — before the detached broadcast has even run.
    assert _meta(client)["push_notified"] is True
    _wait_for_push_calls(fake_webpush, 1)


def test_the_push_payload_carries_the_session_deep_link(client, fake_webpush):
    import json

    client.post("/api/push/subscriptions", json=_subscription_body())
    _fire_stop_hook(client, "sid-1")
    _wait_for_push_calls(fake_webpush, 1)
    payload = json.loads(fake_webpush.call_args.kwargs["data"])
    assert payload["tag"] == "meu-projeto::claude"
    assert payload["data"]["session_key"] == "meu-projeto::claude"
    assert payload["title"] == "claude terminou"


def test_stop_hook_during_quiet_hours_does_not_send_and_does_not_mark(client, fake_webpush):
    import app.main as main_mod
    from app.quiet_hours import current_utc_offset_minutes

    client.post("/api/push/subscriptions", json=_subscription_body())
    # Pin the clock to 23:00 in the SERVER's timezone, inside 22:00-07:00.
    offset = current_utc_offset_minutes()
    fixed_now = (23 * 60 - offset) * 60
    client.put("/api/settings/notifications", json={
        "quiet_hours_enabled": True, "quiet_hours_start": "22:00", "quiet_hours_end": "07:00",
    })
    with patch.object(main_mod.time, "time", return_value=fixed_now):
        _fire_stop_hook(client, "sid-1")
    assert fake_webpush.call_count == 0
    # Not marked: the push was discarded, so the local-sound decision stays
    # entirely with the frontend (which applies the same window itself).
    assert _meta(client)["push_notified"] is False
    # ...but the pending badge is never silenced.
    assert _meta(client)["needs_attention"] is True


def test_a_second_pause_of_the_same_session_resets_the_ledger(client, fake_webpush):
    client.post("/api/push/subscriptions", json=_subscription_body())
    _fire_stop_hook(client, "sid-1")
    _wait_for_push_calls(fake_webpush, 1)
    assert _meta(client)["push_notified"] is True

    # Opening the chat acks it, which clears the ledger for the next pause.
    client.post("/api/sessions/meu-projeto::claude/ack")
    assert _meta(client)["push_notified"] is False

    _fire_stop_hook(client, "sid-1")
    _wait_for_push_calls(fake_webpush, 2)
    assert _meta(client)["push_notified"] is True


def test_stop_hook_still_marks_needs_attention_when_push_blows_up(client, monkeypatch):
    # The hook's real job can never fail because of push. Simulate a broken
    # dependency at the dispatch level.
    import app.main as main_mod

    monkeypatch.setattr(
        main_mod.push_store, "list_all", AsyncMock(side_effect=RuntimeError("db gone"))
    )
    r = _fire_stop_hook(client, "sid-1")
    assert r.status_code == 200
    assert _meta(client)["needs_attention"] is True
    assert _meta(client)["push_notified"] is False


def test_stop_hook_does_not_send_when_push_is_unavailable(client, fake_webpush, monkeypatch):
    # R-2: machine without the dependency — _vapid_keys stayed None.
    import app.main as main_mod

    client.post("/api/push/subscriptions", json=_subscription_body())
    monkeypatch.setattr(main_mod, "_vapid_keys", None)
    _fire_stop_hook(client, "sid-1")
    assert fake_webpush.call_count == 0
    assert _meta(client)["push_notified"] is False
