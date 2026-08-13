"""Unit tests for send_push_to_all (Phase 3, Task 5).

`pywebpush.webpush` is MOCKED in every single test — no test in this suite
may ever reach a real push service (FCM/APNs). The mock is installed on
`app.push_service`'s lazy import site by patching the module attribute that
`_send_one` resolves, via a fake `pywebpush` module in sys.modules.
"""
import sys
import types
from unittest.mock import MagicMock

import pytest

from app.push_service import GONE_STATUS_CODES, PUSH_TIMEOUT_SECONDS, send_push_to_all
from app.vapid_keys import VapidKeys, generate_vapid_keypair


# A REAL keypair, not a placeholder string: _send_one parses the PEM before
# calling webpush, so a fake value would blow up inside the code under test
# instead of exercising it.
_KEYPAIR = generate_vapid_keypair()
VAPID = VapidKeys(
    private_pem=_KEYPAIR["private_pem"],
    public_key=_KEYPAIR["public_key"],
    subject="mailto:test@example.com",
)
PAYLOAD = {"tag": "p::a", "title": "a terminou", "body": "Projeto p", "data": {"session_key": "p::a"}}


class FakeWebPushException(Exception):
    """Mirrors pywebpush.WebPushException: carries the HTTP response of the
    failed delivery — or None, when the failure was local (encryption/key
    material) and never reached the network."""

    def __init__(self, message, response=None):
        super().__init__(message)
        self.response = response


def _response(status_code):
    response = MagicMock()
    response.status_code = status_code
    return response


@pytest.fixture
def fake_webpush(monkeypatch):
    """Installs a fake `pywebpush` module so the lazy `from pywebpush import
    webpush` inside _send_one resolves to a MagicMock."""
    module = types.ModuleType("pywebpush")
    module.webpush = MagicMock(return_value=None)
    module.WebPushException = FakeWebPushException
    monkeypatch.setitem(sys.modules, "pywebpush", module)
    return module.webpush


class FakeStore:
    def __init__(self, subscriptions):
        self.subscriptions = list(subscriptions)
        self.deleted = []
        self.touched = []

    async def list_all(self):
        return list(self.subscriptions)

    async def delete(self, endpoint):
        self.deleted.append(endpoint)

    async def touch_success(self, endpoint):
        self.touched.append(endpoint)


def _subscription(name):
    return {"endpoint": f"https://push.example/{name}", "p256dh": f"pub-{name}", "auth": f"auth-{name}"}


