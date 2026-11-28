"""The origin guard on the real app: every route and both WebSockets, the real loopback listener over TCP,
and the clients that must keep working (hooks, MCP adapters, the V2 in a browser, the vite dev server)."""
from __future__ import annotations

import base64
import http.client
import importlib
import json
import os
import re
import socket
import sys
import time
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Match, Mount, Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from app.request_guard import RequestGuardMiddleware, is_sandbox_file_request
from tests.test_chat_endpoints import PROJECT, _boot
from tests.test_hook_loopback_listener import _running_app_with_listener
from tests.test_pwa_static_routes import _build_fake_dist

REBIND = "rebind.evil.test:8765"
LOOPBACK = "127.0.0.1:8765"
ATTACKS = {
    "rebinding with its own origin": {"Host": REBIND, "Origin": "http://" + REBIND},
    "rebinding, no origin": {"Host": REBIND},
    "another site": {"Host": LOOPBACK, "Origin": "https://evil.example"},
    "another port of the same ip": {"Host": LOOPBACK, "Origin": "http://127.0.0.1:9999"},
    "null origin": {"Host": LOOPBACK, "Origin": "null"},
}
CHAT_CLOSE = 4403
POLICY_CLOSE = 1008


@contextmanager
def booted(tmp_path, monkeypatch, extra_env=None, drop=()):
    """The real `app.main`, reloaded under a patched environment, with a fake `frontend/dist`."""
    dist = tmp_path / "dist"
    if not dist.exists():
        _build_fake_dist(dist)
    with _boot(tmp_path, monkeypatch, {"FRONTEND_DIST": str(dist), **(extra_env or {})}):
        for name in drop:
            os.environ.pop(name, None)
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app, follow_redirects=False) as client:
            yield main_mod, client


@pytest.fixture
def booted_app(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch) as pair:
        yield pair


