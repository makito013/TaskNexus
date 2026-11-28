"""The origin guard in isolation: the pure decision functions and the ASGI middleware driven directly
with raw scopes (a duplicated header cannot be sent by the test client, only by a raw scope or a socket)."""
from __future__ import annotations

import asyncio

import pytest

from app import request_guard
from app.request_guard import (
    CHAT_SOCKET_PREFIX, GuardPolicy, RequestGuardMiddleware, WS_CLOSE_ORIGIN, WS_CLOSE_POLICY,
    allowed_hosts_from_env, allowed_origins_from_env, host_allowed, host_name, is_sandbox_file_request,
    origin_allowed, request_refusal, scope_refusal,
)

GOOD = "x.tail1234.ts.net"
REBIND = "rebind.evil.test:8765"


# -- hosts -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("host", [
    "127.0.0.1", "127.0.0.1:8765", "[::1]:8765", "::1", "100.101.102.103:443", "localhost", "LOCALHOST:5173",
    "fd7a:115c:a1e0::1", "bruno-pc.tail1234.ts.net", "bruno-pc.tail1234.ts.net:443", "Bruno-PC.TAIL1234.ts.net.",
    "[fe80::1]",
])
def test_the_default_hosts_pass(host):
    assert host_allowed(host)


@pytest.mark.parametrize("host", [
    None, "", " ", "evil", "evil:8765", "intranet", "printer", "2130706433", "testserver",
    "rebind.evil.test", REBIND, "evil.example:80", "127.0.0.1.evil.test", "localhost.evil.test",
    "x.ts.net.evil.com", "evilts.net", "ts.net", ".ts.net", "evil.ts.net.evil.test", "x.ts.net.evil.com:1",
    "127.0.0.1:abc", "127.0.0.1:99999999", "[::1", "[::1]x", "[::1]:", "a b", "a@b", "x.ts.net@evil.com",
    "a,b", "127.0.0.1,evil.test", "café.ts.net",
])
def test_everything_else_is_refused(host):
    assert not host_allowed(host)


def test_a_dotless_name_other_than_the_machine_is_refused_and_the_machine_name_passes(monkeypatch):
    monkeypatch.setattr(request_guard, "LOCAL_NAMES", frozenset({"localhost", "my-pc"}))

    assert host_allowed("my-pc") and host_allowed("MY-PC:8765") and host_allowed("my-pc.")
    assert not host_allowed("their-pc")
    monkeypatch.setattr(request_guard, "LOCAL_NAMES", frozenset({"localhost"}))
    assert not host_allowed("my-pc") and not host_allowed("MY-PC:8765")


def test_the_local_names_are_localhost_and_the_hostname(monkeypatch):
    import socket

    monkeypatch.setattr(socket, "gethostname", lambda: "My-PC.")

    assert request_guard._machine_names() == frozenset({"localhost", "my-pc"})


def test_the_local_names_survive_a_failing_hostname(monkeypatch):
    import socket

    def fail():
        raise OSError("no name")

    monkeypatch.setattr(socket, "gethostname", fail)

    assert request_guard._machine_names() == frozenset({"localhost"})


def test_the_extra_hosts_come_from_the_environment():
    assert allowed_hosts_from_env({"CHAT_ALLOWED_HOSTS": " Chat.Example.com:8443 , ,tn.lan. "}) == [
        "chat.example.com", "tn.lan",
    ]
    assert host_allowed("chat.example.com:443", ["chat.example.com"])
    assert not host_allowed("other.example.com", ["chat.example.com"])
    assert allowed_hosts_from_env({}) == []
    assert host_name("[::1]:8765") == "::1"


# -- origins -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("origin, host, extra, expected", [
    (None, "127.0.0.1:8765", [], True),
    ("http://127.0.0.1:8765", "127.0.0.1:8765", [], True),
    ("https://X.ts.net", "x.ts.net", [], True),
    ("http://localhost:5173", "localhost:5173", [], True),
    ("https://evil.example", "127.0.0.1:8765", [], False),
    ("http://127.0.0.1:9999", "127.0.0.1:8765", [], False),  # another port of the same IP
    ("http://user@127.0.0.1:8765", "127.0.0.1:8765", [], False),
    ("", "127.0.0.1:8765", [], False),
    ("null", "127.0.0.1:8765", [], False),
    ("NULL", "127.0.0.1:8765", [], False),
    ("http://[", "127.0.0.1:8765", [], False),  # urlparse raises ValueError: never a 500
    ("https://dev.example.com", "127.0.0.1:8000", ["https://dev.example.com"], True),
    ("https://dev.example.com/", "127.0.0.1:8000", ["https://dev.example.com"], True),
    ("null", "127.0.0.1:8000", ["null"], False),
    ("http://x", None, [], False),
])
def test_origin_allowed(origin, host, extra, expected):
    assert origin_allowed(origin, host, extra) is expected