@pytest.mark.asyncio
async def test_sends_to_every_registered_subscription(fake_webpush):
    store = FakeStore([_subscription("a"), _subscription("b")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert fake_webpush.call_count == 2
    assert summary == {"sent": 2, "failed": 0, "pruned": 0}
    assert store.touched == ["https://push.example/a", "https://push.example/b"]


@pytest.mark.asyncio
async def test_no_subscription_means_no_call_at_all(fake_webpush):
    summary = await send_push_to_all(PAYLOAD, store=FakeStore([]), vapid_keys=VAPID)
    assert fake_webpush.call_count == 0
    assert summary == {"sent": 0, "failed": 0, "pruned": 0}


@pytest.mark.asyncio
async def test_payload_is_serialized_as_json_with_the_vapid_claims(fake_webpush):
    import json

    await send_push_to_all(PAYLOAD, store=FakeStore([_subscription("a")]), vapid_keys=VAPID)
    kwargs = fake_webpush.call_args.kwargs
    assert json.loads(kwargs["data"]) == PAYLOAD
    # NOT the PEM string: pywebpush would base64-decode that and parse it as
    # DER. See _build_signer.
    assert kwargs["vapid_private_key"].__class__.__name__ == "Vapid02"
    assert kwargs["vapid_claims"] == {"sub": "mailto:test@example.com"}
    assert kwargs["subscription_info"] == {
        "endpoint": "https://push.example/a",
        "keys": {"p256dh": "pub-a", "auth": "auth-a"},
    }


@pytest.mark.asyncio
async def test_an_explicit_timeout_is_always_passed_through(fake_webpush):
    # R-4: pywebpush's own default is 10000 — which requests reads as 10000
    # SECONDS, not milliseconds. Omitting this would park a worker thread
    # for hours on an unreachable push service.
    await send_push_to_all(PAYLOAD, store=FakeStore([_subscription("a")]), vapid_keys=VAPID)
    assert fake_webpush.call_args.kwargs["timeout"] == PUSH_TIMEOUT_SECONDS


@pytest.mark.asyncio
async def test_a_custom_timeout_overrides_the_default(fake_webpush):
    await send_push_to_all(
        PAYLOAD, store=FakeStore([_subscription("a")]), vapid_keys=VAPID, timeout=1.5
    )
    assert fake_webpush.call_args.kwargs["timeout"] == 1.5


@pytest.mark.parametrize("status_code", sorted(GONE_STATUS_CODES))
@pytest.mark.asyncio
async def test_a_gone_subscription_is_pruned(fake_webpush, status_code):
    fake_webpush.side_effect = FakeWebPushException("gone", response=_response(status_code))
    store = FakeStore([_subscription("a")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert store.deleted == ["https://push.example/a"]
    assert summary == {"sent": 0, "failed": 0, "pruned": 1}


@pytest.mark.asyncio
async def test_a_transient_failure_keeps_the_subscription(fake_webpush):
    # 500 is the push service having a bad day — deleting the device here
    # would force the user to re-enable push by hand for nothing.
    fake_webpush.side_effect = FakeWebPushException("boom", response=_response(500))
    store = FakeStore([_subscription("a")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert store.deleted == []
    assert summary == {"sent": 0, "failed": 1, "pruned": 0}


@pytest.mark.asyncio
async def test_an_exception_without_a_response_does_not_crash_the_loop(fake_webpush):
    # A local encryption/key failure raises WebPushException with
    # response=None — reading .status_code off that unguarded would raise
    # AttributeError inside the except block and abort the whole broadcast.
    fake_webpush.side_effect = FakeWebPushException("local failure", response=None)
    store = FakeStore([_subscription("a"), _subscription("b")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert summary == {"sent": 0, "failed": 2, "pruned": 0}
    assert store.deleted == []


@pytest.mark.asyncio
async def test_one_failing_device_does_not_stop_the_others(fake_webpush):
    fake_webpush.side_effect = [
        FakeWebPushException("gone", response=_response(410)),
        None,
        FakeWebPushException("boom", response=_response(500)),
    ]
    store = FakeStore([_subscription("a"), _subscription("b"), _subscription("c")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert fake_webpush.call_count == 3
    assert summary == {"sent": 1, "failed": 1, "pruned": 1}
    assert store.deleted == ["https://push.example/a"]
    assert store.touched == ["https://push.example/b"]


@pytest.mark.asyncio
async def test_a_timeout_is_treated_as_transient_not_as_gone(fake_webpush):
    fake_webpush.side_effect = TimeoutError("timed out")
    store = FakeStore([_subscription("a")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert store.deleted == []
    assert summary["failed"] == 1


@pytest.mark.asyncio
async def test_a_missing_pywebpush_dependency_degrades_instead_of_raising(monkeypatch):
    # R-2: the machine simply doesn't have the dependency. The send is a
    # background task with nobody to catch it, so it must not escape.
    monkeypatch.setitem(sys.modules, "pywebpush", None)
    store = FakeStore([_subscription("a")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert summary["failed"] == 1
    assert store.deleted == []


# ─── The one test that uses the REAL pywebpush ────────────────────────────
# Every test above mocks `webpush`, which is what let a genuine production
# bug hide: the persisted PEM was being passed straight to
# `webpush(vapid_private_key=...)`, and pywebpush base64-decodes that value
# and parses it as DER, so it died with "ASN.1 parsing error" — visible only
# on a real send, i.e. only on Bruno's phone.
#
# `curl=True` runs the FULL path (VAPID signing + ECE payload encryption) and
# returns a curl command string instead of performing the POST, so this stays
# inside the rule that no test may ever reach FCM/APNs.
#
# ⚠️ `curl=True` also writes the encrypted body to a file literally named
# `encrypted.data` in the CURRENT WORKING DIRECTORY (pywebpush's
# WebPusher.as_curl, hardcoded, no way to redirect it). Both tests below
# therefore chdir into tmp_path first — without that, running the suite drops
# a stray untracked file into backend/ every time.


@pytest.fixture
def isolated_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _browser_like_keys():
    """Stands in for the keys a real browser hands back in PushSubscription."""
    import base64
    import os
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    receiver = ec.generate_private_key(ec.SECP256R1())
    p256dh = base64.urlsafe_b64encode(
        receiver.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    ).decode().rstrip("=")
    auth = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")
    return p256dh, auth


def test_the_persisted_pem_really_signs_a_push_with_the_actual_library(isolated_cwd):
    import json as _json
    from pywebpush import webpush
    from app.push_service import _build_signer

    p256dh, auth = _browser_like_keys()
    result = webpush(
        subscription_info={
            "endpoint": "https://fcm.googleapis.com/fcm/send/fake-endpoint",
            "keys": {"p256dh": p256dh, "auth": auth},
        },
        data=_json.dumps(PAYLOAD),
        vapid_private_key=_build_signer(VAPID.private_pem),
        vapid_claims={"sub": VAPID.subject},
        curl=True,
    )
    # A signed VAPID authorization header is the proof the keypair was
    # accepted and used.
    assert "authorization: vapid t=" in result


def test_passing_the_raw_pem_string_is_rejected_by_pywebpush(isolated_cwd):
    """Characterizes the underlying pywebpush bug: passing a raw PEM string
    is base64-decoded and parsed as DER, which fails. The actual regression
    guard for _build_signer is
    test_payload_is_serialized_as_json_with_the_vapid_claims (asserts
    vapid_private_key is a Vapid02 instance, not a str)."""
    import json as _json
    import pytest as _pytest
    from pywebpush import webpush

    p256dh, auth = _browser_like_keys()
    with _pytest.raises(Exception):
        webpush(
            subscription_info={
                "endpoint": "https://fcm.googleapis.com/fcm/send/fake-endpoint",
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=_json.dumps(PAYLOAD),
            vapid_private_key=VAPID.private_pem,
            vapid_claims={"sub": VAPID.subject},
            curl=True,
        )
