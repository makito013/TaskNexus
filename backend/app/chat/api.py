"""REST `/api/chat/*` and WebSocket `/ws/chat/{session_key}` of the chat (contracts 3 and 4 of
the architecture). Thin: everything with a decision in it lives in `ChatService`.

Origin check (ADR-49): the backend has no auth and CORS `*`, and the chat approves tool
execution, so a page of another site open in the user's browser must not be able to send or
decide. A request with no `Origin` (a non-browser client) or with the same host:port as the
request, or listed in `CHAT_ALLOWED_ORIGINS`, passes; anything else is 403 / close 4403.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .runtime import OVERFLOW, ChatCommandError, TooManyReaders
from .service import ChatError, ChatService, public_detail

logger = logging.getLogger(__name__)

WS_REPLAY_PAGE = 500
WS_CLOSE_NORMAL = 1000
WS_CLOSE_ORIGIN = 4403
WS_CLOSE_NOT_FOUND = 4404
WS_CLOSE_SLOW_READER = 4408
WS_CLOSE_TOO_MANY = 4429


def allowed_origins_from_env(env=os.environ) -> list[str]:
    return [item.strip().rstrip("/") for item in (env.get("CHAT_ALLOWED_ORIGINS") or "").split(",") if item.strip()]


def origin_allowed(origin: str | None, host: str | None, extra: list[str]) -> bool:
    if not origin:
        return True
    if origin.rstrip("/") in extra:
        return True
    parsed = urlparse(origin)
    return bool(host) and parsed.netloc.lower() == host.lower()


def _http_error(exc: ChatError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message})


class CreateChatBody(BaseModel):
    project_ref: str
    agent_id: str
    model: str | None = None
    permission_mode: str | None = None
    first_message: str | None = None


class SwitchEngineBody(BaseModel):
    engine: Literal["chat", "pty"]
    confirm: bool = False


class DecideBody(BaseModel):
    behavior: Literal["allow", "deny"]
    scope: Literal["once", "session"] = "once"
    message: str | None = None
    interrupt: bool = False
    answers: dict | None = None


class AllowlistBody(BaseModel):
    allowlist: list[str]


def create_chat_router(service: ChatService, allowed_origins: list[str] | None = None) -> APIRouter:
    router = APIRouter()
    extra_origins = allowed_origins if allowed_origins is not None else allowed_origins_from_env()

    async def require_origin(request: Request) -> None:
        if not origin_allowed(request.headers.get("origin"), request.headers.get("host"), extra_origins):
            raise HTTPException(403, {"code": "origin_not_allowed", "message": "origin not allowed"})

    async def guarded(call):
        try:
            return await call
        except ChatError as exc:
            raise _http_error(exc) from exc

    # -- reads ----------------------------------------------------------------------------------------

    @router.get("/api/chat/health")
    async def chat_health():
        return await service.health()

    @router.get("/api/chat/sessions")
    async def list_chat_sessions(project_ref: str | None = None):
        return await service.list_sessions(project_ref)

    @router.get("/api/chat/sessions/{session_key:path}/events")
    async def chat_events(session_key: str, since: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=1000)):
        return await guarded(service.events(session_key, since, limit))

    @router.get("/api/chat/agents/{agent_id}/connectors")
    async def get_connectors(agent_id: str):
        return await guarded(service.get_connectors(agent_id))

    # -- writes (Origin checked) ----------------------------------------------------------------------

    @router.post("/api/chat/sessions", status_code=201, dependencies=[Depends(require_origin)])
    async def create_chat(body: CreateChatBody):
        return await guarded(service.create(
            body.project_ref, body.agent_id, body.model, body.permission_mode, body.first_message
        ))

    @router.post("/api/chat/sessions/{session_key:path}/open", dependencies=[Depends(require_origin)])
    async def open_chat(session_key: str):
        return await guarded(service.open(session_key))

    @router.post("/api/chat/sessions/{session_key:path}/close", dependencies=[Depends(require_origin)])
    async def close_chat(session_key: str):
        return await guarded(service.close(session_key))

    @router.post("/api/chat/sessions/{session_key:path}/switch-engine", dependencies=[Depends(require_origin)])
    async def switch_engine(session_key: str, body: SwitchEngineBody):
        return await guarded(service.switch_engine(session_key, body.engine, body.confirm))

    @router.post("/api/chat/permissions/{permission_id}/decide", dependencies=[Depends(require_origin)])
    async def decide_permission(permission_id: str, body: DecideBody):
        try:
            return await service.decide(
                permission_id, behavior=body.behavior, scope=body.scope, message=body.message,
                interrupt=body.interrupt, answers=body.answers, by="rest",
            )
        except ChatCommandError as exc:
            status = {"permission_not_found": 404, "already_decided": 409, "permission_expired": 410,
                      "scope_not_allowed": 422}.get(exc.code, 400)
            raise HTTPException(status, {"code": exc.code, "message": exc.message}) from exc

    @router.put("/api/chat/agents/{agent_id}/connectors", dependencies=[Depends(require_origin)])
    async def put_connectors(agent_id: str, body: AllowlistBody):
        return await guarded(service.put_connectors(agent_id, body.allowlist))

    @router.post("/api/chat/agents/{agent_id}/connectors/refresh", dependencies=[Depends(require_origin)])
    async def refresh_connectors(agent_id: str):
        return await guarded(service.refresh_connectors(agent_id))

    # -- the WebSocket ----------------------------------------------------------------------------------

    @router.websocket("/ws/chat/{session_key:path}")
    async def chat_socket(websocket: WebSocket, session_key: str):
        await websocket.accept()  # accepted first so the close codes below reach the browser
        if not origin_allowed(websocket.headers.get("origin"), websocket.headers.get("host"), extra_origins):
            await websocket.close(code=WS_CLOSE_ORIGIN)
            return
        try:
            since = max(0, int(websocket.query_params.get("since", "0")))
        except ValueError:
            since = 0
        try:
            reader, cutoff = await service.attach(session_key)
        except ChatError:
            await websocket.close(code=WS_CLOSE_NOT_FOUND)
            return
        except TooManyReaders:
            await websocket.close(code=WS_CLOSE_TOO_MANY)
            return

        write_lock = asyncio.Lock()
        hub = service.hub(session_key)
        commands: set[asyncio.Task] = set()

        async def send(frame: dict) -> None:
            async with write_lock:
                await websocket.send_text(json.dumps(frame, ensure_ascii=False, default=str))

        def direct(kind: str, **payload: Any) -> dict:
            return hub.frame(kind, payload, None, time.time())

        async def reject(request_id: Any, code: str, message: str = "") -> None:
            await send(direct("command.rejected", request_id=request_id, code=code, message=message or code))

        async def run_command(frame: dict) -> None:
            request_id = frame.get("request_id")
            kind = frame.get("type")
            try:
                if kind == "send":
                    if frame.get("attachments"):
                        raise ChatCommandError("attachments_unsupported", "attachments are not supported yet")
                    text = frame.get("text")
                    if not isinstance(text, str):
                        raise ChatCommandError("invalid_frame", "text must be a string")
                    await service.send(session_key, text, frame.get("client_msg_id"))
                elif kind == "permission.decide":
                    await service.decide(
                        str(frame.get("id", "")), behavior=frame.get("behavior", ""),
                        scope=frame.get("scope") or "once", message=frame.get("message"),
                        interrupt=bool(frame.get("interrupt")), answers=frame.get("answers"),
                        by="ws", session_key=session_key,
                    )
                elif kind == "interrupt":
                    await service.interrupt(session_key)
                elif kind == "set_model":
                    await service.set_model(session_key, str(frame.get("model", "")))
                elif kind == "set_permission_mode":
                    await service.set_permission_mode(session_key, str(frame.get("mode", "")))
                elif kind == "ack":
                    await service.ack(session_key)
                else:
                    raise ChatCommandError("invalid_frame", "unknown frame type")
            except ChatCommandError as exc:
                await reject(request_id, exc.code, exc.message)
            except ChatError as exc:
                if exc.code in ("spawn_failed", "resume_failed"):
                    return  # already published as a `status` event
                if exc.code == "engine_unavailable":
                    await send(direct("status", code="engine_unavailable", detail=exc.message))
                else:
                    await reject(request_id, exc.code, exc.message)
            except (WebSocketDisconnect, RuntimeError):
                return
            except Exception:  # noqa: BLE001 - one bad command must not drop the socket
                logger.exception("chat ws %s: command %s failed", session_key, kind)
                await reject(request_id, "invalid_frame", "the command could not be handled")

        async def pump_live() -> str:
            while True:
                frame = await reader.queue.get()
                if frame is OVERFLOW:
                    return "slow"
                if frame["seq"] is not None and frame["seq"] <= cutoff:
                    continue  # already sent by the replay
                await send(frame)

        async def receive() -> str:
            while True:
                try:
                    raw = await websocket.receive_text()
                except WebSocketDisconnect:
                    return "gone"
                try:
                    frame = json.loads(raw)
                except ValueError:
                    frame = None
                if not isinstance(frame, dict):
                    await reject(None, "invalid_frame", "frames are JSON objects")
                    continue
                task = asyncio.ensure_future(run_command(frame))
                commands.add(task)
                task.add_done_callback(commands.discard)

        close_code = WS_CLOSE_NORMAL
        try:
            await send(direct("session.state", **(await service.state_payload(session_key))))
            if not service.sdk_status().available:
                await send(direct("status", code="engine_unavailable",
                                  detail=public_detail(service.sdk_status().detail)))
            position = since
            while position < cutoff:
                events, _, has_more = await service.chat_store.events_since(session_key, position, WS_REPLAY_PAGE)
                for event in events:
                    if event["seq"] > cutoff:
                        has_more = False
                        break
                    await send(hub.frame(event["kind"], event["payload"], event["seq"], event["ts"]))
                    position = event["seq"]
                if not events or not has_more:
                    break
            await send(direct("replay.complete", last_seq=cutoff))
            live = asyncio.ensure_future(pump_live())
            incoming = asyncio.ensure_future(receive())
            done, pending = await asyncio.wait({live, incoming}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if live in done and live.result() == "slow":
                close_code = WS_CLOSE_SLOW_READER
        except (WebSocketDisconnect, RuntimeError):
            close_code = WS_CLOSE_NORMAL
        finally:
            service.detach(session_key, reader)
            try:
                await websocket.close(code=close_code)
            except Exception:  # noqa: BLE001 - already closed by the peer
                pass

    return router