def test_the_null_origin_is_never_configurable():
    assert allowed_origins_from_env({"CHAT_ALLOWED_ORIGINS": "null, https://dev.example.com/ ,NULL"}) == [
        "https://dev.example.com",
    ]
    policy = GuardPolicy.from_env({"CHAT_ALLOWED_ORIGINS": "null"})
    assert policy.origins == () and policy.hosts == ()


def test_the_refusal_names_the_host_before_the_origin():
    assert request_refusal("https://evil.example", "evil.test", [], []) == "host_not_allowed"
    assert request_refusal("https://evil.example", "127.0.0.1:8765", [], []) == "origin_not_allowed"
    assert request_refusal(None, "127.0.0.1:8765", [], []) is None


# -- the policy from the environment -----------------------------------------------------------------------


def test_the_policy_collects_hosts_origins_and_the_callback_host():
    policy = GuardPolicy.from_env({
        "CHAT_ALLOWED_HOSTS": "tn.example.com",
        "CHAT_ALLOWED_ORIGINS": "https://dev.example.com:8443",
        "HOOK_CALLBACK_BASE_URL": "https://meu-proxy.exemplo:8443/",
    })

    assert policy.origins == ("https://dev.example.com:8443",)
    assert set(policy.hosts) == {"tn.example.com", "dev.example.com", "meu-proxy.exemplo"}


@pytest.mark.parametrize("callback, expected", [
    ("https://meu-proxy.exemplo:8443", "meu-proxy.exemplo"),
    ("meu-proxy.exemplo:8443", "meu-proxy.exemplo"),
    ("meu-proxy.exemplo", "meu-proxy.exemplo"),
    ("http://[::1]:9000", "::1"),
    ("http://127.0.0.1:8765", "127.0.0.1"),
])
def test_the_callback_url_host_is_accepted_with_or_without_a_scheme(callback, expected):
    policy = GuardPolicy.from_env({"HOOK_CALLBACK_BASE_URL": callback})

    assert policy.hosts == (expected,)
    assert host_allowed(expected if ":" in expected else f"{expected}:1234", policy.hosts)
    assert not host_allowed("outro.exemplo", policy.hosts)


def test_a_malformed_configured_url_is_ignored_and_never_opens_the_list(caplog):
    with caplog.at_level("WARNING", logger="app.request_guard"):
        policy = GuardPolicy.from_env({
            "CHAT_ALLOWED_ORIGINS": "http://[,https://dev.example.com", "HOOK_CALLBACK_BASE_URL": "http://[",
        })

    assert policy.origins == ("https://dev.example.com",)
    assert policy.hosts == ("dev.example.com",)
    assert "CHAT_ALLOWED_ORIGINS" in caplog.text and "HOOK_CALLBACK_BASE_URL" in caplog.text


def test_an_empty_environment_gives_an_empty_policy():
    assert GuardPolicy.from_env({}) == GuardPolicy((), ())


# -- E1: the sandbox file requests --------------------------------------------------------------------------


def _scope(kind="http", path="/api/x", method="GET", headers=()):
    raw = [(key.lower().encode("latin-1"), value.encode("latin-1")) for key, value in headers]
    scope = {"type": kind, "path": path, "headers": raw}
    if kind == "http":
        scope["method"] = method
    return scope


