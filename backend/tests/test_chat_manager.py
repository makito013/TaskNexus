"""ChatManager: capacity, idleness, approval TTL, shutdown, boot reconciliation."""
from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio

from app.chat.engine import SpawnFailed
from app.chat.manager import ChatManager, ClosedWhileStarting
from app.chat.runtime import ChatRuntime, SessionHub
from app.chat.store import ChatStore
from tests.chat_fakes import FakeChatEngine, Rig

pytestmark = pytest.mark.asyncio


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def _runtime(rig_store: ChatStore, key: str, engine: FakeChatEngine, clock: Clock) -> ChatRuntime:
    from app.chat.engine import ChatSpec
    from tests.chat_fakes import SESSION_UUID

    await rig_store.create_chat_session({"session_key": key, "project_ref": "p", "agent_id": "claude", "cwd": "C:/x"})
    runtime = ChatRuntime(
        session_key=key, hub=SessionHub(key, rig_store), engine=engine,
        spec=ChatSpec(cli_path="C:/c.exe", cwd="C:/x", session_id=SESSION_UUID, connect_timeout=1.0),
        hooks=Rig("x").hooks(), resumed=False, clock=clock,
    )
    await runtime.start()
    return runtime


@pytest_asyncio.fixture
async def world(tmp_path):
    store = ChatStore(db_path=str(tmp_path / "chat.db"))
    await store.initialize()
    clock = Clock()
    manager = ChatManager(max_processes=2, idle_timeout=100, pending_ttl=500, clock=clock)
    engine = FakeChatEngine()
    yield store, manager, engine, clock
    await manager.shutdown(timeout=3)
    await store.close()


async def _spawn(world, key):
    store, manager, engine, clock = world
    runtime = await manager.get_or_spawn(key, lambda: _runtime(store, key, engine, clock))
    manager._runtimes[key] = runtime
    return runtime


async def test_get_or_spawn_reuses_the_live_runtime(world):
    first = await _spawn(world, "a")
    again = await world[1].get_or_spawn("a", lambda: pytest.fail("must not spawn twice"))

    assert again is first and world[2].spawns == 1


async def test_at_capacity_the_least_recent_idle_runtime_is_closed_to_make_room(world):
    store, manager, engine, clock = world
    a = await _spawn(world, "a")
    clock.now += 10
    b = await _spawn(world, "b")
    clock.now += 10
    a.last_activity, b.last_activity = 1000.0, 1010.0

    c = await _spawn(world, "c")

    assert a.alive is False and b.alive is True and c.alive is True
    assert set(manager.active()) == {"b", "c"}


async def test_at_capacity_with_nothing_idle_the_spawn_is_refused_and_nobody_is_killed(world):
    store, manager, engine, clock = world
    a = await _spawn(world, "a")
    b = await _spawn(world, "b")
    a.turn_running = True
    reader, _ = await b.hub.add_reader()  # somebody is watching b: not idle

    with pytest.raises(SpawnFailed) as refused:
        await _spawn(world, "c")

    assert refused.value.reason == "capacity_exceeded" and a.alive and b.alive
    b.hub.remove_reader(reader)


async def test_sweep_closes_what_has_been_idle_too_long_and_only_that(world):
    store, manager, engine, clock = world
    old = await _spawn(world, "old")
    clock.now += 50
    fresh = await _spawn(world, "fresh")
    clock.now += 60  # old: 110 s idle (> 100); fresh: 60 s

    await manager.sweep()

    assert old.alive is False and fresh.alive is True
    assert (await store.events_since("old", 0, 10))[0][-1]["payload"] == {"code": "closed", "reason": "idle"}


async def test_a_busy_runtime_is_not_swept_even_if_quiet(world):
    store, manager, engine, clock = world
    runtime = await _spawn(world, "a")
    runtime.turn_running = True
    clock.now += 10_000

    await manager.sweep()

    assert runtime.alive


async def test_a_pending_approval_older_than_the_ttl_is_expired_and_the_process_closed(world):
    store, manager, engine, clock = world
    runtime = await _spawn(world, "a")
    waiting = engine.last.ask_permission("Write", {})
    for _ in range(100):
        if runtime.pending:
            break
        await asyncio.sleep(0.01)
    pid = next(iter(runtime.pending))
    clock.now += 600  # > pending_ttl of 500

    await manager.sweep()
    decision = await asyncio.wait_for(waiting, 2)

    assert runtime.alive is False and (await store.get_permission(pid))["status"] == "expired"
    assert decision.behavior == "deny"


