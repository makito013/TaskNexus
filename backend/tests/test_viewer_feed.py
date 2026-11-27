"""The live feed of the viewer (`app.viewer_feed`) and the way `ViewerService` and `main` feed it: queues and
limits, the route driven by a fake socket, the two independent awaits of `open_path` (K1) and the copy that
`announce_viewer_open` publishes. No real server: the sockets of the real app are in test_viewer_feed_ws.py."""
from __future__ import annotations

import asyncio
import importlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import APIRouter
from starlette.websockets import WebSocketDisconnect

from app import viewer_feed
from app.viewer_api import ViewerService
from app.viewer_feed import (
    MAX_READERS,
    QUEUE_SIZE,
    WS_TOO_MANY,
    WS_TOO_SLOW,
    ViewerFeed,
    create_viewer_feed_router,
)


def frame(n: int = 0, **extra) -> dict:
    return {"type": "viewer_open", "session_key": "p::claude::abc", "item": {"item_id": f"i{n}"}, **extra}


# -- the feed ---------------------------------------------------------------------------------------------


def test_publish_without_readers_reaches_nobody_and_does_not_raise():
    feed = ViewerFeed()

    assert feed.publish(frame()) == 0
    assert feed.reader_count == 0


def test_publish_reaches_every_reader_in_order():
    feed = ViewerFeed()
    first, second = feed.attach(), feed.attach()

    assert feed.publish(frame(1)) == 2
    assert feed.publish(frame(2)) == 2

    for reader in (first, second):
        assert [json.loads(text)["item"]["item_id"] for text in reader.pending] == ["i1", "i2"]


def test_the_33rd_reader_is_refused_and_a_freed_slot_is_reusable():
    feed = ViewerFeed()
    readers = [feed.attach() for _ in range(MAX_READERS)]

    assert all(reader is not None for reader in readers)
    assert feed.reader_count == MAX_READERS
    assert feed.attach() is None
    assert feed.reader_count == MAX_READERS

    feed.detach(readers[0])
    assert feed.attach() is not None


def test_a_full_queue_marks_the_reader_and_the_others_keep_receiving():
    feed = ViewerFeed()
    slow, fast = feed.attach(), feed.attach()

    for n in range(QUEUE_SIZE):
        assert feed.publish(frame(n)) == 2
        fast.pending.clear()  # the fast reader keeps up
    assert slow.overflowed is False

    assert feed.publish(frame(QUEUE_SIZE)) == 1  # only the fast one is reached by the overflowing frame
    assert slow.overflowed is True
    assert len(slow.pending) == QUEUE_SIZE
    assert feed.publish(frame(QUEUE_SIZE + 1)) == 1  # a marked reader is skipped, not counted
    assert len(fast.pending) == 2


def test_a_marked_reader_gets_nothing_more_even_when_its_writer_drains_a_frame_meanwhile():
    feed = ViewerFeed()
    slow = feed.attach()
    for n in range(QUEUE_SIZE + 1):
        feed.publish(frame(n))
    assert slow.overflowed is True

    slow.pending.popleft()  # the writer was mid-drain when the flag went up: there is room again

    assert feed.publish(frame(99)) == 0
    assert len(slow.pending) == QUEUE_SIZE - 1


def test_a_frame_that_cannot_be_serialized_reaches_nobody_and_does_not_raise():
    feed = ViewerFeed()
    reader = feed.attach()
    loop = {}
    loop["self"] = loop

    assert feed.publish(loop) == 0
    assert list(reader.pending) == []


def test_publish_never_touches_the_dict_it_receives():
    feed = ViewerFeed()
    feed.attach()
    original = frame(1)
    snapshot = json.loads(json.dumps(original))

    feed.publish(original)

    assert original == snapshot


# -- the route, driven by a fake socket -------------------------------------------------------------------


class FakeSocket:
    """The part of `WebSocket` the route uses. `incoming` is a queue of raw ASGI messages for `receive()`."""

    def __init__(self):
        self.sent: list[str] = []
        self.closed_with: int | None = None
        self.accepted = False
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.fail_send_after: int | None = None

    async def accept(self):
        self.accepted = True

    async def send_text(self, text):
        if self.fail_send_after is not None and len(self.sent) >= self.fail_send_after:
            raise WebSocketDisconnect(1001)
        self.sent.append(text)

    async def receive(self):
        return await self.incoming.get()

    async def close(self, code=1000):
        self.closed_with = code


def handler_of(feed: ViewerFeed):
    router = create_viewer_feed_router(feed)
    assert isinstance(router, APIRouter)
    (route,) = [r for r in router.routes if getattr(r, "path", "") == "/ws/viewer"]
    return route.endpoint