@pytest.mark.parametrize("path, method, expected", [
    ("/api/viewer/abc/f/index.html", "GET", True),
    ("/api/viewer/abc/f/dir/app.js", "HEAD", True),
    ("/api/artifacts/Zx_-9/f/data.json", "GET", True),
    ("/api/viewer/abc/f/index.html", "POST", False),
    ("/api/viewer/abc/f/index.html", "DELETE", False),
    ("/api/viewer/abc/f", "GET", False),
    ("/api/viewer/abc/f/", "GET", False),
    ("/x/api/viewer/abc/f/index.html", "GET", False),
    ("/api/viewer/abc/f/index.html\n", "GET", False),
    ("/api/viewer/a/b/f/index.html", "GET", False),
    ("/api/viewer/abc/content", "GET", False),
    ("/api/artifacts/abc/content", "GET", False),
    ("/api/card-attachments/1/content", "GET", False),
    ("/api/card-attachments/1/f/a.html", "GET", False),
    ("/api/sessions/active", "GET", False),
])
def test_only_the_sandbox_file_routes_are_e1(path, method, expected):
    assert is_sandbox_file_request(_scope(path=path, method=method)) is expected


def test_a_websocket_is_never_e1():
    assert not is_sandbox_file_request(_scope("websocket", "/api/viewer/abc/f/index.html"))


POLICY = GuardPolicy((), ())


@pytest.mark.parametrize("path, method, headers, expected", [
    ("/api/viewer/abc/f/a.js", "GET", [("host", "127.0.0.1:8765"), ("origin", "null")], None),
    ("/api/artifacts/abc/f/a.js", "HEAD", [("host", GOOD), ("origin", "null")], None),
    ("/api/viewer/abc/f/a.js", "GET", [("host", REBIND), ("origin", "null")], "host_not_allowed"),
    ("/api/viewer/abc/f/a.js", "POST", [("host", GOOD), ("origin", "null")], "origin_not_allowed"),
    ("/api/viewer/abc/f/a.js", "GET", [("host", GOOD), ("origin", "null"), ("origin", "null")], "duplicate_header"),
    ("/api/viewer/abc/content", "GET", [("host", GOOD), ("origin", "null")], "origin_not_allowed"),
    ("/api/sessions/active", "GET", [("host", GOOD), ("origin", "null")], "origin_not_allowed"),
])
def test_null_origin_passes_only_in_e1_and_the_host_is_still_checked(path, method, headers, expected):
    assert scope_refusal(_scope(path=path, method=method, headers=headers), POLICY) == expected


# -- duplicated and malformed headers (raw scopes) ---------------------------------------------------------------


@pytest.mark.parametrize("headers", [
    [("host", GOOD), ("host", REBIND)],
    [("host", REBIND), ("host", GOOD)],
    [("host", GOOD), ("host", GOOD)],
    [("host", GOOD), ("origin", "https://" + GOOD), ("origin", "https://" + GOOD)],
    [("host", GOOD), ("host", GOOD), ("origin", "https://" + GOOD), ("origin", "https://" + GOOD)],
])
def test_a_repeated_host_or_origin_is_refused_even_with_equal_values(headers):
    assert scope_refusal(_scope(headers=headers), POLICY) == "duplicate_header"
    assert scope_refusal(_scope("websocket", headers=headers), POLICY) == "duplicate_header"


def test_header_names_are_compared_in_lower_case():
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [(b"Host", b"x.ts.net"), (b"HOST", b"x.ts.net")]}

    assert scope_refusal(scope, POLICY) == "duplicate_header"


def test_a_duplicate_wins_over_the_host_and_the_host_over_the_origin():
    assert scope_refusal(_scope(headers=[("host", REBIND), ("host", REBIND), ("origin", "null")]), POLICY) == "duplicate_header"
    assert scope_refusal(_scope(headers=[("host", REBIND), ("origin", "https://evil.example")]), POLICY) == "host_not_allowed"
    assert scope_refusal(_scope(headers=[("host", GOOD), ("origin", "https://evil.example")]), POLICY) == "origin_not_allowed"


@pytest.mark.parametrize("headers, expected", [
    ([], "host_not_allowed"),
    ([("host", "")], "host_not_allowed"),
    ([("host", "a,b")], "host_not_allowed"),
    ([("host", GOOD), ("origin", "")], "origin_not_allowed"),
    ([("host", GOOD), ("origin", "http://[")], "origin_not_allowed"),
    ([("host", GOOD), ("origin", "https://" + GOOD + ":9")], "origin_not_allowed"),
    ([("host", GOOD), ("origin", "https://u@" + GOOD)], "origin_not_allowed"),
    ([("host", "café"), ("origin", "http://x")], "host_not_allowed"),
    ([("host", GOOD), ("x-forwarded-host", "evil.test")], None),
    ([("host", REBIND), ("x-forwarded-host", GOOD), ("forwarded", "host=" + GOOD)], "host_not_allowed"),
])
def test_malformed_headers_are_refused_without_an_error(headers, expected):
    assert scope_refusal(_scope(headers=headers), POLICY) == expected


