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

from app.push_service import (
    GONE_STATUS_CODES,
    PUSH_TIMEOUT_SECONDS,
    PUSH_TTL_SECONDS,
    _wns_headers,
    send_push_to_all,
)
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


def _response(status_code, headers=None):
    response = MagicMock()
    response.status_code = status_code
    # Explicit, real dict — never left as an auto-generated MagicMock
    # attribute: send_push_to_all's failure branch now does
    # `dict(response.headers)` to log them, and `dict(MagicMock())` is not
    # something the mock library makes work by accident.
    response.headers = headers if headers is not None else {}
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


# ─── WNS TTL / X-WNS-Cache-Policy fix ──────────────────────────────────────
# WNS (Edge on Windows) 400s every delivery with an empty body unless the
# request carries both a positive TTL and a matching X-WNS-Cache-Policy
# header — see PUSH_TTL_SECONDS's docstring in push_service.py for the full
# story. These tests guard the fix at three levels: the header decision
# function in isolation, its wiring into _send_one, and the failure-log path
# that would have surfaced the real WNS error message directly instead of
# needing an external GitHub issue to decode a bare "400, empty body".


def _subscription_with_endpoint(endpoint):
    return {"endpoint": endpoint, "p256dh": "pub-x", "auth": "auth-x"}


@pytest.mark.asyncio
async def test_send_one_passes_wns_cache_policy_header_for_windows_endpoint(fake_webpush):
    subscription = _subscription_with_endpoint(
        "https://wns2-bl2p.notify.windows.com/w/?token=fake"
    )
    await send_push_to_all(PAYLOAD, store=FakeStore([subscription]), vapid_keys=VAPID)
    kwargs = fake_webpush.call_args.kwargs
    assert kwargs["headers"] == {"x-wns-cache-policy": "cache"}
    assert kwargs["ttl"] == PUSH_TTL_SECONDS


@pytest.mark.asyncio
async def test_send_one_omits_wns_header_for_non_windows_endpoint(fake_webpush):
    subscription = _subscription_with_endpoint("https://fcm.googleapis.com/fcm/send/abc")
    await send_push_to_all(PAYLOAD, store=FakeStore([subscription]), vapid_keys=VAPID)
    kwargs = fake_webpush.call_args.kwargs
    # webpush() treats headers=None the same as omitting the kwarg entirely
    # (`if headers is None: headers = dict()`), so passing it explicitly for
    # non-WNS endpoints is safe — it never leaks a WNS-only header to FCM.
    assert kwargs["headers"] is None
    assert kwargs["ttl"] == PUSH_TTL_SECONDS


@pytest.mark.parametrize(
    "endpoint,expected",
    [
        # Positive: exact host, and the real regional subdomain browsers
        # actually subscribe through (wns2-bl2p is a genuine WNS region).
        ("https://notify.windows.com/x", {"x-wns-cache-policy": "cache"}),
        ("https://wns2-bl2p.notify.windows.com/x", {"x-wns-cache-policy": "cache"}),
        ("https://NOTIFY.WINDOWS.COM/x", {"x-wns-cache-policy": "cache"}),
        # An explicit port must not defeat the match: urlsplit().hostname
        # strips it before the comparison runs.
        ("https://notify.windows.com:443/x", {"x-wns-cache-policy": "cache"}),
        # Negative: host-smuggling shapes a plain substring check
        # (`"notify.windows.com" in endpoint`) would wrongly accept — the
        # same class of bug models._is_known_push_host guards against.
        ("https://evilnotify.windows.com.attacker.test/x", None),
        ("https://notify.windows.com.evil.test/x", None),
        ("https://fcm.googleapis.com/x", None),
        # Malformed/edge inputs must fail closed (None), never raise.
        ("", None),
        ("notify.windows.com/x", None),  # no scheme: urlsplit has no hostname
        ("https://notify.windows.com./x", None),  # trailing-dot FQDN, real
        # browser subscriptions never carry one, so under-matching here is
        # safe — the risk direction that matters is over-matching.
    ],
)
def test_wns_headers_matches_subdomain_not_substring(endpoint, expected):
    assert _wns_headers(endpoint, PUSH_TTL_SECONDS) == expected