async def test_shutdown_closes_everything_and_stops_the_sweeper(world):
    store, manager, engine, clock = world
    a = await _spawn(world, "a")
    b = await _spawn(world, "b")
    manager.start_sweeper(interval=0.01)

    await manager.shutdown(timeout=3)

    assert not a.alive and not b.alive and manager.active() == {}
    assert all(p.closed for p in engine.processes)


async def test_reconcile_on_boot_stops_live_looking_sessions_and_expires_their_approvals(tmp_path):
    store = ChatStore(db_path=str(tmp_path / "chat.db"))
    await store.initialize()
    for key, status, pid in (("run", "running", 4242), ("idle", "idle", None), ("done", "stopped", None),
                             ("sw", "switched_to_pty", None)):
        await store.create_chat_session({"session_key": key, "project_ref": "p", "agent_id": "a", "cwd": "x",
                                         "status": status, "runtime_owner_pid": pid})
    await store.create_permission({"id": "p1", "session_key": "run", "kind": "tool", "tool_name": "Write"})

    result = await ChatManager.reconcile_on_boot(store)

    assert result == {"stopped": 2, "expired": 1}
    sessions = {s["session_key"]: s for s in await store.list_chat_sessions()}
    assert sessions["run"]["status"] == "stopped" and sessions["run"]["runtime_owner_pid"] is None
    assert sessions["idle"]["status"] == "stopped"
    assert sessions["sw"]["status"] == "switched_to_pty"
    assert (await store.get_permission("p1"))["status"] == "expired"
    resolved = (await store.events_since("run", 0, 10))[0][-1]
    assert resolved["kind"] == "permission.resolved" and resolved["payload"]["status"] == "expired"
    await store.close()


# -- the reservation of a runtime that is still coming up (B9) ---------------------------------------------


async def _starter(world, key):
    store, manager, engine, clock = world
    return await manager.get_or_spawn(key, lambda: _runtime(store, key, engine, clock))


async def test_a_close_during_the_connect_waits_for_it_and_leaves_nothing_alive(world):
    _, manager, engine, _ = world
    engine.gate = asyncio.Event()
    start = asyncio.ensure_future(_starter(world, "a"))
    await asyncio.sleep(0.05)
    closing = asyncio.ensure_future(manager.close("a", "terminated"))
    await asyncio.sleep(0.05)
    assert not closing.done()  # it waits for the start instead of finding nothing

    engine.gate.set()
    await closing
    with pytest.raises(ClosedWhileStarting):
        await start

    assert manager.get("a") is None and "a" not in manager._runtimes and manager._starting == {}
    assert engine.processes and all(process.closed for process in engine.processes)


async def test_simultaneous_starts_never_exceed_the_limit(world):
    store, manager, engine, clock = world  # max_processes = 2
    engine.gate = asyncio.Event()
    starts = [asyncio.ensure_future(_starter(world, key)) for key in "abcde"]
    await asyncio.sleep(0.1)
    engine.gate.set()
    results = await asyncio.gather(*starts, return_exceptions=True)

    started = [r for r in results if isinstance(r, ChatRuntime)]
    refused = [r for r in results if isinstance(r, SpawnFailed)]
    assert len(started) == 2 and len(refused) == 3
    assert {r.reason for r in refused} == {"capacity_exceeded"}
    assert len(manager.active()) == 2 and len([p for p in engine.processes if not p.closed]) == 2


async def test_a_start_that_fails_frees_its_reservation(world):
    _, manager, engine, _ = world
    engine.fail_with = SpawnFailed("process_error", "boom")

    with pytest.raises(SpawnFailed):
        await _starter(world, "a")

    assert manager._starting == {}
    engine.fail_with = None
    assert (await _starter(world, "b")).alive


async def test_shutdown_never_raises_even_when_a_runtime_will_not_close(world):
    _, manager, _, _ = world
    runtime = await _spawn(world, "a")

    async def stuck(reason, timeout=15.0):
        raise asyncio.TimeoutError()

    real_close = runtime.close
    runtime.close = stuck
    await manager.shutdown(timeout=1)

    assert manager._runtimes == {}
    await real_close("shutdown")