def _fill(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


def _close_code(client, path, headers):
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(path, headers=headers) as ws:
            ws.receive_text()
    return closed.value.code


def _targets(app):
    """(kind, method, path) for every registered route; an unknown route type fails instead of being skipped."""
    found = []
    for route in app.routes:
        if isinstance(route, WebSocketRoute):
            found.append(("ws", None, _fill(route.path)))
        elif isinstance(route, Mount):
            found += [("http", "GET", _fill(route.path) + "/x"), ("http", "POST", _fill(route.path) + "/x")]
        elif isinstance(route, Route):
            found += [("http", method, _fill(route.path)) for method in sorted(route.methods or {"GET"}) if method != "HEAD"]
        else:
            pytest.fail(f"unknown route type {type(route).__name__}: the guard matrix must cover it")
    return found


def _expected_ws_code(path):
    return CHAT_CLOSE if path.startswith("/ws/chat/") else POLICY_CLOSE


def _wait(predicate, timeout=6.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition not reached in time")


# -- the whole app is behind the guard -----------------------------------------------------------------------


@pytest.mark.parametrize("attack", sorted(ATTACKS))
def test_every_route_refuses_the_attack_with_no_cors_header(booted_app, attack):
    main_mod, client = booted_app
    targets = _targets(main_mod.app)
    assert len(targets) > 100 and {kind for kind, _, _ in targets} == {"http", "ws"}
    headers, failures = ATTACKS[attack], []

    for kind, method, path in targets:
        if kind == "ws":
            code = _close_code(client, path, headers)
            if code != _expected_ws_code(path):
                failures.append((path, code))
            continue
        if headers.get("Origin") == "null" and is_sandbox_file_request({"type": "http", "method": method, "path": path}):
            continue  # E1, covered on its own below
        response = client.request(method, path, headers=headers)
        if response.status_code != 403 or "access-control-allow-origin" in response.headers:
            failures.append((method, path, response.status_code))

    assert failures == []


def test_a_missing_route_and_a_trailing_slash_redirect_are_guarded_too(booted_app):
    _, client = booted_app

    assert client.get("/api/agents/", headers={"Host": REBIND}).status_code == 403  # would be a 307
    assert client.get("/api/agents/", headers={"Host": LOOPBACK}).status_code != 403  # the SPA catch-all answers it
    assert client.get("/no/such/route", headers={"Host": REBIND}).status_code == 403
    assert client.get("/docs", headers={"Host": REBIND}).status_code == 403
    assert client.get("/openapi.json", headers={"Host": REBIND}).status_code == 403
    assert client.get("/openapi.json", headers={"Host": LOOPBACK}).status_code == 200


def test_the_guard_comes_right_after_the_backslash_check_and_there_is_no_cors_without_origins(booted_app):
    main_mod, client = booted_app

    assert [m.cls.__name__ for m in main_mod.app.user_middleware] == ["RejectBackslashPathMiddleware", "RequestGuardMiddleware"]
    assert client.get("/a%5Cb", headers={"Host": REBIND}).status_code == 400


def test_a_dangerous_write_is_refused_and_leaves_no_trace(booted_app):
    _, client = booted_app
    created = client.post("/api/agents", json={"id": "a1", "nome": "A", "papel": "p", "ia": "claude"}, headers={"Host": LOOPBACK})
    assert created.status_code == 201
    agents_before, cards_before = client.get("/api/agents", headers={"Host": LOOPBACK}).json(), client.get("/api/cards", headers={"Host": LOOPBACK}).json()

    for headers in ATTACKS.values():
        body = {"id": "a1", "nome": "A", "papel": "p", "ia": "claude", "cmd": ["calc.exe"]}
        assert client.put("/api/agents/a1", json=body, headers=headers).status_code == 403
        assert client.post("/api/sessions/k/paste", json={"text": "rm -rf /"}, headers=headers).status_code == 403
        assert client.post("/api/settings/projects-root/browse", json={"path": "C:/"}, headers=headers).status_code == 403
        assert client.post("/api/hooks/cards/create", json={"title": "x"}, headers=headers).status_code == 403

    assert client.get("/api/agents", headers={"Host": LOOPBACK}).json() == agents_before
    assert client.get("/api/cards", headers={"Host": LOOPBACK}).json() == cards_before


@pytest.mark.parametrize("path", ["/api/sessions/active", "/api/sessions/active?engine=chat", "/api/sessions/persisted"])
@pytest.mark.parametrize("attack", ["rebinding, no origin", "another site", "null origin"])
def test_the_session_lists_are_guarded(booted_app, path, attack):
    _, client = booted_app

    assert client.get(path, headers=ATTACKS[attack]).status_code == 403
    assert client.get(path, headers={"Host": LOOPBACK}).status_code == 200


# -- the clients that must keep working ------------------------------------------------------------------------


@pytest.mark.parametrize("host", [
    "127.0.0.1:8765", "localhost:8000", "[::1]:8765", "bruno-pc.tail1234.ts.net", "BRUNO-PC.TAIL1234.TS.NET.:443",
    "100.101.102.103", "[fd7a:115c:a1e0::1]:8765", "localhost",
])
def test_non_browser_clients_without_an_origin_work_on_every_kind_of_route(booted_app, host):
    _, client = booted_app
    headers = {"Host": host}

    assert client.post("/api/hooks/stop", json={"session_id": "none"}, headers=headers).status_code == 200
    assert client.get("/api/sessions/persisted", headers=headers).status_code == 200
    assert client.get("/", headers=headers).status_code == 200
    assert client.get("/sw.js", headers=headers).status_code == 200
    assert client.get("/manifest.webmanifest", headers=headers).status_code == 200
    assert client.get("/icons/icon-192.png", headers=headers).status_code == 200
    assert client.get("/fonts/figtree-variable.woff2", headers=headers).status_code == 200


def test_the_machine_name_is_accepted_and_another_dotless_name_is_not(booted_app):
    _, client = booted_app
    from app import request_guard

    with patch.object(request_guard, "LOCAL_NAMES", frozenset({"localhost", "my-pc"})):
        assert client.get("/api/sessions/persisted", headers={"Host": "MY-PC:8765"}).status_code == 200
        assert client.get("/api/sessions/persisted", headers={"Host": "their-pc"}).status_code == 403
    for name in ["evil", "intranet", "printer", "2130706433", "localhost.evil.test", "x.ts.net.evil.com", "evilts.net", "ts.net"]:
        assert client.get("/api/sessions/persisted", headers={"Host": name}).status_code == 403, name


@pytest.mark.parametrize("host", ["bruno-pc.tail1234.ts.net", "127.0.0.1:8765", "[::1]:8765", "localhost:8000", "100.1.2.3"])
@pytest.mark.parametrize("method", ["get", "post", "put", "patch", "delete"])
def test_a_same_origin_browser_request_passes_for_every_method(booted_app, host, method):
    _, client = booted_app
    scheme = "https" if "ts.net" in host else "http"
    headers = {"Host": host, "Origin": f"{scheme}://{host}"}

    # a GET of an unknown agent path falls into the SPA catch-all (200); the other methods reach the API
    path = "/api/agents" if method == "get" else "/api/agents/nope"
    response = getattr(client, method)(path, headers=headers)

    assert response.status_code in (200, 404, 405, 422) and response.status_code != 403 and "access-control-allow-origin" not in response.headers


def test_a_same_origin_browser_request_passes_on_the_terminal_socket(booted_app):
    _, client = booted_app

    with client.websocket_connect("/ws/pty/same-origin", headers={"Host": LOOPBACK, "Origin": "http://" + LOOPBACK}) as ws:
        ws.close()


def test_the_vite_dev_server_proxy_passes_and_the_old_proxy_form_does_not(booted_app):
    _, client = booted_app

    assert client.post("/api/hooks/stop", json={}, headers={"Host": "localhost:5173", "Origin": "http://localhost:5173"}).status_code == 200
    old = client.post("/api/hooks/stop", json={}, headers={"Host": "localhost:8000", "Origin": "http://localhost:5173"})
    assert old.status_code == 403 and old.json()["detail"]["code"] == "origin_not_allowed"


def test_x_forwarded_headers_change_nothing(booted_app):
    _, client = booted_app

    assert client.get("/api/sessions/persisted", headers={"Host": REBIND, "X-Forwarded-Host": LOOPBACK, "Forwarded": "host=localhost"}).status_code == 403
    assert client.get("/api/sessions/persisted", headers={"Host": LOOPBACK, "X-Forwarded-Host": REBIND}).status_code == 200


@pytest.mark.parametrize("headers", [
    {"Host": LOOPBACK, "Origin": ""}, {"Host": LOOPBACK, "Origin": "http://["}, {"Host": LOOPBACK, "Origin": "http://u@127.0.0.1:8765"},
    {"Host": ""}, {"Host": "127.0.0.1,evil.test"},
])
def test_malformed_headers_are_a_403_never_a_500(booted_app, headers):
    _, client = booted_app

    assert client.get("/api/sessions/persisted", headers=headers).status_code == 403


# -- configuration -------------------------------------------------------------------------------------------


def test_testserver_is_refused_when_the_test_suite_does_not_allow_it(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch, drop=("CHAT_ALLOWED_HOSTS",)) as (_, client):
        assert client.get("/api/sessions/persisted").status_code == 403
        assert client.get("/api/sessions/persisted", headers={"Host": "127.0.0.1"}).status_code == 200


def test_the_callback_url_host_and_only_that_host_is_accepted(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch, {"HOOK_CALLBACK_BASE_URL": "https://meu-proxy.exemplo:8443"}) as (_, client):
        assert client.post("/api/hooks/stop", json={}, headers={"Host": "meu-proxy.exemplo:8443"}).status_code == 200
        assert client.post("/api/hooks/stop", json={}, headers={"Host": "outro.exemplo"}).status_code == 403


def test_a_configured_origin_gets_cors_for_itself_and_its_preflight_only(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch, {"CHAT_ALLOWED_ORIGINS": "https://dev.example.com"}) as (main_mod, client):
        origin = {"Origin": "https://dev.example.com", "Host": "127.0.0.1:8000"}
        ok = client.post("/api/hooks/stop", json={}, headers=origin)
        preflight = client.options("/api/agents/x", headers={**origin, "Access-Control-Request-Method": "PUT"})
        other = client.options("/api/agents/x", headers={"Origin": "https://evil.example", "Host": "127.0.0.1:8000", "Access-Control-Request-Method": "PUT"})

        assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "https://dev.example.com"
        assert preflight.status_code == 200 and preflight.headers["access-control-allow-origin"] == "https://dev.example.com"
        assert other.status_code == 403 and not any(k.startswith("access-control") for k in other.headers)
        assert [m.cls for m in main_mod.app.user_middleware][1:3] == [RequestGuardMiddleware, CORSMiddleware]
        assert not any(m.kwargs.get("allow_origins") == ["*"] for m in main_mod.app.user_middleware)


def test_the_null_origin_cannot_be_configured(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch, {"CHAT_ALLOWED_ORIGINS": "null"}) as (main_mod, client):
        assert client.post("/api/hooks/stop", json={}, headers={"Origin": "null", "Host": "127.0.0.1:8000"}).status_code == 403
        assert CORSMiddleware not in [m.cls for m in main_mod.app.user_middleware]


def test_a_hostile_preflight_gets_a_403_and_no_cors_headers(booted_app):
    _, client = booted_app

    for headers in ATTACKS.values():
        response = client.options("/api/agents/x", headers={
            **headers, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Private-Network": "true",
        })
        assert response.status_code == 403 and not any(k.startswith("access-control") for k in response.headers)


def test_a_malformed_configured_origin_does_not_stop_the_boot(tmp_path, monkeypatch):
    with booted(tmp_path, monkeypatch, {"CHAT_ALLOWED_ORIGINS": "http://[", "HOOK_CALLBACK_BASE_URL": "http://["}) as (_, client):
        assert client.get("/api/sessions/persisted", headers={"Host": LOOPBACK}).status_code == 200
        assert client.get("/api/sessions/persisted", headers={"Host": REBIND}).status_code == 403


# -- E1: the sandboxed iframe ----------------------------------------------------------------------------------


E1_PATHS = ["/api/viewer/abc123/f/app.js", "/api/artifacts/abc123/f/dir/data.json"]


@pytest.mark.parametrize("path", E1_PATHS)
def test_the_first_route_matching_an_e1_path_is_the_file_route(booted_app, path):
    main_mod, _ = booted_app
    scope = {"type": "http", "method": "GET", "path": path, "root_path": "", "headers": []}

    first = next(route for route in main_mod.app.routes if route.matches(scope)[0] == Match.FULL)

    assert first.path.startswith(path.split("/abc123")[0]) and "/f/" in first.path


@pytest.mark.parametrize("path", E1_PATHS)
@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_a_sandboxed_iframe_gets_its_files_with_the_null_origin_header(booted_app, path, method):
    _, client = booted_app
    plain = client.request(method, path, headers={"Host": LOOPBACK})

    sandboxed = client.request(method, path, headers={"Host": LOOPBACK, "Origin": "null"})

    assert sandboxed.status_code == plain.status_code != 403
    assert sandboxed.headers["access-control-allow-origin"] == "null" and "Origin" in sandboxed.headers["vary"]
    assert "access-control-allow-origin" not in plain.headers


@pytest.mark.parametrize("path", E1_PATHS)
def test_a_sandboxed_iframe_is_refused_with_a_hostile_host_or_a_write_or_a_preflight(booted_app, path):
    _, client = booted_app

    assert client.get(path, headers={"Host": REBIND, "Origin": "null"}).status_code == 403
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        response = client.request(method, path, headers={"Host": LOOPBACK, "Origin": "null"})
        assert response.status_code == 403 and "access-control-allow-origin" not in response.headers
    preflight = client.options(path, headers={"Host": LOOPBACK, "Origin": "null", "Access-Control-Request-Method": "GET"})
    assert preflight.status_code == 403 and "access-control-allow-origin" not in preflight.headers


@pytest.mark.parametrize("path", [
    "/api/viewer/abc123/content", "/api/artifacts/abc123/content", "/api/card-attachments/1/content",
    "/api/card-attachments/1/f/a.html", "/api/sessions/active", "/api/viewer/abc123/f", "/x/api/viewer/abc/f/a.js",
    "/api/agents", "/", "/sw.js",
])
def test_a_null_origin_is_refused_outside_e1(booted_app, path):
    _, client = booted_app

    response = client.get(path, headers={"Host": LOOPBACK, "Origin": "null"})

    assert response.status_code == 403 and "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("path", ["/ws/pty/k", "/ws/chat/k::claude::aaaaaa", "/api/viewer/abc123/f/app.js"])
def test_a_null_origin_is_refused_on_the_sockets(booted_app, path):
    _, client = booted_app

    assert _close_code(client, path, {"Host": LOOPBACK, "Origin": "null"}) == _expected_ws_code(path)


def test_a_card_attachment_opens_by_navigation_without_an_origin(booted_app):
    _, client = booted_app

    response = client.get("/api/card-attachments/1/content", headers={"Host": "bruno-pc.tail1234.ts.net"})

    assert response.status_code != 403


# -- the terminal socket: a refused handshake has no effect ---------------------------------------------------------


def test_a_refused_terminal_handshake_does_not_evict_the_live_connection_or_spawn(booted_app):
    main_mod, client = booted_app
    from app.main import pty_manager

    echo = [sys.executable, "-c", "import sys,os,time; data=os.read(0,4096); os.write(1, b'GOT:'+data); time.sleep(1.0)"]
    spawned = []
    original = main_mod._ensure_pty

    async def spy(*args, **kwargs):
        spawned.append(args)
        return await original(*args, **kwargs)

    with patch("app.main._build_pty_cmd", return_value=echo), patch.object(main_mod, "_ensure_pty", spy):
        with client.websocket_connect("/ws/pty/live") as live:
            live.send_text(json.dumps({"type": "init", "project_id": PROJECT, "agent_id": None, "cols": 80, "rows": 24}))
            _wait(lambda: pty_manager.get("live") is not None and "live" in main_mod._active_connections)
            connection, task = main_mod._active_connections["live"], main_mod._active_tasks["live"]
            sessions, spawned_before = list(pty_manager._sessions), len(spawned)

            for headers in ATTACKS.values():
                assert _close_code(client, "/ws/pty/live", headers) == POLICY_CLOSE

            assert main_mod._active_connections["live"] is connection and main_mod._active_tasks["live"] is task
            assert not task.done() and list(pty_manager._sessions) == sessions and len(spawned) == spawned_before
            live.send_bytes(b"hi\r\n")
            _wait(lambda: b"GOT:hi" in pty_manager.get("live").snapshot())


def test_a_refused_terminal_close_carries_the_reason(booted_app):
    _, client = booted_app

    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect("/ws/pty/k", headers={"Host": REBIND}) as ws:
            ws.receive_text()

    assert closed.value.code == POLICY_CLOSE and closed.value.reason == "host_not_allowed"


# -- the real loopback listener, over TCP -------------------------------------------------------------------------


def _raw_http(port, method, path, headers, body=b""):
    """One request with exactly the given header lines (a repeated `Host` included)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    for name, value in headers:
        conn.putheader(name, value)
    conn.putheader("Content-Length", str(len(body)))
    conn.endheaders(body)
    try:
        response = conn.getresponse()
        return response.status, response.read()
    except (http.client.HTTPException, ConnectionError):
        return None, b""  # the server dropped the connection before answering: a refusal too
    finally:
        conn.close()


def _raw_websocket(port, path, headers):
    """The handshake by hand; returns (status line, close code or None)."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    try:
        lines = [f"GET {path} HTTP/1.1"] + [f"{k}: {v}" for k, v in headers]
        lines += ["Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13",
                  "Sec-WebSocket-Key: " + base64.b64encode(os.urandom(16)).decode(), "", ""]
        sock.sendall("\r\n".join(lines).encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        while len(rest) < 4 and status.endswith("Switching Protocols"):
            chunk = sock.recv(4096)
            if not chunk:
                break
            rest += chunk
        code = int.from_bytes(rest[2:4], "big") if len(rest) >= 4 and rest[0] & 0x0F == 8 else None
        return status, code
    except (ConnectionError, socket.timeout):
        return "", None
    finally:
        sock.close()


def test_the_loopback_channel_serves_the_hooks_and_refuses_the_attacks(tmp_path):
    with _running_app_with_listener(tmp_path) as (main_mod, client, port):
        host = f"127.0.0.1:{port}"
        body = json.dumps({"session_id": "none"}).encode()
        json_headers = [("Content-Type", "application/json")]

        assert _raw_http(port, "POST", "/api/hooks/stop", [("Host", host), *json_headers], body)[0] == 200
        for headers in (
            [("Host", f"rebind.evil.test:{port}")],
            [("Host", f"rebind.evil.test:{port}"), ("Origin", f"http://rebind.evil.test:{port}")],
            [("Host", host), ("Origin", "https://evil.example")],
            [("Host", host), ("Origin", "null")],
        ):
            status, _ = _raw_http(port, "POST", "/api/hooks/stop", [*headers, *json_headers], body)
            assert status == 403, headers
        status, _ = _raw_http(port, "GET", "/api/sessions/active", [("Host", f"rebind.evil.test:{port}")])
        assert status == 403


@pytest.mark.parametrize("headers", [
    lambda host: [("Host", host), ("Host", "rebind.evil.test")],
    lambda host: [("Host", "rebind.evil.test"), ("Host", host)],
    lambda host: [("Host", host), ("Host", host)],
    lambda host: [("Host", host), ("Origin", "http://" + host), ("Origin", "http://" + host)],
])
def test_a_repeated_header_over_tcp_is_refused_before_the_app(tmp_path, headers):
    with _running_app_with_listener(tmp_path) as (main_mod, client, port):
        status, body = _raw_http(port, "GET", "/api/sessions/persisted", headers(f"127.0.0.1:{port}"))

        assert status in (None, 400, 403), body  # a protocol-level 4xx before the app counts as a refusal
        if status == 403:
            assert json.loads(body)["detail"]["code"] == "duplicate_header"


def test_the_terminal_socket_over_tcp_is_closed_1008_for_every_attack(tmp_path):
    with _running_app_with_listener(tmp_path) as (main_mod, client, port):
        host = f"127.0.0.1:{port}"
        for headers in (
            [("Host", f"rebind.evil.test:{port}")],
            [("Host", host), ("Origin", "https://evil.example")],
            [("Host", host), ("Origin", "null")],
            [("Host", host), ("Host", "rebind.evil.test")],
        ):
            status, code = _raw_websocket(port, "/ws/pty/k", headers)
            assert code == POLICY_CLOSE, (headers, status, code)
        status, code = _raw_websocket(port, "/ws/chat/k::claude::aaaaaa", [("Host", f"rebind.evil.test:{port}")])
        assert code == CHAT_CLOSE
        # a repeated Origin is stopped by the websocket library with a 400 once the app has already refused
        status, code = _raw_websocket(port, "/ws/pty/k", [("Host", host), ("Origin", "http://" + host), ("Origin", "http://" + host)])
        assert code == POLICY_CLOSE or "400" in status or status == ""