def test_wns_headers_uses_no_cache_when_ttl_is_not_positive():
    # Dead in practice today (every real call site passes PUSH_TTL_SECONDS,
    # which is > 0) but the function's contract — "headers appropriate for
    # this ttl" — must hold for ttl=0 even though nothing currently exercises
    # it live. Without this test a typo in the ternary (e.g. flipping the
    # branches) would ship silently.
    endpoint = "https://notify.windows.com/x"
    assert _wns_headers(endpoint, 0) == {"x-wns-cache-policy": "no-cache"}
    assert _wns_headers(endpoint, -1) == {"x-wns-cache-policy": "no-cache"}


@pytest.mark.asyncio
async def test_send_push_to_all_sends_wns_header_only_to_the_wns_subscription(fake_webpush):
    # A single broadcast mixing a WNS and a non-WNS device: _wns_headers
    # builds a fresh dict per call, so there is no structural way for one
    # subscription's header to leak into the next — but that is exactly the
    # kind of invariant that should be pinned by a test, not left as an
    # inference from reading the code.
    wns_subscription = _subscription_with_endpoint(
        "https://wns2-bl2p.notify.windows.com/w/?token=fake"
    )
    fcm_subscription = _subscription_with_endpoint(
        "https://fcm.googleapis.com/fcm/send/abc"
    )
    store = FakeStore([wns_subscription, fcm_subscription])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert summary == {"sent": 2, "failed": 0, "pruned": 0}
    calls = fake_webpush.call_args_list
    assert calls[0].kwargs["headers"] == {"x-wns-cache-policy": "cache"}
    assert calls[1].kwargs["headers"] is None


@pytest.mark.asyncio
async def test_send_push_to_all_logs_response_headers_on_failure(fake_webpush, capsys):
    fake_webpush.side_effect = FakeWebPushException(
        "boom",
        response=_response(
            400,
            headers={
                "x-wns-error-description": "Ttl value conflicts with X-WNS-Cache-Policy."
            },
        ),
    )
    store = FakeStore([_subscription("a")])
    await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    captured = capsys.readouterr()
    assert "x-wns-error-description" in captured.out


@pytest.mark.asyncio
async def test_send_push_to_all_logs_empty_headers_when_response_is_none(fake_webpush, capsys):
    # Local failure (bad key material, encryption error) never reaches the
    # network, so the exception carries response=None. Logging headers must
    # degrade to an empty dict here, not raise inside the except block.
    fake_webpush.side_effect = FakeWebPushException("local failure", response=None)
    store = FakeStore([_subscription("a")])
    summary = await send_push_to_all(PAYLOAD, store=store, vapid_keys=VAPID)
    assert summary["failed"] == 1
    captured = capsys.readouterr()
    assert "headers={}" in captured.out


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


def test_the_persisted_pem_signs_a_wns_push_with_correct_headers(isolated_cwd):
    """Exercises the actual fix end to end: the real pywebpush library,
    given our ttl kwarg and the header _wns_headers() computes for a WNS
    endpoint, must produce a request carrying both — this is exactly the
    request shape WNS rejected before the fix (see PUSH_TTL_SECONDS)."""
    import json as _json
    from pywebpush import webpush
    from app.push_service import PUSH_TTL_SECONDS, _build_signer, _wns_headers

    p256dh, auth = _browser_like_keys()
    endpoint = "https://wns2-bl2p.notify.windows.com/w/?token=fake"
    result = webpush(
        subscription_info={
            "endpoint": endpoint,
            "keys": {"p256dh": p256dh, "auth": auth},
        },
        data=_json.dumps(PAYLOAD),
        vapid_private_key=_build_signer(VAPID.private_pem),
        vapid_claims={"sub": VAPID.subject},
        ttl=PUSH_TTL_SECONDS,
        headers=_wns_headers(endpoint, PUSH_TTL_SECONDS),
        curl=True,
    )
    # WebPusher.as_curl lowercases every header name and renders
    # `-H "key: value"` — this is the literal request WNS was 400ing on.
    assert "ttl: 900" in result
    assert "x-wns-cache-policy: cache" in result


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
