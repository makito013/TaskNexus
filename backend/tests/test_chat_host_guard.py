"""Stage 10 (R1): the chat checks the `Host` before anything else, on every route and on the socket.

DNS rebinding makes `Origin` equal to `Host`, so only a list of acceptable hosts stops it; and a
same-origin `GET` carries no `Origin`, so the reads need the host check too. Runs against the real app
with the scripted engine (no SDK, no binary: both venvs).
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.chat.api import allowed_hosts_from_env, host_allowed, host_name
from app.chat.errors import ChatError
from tests.test_chat_endpoints import PROJECT, _boot, env, wait_until  # noqa: F401 - fixtures

REBIND = "rebind.evil.test:8765"
REBIND_HEADERS = {"Host": REBIND, "Origin": "http://" + REBIND}  # what a rebinding page sends: both its own
NO_ORIGIN_REBIND = {"Host": REBIND}  # a same-origin GET: no Origin at all
CROSS_SITE = {"Host": "127.0.0.1:8765", "Origin": "https://evil.example"}
READS = [
    "/api/chat/health", "/api/chat/sessions", "/api/chat/sessions/k::claude::aaaaaa/events",
    "/api/chat/sessions/k::claude::aaaaaa/commands", "/api/chat/commands", "/api/chat/models",
    "/api/chat/agents/claude/connectors",
]


@pytest.mark.parametrize("host", [
    "127.0.0.1", "127.0.0.1:8765", "[::1]:8765", "::1", "100.101.102.103:443", "localhost", "localhost:5173",
    "testserver", "my-pc", "MY-PC:8765", "bruno-pc.tail1234.ts.net", "bruno-pc.tail1234.ts.net:443",
    "bruno-pc.tail1234.ts.net.", "[fe80::1]",
])
def test_the_default_hosts_pass(host):
    assert host_allowed(host, [])


@pytest.mark.parametrize("host", [
    None, "", " ", "rebind.evil.test", REBIND, "evil.example:80", "127.0.0.1.evil.test", "localhost.evil.test",
    "ts.net", ".ts.net", "evil.ts.net.evil.test", "evilts.net", "x.ts.net.evil.com:1",
    "127.0.0.1:abc", "127.0.0.1:99999999", "[::1", "[::1]x", "[::1]:", "a b", "a@b", "x.ts.net@evil.com",
    "my_pc.evil.com",
])
def test_everything_else_is_refused(host):
    assert not host_allowed(host, [])


def test_the_extra_hosts_come_from_the_environment():
    assert allowed_hosts_from_env({"CHAT_ALLOWED_HOSTS": " Chat.Example.com:8443 , ,tn.lan. "}) == ["chat.example.com", "tn.lan"]
    assert host_allowed("chat.example.com:443", ["chat.example.com"])
    assert not host_allowed("other.example.com", ["chat.example.com"])
    assert allowed_hosts_from_env({}) == []
    assert host_name("[::1]:8765") == "::1"


@pytest.mark.parametrize("path", READS)
@pytest.mark.parametrize("headers", [NO_ORIGIN_REBIND, REBIND_HEADERS])
def test_a_rebinding_host_cannot_read_the_chat_even_without_an_origin(env, path, headers):
    response = env.client.get(path, headers=headers)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "host_not_allowed"


@pytest.mark.parametrize("path", READS)
def test_another_site_cannot_read_the_chat_content(env, path):
    response = env.client.get(path, headers=CROSS_SITE)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "origin_not_allowed"


def test_a_rebinding_page_cannot_create_or_decide(env):
    body = {"project_ref": PROJECT, "agent_id": "claude", "first_message": "run x"}

    created = env.client.post("/api/chat/sessions", json=body, headers=REBIND_HEADERS)
    decided = env.client.post("/api/chat/permissions/abc/decide", json={"behavior": "allow"}, headers=REBIND_HEADERS)

    assert created.status_code == 403 and decided.status_code == 403
    assert env.sessions() == [] and env.engine.spawns == 0


@pytest.mark.parametrize("headers", [
    {}, {"Host": "127.0.0.1:8765"}, {"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765"},
    {"Host": "[::1]:8765", "Origin": "http://[::1]:8765"}, {"Host": "localhost", "Origin": "http://localhost"},
    {"Host": "bruno-pc.tail1234.ts.net"},
    {"Host": "bruno-pc.tail1234.ts.net", "Origin": "http://bruno-pc.tail1234.ts.net"},
])
def test_the_real_ways_in_still_work(env, headers):
    assert env.client.get("/api/chat/sessions", headers=headers).status_code == 200
    assert env.client.post("/api/chat/sessions/nope::claude::zzzzzz/close", headers=headers).status_code == 404


def test_chat_allowed_hosts_lets_an_own_domain_through(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch, {"CHAT_ALLOWED_HOSTS": "tn.example.com"}):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            own = client.get("/api/chat/sessions", headers={"Host": "tn.example.com:8443"})
            other = client.get("/api/chat/sessions", headers={"Host": "evil.example.com"})
            terminate = client.post("/api/sessions/x/terminate", headers={"Host": "tn.example.com"})

    assert own.status_code == 200 and other.status_code == 403 and terminate.status_code != 403


def test_a_configured_origin_also_makes_its_host_acceptable(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch, {"CHAT_ALLOWED_ORIGINS": "https://dev.example.com"}):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            ok = client.get("/api/chat/sessions", headers={"Host": "dev.example.com", "Origin": "https://dev.example.com"})

    assert ok.status_code == 200


# -- the V2 routes that reach the chat -----------------------------------------------------------------------


@pytest.mark.parametrize("action", ["terminate", "reset"])
@pytest.mark.parametrize("headers", [CROSS_SITE, REBIND_HEADERS, NO_ORIGIN_REBIND])
def test_terminate_and_reset_refuse_another_site_and_a_rebinding_host(env, action, headers):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    before = env.events(key)["last_seq"]

    response = env.client.post(f"/api/sessions/{key}/{action}", headers=headers)

    assert response.status_code == 403
    assert env.session(key) and env.events(key)["last_seq"] == before  # nothing was erased or recorded


@pytest.mark.parametrize("action", ["terminate", "reset"])
@pytest.mark.parametrize("headers", [{}, {"Host": "127.0.0.1:8765"}, {"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765"}])
def test_terminate_and_reset_keep_working_for_the_v2_client_and_non_browser_clients(env, action, headers):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    response = env.client.post(f"/api/sessions/{key}/{action}", headers=headers)

    assert response.status_code == 200


# -- the socket ----------------------------------------------------------------------------------------------


def _close_code(env, key, headers):
    with pytest.raises(WebSocketDisconnect) as closed:
        with env.client.websocket_connect(f"/ws/chat/{key}?since=0", headers=headers) as ws:
            for _ in range(100):
                ws.receive_json()
    return closed.value.code


@pytest.mark.parametrize("headers", [REBIND_HEADERS, NO_ORIGIN_REBIND, CROSS_SITE])
def test_the_socket_closes_4403_before_attaching_for_a_rebinding_host_or_another_site(env, headers):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    attached = []

    def attach_refused(*args, **kwargs):  # reaching attach would answer 4404 at once instead of hanging on a live socket
        attached.append(args)
        raise ChatError("session_not_found")

    env.main.chat_service.attach = attach_refused

    code = _close_code(env, key, headers)

    assert code == 4403 and attached == []


def test_the_socket_still_serves_a_trusted_host(env):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    with env.client.websocket_connect(f"/ws/chat/{key}?since=0", headers={"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765"}) as ws:
        first = ws.receive_json()

    assert first["type"] == "session.state"
