"""Contract with the REAL `claude` binary and SDK (opt-in: `CHAT_SDK_CONTRACT=1`, ambiente limpo).

Run it after every update of the CLI: the connector mechanisms come from strings of the
binary, not from a published contract (ADR-43). Uses `haiku`, new sessions only, and a scratch
cwd under `C:/tmp/tn-v3-t2/folders/contract` (never a folder of the user).

    env -u HOOK_LOOPBACK_PORT <-u CLAUDE* ...> CHAT_SDK_CONTRACT=1 \\
        python -m pytest -q tests/test_chat_sdk_contract.py
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(os.getenv("CHAT_SDK_CONTRACT") != "1", reason="set CHAT_SDK_CONTRACT=1 to run"),
    pytest.mark.asyncio,
]
sdk = pytest.importorskip("claude_agent_sdk")

from app.chat import connectors  # noqa: E402
from app.chat.availability import CliResolver  # noqa: E402
from app.chat.engine import ChatSpec, ConnectorPolicy, EngineCallbacks, ResumeFailed, SpawnFailed  # noqa: E402
from app.chat.sdk_engine import AgentSdkEngine, SdkTranslator  # noqa: E402
from tests.chat_fakes import KEY, Rig  # noqa: E402

SCRATCH = Path("C:/tmp/tn-v3-t2")
CWD = SCRATCH / "folders" / "contract"
OUT_DIR = SCRATCH / "qa"
SESSIONS_LOG = SCRATCH / "qa-sessions.txt"
HOME = Path(os.path.expanduser("~"))


@pytest.fixture(scope="module")
def cli():
    info = CliResolver().resolve()
    assert info.ok, f"no usable claude binary: {info.reason} {info.detail}"
    return info


@pytest.fixture(autouse=True)
def scratch():
    CWD.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("contract-out.txt", "contract-out2.txt", "contract-out3.txt", "contract-out4.txt"):
        (OUT_DIR / name).unlink(missing_ok=True)
        (CWD / name).unlink(missing_ok=True)


def _settings_hashes() -> dict[str, str]:
    paths = sorted(HOME.glob(".claude/settings*.json")) + sorted((CWD / ".claude").glob("settings*.json"))
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def _note(session_id: str | None) -> None:
    if session_id:
        with SESSIONS_LOG.open("a", encoding="utf-8") as log:
            log.write(f"contract\t{session_id}\t{CWD}\n")


async def _turn(rig: Rig, runtime, text: str, timeout: float = 120.0) -> None:
    before = len(await rig.events("turn.ended"))
    await runtime.submit("send", text=text)
    await rig.wait_for_async(lambda: _count(rig, "turn.ended", before), timeout)


async def _count(rig: Rig, kind: str, before: int) -> bool:
    return len(await rig.events(kind)) > before


def _rig(tmp_path, cli, **spec) -> Rig:
    # A new session id every time: the CLI refuses to reuse one that already has a transcript.
    rig = Rig(tmp_path / "chat.db", **{"cli_path": cli.path, "cwd": str(CWD), "model": "haiku",
                                       "connect_timeout": 60.0, "session_id": str(uuid.uuid4()), **spec})
    rig.engine = AgentSdkEngine()
    return rig


async def _wait_async(self, predicate, timeout):
    deadline = asyncio.get_running_loop().time() + timeout
    while not await predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached in time")
        await asyncio.sleep(0.25)


Rig.wait_for_async = _wait_async


async def test_a_real_conversation_with_the_connectors_off_by_default(tmp_path, cli):
    """CA16b. The status right after `connect()` can be empty for timing reasons, so it proves
    little; the real evidence is what the model is given (`init.tools`) and the status AFTER
    the turn. The nets behind it are the PreToolUse deny and the init-tools audit."""
    seen_tools: list[list[str]] = []
    original = SdkTranslator._SystemMessage

    def spy(self, message):
        translated = original(self, message)
        seen_tools.extend(list(item.data["tools"]) for item in translated if item.kind == "init")
        return translated

    SdkTranslator._SystemMessage = spy
    try:
        async with _rig(tmp_path, cli) as rig:
            runtime = await rig.start()
            await _turn(rig, runtime, "Reply with exactly: OK")
            status_after = await runtime.process.get_mcp_status()
            started = (await rig.events("session.started"))[0]["payload"]
            _note(started["claude_session_id"])
    finally:
        SdkTranslator._SystemMessage = original

    assert started["api_key_source"] == "none"
    assert started["claude_code_version"] == cli.version
    assert seen_tools and "Read" in seen_tools[-1]
    assert not [t for t in seen_tools[-1] if t.startswith("mcp__claude_ai_")]
    assert [s for s in status_after.get("mcpServers", []) if connectors.is_claudeai(s)] == []
    assert all(s["scope"] != "claudeai" for s in started["mcp_servers"])


async def test_a_write_asks_denial_blocks_it_and_allow_for_the_conversation_touches_no_settings(tmp_path, cli):
    before = _settings_hashes()
    # Inside the session folder: "allow for the conversation" no longer covers a path outside the
    # project folders (Decision 2 of 2026-11-10), which the last test of this file proves.
    target, target2 = CWD / "contract-out.txt", CWD / "contract-out2.txt"
    target3, target4 = CWD / "contract-out3.txt", CWD / "contract-out4.txt"
    async with _rig(tmp_path, cli) as rig:
        runtime = await rig.start()
        await runtime.submit("send", text=f"Use the Write tool to create {target.as_posix()} with the text ok.")
        await rig.wait_for_async(lambda: _has(rig, "permission.request"), 120)
        request = (await rig.events("permission.request"))[0]["payload"]
        await runtime.decide(request["id"], behavior="deny", message="not now", by="rest")
        await rig.wait_for_async(lambda: _count(rig, "turn.ended", 0), 120)
        assert not target.exists()

        await runtime.submit("send", text=f"Now use the Write tool to create {target2.as_posix()} with the text ok.")
        await rig.wait_for_async(lambda: _count(rig, "permission.request", 1), 120)
        second = (await rig.events("permission.request"))[-1]["payload"]
        await runtime.decide(second["id"], behavior="allow", scope="session", by="rest")
        await rig.wait_for_async(lambda: _count(rig, "turn.ended", 1), 120)
        claude_session_id = (await rig.events("session.started"))[0]["payload"]["claude_session_id"]
        _note(claude_session_id)

        # CA06: after "allow for this conversation" the same tool runs again WITHOUT a card.
        asks_before = len(await rig.events("permission.request"))
        await runtime.submit("send", text=f"Now use the Write tool to create {target3.as_posix()} with the text ok.")
        await rig.wait_for_async(lambda: _count(rig, "turn.ended", 2), 120)
        asks_after_rule = len(await rig.events("permission.request"))
        third_exists = target3.exists()
        hashes_after_rule = _settings_hashes()
        await runtime.close("terminated")

    assert request["tool_name"] == "Write" and request["kind"] == "tool"
    assert target2.exists()
    assert _settings_hashes() == before
    assert third_exists and asks_after_rule == asks_before, "the session rule was not honoured by the CLI"
    assert hashes_after_rule == before  # CA06a: still nothing written to any settings file

    # CA06a: the rule lives in the session only; after close/open the tool asks again.
    (tmp_path / "reopened").mkdir()
    async with _rig(tmp_path / "reopened", cli, session_id=None) as reopened:
        reopened.resume = claude_session_id
        runtime = await reopened.start()
        await runtime.submit("send", text=f"Now use the Write tool to create {target4.as_posix()} with the text ok.")
        await reopened.wait_for_async(lambda: _has(reopened, "permission.request"), 120)
        again = (await reopened.events("permission.request"))[0]["payload"]
        await runtime.decide(again["id"], behavior="deny", by="rest")
        await reopened.wait_for_async(lambda: _count(reopened, "turn.ended", 0), 120)

    assert again["tool_name"] == "Write"
    assert not target4.exists()
    assert _settings_hashes() == before


async def _has(rig: Rig, kind: str) -> bool:
    return bool(await rig.events(kind))


async def test_set_model_is_applied_by_the_running_process(tmp_path, cli):
    """Observed on 2.1.317: `set_model` answers at once with a notice, and the next turn's `init`
    carries the new model (`model.changed`), with no extra turn of its own."""
    async with _rig(tmp_path, cli) as rig:
        runtime = await rig.start()
        await _turn(rig, runtime, "Reply with exactly: OK")
        await runtime.submit("set_model", model="sonnet")
        await rig.wait_for_async(lambda: _has(rig, "system.notice"), 30)
        await _turn(rig, runtime, "Reply with exactly: OK2")
        changed = (await rig.events("model.changed"))[0]["payload"]

    assert "sonnet" in changed["model"]


async def test_the_connector_prefixes_and_the_disallowed_tools_mechanism_hold_on_this_binary(tmp_path, cli):
    """O11: discovery sees the five connectors; a partial allowlist loads only the allowed one's
    tools (the other connectors are blocked with `disallowed_tools`, never toggled)."""
    seen_tools: list[list[str]] = []
    original = SdkTranslator._SystemMessage

    def spy(self, message):
        translated = original(self, message)
        for item in translated:
            if item.kind == "init":
                seen_tools.append(list(item.data["tools"]))
        return translated

    SdkTranslator._SystemMessage = spy
    try:
        probe_dir = tmp_path / "probe"
        probe_dir.mkdir()
        found = await connectors.probe(AgentSdkEngine(), ChatSpec(
            cli_path=cli.path, cwd=str(probe_dir), connector_policy=ConnectorPolicy(probe=True)))
        names = {c["name"]: c["tool_prefix"] for c in found}
        assert {"claude.ai Claude Docs", "claude.ai podesubir-staging", "claude.ai Atlassian Rovo"} <= set(names)
        assert names["claude.ai podesubir-staging"] == "mcp__claude_ai_podesubir-staging__"
        assert names["claude.ai Atlassian Rovo"] == "mcp__claude_ai_Atlassian_Rovo__"

        policy = ConnectorPolicy(allowed=("claude.ai Claude Docs",), known=tuple(found))
        async with _rig(tmp_path, cli, connector_policy=policy) as rig:
            runtime = await rig.start()
            await _turn(rig, runtime, "Reply with exactly: OK")
            statuses = [e["payload"] for e in await rig.events("status")]
    finally:
        SdkTranslator._SystemMessage = original

    tools = seen_tools[-1]
    assert any(t.startswith("mcp__claude_ai_Claude_Docs__") for t in tools)
    assert not any(t.startswith("mcp__claude_ai_") and not t.startswith("mcp__claude_ai_Claude_Docs__") for t in tools)
    assert all(s.get("reason") != "connector_exposed" for s in statuses)


async def _no_tool(*args):
    raise AssertionError("must not be called")


async def _no_stop(payload):
    return None


async def test_a_resume_value_that_looks_like_a_flag_never_launches_the_binary(tmp_path, cli):
    spec = ChatSpec(cli_path=cli.path, cwd=str(CWD), resume="--mcp-config=" + '{"mcpServers":{}}')

    with pytest.raises(ResumeFailed):
        await AgentSdkEngine().spawn(spec, EngineCallbacks(can_use_tool=_no_tool, on_stop=_no_stop))


async def test_a_bash_card_arrives_without_allow_for_the_conversation(tmp_path, cli):
    """The CLI ignores a session rule with `ruleContent`, so the card for Bash must not offer it."""
    target = OUT_DIR / "contract-bash.txt"
    target.unlink(missing_ok=True)
    async with _rig(tmp_path, cli) as rig:
        runtime = await rig.start()
        await runtime.submit(
            "send", text=f"Use only the Bash tool, once, with exactly this command: touch {target.as_posix()}")
        await rig.wait_for_async(lambda: _has(rig, "permission.request"), 120)
        request = (await rig.events("permission.request"))[0]["payload"]
        await runtime.decide(request["id"], behavior="deny", by="rest")
        await rig.wait_for_async(lambda: _count(rig, "turn.ended", 0), 120)
        _note((await rig.events("session.started"))[0]["payload"]["claude_session_id"])
        await runtime.close("terminated")

    assert request["tool_name"] == "Bash" and request["allow_session"] is False
    assert not target.exists()


# -- rework of the 1b review: proofs with the real binary ---------------------------------------------------


def _note_tag(tag: str, session_id: str | None, cwd: Path) -> None:
    if session_id:
        with SESSIONS_LOG.open("a", encoding="utf-8") as log:
            log.write(f"dev1b-v4 {tag}\t{session_id}\t{cwd}\n")


def _assistant_text(events: list[dict]) -> str:
    return " ".join(block.get("text", "") for event in events for block in event["payload"]["blocks"]
                    if block.get("type") == "text")


async def _decide_cards(rig: Rig, runtime, policy, cards: list, stop: asyncio.Event) -> None:
    """What the UI does: answer every new card with `policy(payload) -> (behavior, scope)`."""
    seen: set[str] = set()
    while not stop.is_set():
        for event in await rig.events("permission.request"):
            payload = event["payload"]
            if payload["id"] in seen:
                continue
            seen.add(payload["id"])
            behavior, scope = policy(payload)
            cards.append((payload["tool_name"], payload["allow_session"], behavior, scope, dict(payload["input"])))
            await runtime.decide(payload["id"], behavior=behavior, scope=scope, by="rest")
        await asyncio.sleep(0.2)


async def _send_and_wait(rig: Rig, runtime, text: str, timeout: float = 120.0) -> None:
    before = len(await rig.events("turn.ended"))
    await runtime.submit("send", text=text)
    await rig.wait_for_async(lambda: _count(rig, "turn.ended", before), timeout)


async def test_clear_as_the_first_message_of_a_resumed_process_moves_the_id_and_the_old_conversation_stays_gone(tmp_path, cli):
    """B1 (RF14, CA14): the first `init` of the process already carries the new id."""
    sid = str(uuid.uuid4())
    for name in ("a", "b", "c"):
        (tmp_path / name).mkdir()
    async with _rig(tmp_path / "a", cli, session_id=sid) as first:
        runtime = await first.start()
        await _send_and_wait(first, runtime, "Remember the secret word PINEAPPLE. Reply with just OK.")
        _note_tag("clear-first", sid, CWD)
        await runtime.close("terminated")

    async with _rig(tmp_path / "b", cli, session_id=None) as second:
        second.resume = sid
        runtime = await second.start()
        await _send_and_wait(second, runtime, "/clear")
        resumed = (await second.events("session.resumed"))[0]["payload"]["claude_session_id"]
        changes = list(second.id_changes)
        await runtime.close("terminated")

    assert resumed != sid, "the CLI did not give /clear a new id on this binary"
    assert changes == [(KEY, sid, resumed)]

    # What the product does on the next open: resume the id it now keeps (the new one).
    async with _rig(tmp_path / "c", cli, session_id=None) as third:
        third.resume = resumed
        runtime = await third.start()
        await _send_and_wait(third, runtime, "What secret word did I ask you to remember earlier? Answer with the word only, or NONE.")
        answer = _assistant_text(await third.events("message.assistant"))
        await runtime.close("terminated")
    assert "PINEAPPLE" not in answer.upper()


async def test_a_connect_without_a_turn_leaves_no_conversation_to_resume(tmp_path, cli):
    """B2 (CA13), no tokens: the id of a process that never got a message cannot be `--resume`d,
    but the same id can be connected again as a NEW session."""
    engine = AgentSdkEngine()
    callbacks = EngineCallbacks(can_use_tool=_no_tool, on_stop=_no_stop)
    sid = str(uuid.uuid4())
    base = dict(cli_path=cli.path, cwd=str(CWD), model="haiku", connect_timeout=60.0)
    _note_tag("no-turn", sid, CWD)

    process = await engine.spawn(ChatSpec(session_id=sid, **base), callbacks)
    await process.close()
    again = await engine.spawn(ChatSpec(session_id=sid, **base), callbacks)  # what the product does now
    await again.close()
    with pytest.raises(ResumeFailed) as refused:
        await engine.spawn(ChatSpec(resume=sid, **base), callbacks)  # what it did before

    assert "No conversation found" in refused.value.detail and sid in refused.value.detail


async def test_the_live_assistant_message_ids_are_the_ids_of_the_transcript(tmp_path, cli):
    """B4: the deduplication key of the history import. Going to the terminal and back must import nothing."""
    from app.chat import history_import

    async with _rig(tmp_path, cli) as rig:
        runtime = await rig.start()
        await _send_and_wait(rig, runtime, "Reply with exactly: OK")
        sid = (await rig.events("session.started"))[0]["payload"]["claude_session_id"]
        _note_tag("transcript-ids", sid, CWD)
        live_ids = {e["payload"]["message_id"] for e in await rig.events("message.assistant")}
        known = await rig.store.logged_conversation(KEY)
        await runtime.close("terminated")

    transcript = sdk.get_session_messages(sid, directory=str(CWD))
    transcript_ids = {item.message.get("id") for item in transcript if item.message.get("role") == "assistant"}
    assert live_ids and None not in live_ids and live_ids <= transcript_ids
    assert known["assistant_ids"] == live_ids
    assert await history_import.import_history(sid, str(CWD), {}, known=known) == []


async def test_an_interrupt_that_makes_the_cli_withdraw_the_other_card_leaves_nothing_pending(tmp_path, cli):
    """B8: two parallel Reads outside the cwd; the first is denied with `interrupt`, the CLI cancels the second."""
    folder = SCRATCH / "folders" / "contract-b8"
    outside, cwd = folder / "outside", folder / "cwd"
    outside.mkdir(parents=True, exist_ok=True)
    cwd.mkdir(parents=True, exist_ok=True)
    for name in ("a.txt", "b.txt"):
        (outside / name).write_text("hello\n")
    async with _rig(tmp_path, cli, cwd=str(cwd)) as rig:
        runtime = await rig.start()
        await runtime.submit("send", text=(
            f"In one single assistant message, call the Read tool twice in parallel: {outside.as_posix()}/a.txt "
            f"and {outside.as_posix()}/b.txt. Do not call anything else before that."))
        deadline = asyncio.get_running_loop().time() + 90
        while len(runtime.pending) < 2 and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.2)
        assert len(runtime.pending) == 2, "the model did not ask for two parallel reads"
        ids = list(runtime.pending)
        await runtime.decide(ids[0], behavior="deny", interrupt=True, by="rest")
        await rig.wait_for_async(lambda: _count(rig, "turn.ended", 0), 90)
        await asyncio.sleep(1.0)
        rows = [await rig.store.get_permission(i) for i in ids]
        resolved = [e["payload"]["status"] for e in await rig.events("permission.resolved")]
        pending_in_db = await rig.store.pending_count(KEY)
        _note_tag("b8", (await rig.events("session.started"))[0]["payload"]["claude_session_id"], cwd)
        await runtime.close("terminated")

    assert pending_in_db == 0 and "pending" not in [row["status"] for row in rows]
    assert len(resolved) == 2 and "denied" in resolved and not runtime.pending


async def test_two_different_powershell_commands_ask_twice(tmp_path, cli):
    """Decision 1: no "allow for the conversation" for a shell, so the second command is not waved through."""
    folder = SCRATCH / "folders" / "contract-d1"
    folder.mkdir(parents=True, exist_ok=True)
    first, second = folder / "ps-a.txt", folder / "ps-b.txt"
    for target in (first, second):
        target.unlink(missing_ok=True)
    cards: list = []
    stop = asyncio.Event()
    async with _rig(tmp_path, cli, cwd=str(folder)) as rig:
        runtime = await rig.start()
        decider = asyncio.ensure_future(_decide_cards(rig, runtime, lambda p: ("allow", "once"), cards, stop))
        await _send_and_wait(rig, runtime, f"Use the PowerShell tool (not Bash) to run exactly this and nothing else: "
                                           f"Set-Content -Path {first.as_posix()} -Value one")
        await _send_and_wait(rig, runtime, f"Use the PowerShell tool (not Bash) to run exactly this and nothing else: "
                                           f"Set-Content -Path {second.as_posix()} -Value two")
        stop.set()
        await decider
        _note_tag("d1", (await rig.events("session.started"))[0]["payload"]["claude_session_id"], folder)
        await runtime.close("terminated")

    powershell = [c for c in cards if c[0] == "PowerShell"]
    assert len(powershell) == 2, f"expected two PowerShell cards, got {cards}"
    assert all(card[1] is False for card in powershell)
    assert first.exists() and second.exists()


async def test_allow_for_the_conversation_covers_edits_inside_the_folders_and_not_outside(tmp_path, cli):
    """Decision 2: the PreToolUse `ask` of the path gate beats the session rule for a file outside."""
    folder = SCRATCH / "folders" / "contract-d2"
    inside, outside = folder / "cwd", folder / "outside"
    inside.mkdir(parents=True, exist_ok=True)
    outside.mkdir(parents=True, exist_ok=True)
    for path in (inside / "one.txt", inside / "two.txt", outside / "out.txt"):
        path.write_text("alpha\n")
    cards: list = []
    stop = asyncio.Event()

    def policy(payload):
        if payload["tool_name"] in ("Write", "Edit") and payload["input"].get("file_path", "").replace("\\", "/").startswith(
                outside.as_posix()):
            return "deny", "once"
        if payload["tool_name"] in ("Write", "Edit") and payload["allow_session"]:
            return "allow", "session"
        return "allow", "once"

    async with _rig(tmp_path, cli, cwd=str(inside)) as rig:
        runtime = await rig.start()
        decider = asyncio.ensure_future(_decide_cards(rig, runtime, policy, cards, stop))
        await _send_and_wait(rig, runtime, f"Read {(inside / 'one.txt').as_posix()}, then use the Edit tool to replace "
                                           "alpha with beta in it. Do nothing else.")
        after_first = len(cards)
        await _send_and_wait(rig, runtime, f"Read {(inside / 'two.txt').as_posix()}, then use the Edit tool to replace "
                                           "alpha with beta in it. Do nothing else.")
        cards_for_second_inside = [c for c in cards[after_first:] if c[0] in ("Write", "Edit")]
        await _send_and_wait(rig, runtime, f"Read {(outside / 'out.txt').as_posix()}, then use the Edit tool to replace "
                                           "alpha with gamma in it. Do nothing else.")
        outside_cards = [c for c in cards if c[0] in ("Write", "Edit") and c[4]["file_path"].replace("\\", "/").startswith(
            outside.as_posix())]
        stop.set()
        await decider
        _note_tag("d2", (await rig.events("session.started"))[0]["payload"]["claude_session_id"], inside)
        await runtime.close("terminated")

    first_edit = [c for c in cards[:after_first] if c[0] in ("Write", "Edit")]
    assert first_edit and first_edit[0][1] is True and first_edit[0][3] == "session"
    assert cards_for_second_inside == [], "the session rule was not honoured inside the folder"
    assert (inside / "two.txt").read_text().strip() == "beta"
    assert outside_cards, "an Edit outside the folders ran without a card: the path gate did not win"
    assert (outside / "out.txt").read_text().strip() == "alpha"


async def test_a_conversation_made_outside_the_chat_is_imported_and_resumed_not_started_again(tmp_path, cli):
    """N1: reset in the chat -> the terminal makes a conversation -> back to the chat. A plain SDK session
    plays the terminal (the PTY itself does not fit the contract: it needs a TTY and the app's lifespan).
    The product must read its turns and `--resume` its id; starting it as a new session is refused."""
    from app.chat import history_import

    for name in ("terminal", "chat"):
        (tmp_path / name).mkdir()
    terminal_id = str(uuid.uuid4())
    async with _rig(tmp_path / "terminal", cli, session_id=terminal_id) as terminal:
        runtime = await terminal.start()
        await _send_and_wait(terminal, runtime, "Remember the secret word PINEAPPLE. Reply with just OK.")
        _note_tag("n1-terminal", terminal_id, CWD)
        await runtime.close("terminated")

    # The chat log holds a message of the conversation before the reset: none of its ids is in this transcript.
    known = {"assistant_ids": {"msg_before_the_reset"}, "tool_use_ids": set(), "trailing_user_texts": []}
    events = await history_import.import_history(terminal_id, str(CWD), {}, known=known)
    assert any(e.kind == "message.user" and "PINEAPPLE" in e.payload["text"] for e in events)

    with pytest.raises(SpawnFailed) as refused:  # what the product did before the fix
        await AgentSdkEngine().spawn(
            ChatSpec(cli_path=cli.path, cwd=str(CWD), model="haiku", connect_timeout=60.0, session_id=terminal_id),
            EngineCallbacks(can_use_tool=_no_tool, on_stop=_no_stop),
        )
    assert "already in use" in refused.value.detail

    async with _rig(tmp_path / "chat", cli, session_id=None) as chat:  # what it does now
        chat.resume = terminal_id
        runtime = await chat.start()
        await _send_and_wait(chat, runtime, "What secret word did I ask you to remember? Answer with the word only.")
        answer = _assistant_text(await chat.events("message.assistant"))
        await runtime.close("terminated")
    assert "PINEAPPLE" in answer.upper()