async def settle(predicate, timeout=2.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not reached in time")


async def finished(run, timeout=3.0):
    """Waits for the handler; a handler that never returns (a task it should have cancelled) is a failure, not a hang."""
    await asyncio.wait_for(run, timeout)


def only_this_task_is_left():
    return asyncio.all_tasks() == {asyncio.current_task()}


def test_the_route_sends_ready_first_then_the_frames_in_order():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)
        assert feed.publish(frame(1)) == 1
        assert feed.publish(frame(2)) == 1
        await settle(lambda: len(socket.sent) == 3)

        assert socket.accepted is True
        assert json.loads(socket.sent[0]) == {"type": "ready"}
        assert [json.loads(text)["item"]["item_id"] for text in socket.sent[1:]] == ["i1", "i2"]
        socket.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await finished(run)

    asyncio.run(scenario())


def test_ready_is_queued_before_a_frame_published_while_it_is_being_sent():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        original = socket.send_text

        async def publish_during_ready(text):
            if not socket.sent:
                feed.publish(frame(1))  # published after the reader is attached, before `ready` is out
            await original(text)

        socket.send_text = publish_during_ready
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: len(socket.sent) == 2)

        assert json.loads(socket.sent[0]) == {"type": "ready"}
        assert json.loads(socket.sent[1])["item"]["item_id"] == "i1"
        socket.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await finished(run)

    asyncio.run(scenario())


def test_the_33rd_socket_is_accepted_and_closed_with_4429():
    async def scenario():
        feed = ViewerFeed()
        for _ in range(MAX_READERS):
            assert feed.attach() is not None
        socket = FakeSocket()

        await handler_of(feed)(socket)

        assert socket.accepted is True
        assert socket.closed_with == WS_TOO_MANY == 4429
        assert socket.sent == []
        assert feed.reader_count == MAX_READERS

    asyncio.run(scenario())


def test_a_reader_that_overflows_is_closed_with_4408_and_detached():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        gate = asyncio.Event()
        original = socket.send_text

        async def blocked(text):
            await gate.wait()  # a client that stopped reading
            await original(text)

        socket.send_text = blocked
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)
        for n in range(QUEUE_SIZE + 2):
            feed.publish(frame(n))
        gate.set()
        await finished(run)

        assert socket.closed_with == WS_TOO_SLOW == 4408
        assert feed.reader_count == 0
        assert only_this_task_is_left()

    asyncio.run(scenario())


def test_what_the_client_sends_is_ignored_text_binary_or_garbage():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)
        for message in (
            {"type": "websocket.receive", "text": '{"type": "viewer_open"}'},
            {"type": "websocket.receive", "bytes": b"\x00\x01"},
            {"type": "websocket.receive", "text": "not json"},
        ):
            socket.incoming.put_nowait(message)
        await asyncio.sleep(0.05)

        assert feed.reader_count == 1 and not run.done()
        assert socket.sent == [json.dumps({"type": "ready"})]
        assert feed.publish(frame(1)) == 1
        await settle(lambda: len(socket.sent) == 2)
        socket.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await finished(run)

    asyncio.run(scenario())


def test_leaving_removes_the_reader_and_leaves_no_task_behind():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)

        socket.incoming.put_nowait({"type": "websocket.disconnect", "code": 1001})
        await finished(run)

        assert feed.reader_count == 0
        assert only_this_task_is_left()

    asyncio.run(scenario())


def test_a_send_that_fails_removes_the_reader_and_leaves_no_task_behind():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        socket.fail_send_after = 1  # `ready` goes out, the next frame does not
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)
        feed.publish(frame(1))
        await finished(run)

        assert feed.reader_count == 0
        assert only_this_task_is_left()

    asyncio.run(scenario())


def test_cancelling_the_handler_as_a_shutdown_does_removes_the_reader_and_every_task():
    async def scenario():
        feed, socket = ViewerFeed(), FakeSocket()
        run = asyncio.ensure_future(handler_of(feed)(socket))
        await settle(lambda: feed.reader_count == 1)

        run.cancel()
        with pytest.raises(asyncio.CancelledError):
            await finished(run)

        assert feed.reader_count == 0
        assert only_this_task_is_left()

    asyncio.run(scenario())


# -- ViewerService: the two awaits of open_path (K1) ------------------------------------------------------


@pytest.fixture
def service_parts(tmp_path):
    """A `ViewerService` over a real project folder with a fake store, so only the announce logic is in play."""
    (tmp_path / "proj" / "docs").mkdir(parents=True)
    (tmp_path / "proj" / "docs" / "plan.md").write_text("# Plan\n", encoding="utf-8")
    item = {"item_id": "i1", "session_key": "proj::claude::abc", "path": "docs/plan.md", "opened_by": "agent"}
    store = SimpleNamespace(open_item=AsyncMock(return_value=(item, False, ["old"])))

    def build(notify=None, announce=None):
        return ViewerService(
            store=store,
            find_project_path=lambda project_id: str(tmp_path / project_id),
            get_projects_root=lambda: str(tmp_path),
            session_key_for_claude_id=AsyncMock(return_value=None),
            notify=notify,
            announce=announce,
        )

    return build, item


