"""The part of a conversation that outlives its process: the event lock (`seq` order), the live
readers (fan-out with bounded queues) and `publish`, used by the runtime and by the service for
events that exist without a process (status, history import, reset).
"""
from __future__ import annotations

import asyncio
import time

from .store import ChatStore

MAX_READERS = 16
READER_QUEUE_SIZE = 1024
OVERFLOW = object()  # sentinel left in a reader's queue when it fell behind


class TooManyReaders(Exception):
    pass


class Reader:
    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=READER_QUEUE_SIZE)
        self.overflowed = False

    def offer(self, frame: dict) -> None:
        if self.overflowed:
            return  # the socket is about to close; the client will ask for the rest with `since`
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            # Too slow: drop the backlog and leave a marker; the socket closes with 4408
            # and the client reconnects with `since` (the log is the truth).
            self.overflowed = True
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(OVERFLOW)


class SessionHub:
    """Per `session_key`: the event lock, the readers and the one way to publish."""

    def __init__(self, session_key: str, store: ChatStore):
        self.session_key = session_key
        self.store = store
        self.event_lock = asyncio.Lock()
        self.readers: list[Reader] = []

    def frame(self, kind: str, payload: dict, seq: int | None, ts: float) -> dict:
        return {"type": kind, "session_key": self.session_key, "seq": seq, "ts": ts, **payload}

    def _fan_out(self, frame: dict) -> None:
        for reader in list(self.readers):
            reader.offer(frame)

    async def publish(self, kind: str, payload: dict) -> int:
        """Persist and fan out. Order of `seq` is the order of the lock. When the caller is
        cancelled with the commit already in flight the event still reaches the readers
        (the store runs the callback), so a durable event is never invisible live."""
        async with self.event_lock:
            seq, _ = await self.store.append_event(
                self.session_key, kind, payload,
                on_committed=lambda seq, ts: self._fan_out(self.frame(kind, payload, seq, ts)),
            )
        return seq

    def emit(self, kind: str, payload: dict) -> None:
        """Live only (`seq: null`): deltas, rate limits, state."""
        self._fan_out(self.frame(kind, payload, None, time.time()))

    async def add_reader(self) -> tuple[Reader, int]:
        """Register a reader and read the cutoff in ONE critical section, so no event falls
        between the replay (seq <= cutoff, from the database) and the live queue."""
        async with self.event_lock:
            if len(self.readers) >= MAX_READERS:
                raise TooManyReaders()
            reader = Reader()
            self.readers.append(reader)
            session = await self.store.get_chat_session(self.session_key)
            return reader, (session["last_seq"] if session else 0)

    def remove_reader(self, reader: Reader) -> None:
        if reader in self.readers:
            self.readers.remove(reader)
