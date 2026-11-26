"""One guard for the whole app: every HTTP request and every WebSocket handshake is checked for `Host`
and `Origin` before any route, handler or effect.

The backend has no authentication by design, so the only defence against a page of another site in the
user's browser (cross-site, DNS rebinding, an opaque `null` origin) is to look at who is talking:

* `Host` is checked FIRST, always. Comparing `Origin` with the request's own `Host` proves nothing under
  DNS rebinding (the attacker controls both), and a same-origin `GET` carries no `Origin` at all. Only an
  IP literal, `localhost`, the name of this machine, a `*.ts.net` name or a host listed in
  `CHAT_ALLOWED_HOSTS`, in `CHAT_ALLOWED_ORIGINS` or in `HOOK_CALLBACK_BASE_URL` passes. A rebinding page
  needs a public DNS name, which always has a dot and is never under `ts.net`.
* A request with no `Origin` (a non-browser client: hooks, MCP adapters, curl) passes with an accepted
  `Host`. An `Origin` must have the same `host:port` as the request or be in `CHAT_ALLOWED_ORIGINS`.
* A repeated `Host` or `Origin` header is refused whatever its values (`Headers.get` would read only the
  first one), so the decision reads the raw ASGI header list.
* `Origin: null` (a sandboxed iframe) is refused everywhere except `GET`/`HEAD` of the files the viewer and
  the artifacts serve to that iframe (`/api/{viewer,artifacts}/{id}/f/...`, ids of 128 bits): there the
  `Host` is still checked and the response carries `Access-Control-Allow-Origin: null`, because the
  browser needs it to hand a module, a font or a `fetch` result to an opaque origin.

A refusal is `403` with `{"detail": {"code", "message"}}` for HTTP and, for a WebSocket, an accepted
handshake closed at once (the app never runs, so nothing is evicted, spawned or read): `4403` on
`/ws/chat/...` (the contract of the chat) and `1008` elsewhere (the only code on which the V2 terminal does
not reconnect in a loop).
"""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

WS_CLOSE_ORIGIN = 4403
WS_CLOSE_POLICY = 1008
CHAT_SOCKET_PREFIX = "/ws/chat/"

_PORT = re.compile(r"\d{1,5}")
_TAILNET_NAME = re.compile(r"[a-z0-9_.-]+\.ts\.net")
_SANDBOX_FILE_PATH = re.compile(r"/api/(?:viewer|artifacts)/[^/]+/f/.+")


def host_name(host: str | None) -> str:
    """The name of a `Host` header (or of a configured host) without port, brackets and trailing dot,
    lower-cased; `""` when empty or malformed (a malformed host is never allowed)."""
    value = (host or "").strip().lower()
    if value.startswith("["):
        end = value.find("]")
        rest = value[end + 1:] if end > 0 else "x"
        if end < 1 or (rest and not (rest.startswith(":") and _PORT.fullmatch(rest[1:]))):
            return ""
        value = value[1:end]
    elif value.count(":") == 1:
        value, port = value.split(":")
        if port and not _PORT.fullmatch(port):
            return ""
    return value.rstrip(".")


def _machine_names() -> frozenset[str]:
    try:
        machine = host_name(socket.gethostname())
    except OSError:  # no name: only `localhost` and the IP literals remain
        machine = ""
    return frozenset(name for name in ("localhost", machine) if name)


# The dotless names that pass: `localhost` and this machine. Read once at import (no DNS, no per-request
# cost); a module constant so a test can replace it.
LOCAL_NAMES: frozenset[str] = _machine_names()


def allowed_origins_from_env(env=os.environ) -> list[str]:
    """`CHAT_ALLOWED_ORIGINS`; the opaque `null` origin is never configurable."""
    items = [item.strip().rstrip("/") for item in (env.get("CHAT_ALLOWED_ORIGINS") or "").split(",") if item.strip()]
    return [item for item in items if item.lower() != "null"]


def allowed_hosts_from_env(env=os.environ) -> list[str]:
    return [name for item in (env.get("CHAT_ALLOWED_HOSTS") or "").split(",") if (name := host_name(item))]


def host_allowed(host: str | None, extra_hosts: list[str] | tuple[str, ...] = ()) -> bool:
    name = host_name(host)
    if not name:
        return False
    if name in extra_hosts or name in LOCAL_NAMES:
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        pass
    return bool(_TAILNET_NAME.fullmatch(name))


def origin_allowed(origin: str | None, host: str | None, extra: list[str] | tuple[str, ...]) -> bool:
    """`None` means no `Origin` header (a non-browser client). An empty, `null` or malformed one is refused."""
    if origin is None:
        return True
    if not origin or origin.lower() == "null":
        return False
    if origin.rstrip("/") in extra:
        return True
    try:
        netloc = urlparse(origin).netloc
    except ValueError:  # e.g. `http://[`
        return False
    return bool(host) and netloc.lower() == host.lower()


def request_refusal(
    origin: str | None, host: str | None, extra_origins: list[str] | tuple[str, ...],
    extra_hosts: list[str] | tuple[str, ...],
) -> str | None:
    """The error code that refuses a request (host first, then origin), or None when it may proceed."""
    if not host_allowed(host, extra_hosts):
        return "host_not_allowed"
    if not origin_allowed(origin, host, extra_origins):
        return "origin_not_allowed"
    return None