def open_path(service, opened_by="agent"):
    return asyncio.run(service.open_path("proj::claude::abc", "docs/plan.md", opened_by=opened_by))


def test_announce_runs_even_when_notify_already_delivered_and_after_it(service_parts):
    build, item = service_parts
    calls: list[str] = []

    async def notify(*args):
        calls.append("notify")
        return True

    async def announce(*args):
        calls.append("announce")
        return False

    result = open_path(build(notify, announce))

    assert calls == ["notify", "announce"]
    assert result["delivered"] is True


def test_delivered_is_the_or_of_both_in_every_combination(service_parts):
    build, _ = service_parts
    for notified in (True, False):
        for announced in (True, False):
            result = open_path(build(AsyncMock(return_value=notified), AsyncMock(return_value=announced)))
            assert result["delivered"] is (notified or announced), (notified, announced)


def test_announce_receives_the_item_the_flags_and_the_opened_by_of_the_call(service_parts):
    build, item = service_parts
    announce = AsyncMock(return_value=False)

    open_path(build(None, announce), opened_by="user")

    announce.assert_awaited_once_with("proj::claude::abc", item, False, ["old"], "user")


def test_an_announce_that_raises_is_false_and_the_open_still_succeeds(service_parts):
    build, item = service_parts

    result = open_path(build(AsyncMock(return_value=True), AsyncMock(side_effect=RuntimeError("boom"))))
    assert result["success"] is True and result["item"] == item and result["delivered"] is True

    result = open_path(build(AsyncMock(return_value=False), AsyncMock(side_effect=RuntimeError("boom"))))
    assert result["success"] is True and result["delivered"] is False


def test_without_announce_delivered_is_what_notify_said(service_parts):
    build, _ = service_parts

    assert open_path(build(AsyncMock(return_value=True)))["delivered"] is True
    assert open_path(build(AsyncMock(return_value=False)))["delivered"] is False
    assert open_path(build())["delivered"] is False


# -- main.announce_viewer_open ----------------------------------------------------------------------------


@pytest.fixture
def main_mod(tmp_path):
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path), "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"), "BOARD_UPLOADS_ROOT": str(tmp_path / "uploads"),
        "BOARD_ATTACHMENTS_ROOT": str(tmp_path / "attachments"), "CLEANUP_DELAY": "0.1",
    }):
        import app.main as module

        yield importlib.reload(module)


def announce(main_mod, engine, item=None, opened_by="agent", reused=False, evicted=None):
    item = item if item is not None else {"item_id": "i1", "path": "docs/plan.md", "opened_by": "user"}
    main_mod.store = SimpleNamespace(get_engine=AsyncMock(return_value=engine) if not isinstance(engine, Exception)
                                     else AsyncMock(side_effect=engine))
    return asyncio.run(main_mod.announce_viewer_open("p::claude::abc", item, reused, evicted, opened_by))


def test_the_published_frame_carries_a_copy_of_the_item_marked_as_the_agent(main_mod):
    reader = main_mod.viewer_feed.attach()
    item = {"item_id": "i1", "path": "docs/plan.md", "opened_by": "user"}

    assert announce(main_mod, "chat", item=item, reused=True, evicted=["old"]) is True

    assert json.loads(reader.pending[0]) == {
        "type": "viewer_open",
        "session_key": "p::claude::abc",
        "item": {"item_id": "i1", "path": "docs/plan.md", "opened_by": "agent"},
        "reused": True,
        "evicted": ["old"],
    }
    assert item["opened_by"] == "user"  # the stored item is not mutated


def test_a_user_opening_publishes_nothing_and_is_not_delivered(main_mod):
    reader = main_mod.viewer_feed.attach()

    assert announce(main_mod, "chat", opened_by="user") is False
    assert list(reader.pending) == []


def test_delivered_is_true_only_for_a_chat_conversation_with_a_reader(main_mod):
    assert announce(main_mod, "chat") is False  # no reader: nobody was reached

    reader = main_mod.viewer_feed.attach()
    assert announce(main_mod, "pty") is False  # the PTY's `delivered` stays what notify_viewer_open said
    assert announce(main_mod, None) is False  # a key with no row
    assert len(reader.pending) == 2  # but the frame went out for both
    assert announce(main_mod, "chat") is True


def test_a_failing_engine_lookup_is_false_but_the_frame_is_already_out(main_mod):
    reader = main_mod.viewer_feed.attach()

    assert announce(main_mod, RuntimeError("db closed")) is False
    assert len(reader.pending) == 1


def test_the_module_exposes_the_documented_constants():
    assert (viewer_feed.MAX_READERS, viewer_feed.QUEUE_SIZE) == (32, 64)
    assert (viewer_feed.WS_TOO_SLOW, viewer_feed.WS_TOO_MANY) == (4408, 4429)