def test_non_ascii_header_bytes_are_decoded_as_latin_1():
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [(b"host", b"\xe9"), (b"origin", b"http://\xe9")]}

    assert scope_refusal(scope, POLICY) == "host_not_allowed"


# -- the middleware, driven directly --------------------------------------------------------------------------


class Spy:
    def __init__(self, status=200, headers=()):
        self.calls, self.status, self.headers = [], status, list(headers)

    async def __call__(self, scope, receive, send):
        self.calls.append(scope["type"])
        if scope["type"] == "http":
            await send({"type": "http.response.start", "status": self.status, "headers": list(self.headers)})
            await send({"type": "http.response.body", "body": b"ok"})


def _drive(middleware, scope, incoming=None):
    """Runs the middleware; returns (sent messages, receive calls)."""
    sent, received = [], []
    queue = list(incoming if incoming is not None else [{"type": "websocket.connect"}])

    async def receive():
        received.append(1)
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))
    return sent, received


def _headers(sent):
    return {key: value for key, value in sent[0]["headers"]}


def test_a_refused_http_request_is_403_json_and_never_reaches_the_app_or_reads_the_body():
    spy = Spy()

    sent, received = _drive(RequestGuardMiddleware(spy, POLICY), _scope(path="/paste", method="POST", headers=[("host", REBIND)]))

    assert spy.calls == [] and received == []
    assert sent[0]["status"] == 403
    assert sent[1]["body"] == b'{"detail":{"code":"host_not_allowed","message":"host not allowed"}}'
    assert not any(key.startswith(b"access-control") for key in _headers(sent))


def test_an_allowed_request_reaches_the_app_untouched():
    spy = Spy(headers=[(b"x-a", b"1")])

    sent, _ = _drive(RequestGuardMiddleware(spy, POLICY), _scope(headers=[("host", "127.0.0.1:8000")]))

    assert spy.calls == ["http"] and sent[0]["status"] == 200 and sent[0]["headers"] == [(b"x-a", b"1")]


def test_the_lifespan_passes_straight_through():
    spy = Spy()

    _drive(RequestGuardMiddleware(spy, POLICY), {"type": "lifespan"})

    assert spy.calls == ["lifespan"]


def test_a_refused_websocket_is_accepted_then_closed_and_the_app_never_runs():
    spy = Spy()
    scope = _scope("websocket", "/ws/pty/k", headers=[("host", GOOD), ("origin", "https://evil.example")])

    sent, _ = _drive(RequestGuardMiddleware(spy, POLICY), scope)

    assert spy.calls == []
    assert [m["type"] for m in sent] == ["websocket.accept", "websocket.close"]
    assert sent[1]["code"] == WS_CLOSE_POLICY == 1008 and sent[1]["reason"] == "origin_not_allowed"


def test_a_refused_chat_websocket_closes_with_the_chat_code():
    scope = _scope("websocket", CHAT_SOCKET_PREFIX + "k::claude::aaaaaa", headers=[("host", REBIND)])

    sent, _ = _drive(RequestGuardMiddleware(Spy(), POLICY), scope)

    assert sent[1]["code"] == WS_CLOSE_ORIGIN == 4403 and sent[1]["reason"] == "host_not_allowed"


def test_a_websocket_with_a_null_origin_is_refused_even_on_a_sandbox_path():
    scope = _scope("websocket", "/api/viewer/abc/f/a", headers=[("host", GOOD), ("origin", "null")])

    sent, _ = _drive(RequestGuardMiddleware(Spy(), POLICY), scope)

    assert sent[1]["code"] == WS_CLOSE_POLICY


def test_a_websocket_that_never_connects_gets_no_frame():
    sent, _ = _drive(
        RequestGuardMiddleware(Spy(), POLICY), _scope("websocket", "/ws/pty/k", headers=[("host", REBIND)]),
        incoming=[{"type": "websocket.disconnect"}],
    )

    assert sent == []