def _host_of_url(value: str, variable: str) -> str:
    """The host name of a configured URL (with or without a scheme), `""` when it has none or is malformed."""
    try:
        return host_name(urlparse(value if "://" in value else "//" + value).netloc)
    except ValueError:
        logger.warning("%s has an item that is not a valid URL; it was ignored", variable)
        return ""


@dataclass(frozen=True)
class GuardPolicy:
    origins: tuple[str, ...]
    hosts: tuple[str, ...]  # CHAT_ALLOWED_HOSTS + hosts of the origins + host of HOOK_CALLBACK_BASE_URL

    @classmethod
    def from_env(cls, env=os.environ) -> "GuardPolicy":
        origins: list[str] = []
        hosts = allowed_hosts_from_env(env)
        for origin in allowed_origins_from_env(env):
            name = _host_of_url(origin, "CHAT_ALLOWED_ORIGINS")
            if name:  # an item with no usable host would never match: dropped, never "everything"
                origins.append(origin)
                hosts.append(name)
        callback = (env.get("HOOK_CALLBACK_BASE_URL") or "").strip()
        if callback and (name := _host_of_url(callback, "HOOK_CALLBACK_BASE_URL")):
            hosts.append(name)
        return cls(tuple(origins), tuple(hosts))


def _header_values(scope: Scope, name: bytes) -> list[str]:
    # latin-1 never fails (neither does Starlette's decoding); only the NAME is compared in lower case.
    return [value.decode("latin-1") for key, value in scope.get("headers") or () if key.lower() == name]


def is_sandbox_file_request(scope: Scope) -> bool:
    """E1: `GET`/`HEAD` of a file the viewer or the artifacts serve to the sandboxed iframe."""
    return (
        scope["type"] == "http"
        and scope.get("method") in ("GET", "HEAD")
        and _SANDBOX_FILE_PATH.fullmatch(scope.get("path", "")) is not None
    )


def _sandbox_origin(origins: list[str], scope: Scope) -> bool:
    return len(origins) == 1 and origins[0] == "null" and is_sandbox_file_request(scope)


def scope_refusal(scope: Scope, policy: GuardPolicy) -> str | None:
    """The single decision for HTTP and WebSocket: the error code that refuses the request, or None."""
    hosts, origins = _header_values(scope, b"host"), _header_values(scope, b"origin")
    if len(hosts) > 1 or len(origins) > 1:
        return "duplicate_header"
    origin = None if _sandbox_origin(origins, scope) else (origins[0] if origins else None)
    return request_refusal(origin, hosts[0] if hosts else None, policy.origins, policy.hosts)


class RequestGuardMiddleware:
    """Pure ASGI (no `BaseHTTPMiddleware`: it breaks sockets and streamed files). `lifespan` passes through."""

    def __init__(self, app: ASGIApp, policy: GuardPolicy) -> None:
        self.app = app
        self.policy = policy

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        code = scope_refusal(scope, self.policy)
        if code is None:
            if _sandbox_origin(_header_values(scope, b"origin"), scope):
                send = _allow_opaque_origin(send)
            await self.app(scope, receive, send)
            return
        logger.warning("request refused (%s): %s %r", code, kind, scope.get("path", ""))
        if kind == "http":
            await _refuse_http(send, code)
        else:
            await _refuse_websocket(scope, receive, send, code)


def _allow_opaque_origin(send: Send) -> Send:
    """Adds `Access-Control-Allow-Origin: null` and `Vary: Origin` to every response, errors included."""

    async def send_with_cors(message: Message) -> None:
        if message["type"] == "http.response.start":
            headers = []
            vary = None
            for key, value in message.get("headers") or ():
                if key.lower() == b"vary":
                    vary = value if vary is None else vary + b", " + value
                else:
                    headers.append((key, value))
            if vary is None:
                vary = b"Origin"
            elif b"origin" not in vary.lower() and vary.strip() != b"*":
                vary += b", Origin"
            headers += [(b"access-control-allow-origin", b"null"), (b"vary", vary)]
            message = {**message, "headers": headers}
        await send(message)

    return send_with_cors


async def _refuse_http(send: Send, code: str) -> None:
    body = json.dumps({"detail": {"code": code, "message": code.replace("_", " ")}}, separators=(",", ":")).encode()
    await send({
        "type": "http.response.start", "status": 403,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})


async def _refuse_websocket(scope: Scope, receive: Receive, send: Send, code: str) -> None:
    """Accept, then close: the browser reads a close code only after the handshake, and a close before it
    would be a plain 1006 (a drop the V2 terminal retries). The app behind never runs."""
    if (await receive())["type"] != "websocket.connect":
        return
    await send({"type": "websocket.accept"})
    close_code = WS_CLOSE_ORIGIN if scope.get("path", "").startswith(CHAT_SOCKET_PREFIX) else WS_CLOSE_POLICY
    try:
        await send({"type": "websocket.close", "code": close_code, "reason": code})
    except Exception:  # noqa: BLE001 - the peer dropped during the handshake; the app still did not run
        logger.debug("refused websocket: the close frame could not be sent", exc_info=True)
