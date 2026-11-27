"""Read-only live feed of the files an agent opens in the viewer (`WS /ws/viewer`).

The V2 learns about an opened file through a text frame on the PTY socket of the session
(`main.notify_viewer_open`). A chat conversation has no PTY and the V3 shows conversations that are not
on screen, so it gets one shared socket instead: every file an agent opens is published here, with the
session key in the frame, and the V3 sorts out which conversation it belongs to.

* `ViewerFeed` keeps the readers in memory (no persistence, no replay: the tab is already stored, and the
  V3 reloads the tabs from the GET route each time the feed says `ready`).
* `ViewerFeed.publish` is synchronous and never raises: the caller has already stored the tab, so a slow
  or broken reader must not turn into an error for the agent. A reader whose queue is full is marked and
  closed with `WS_TOO_SLOW`; it reconnects and reloads.
* The route only writes. A frame from the client, text or binary, is read and dropped. It has no check of
  its own: `RequestGuardMiddleware` already refuses a hostile `Host` or `Origin` before any route runs.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

MAX_READERS = 32
QUEUE_SIZE = 64
WS_TOO_SLOW = 4408
WS_TOO_MANY = 4429
WS_NORMAL = 1000

_READY = json.dumps({"type": "ready"})


class _Reader:
    """One connected socket: a bounded queue of serialized frames and the event that wakes its writer."""

    def __init__(self) -> None:
        self.pending: deque[str] = deque()
        self.wake = asyncio.Event()
        self.overflowed = False


class ViewerFeed:
    def __init__(self) -> None:
        self._readers: set[_Reader] = set()

    @property
    def reader_count(self) -> int:
        return len(self._readers)

    def publish(self, frame: dict) -> int:
        """Queues `frame` for every reader and returns how many it reached. Never raises."""
        try:
            text = json.dumps(frame, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001 - a frame that cannot be serialized reaches nobody
            logger.exception("viewer feed: frame could not be serialized")
            return 0
        reached = 0
        for reader in list(self._readers):
            if reader.overflowed:
                continue
            if len(reader.pending) >= QUEUE_SIZE:
                reader.overflowed = True
            else:
                reader.pending.append(text)
                reached += 1
            reader.wake.set()
        return reached

    def attach(self) -> _Reader | None:
        """A new reader, or `None` when `MAX_READERS` are already connected."""
        if len(self._readers) >= MAX_READERS:
            return None
        reader = _Reader()
        self._readers.add(reader)
        return reader

    def detach(self, reader: _Reader) -> None:
        self._readers.discard(reader)


async def _pump(websocket: WebSocket, reader: _Reader) -> str:
    """Writes the queued frames in order; returns "slow" when the reader overflowed."""
    while True:
        await reader.wake.wait()
        reader.wake.clear()
        if reader.overflowed:
            return "slow"
        while reader.pending:
            await websocket.send_text(reader.pending.popleft())


async def _drain(websocket: WebSocket) -> None:
    """Reads and drops whatever the client sends until it disconnects."""
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return


def create_viewer_feed_router(feed: ViewerFeed) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws/viewer")
    async def viewer_feed_socket(websocket: WebSocket) -> None:
        await websocket.accept()  # accepted first so the close codes below reach the browser
        reader = feed.attach()
        if reader is None:
            await websocket.close(code=WS_TOO_MANY)
            return
        tasks: list[asyncio.Future[Any]] = []
        close_code = WS_NORMAL
        try:
            # Attached before `ready`: a frame published meanwhile waits in the queue behind it.
            await websocket.send_text(_READY)
            writer = asyncio.ensure_future(_pump(websocket, reader))
            incoming = asyncio.ensure_future(_drain(websocket))
            tasks = [writer, incoming]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if writer in done and writer.result() == "slow":
                close_code = WS_TOO_SLOW
        except (WebSocketDisconnect, RuntimeError):
            close_code = WS_NORMAL
        finally:
            feed.detach(reader)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            try:
                await websocket.close(code=close_code)
            except Exception:  # noqa: BLE001 - already closed by the peer
                pass

    return router