def test_a_close_that_fails_after_the_accept_is_swallowed_and_the_app_still_does_not_run():
    spy = Spy()
    sent = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        sent.append(message["type"])
        if message["type"] == "websocket.close":
            raise AttributeError("transfer_data_task")

    asyncio.run(RequestGuardMiddleware(spy, POLICY)(_scope("websocket", "/ws/pty/k", headers=[("host", REBIND)]), receive, send))

    assert sent == ["websocket.accept", "websocket.close"] and spy.calls == []


def test_a_failing_accept_is_not_swallowed():
    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        raise AttributeError("accept failed")

    with pytest.raises(AttributeError):
        asyncio.run(RequestGuardMiddleware(Spy(), POLICY)(_scope("websocket", "/ws/pty/k", headers=[("host", REBIND)]), receive, send))


def test_a_websocket_with_an_allowed_host_reaches_the_app():
    spy = Spy()

    _drive(RequestGuardMiddleware(spy, POLICY), _scope("websocket", "/ws/pty/k", headers=[("host", GOOD), ("origin", "https://" + GOOD)]))

    assert spy.calls == ["websocket"]


# -- E1 response headers -------------------------------------------------------------------------------------


@pytest.mark.parametrize("status", [200, 304, 403, 404])
def test_a_sandbox_response_carries_the_null_origin_header_whatever_its_status(status):
    spy = Spy(status=status)
    scope = _scope(path="/api/viewer/abc/f/a.js", headers=[("host", GOOD), ("origin", "null")])

    sent, _ = _drive(RequestGuardMiddleware(spy, POLICY), scope)

    headers = _headers(sent)
    assert spy.calls == ["http"] and sent[0]["status"] == status
    assert headers[b"access-control-allow-origin"] == b"null" and headers[b"vary"] == b"Origin"


def test_the_vary_header_is_extended_not_replaced():
    spy = Spy(headers=[(b"vary", b"Accept-Encoding"), (b"cache-control", b"no-store")])
    scope = _scope(path="/api/artifacts/abc/f/a.js", headers=[("host", GOOD), ("origin", "null")])

    sent, _ = _drive(RequestGuardMiddleware(spy, POLICY), scope)

    headers = _headers(sent)
    assert headers[b"vary"] == b"Accept-Encoding, Origin" and headers[b"cache-control"] == b"no-store"
    assert [key for key, _ in sent[0]["headers"]].count(b"vary") == 1


def test_a_vary_that_already_names_origin_is_left_alone():
    spy = Spy(headers=[(b"vary", b"origin")])
    scope = _scope(path="/api/artifacts/abc/f/a.js", headers=[("host", GOOD), ("origin", "null")])

    sent, _ = _drive(RequestGuardMiddleware(spy, POLICY), scope)

    assert _headers(sent)[b"vary"] == b"origin"


@pytest.mark.parametrize("headers", [
    [("host", GOOD)],  # a navigation: no Origin
    [("host", GOOD), ("origin", "https://" + GOOD)],  # same origin
])
def test_a_sandbox_path_without_a_null_origin_gets_no_cors_header(headers):
    sent, _ = _drive(RequestGuardMiddleware(Spy(), POLICY), _scope(path="/api/viewer/abc/f/a.js", headers=headers))

    assert b"access-control-allow-origin" not in _headers(sent)


def test_a_null_origin_on_another_path_never_gets_the_header():
    sent, _ = _drive(RequestGuardMiddleware(Spy(), POLICY), _scope(path="/api/viewer/abc/content", headers=[("host", GOOD), ("origin", "null")]))

    assert sent[0]["status"] == 403 and b"access-control-allow-origin" not in _headers(sent)


def test_a_configured_origin_is_accepted_and_another_is_not():
    policy = GuardPolicy(("https://dev.example.com",), ("dev.example.com",))
    ok, bad = Spy(), Spy()

    _drive(RequestGuardMiddleware(ok, policy), _scope(method="PUT", headers=[("host", "dev.example.com"), ("origin", "https://dev.example.com")]))
    _drive(RequestGuardMiddleware(bad, policy), _scope(method="PUT", headers=[("host", "dev.example.com"), ("origin", "https://evil.example")]))

    assert ok.calls == ["http"] and bad.calls == []
