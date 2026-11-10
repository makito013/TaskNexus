"""REST `/api/chat/*` and the chat's hooks into the V2 session endpoints, through the real app
with the scripted engine (no SDK, no binary: runs in both venvs)."""
from __future__ import annotations

import asyncio
import importlib
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.chat.availability import CliInfo, SdkStatus
from app.chat.engine import ResumeFailed, SpawnFailed
from tests.chat_fakes import FakeChatEngine, init_message

PROJECT = "meu-projeto"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "revert_chat_sessions.py"
OTHER_UUID = "22222222-2222-4222-8222-222222222222"


class StubResolver:
    min_version = "2.1.317"

    def __init__(self):
        self.calls = []

    def resolve(self, agent=None):
        self.calls.append(agent)
        return CliInfo("C:/bin/claude.exe", "2.1.317", True)


def wait_until(predicate, timeout=5.0, step=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    raise AssertionError("condition not reached in time")


class Env:
    def __init__(self, client, main_mod, engine, tmp_path, resolver):
        self.client, self.main, self.engine, self.tmp_path, self.resolver = client, main_mod, engine, tmp_path, resolver
        self.db = tmp_path / "sessions.db"

    def post(self, url, **kw):
        return self.client.post(url, **kw)

    def create(self, **body):
        payload = {"project_ref": PROJECT, "agent_id": "claude", **body}
        response = self.client.post("/api/chat/sessions", json=payload)
        assert response.status_code == 201, response.text
        return response.json()["session_key"]

    def sessions(self):
        return self.client.get("/api/chat/sessions").json()

    def session(self, key):
        return next(s for s in self.sessions() if s["session_key"] == key)

    def events(self, key, **params):
        return self.client.get(f"/api/chat/sessions/{key}/events", params=params).json()

    def kinds(self, key):
        return [e["kind"] for e in self.events(key)["events"]]

    def sql(self, query, params=()):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute(query, params).fetchall()
        finally:
            conn.close()

    def add_agent(self, **fields):
        base = {"nome": "A", "papel": "p", "ia": "claude", "cmd": ["claude"]}
        response = self.client.post("/api/agents", json={**base, **fields})
        assert response.status_code == 201, response.text


def _boot(tmp_path, monkeypatch, extra_env=None):
    (tmp_path / PROJECT / ".claude").mkdir(parents=True)
    monkeypatch.delenv("HOOK_LOOPBACK_PORT", raising=False)
    env = {
        "PROJECTS_ROOT": str(tmp_path), "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"), "BOARD_UPLOADS_ROOT": str(tmp_path / "uploads"),
        "BOARD_ATTACHMENTS_ROOT": str(tmp_path / "attachments"), "CLEANUP_DELAY": "0.1",
        **(extra_env or {}),
    }
    return patch.dict("os.environ", env)


@pytest.fixture
def env(tmp_path, monkeypatch):
    from app.chat.runtime import ChatRuntime

    monkeypatch.setattr(ChatRuntime, "connector_settle_seconds", 0.2)  # the fake has no connectors
    monkeypatch.setattr(ChatRuntime, "connector_poll_seconds", 0.02)
    with _boot(tmp_path, monkeypatch):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            engine, resolver = FakeChatEngine(), StubResolver()
            service = main_mod.chat_service
            service.engine_factory = lambda: engine
            service.cli_resolver = resolver
            service.sdk_status = lambda: SdkStatus(True, "0.1.69", None)
            service.dispatch_push = AsyncMock(return_value=True)
            e = Env(client, main_mod, engine, tmp_path, resolver)
            e.add_agent(id="claude", default=True)
            yield e


# -- creating ----------------------------------------------------------------------------------------------


def test_create_returns_201_with_a_suffixed_key_and_the_chat_is_invisible_to_the_v2_list(env):
    key = env.create(model="haiku", first_message="hello")

    prefix, agent, suffix = key.split("::")
    assert (prefix, agent) == (PROJECT, "claude") and len(suffix) == 6 and suffix.isalnum()
    assert env.client.get("/api/sessions/persisted").json() == {}
    assert key in env.client.get("/api/sessions/persisted?engine=chat").json()
    wait_until(lambda: "turn.ended" in env.kinds(key))
    kinds = env.kinds(key)
    assert kinds[:2] == ["message.user", "session.started"] and "message.assistant" in kinds
    spec = env.engine.specs[0]
    assert spec.model == "haiku" and spec.session_id and spec.resume is None
    assert spec.cwd == str(env.tmp_path / PROJECT)


def test_two_chats_of_one_project_never_share_a_key_or_a_session_id(env):
    keys = {env.create() for _ in range(3)}

    assert len(keys) == 3
    ids = {row[0] for row in env.sql("SELECT claude_session_id FROM sessions WHERE engine = 'chat'")}
    assert len(ids) == 3


@pytest.mark.parametrize("body,status,code", [
    ({"project_ref": "nope", "agent_id": "claude"}, 404, "project_not_found"),
    ({"project_ref": PROJECT, "agent_id": "ghost"}, 404, "agent_not_found"),
    ({"project_ref": PROJECT, "agent_id": "claude", "permission_mode": "bypassPermissions"}, 422, "mode_not_allowed"),
    ({"project_ref": PROJECT, "agent_id": "claude", "model": "--mcp-config=evil"}, 422, "model_not_allowed"),
])
def test_create_refusals(env, body, status, code):
    response = env.client.post("/api/chat/sessions", json=body)

    assert response.status_code == status and response.json()["detail"]["code"] == code
    assert env.engine.spawns == 0


def test_a_codex_agent_has_no_chat(env):
    env.add_agent(id="codex-agent", ia="codex", cmd=["codex"])

    response = env.client.post("/api/chat/sessions", json={"project_ref": PROJECT, "agent_id": "codex-agent"})

    assert response.status_code == 422 and response.json()["detail"]["code"] == "agent_not_chat_capable"


def test_an_agent_command_with_arguments_fails_as_a_status_not_as_a_refusal(env):
    env.add_agent(id="risky", cmd=["claude", "--dangerously-skip-permissions"])

    key = env.create(agent_id="risky")
    row = wait_until(lambda: (s := env.session(key))["status"] == "failed" and s)

    assert row["last_error"]["reason"] == "agent_cmd_args_unsupported"
    assert env.engine.spawns == 0


def test_without_the_sdk_the_motor_routes_say_503_and_the_reads_keep_working(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")
    env.main.chat_service.sdk_status = lambda: SdkStatus(False, None, "ImportError: nope")

    refused = env.client.post("/api/chat/sessions", json={"project_ref": PROJECT, "agent_id": "claude"})
    opened = env.client.post(f"/api/chat/sessions/{key}/open")
    health = env.client.get("/api/chat/health").json()

    assert refused.status_code == 503 and refused.json()["detail"]["code"] == "engine_unavailable"
    assert opened.status_code in (200, 503)
    assert health["sdk"]["available"] is False
    assert env.client.get("/api/chat/sessions").status_code == 200
    assert env.client.get(f"/api/chat/sessions/{key}/events").status_code == 200


def test_health_reports_the_binary_by_file_name_only(env):
    health = env.client.get("/api/chat/health").json()

    assert health["sdk"]["available"] is True
    assert health["cli"] == {"path": "claude.exe", "version": "2.1.317", "ok": True}
    assert health["min_cli_version"] == "2.1.317"


# -- opening, failures, conflicts ---------------------------------------------------------------------------


def test_open_resumes_with_the_stored_id_after_a_close(env):
    key = env.create(first_message="remember TAPIR")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    stored = env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,))[0][0]

    assert env.client.post(f"/api/chat/sessions/{key}/close").json() == {"status": "stopped"}
    assert env.client.post(f"/api/chat/sessions/{key}/open").json() == {"status": "idle"}

    assert env.engine.spawns == 2
    assert env.engine.specs[1].resume == stored and env.engine.specs[1].session_id is None
    assert "session.resumed" in env.kinds(key) or env.engine.last.queries == []


def test_a_spawn_failure_becomes_a_status_and_last_error_without_local_paths(env):
    env.engine.fail_with = SpawnFailed("process_error", "could not start C:\\Users\\bob\\bin\\claude.exe")
    key = env.create()
    row = wait_until(lambda: (s := env.session(key))["status"] == "failed" and s)

    assert row["last_error"]["reason"] == "process_error"
    assert "bob" not in row["last_error"]["detail"] and "<path>" in row["last_error"]["detail"]
    status = [e for e in env.events(key)["events"] if e["kind"] == "status"][0]["payload"]
    assert status["code"] == "spawn_failed" and "bob" not in status["detail"]


def test_a_refused_resume_is_resume_failed_and_reset_lets_the_conversation_start_over(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.engine.fail_with = ResumeFailed("No conversation found with session ID: x")

    opened = env.client.post(f"/api/chat/sessions/{key}/open").json()

    assert opened["status"] == "failed" and opened["last_error"]["code"] == "resume_failed"
    env.engine.fail_with = None
    assert env.client.post(f"/api/sessions/{key}/reset").json()["status"] == "reset"
    assert "session.reset" in env.kinds(key)
    assert env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,)) == [("",)]
    env.client.post(f"/api/chat/sessions/{key}/open")
    assert env.engine.specs[-1].resume is None and env.engine.specs[-1].session_id


def test_a_stored_id_that_is_not_a_uuid_is_resume_failed_and_never_reaches_the_engine(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    env.client.post(f"/api/chat/sessions/{key}/close")
    conn = sqlite3.connect(env.db)
    conn.execute("UPDATE sessions SET claude_session_id = ? WHERE session_key = ?", ("--mcp-config=evil", key))
    conn.commit()
    conn.close()
    spawns = env.engine.spawns

    opened = env.client.post(f"/api/chat/sessions/{key}/open").json()

    assert opened["status"] == "failed" and opened["last_error"]["code"] == "resume_failed"
    assert env.engine.spawns == spawns


def test_a_missing_binary_is_one_spawn_failed_status_and_no_respawn(env):
    env.resolver.resolve = lambda agent=None: CliInfo(None, None, False, "cli_not_found", "not found: claude")

    key = env.create(first_message="hi")
    row = wait_until(lambda: (s := env.session(key))["status"] == "failed" and s)
    time.sleep(0.3)

    assert row["last_error"]["reason"] == "cli_not_found"
    assert [e["payload"].get("reason") for e in env.events(key)["events"] if e["kind"] == "status"] == ["cli_not_found"]
    assert env.engine.spawns == 0


def test_open_is_a_409_for_a_conversation_that_belongs_to_the_terminal(env):
    key = f"{PROJECT}::claude::pty001"
    env.sql  # noqa: B018 - clarity: the row below is made with sqlite directly
    conn = sqlite3.connect(env.db)
    conn.execute("INSERT INTO sessions (session_key, claude_session_id, engine) VALUES (?, ?, 'pty')", (key, OTHER_UUID))
    conn.execute("INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, created_at, updated_at) "
                 "VALUES (?, ?, 'claude', 'x', 1, 1)", (key, PROJECT))
    conn.commit()
    conn.close()

    response = env.client.post(f"/api/chat/sessions/{key}/open")

    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_conflict"
    assert env.engine.spawns == 0


def test_open_is_a_409_while_a_pty_is_alive_for_the_key(env):
    key = env.create()
    wait_until(lambda: env.session(key)["status"] != "new")
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.main.chat_service.pty_is_alive = lambda k: True

    response = env.client.post(f"/api/chat/sessions/{key}/open")

    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_conflict"


def test_unknown_session_is_404_everywhere(env):
    for path in ("open", "close"):
        assert env.client.post(f"/api/chat/sessions/nope::claude::zzzzzz/{path}").status_code == 404
    assert env.client.get("/api/chat/sessions/nope::claude::zzzzzz/events").status_code == 404


# -- events ------------------------------------------------------------------------------------------------


def test_events_are_paginated_with_has_more(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    total = env.events(key)["last_seq"]

    first = env.events(key, since=0, limit=2)
    rest = env.events(key, since=2)

    assert [e["seq"] for e in first["events"]] == [1, 2] and first["has_more"] is True
    assert [e["seq"] for e in rest["events"]] == list(range(3, total + 1)) and rest["has_more"] is False
    assert env.client.get(f"/api/chat/sessions/{key}/events?limit=5000").status_code == 422


# -- permissions -------------------------------------------------------------------------------------------


def _ask_on_query(env, tool="Write", tool_input=None, suggestions=None):
    async def on_query(process, text):
        process.push(init_message(process.session_id))
        if text.startswith("ASK"):
            process.ask_permission(tool, tool_input or {"file_path": "C:/tmp/x.txt"}, suggestions)

    env.engine.on_query = on_query


def _pending_id(env, key):
    events = wait_until(lambda: [e for e in env.events(key)["events"] if e["kind"] == "permission.request"])
    return events[-1]["payload"]["id"]


def test_decide_by_rest_resolves_the_request_and_a_second_decision_is_409(env):
    _ask_on_query(env)
    key = env.create(first_message="ASK write")
    pid = _pending_id(env, key)
    assert env.session(key)["pending_permissions"] == 1 and env.session(key)["needs_attention"] is True

    first = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow"})
    second = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "deny"})

    assert first.status_code == 200 and first.json() == {"id": pid, "status": "allowed"}
    assert second.status_code == 409 and second.json()["detail"]["code"] == "already_decided"
    resolved = wait_until(lambda: [e for e in env.events(key)["events"] if e["kind"] == "permission.resolved"])
    assert resolved[0]["payload"]["status"] == "allowed" and resolved[0]["payload"]["by"] == "rest"
    wait_until(lambda: env.session(key)["pending_permissions"] == 0)
    assert env.session(key)["needs_attention"] is False  # the last decision acked it


def test_decide_errors(env):
    _ask_on_query(env)
    key = env.create(first_message="ASK write")
    pid = _pending_id(env, key)

    unknown = env.client.post("/api/chat/permissions/nope/decide", json={"behavior": "allow"})
    bad = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "maybe"})
    env.client.post(f"/api/chat/sessions/{key}/close")
    expired = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow"})

    assert unknown.status_code == 404 and unknown.json()["detail"]["code"] == "permission_not_found"
    assert bad.status_code == 422
    assert expired.status_code == 410 and expired.json()["detail"]["code"] == "permission_expired"


def test_allow_for_the_conversation_is_refused_for_a_connector_tool_with_422(env):
    env.sql  # noqa: B018
    env.main.chat_service.chat_store  # noqa: B018
    # allow Claude Docs for the agent, as the user would after "Atualizar lista"
    env.engine.mcp_status = {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected"}]}
    assert env.client.post("/api/chat/agents/claude/connectors/refresh").status_code == 200
    assert env.client.put("/api/chat/agents/claude/connectors", json={"allowlist": ["claude.ai Claude Docs"]}).status_code == 200
    env.engine.mcp_status = {"mcpServers": []}
    _ask_on_query(env, tool="mcp__claude_ai_Claude_Docs__guide", tool_input={})
    key = env.create(first_message="ASK docs")
    pid = _pending_id(env, key)

    session = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow", "scope": "session"})
    once = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow", "scope": "once"})

    assert session.status_code == 422 and session.json()["detail"]["code"] == "scope_not_allowed"
    assert once.status_code == 200


def test_allow_for_the_conversation_never_writes_a_settings_file(env, tmp_path):
    settings = tmp_path / "settings.local.json"
    settings.write_text("{}", encoding="utf-8")
    _ask_on_query(env, tool="Write", tool_input={"file_path": "C:/tmp/x.txt"},
                  suggestions=[{"type": "addRules", "rules": [{"toolName": "Write", "ruleContent": None}],
                                "behavior": "allow", "destination": "localSettings"}])
    key = env.create(first_message="ASK write")
    pid = _pending_id(env, key)
    before = settings.read_bytes()
    claude_json = (tmp_path / "claude.json")
    claude_before = claude_json.read_bytes() if claude_json.exists() else None

    assert env.client.post(f"/api/chat/permissions/{pid}/decide",
                           json={"behavior": "allow", "scope": "session"}).status_code == 200

    assert settings.read_bytes() == before
    assert (claude_json.read_bytes() if claude_json.exists() else None) == claude_before


def test_allow_for_the_conversation_is_refused_for_bash_and_the_request_stays_decidable(env):
    _ask_on_query(env, tool="Bash", tool_input={"command": "echo ok > C:/tmp/x.txt"})
    key = env.create(first_message="ASK bash")
    pid = _pending_id(env, key)
    request = [e for e in env.events(key)["events"] if e["kind"] == "permission.request"][-1]["payload"]

    session = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow", "scope": "session"})
    once = env.client.post(f"/api/chat/permissions/{pid}/decide", json={"behavior": "allow", "scope": "once"})

    assert request["allow_session"] is False
    assert session.status_code == 422 and session.json()["detail"]["code"] == "scope_not_allowed"
    assert once.status_code == 200


# -- the V2 endpoints ------------------------------------------------------------------------------------


def test_active_with_engine_chat_lists_live_chats_and_without_a_parameter_never_does(env):
    _ask_on_query(env)
    key = env.create(first_message="ASK write")
    _pending_id(env, key)

    plain = env.client.get("/api/sessions/active").json()
    chat = env.client.get("/api/sessions/active?engine=chat").json()
    both = env.client.get("/api/sessions/active?engine=all").json()

    assert plain == {}
    assert chat[key]["engine"] == "chat" and chat[key]["status"] == "awaiting_permission"
    assert chat[key]["pending_permissions"] == 1 and chat[key]["connected"] is False
    assert key in both


def test_terminate_closes_the_process_and_erases_every_trace_of_the_chat(env):
    _ask_on_query(env)
    key = env.create(first_message="ASK write")
    _pending_id(env, key)
    conn = sqlite3.connect(env.db)
    conn.execute("INSERT INTO session_claude_ids (claude_session_id, session_key, created_at) VALUES ('old', ?, 1)", (key,))
    conn.commit()
    conn.close()

    assert env.client.post(f"/api/sessions/{key}/terminate").json()["status"] == "terminated"

    for table in ("chat_events", "permission_requests", "chat_sessions", "session_claude_ids", "sessions"):
        assert env.sql(f"SELECT COUNT(*) FROM {table} WHERE session_key = ?", (key,)) == [(0,)], table
    assert env.engine.last.closed
    assert env.client.post(f"/api/sessions/{key}/terminate").status_code == 404


def test_terminating_a_pty_key_never_touches_the_chat_store(env):
    conn = sqlite3.connect(env.db)
    conn.execute("INSERT INTO sessions (session_key, claude_session_id) VALUES ('proj::claude', ?)", (OTHER_UUID,))
    conn.commit()
    conn.close()
    with patch.object(env.main.chat_store, "delete_session_data", side_effect=AssertionError("touched")):
        response = env.client.post("/api/sessions/proj::claude/terminate")

    assert response.status_code == 200


# -- the conversation id after /clear (alias) -------------------------------------------------------------


def test_clear_moves_the_stored_id_and_keeps_the_old_one_as_an_alias(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    first = env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,))[0][0]

    env.engine.last.push(init_message(OTHER_UUID))
    wait_until(lambda: "session.id_changed" in env.kinds(key))

    assert env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,)) == [(OTHER_UUID,)]
    assert env.sql("SELECT session_key FROM session_claude_ids WHERE claude_session_id = ?", (first,)) == [(key,)]


def test_a_new_session_id_that_is_not_a_uuid_is_never_written_to_the_database(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    first = env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,))[0][0]

    env.engine.last.push(init_message("--mcp-config=" + '{"mcpServers":{}}'))
    wait_until(lambda: "session.id_changed" in env.kinds(key))
    time.sleep(0.2)

    assert env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,)) == [(first,)]
    assert env.sql("SELECT COUNT(*) FROM session_claude_ids") == [(0,)]


# -- notifications -----------------------------------------------------------------------------------------


def test_stop_marks_attention_and_pushes_once_per_turn_and_once_per_new_approval(env):
    async def on_query(process, text):
        process.push(init_message(process.session_id))
        await process.fire_stop()
        await process.fire_stop()  # a second Stop in the same turn is not a second push

    env.engine.on_query = on_query
    key = env.create(first_message="hi")
    wait_until(lambda: env.main.chat_service.dispatch_push.await_count >= 1)
    time.sleep(0.2)

    assert env.main.chat_service.dispatch_push.await_count == 1
    assert env.client.get("/api/sessions/persisted?engine=chat").json()[key]["needs_attention"] is True


# -- the agent environment ---------------------------------------------------------------------------------


def test_percent_variables_in_the_agent_env_are_expanded_like_the_pty_does(env, monkeypatch):
    monkeypatch.setenv("USERPROFILE", "C:\\Users\\tester")
    env.add_agent(id="work", env={"CLAUDE_CONFIG_DIR": "%USERPROFILE%\\.claude-work", "PLAIN": "x"})

    env.create(agent_id="work")
    wait_until(lambda: env.engine.specs)

    spec = env.engine.specs[0]
    assert spec.env["CLAUDE_CONFIG_DIR"] == "C:\\Users\\tester\\.claude-work" and spec.env["PLAIN"] == "x"


def test_the_agent_system_prompt_and_escritorio_mcp_servers_are_passed_to_the_engine(env):
    env.add_agent(id="speaker")
    # only discovered project agents carry a system prompt; give the cached one the same field
    next(a for a in env.main._global_agents_cache if a.id == "speaker").system_prompt = "Answer in Portuguese."

    env.create(agent_id="speaker")
    wait_until(lambda: env.engine.specs)

    spec = env.engine.specs[0]
    assert spec.system_prompt_append == "Answer in Portuguese."
    assert "escritorio-cards" in spec.mcp_servers
    assert spec.setting_sources == ("user", "project", "local") and spec.cli_path == "C:/bin/claude.exe"


# -- connectors --------------------------------------------------------------------------------------------


def test_connectors_discovery_allowlist_and_what_the_client_may_see(env):
    env.engine.mcp_status = {"mcpServers": [
        {"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected",
         "config": {"type": "claudeai-proxy", "url": "https://x.example/mcpsrv_abc?token=secret"}},
        {"name": "claude.ai podesubir-staging", "scope": "claudeai", "status": "connected"},
        {"name": "escritorio-cards", "scope": "dynamic", "status": "connected"},
    ]}

    assert env.client.get("/api/chat/agents/claude/connectors").json()["known"] == []
    refreshed = env.client.post("/api/chat/agents/claude/connectors/refresh")
    put = env.client.put("/api/chat/agents/claude/connectors", json={"allowlist": ["claude.ai Claude Docs"]})
    unknown = env.client.put("/api/chat/agents/claude/connectors", json={"allowlist": ["claude.ai Nope"]})
    invalid = env.client.put("/api/chat/agents/claude/connectors", json={"allowlist": ["x" * 200]})
    missing = env.client.get("/api/chat/agents/ghost/connectors")

    assert refreshed.status_code == 200
    body = put.json()
    assert body["allowlist"] == ["claude.ai Claude Docs"]
    assert body["known"] == [{"name": "claude.ai Claude Docs", "allowed": True},
                             {"name": "claude.ai podesubir-staging", "allowed": False}]
    for text in (refreshed.text, put.text):
        assert "http" not in text and "mcpsrv_" not in text and "token" not in text and "url" not in text
    assert unknown.status_code == 422 and unknown.json()["detail"]["code"] == "unknown_connector"
    assert invalid.status_code == 422 and invalid.json()["detail"]["code"] == "invalid_name"
    assert missing.status_code == 404
    assert env.engine.last.closed and env.engine.last.queries == []


def test_refresh_is_503_without_the_sdk_and_502_when_the_probe_fails(env):
    env.engine.fail_with = SpawnFailed("process_error", "boom")

    failed = env.client.post("/api/chat/agents/claude/connectors/refresh")
    env.main.chat_service.sdk_status = lambda: SdkStatus(False, None, "x")
    unavailable = env.client.post("/api/chat/agents/claude/connectors/refresh")

    assert failed.status_code == 502 and failed.json()["detail"]["code"] == "probe_failed"
    assert unavailable.status_code == 503


def test_an_agent_with_the_allowlist_empty_spawns_with_the_connectors_switched_off(env):
    env.create(first_message="hi")
    wait_until(lambda: env.engine.specs)

    assert env.engine.specs[0].connector_policy.mode == "none"


def test_connectors_still_loaded_after_the_start_are_retried_once_with_the_strict_net_then_refused(env):
    env.engine.mcp_status = {"mcpServers": [{"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected"}]}

    key = env.create(first_message="hi")
    row = wait_until(lambda: (s := env.session(key))["status"] == "failed" and s)

    assert row["last_error"]["reason"] == "connector_exposed"
    assert [s.strict_mcp for s in env.engine.specs] == [False, True]
    assert all(p.queries == [] for p in env.engine.processes)


def test_the_strict_net_saves_the_start_when_it_cleans_the_connectors(env):
    calls = []
    original = env.engine.spawn

    async def spawn(spec, callbacks):
        process = await original(spec, callbacks)
        calls.append(spec.strict_mcp)
        process.engine.mcp_status = {"mcpServers": [] if spec.strict_mcp else [
            {"name": "claude.ai Claude Docs", "scope": "claudeai", "status": "connected"}]}
        return process

    env.engine.spawn = spawn
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    assert calls == [False, True]


# -- capacity, origin --------------------------------------------------------------------------------------


def test_the_oldest_idle_conversation_makes_room_at_capacity(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch, {"CHAT_MAX_PROCESSES": "1"}):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            engine = FakeChatEngine()
            main_mod.chat_service.engine_factory = lambda: engine
            main_mod.chat_service.cli_resolver = StubResolver()
            main_mod.chat_service.sdk_status = lambda: SdkStatus(True, "0.1.69", None)
            e = Env(client, main_mod, engine, tmp_path, None)
            e.add_agent(id="claude", default=True)
            first = e.create(first_message="a")
            wait_until(lambda: "turn.ended" in e.kinds(first))
            second = e.create(first_message="b")
            wait_until(lambda: "turn.ended" in e.kinds(second))

            assert engine.spawns == 2 and engine.processes[0].closed
            assert e.session(first)["status"] == "stopped" and e.session(second)["live_status"] == "idle"


@pytest.mark.parametrize("origin,status", [
    ("http://evil.example", 403), ("http://testserver", 200), (None, 200),
])
def test_mutating_routes_check_the_origin(env, origin, status):
    headers = {"Origin": origin} if origin else {}

    response = env.client.post("/api/chat/sessions/nope::claude::zzzzzz/close", headers=headers)

    assert (403 if status == 403 else 404) == response.status_code or status == 200 and response.status_code == 404
    if status == 403:
        assert response.json()["detail"]["code"] == "origin_not_allowed"


def test_reads_do_not_check_the_origin(env):
    assert env.client.get("/api/chat/sessions", headers={"Origin": "http://evil.example"}).status_code == 200


def test_chat_allowed_origins_lets_a_dev_server_through(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch, {"CHAT_ALLOWED_ORIGINS": "http://localhost:5173, http://127.0.0.1:5173"}):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app) as client:
            ok = client.post("/api/chat/sessions/x/close", headers={"Origin": "http://localhost:5173"})
            nope = client.post("/api/chat/sessions/x/close", headers={"Origin": "http://localhost:9999"})

    assert ok.status_code == 404 and nope.status_code == 403


# -- switching engine --------------------------------------------------------------------------------------


def _seed_pty(env, key=f"{PROJECT}::claude"):
    conn = sqlite3.connect(env.db)
    conn.execute("INSERT OR REPLACE INTO sessions (session_key, claude_session_id) VALUES (?, ?)", (key, OTHER_UUID))
    conn.commit()
    conn.close()
    return key


def test_pty_to_chat_needs_confirmation_imports_the_history_and_survives_a_failed_import(env):
    key = _seed_pty(env)
    transcript = [SimpleNamespace(type="user", message={"role": "user", "content": "old words"}),
                  SimpleNamespace(type="assistant", message={"role": "assistant", "id": "m1", "model": "opus",
                                                              "content": [{"type": "text", "text": "old answer"}]})]
    env.main.chat_service.history_reader = lambda sid, cwd: transcript

    unconfirmed = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat"})
    done = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert unconfirmed.status_code == 400 and unconfirmed.json()["detail"]["code"] == "confirmation_required"
    assert done.json() == {"engine": "chat", "history": {"imported": 2}}
    assert env.sql("SELECT engine FROM sessions WHERE session_key = ?", (key,)) == [("chat",)]
    assert env.kinds(key) == ["message.user", "message.assistant", "history.imported"]
    assert env.session(key)["origin"] == "imported_from_pty"
    # opening resumes the terminal's own conversation id
    env.client.post(f"/api/chat/sessions/{key}/open")
    assert env.engine.specs[0].resume == OTHER_UUID


def test_a_failing_history_import_does_not_stop_the_switch(env):
    key = _seed_pty(env)

    def broken(sid, cwd):
        raise OSError("disk on fire")

    env.main.chat_service.history_reader = broken

    done = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert done.json() == {"engine": "chat", "history": {"failed": "unreadable"}}
    assert "history.import_failed" in env.kinds(key)


def test_switching_to_a_chat_evicts_a_live_pty_first(env):
    key = _seed_pty(env)
    evicted = []

    async def evict(k):
        evicted.append(k)

    env.main.chat_service.pty_evict = evict
    env.main.chat_service.history_reader = lambda sid, cwd: []

    env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert evicted == [key]


def test_chat_to_pty_closes_the_runtime_and_hands_the_key_back(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    done = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"})

    assert done.json() == {"engine": "pty", "history": None}
    assert env.sql("SELECT engine FROM sessions WHERE session_key = ?", (key,)) == [("pty",)]
    assert env.session(key)["status"] == "switched_to_pty" and env.engine.last.closed
    again = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"})
    assert again.status_code == 409


# -- O5: the rollback script refuses because the BACKEND wrote the pid ----------------------------------------


def test_the_reversion_script_refuses_while_the_backend_has_a_live_chat_and_proceeds_after_close(env):
    """No pid is written by hand: the running backend (this very process) wrote its own."""
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    assert env.sql("SELECT runtime_owner_pid FROM chat_sessions WHERE session_key = ?", (key,)) == [(os.getpid(),)]

    def run():
        return subprocess.run([sys.executable, str(SCRIPT), "--db", str(env.db), "--dry-run"],
                              capture_output=True, text=True, timeout=60)

    refused = run()
    env.client.post(f"/api/chat/sessions/{key}/close")
    wait_until(lambda: env.sql("SELECT runtime_owner_pid FROM chat_sessions WHERE session_key = ?", (key,)) == [(None,)])
    allowed = run()

    assert refused.returncode == 2 and "PID" in refused.stderr and str(os.getpid()) in refused.stderr
    assert allowed.returncode == 0 and "sessions migradas: 1" in allowed.stdout
    assert env.sql("SELECT engine FROM sessions WHERE session_key = ?", (key,)) == [("chat",)]  # dry run


def test_booting_over_a_database_with_a_dead_owner_clears_the_mark(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app):
            pass
        conn = sqlite3.connect(tmp_path / "sessions.db")
        conn.execute("INSERT INTO chat_sessions (session_key, project_ref, agent_id, cwd, status, "
                     "runtime_owner_pid, created_at, updated_at) VALUES ('k', 'p', 'a', 'x', 'running', 999999, 1, 1)")
        conn.commit()
        conn.close()
        importlib.reload(main_mod)
        with TestClient(main_mod.app):
            pass
        conn = sqlite3.connect(tmp_path / "sessions.db")
        row = conn.execute("SELECT status, runtime_owner_pid FROM chat_sessions WHERE session_key = 'k'").fetchone()
        conn.close()

    assert row == ("stopped", None)


# -- O15: the resolver is built by main, without a minimum, after load_dotenv() ------------------------------


def test_main_builds_the_resolver_without_a_minimum_and_after_load_dotenv():
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8").splitlines()
    dotenv_line = next(n for n, line in enumerate(source) if line.strip() == "load_dotenv()")
    built = [(n, line) for n, line in enumerate(source) if "CliResolver(" in line and not line.lstrip().startswith("#")]

    assert len(built) == 1
    number, line = built[0]
    assert number > dotenv_line and line.strip() == "chat_cli_resolver = CliResolver()"


@pytest.mark.parametrize("configured,expected", [("9.0.0", "9.0.0"), ("1.0.0", "2.1.317"), (None, "2.1.317")])
def test_the_minimum_in_the_environment_reaches_the_resolver_main_builds(tmp_path, monkeypatch, configured, expected):
    extra = {"CHAT_MIN_CLI_VERSION": configured} if configured else {}
    with _boot(tmp_path, monkeypatch, extra):
        import app.main as main_mod

        importlib.reload(main_mod)

    assert main_mod.chat_cli_resolver.min_version == expected


# -- O11: what a client may read, the folders before the eviction, the boot warning ----------------------------


@pytest.mark.parametrize("raw,expected_absent", [
    (r"could not start C:\Program Files\Claude Code\claude.exe now", "Program Files"),
    ("could not start C:/Users/bob/bin/claude.exe", "bob"),
    (r"bad \\fileserver\share\bob\claude.exe", "fileserver"),
    ("see /home/bob/.claude/x.json for details", "bob"),
    (r"error in D:\projetos\Pessoal\TaskNexus", "Pessoal"),
])
def test_public_detail_hides_local_paths_including_spaces_and_unc(raw, expected_absent):
    from app.chat.service import public_detail

    cleaned = public_detail(raw)

    assert expected_absent not in cleaned and "<path>" in cleaned


def test_a_switch_to_chat_with_the_folder_gone_is_422_and_the_terminal_is_not_evicted(env):
    key = _seed_pty(env)
    evicted = []

    async def evict(k):
        evicted.append(k)

    def gone(project_ref, agent_id):
        raise SpawnFailed("folder_unavailable", "C:/Users/bob/vanished is unavailable")

    env.main.chat_service.pty_evict = evict
    env.main.chat_service.resolve_project = gone

    response = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert response.status_code == 422 and response.json()["detail"]["code"] == "folder_unavailable"
    assert "bob" not in response.text
    assert evicted == []
    assert env.sql("SELECT engine FROM sessions WHERE session_key = ?", (key,)) == [("pty",)]


def test_booting_from_inside_a_claude_session_prints_the_transcript_warning(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("CLAUDECODE", "1")
    with _boot(tmp_path, monkeypatch):
        import app.main as main_mod

        importlib.reload(main_mod)
        with TestClient(main_mod.app):
            pass

    assert "CLAUDECODE set in the backend environment" in capsys.readouterr().out


# -- rework of the 1b review (B1 to B10, Decision 1, L1#8, L2#9) ---------------------------------------------


def _send_by_ws(env, key, text):
    with env.client.websocket_connect(f"/ws/chat/{key}?since={env.events(key)['last_seq']}") as ws:
        for _ in range(60):
            if ws.receive_json()["type"] == "replay.complete":
                break
        ws.send_json({"type": "send", "text": text})
        wait_until(lambda: any(e["payload"].get("text") == text for e in env.events(key)["events"]
                               if e["kind"] == "message.user"))


def _stored_id(env, key):
    return env.sql("SELECT claude_session_id FROM sessions WHERE session_key = ?", (key,))[0][0]


def test_clear_as_the_first_message_of_a_resumed_process_moves_the_stored_id_and_the_next_open_follows_it(env):
    key = env.create(first_message="remember PINEAPPLE")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    old = _stored_id(env, key)
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.client.post(f"/api/chat/sessions/{key}/open")
    assert env.engine.specs[-1].resume == old

    _send_by_ws(env, key, "/clear")
    wait_until(lambda: "session.id_changed" in env.kinds(key))
    new = env.engine.last.session_id

    assert new != old and _stored_id(env, key) == new
    assert env.sql("SELECT session_key FROM session_claude_ids WHERE claude_session_id = ?", (old,)) == [(key,)]
    wait_until(lambda: not env.main.chat_manager.get(key).turn_running)
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.client.post(f"/api/chat/sessions/{key}/open")
    assert env.engine.specs[-1].resume == new  # the cleared conversation does not come back


def test_a_reset_then_open_without_sending_then_reopen_does_not_resume_an_id_that_never_had_a_turn(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    assert env.client.post(f"/api/sessions/{key}/reset").json()["status"] == "reset"
    env.client.post(f"/api/chat/sessions/{key}/open")
    first = env.engine.specs[-1]
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.client.post(f"/api/chat/sessions/{key}/open")
    second = env.engine.specs[-1]

    assert first.resume is None and first.session_id
    assert second.resume is None and second.session_id == first.session_id
    # once a turn happened after the reset, the next open resumes
    _send_by_ws(env, key, "after the reset")
    wait_until(lambda: env.kinds(key).count("turn.ended") == 2)
    env.client.post(f"/api/chat/sessions/{key}/close")
    env.client.post(f"/api/chat/sessions/{key}/open")
    assert env.engine.specs[-1].resume == first.session_id


def test_the_key_of_a_v2_session_with_a_suffix_switches_to_the_chat(env):
    key = _seed_pty(env, f"{PROJECT}::claude::abc123")
    env.main.chat_service.history_reader = lambda sid, cwd: []

    done = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert done.status_code == 200 and done.json()["history"] == {"imported": 0}
    assert env.session(key)["agent_id"] == "claude" and env.session(key)["project_ref"] == PROJECT


def test_the_key_is_split_on_its_first_two_parts():
    from app.chat.service import ChatService

    assert ChatService._split_key("Pessoal/TaskNexus-publico::claude::rsvt3t") == ("Pessoal/TaskNexus-publico", "claude")
    assert ChatService._split_key("RD_Station::claude") == ("RD_Station", "claude")


def _transcript(*pairs, prefix="msg"):
    out = []
    for index, (user, assistant) in enumerate(pairs, start=1):
        out.append(SimpleNamespace(type="user", message={"role": "user", "content": user}))
        out.append(SimpleNamespace(type="assistant", message={
            "role": "assistant", "id": f"{prefix}-{index}", "model": "haiku",
            "content": [{"type": "text", "text": assistant}]}))
    return out


def test_going_to_the_terminal_and_back_never_duplicates_and_keeps_the_terminal_turns(env):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    live = _transcript(("hello", "echo: hello"))  # the live assistant message id is msg-1 as well
    env.main.chat_service.history_reader = lambda sid, cwd: live

    assert env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"}).status_code == 200
    back = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})
    assert back.json()["history"] == {"imported": 0}
    assert env.kinds(key).count("message.user") == 1 and env.kinds(key).count("message.assistant") == 1

    env.main.chat_service.history_reader = lambda sid, cwd: _transcript(
        ("hello", "echo: hello"), ("typed in the terminal", "terminal answer"))
    env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"})
    again = env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})

    assert again.json()["history"] == {"imported": 2}
    texts = [e["payload"].get("text") for e in env.events(key)["events"] if e["kind"] == "message.user"]
    assert texts == ["hello", "typed in the terminal"]


TERMINAL_ID = "33333333-3333-4333-8333-333333333333"


def _reset_then_terminal(env, key, terminal_transcript):
    """Chat with a turn -> reset -> open in the terminal with nothing sent in the chat -> the
    terminal starts a new conversation (its own id) -> back to the chat."""
    assert env.client.post(f"/api/sessions/{key}/reset").status_code == 200
    assert env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"}).status_code == 200
    import sqlite3

    conn = sqlite3.connect(env.db)
    conn.execute("UPDATE sessions SET claude_session_id = ? WHERE session_key = ?", (TERMINAL_ID, key))
    conn.commit()
    conn.close()
    env.main.chat_service.history_reader = lambda sid, cwd: terminal_transcript
    return env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "chat", "confirm": True})


def test_back_from_a_terminal_conversation_started_after_a_reset_imports_it_and_resumes_its_id(env):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    back = _reset_then_terminal(env, key, _transcript(("typed in the terminal", "terminal answer"), prefix="term"))

    assert back.status_code == 200 and back.json()["history"] == {"imported": 2}
    texts = [e["payload"].get("text") for e in env.events(key)["events"] if e["kind"] == "message.user"]
    assert texts == ["hello", "typed in the terminal"]
    assert env.client.post(f"/api/chat/sessions/{key}/open").status_code == 200
    spec = env.engine.specs[-1]
    assert spec.resume == TERMINAL_ID and spec.session_id is None


def test_back_from_a_terminal_without_a_conversation_after_a_reset_still_starts_a_new_session(env):
    key = env.create(first_message="hello")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    back = _reset_then_terminal(env, key, [])

    assert back.json()["history"] == {"imported": 0}
    assert env.client.post(f"/api/chat/sessions/{key}/open").status_code == 200
    spec = env.engine.specs[-1]
    assert spec.session_id == TERMINAL_ID and spec.resume is None


def test_terminate_after_open_in_the_terminal_erases_the_chat_data(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    env.client.post(f"/api/chat/sessions/{key}/switch-engine", json={"engine": "pty"})
    assert env.sql("SELECT engine FROM sessions WHERE session_key = ?", (key,)) == [("pty",)]

    assert env.client.post(f"/api/sessions/{key}/terminate").json()["status"] == "terminated"

    for table in ("chat_events", "permission_requests", "chat_sessions", "sessions", "session_was_chat"):
        assert env.sql(f"SELECT COUNT(*) FROM {table} WHERE session_key = ?", (key,)) == [(0,)], table
    assert key not in [s["session_key"] for s in env.sessions()]
    assert env.client.post(f"/api/sessions/{key}/terminate").status_code == 404


def test_an_agent_that_was_removed_fails_the_open_and_the_switch_instead_of_using_another(env):
    env.add_agent(id="work", nome="Work", default=False)
    key = env.create(agent_id="work")
    wait_until(lambda: env.session(key)["live_status"] == "idle")
    env.client.post(f"/api/chat/sessions/{key}/close")
    assert env.client.delete("/api/agents/work").status_code in (200, 204)
    spawns = env.engine.spawns

    opened = env.client.post(f"/api/chat/sessions/{key}/open").json()

    assert opened["status"] == "failed" and opened["last_error"]["reason"] == "agent_unavailable"
    assert env.engine.spawns == spawns and env.session(key)["agent_id"] == "work"
    seeded = _seed_pty(env, f"{PROJECT}::work")
    switch = env.client.post(f"/api/chat/sessions/{seeded}/switch-engine", json={"engine": "chat", "confirm": True})
    assert switch.status_code == 404 and switch.json()["detail"]["code"] == "agent_not_found"


def _slow_spawn(env):
    """The next connects wait until the returned event is set (a thread event: the test thread
    must be able to release a start that the app's loop is waiting on)."""
    import threading

    gate = threading.Event()
    original = env.engine.spawn

    async def spawn(spec, callbacks):
        await asyncio.to_thread(gate.wait, 20)
        return await original(spec, callbacks)

    env.engine.spawn = spawn
    return gate


def test_a_terminate_during_the_connect_leaves_no_process_and_no_registered_runtime(env):
    import threading

    gate = _slow_spawn(env)
    key = env.create(first_message="hi")
    wait_until(lambda: env.main.chat_manager._starting)
    answers = []
    thread = threading.Thread(target=lambda: answers.append(env.client.post(f"/api/sessions/{key}/terminate")))
    thread.start()
    time.sleep(0.3)
    assert answers == []  # waiting for the start, not answering "nothing to close"

    gate.set()
    thread.join(20)

    assert answers and answers[0].status_code == 200
    assert env.main.chat_manager.active() == {} and env.main.chat_manager._starting == {}
    assert env.engine.processes and all(p.closed for p in env.engine.processes)
    assert env.sql("SELECT COUNT(*) FROM chat_sessions WHERE session_key = ?", (key,)) == [(0,)]


def test_a_close_during_the_connect_answers_stopped_with_nothing_left_running(env):
    import threading

    gate = _slow_spawn(env)
    key = env.create(first_message="hi")
    wait_until(lambda: env.main.chat_manager._starting)
    answers = []
    thread = threading.Thread(target=lambda: answers.append(env.client.post(f"/api/chat/sessions/{key}/close")))
    thread.start()
    time.sleep(0.3)
    gate.set()
    thread.join(20)

    assert answers[0].json() == {"status": "stopped"}
    assert env.main.chat_manager.active() == {} and all(p.closed for p in env.engine.processes)
    assert env.engine.processes[0].queries == []  # the first message did not go out


def test_a_first_message_over_the_limit_is_refused_and_a_failed_first_send_is_recorded(env):
    too_long = env.client.post("/api/chat/sessions", json={
        "project_ref": PROJECT, "agent_id": "claude", "first_message": "x" * 100_001})
    assert too_long.status_code == 422 and too_long.json()["detail"]["code"] == "first_message_too_long"
    assert env.engine.spawns == 0

    async def broken(process, text):
        raise RuntimeError("the process refused the query")

    env.engine.on_query = broken
    key = env.create(first_message="hello")
    row = wait_until(lambda: (s := env.session(key))["last_error"] and s)

    assert row["last_error"]["code"] == "first_message_failed" and row["last_error"]["reason"] == "process_error"
    assert any(e["kind"] == "status" and e["payload"].get("code") == "first_message_failed"
               for e in env.events(key)["events"])


def test_an_error_after_the_connect_is_a_failed_start_with_last_error(env):
    original = env.engine.spawn

    async def spawn(spec, callbacks):
        process = await original(spec, callbacks)

        async def broken():
            raise RuntimeError("status call exploded")

        process.get_mcp_status = broken
        return process

    env.engine.spawn = spawn
    key = env.create()
    row = wait_until(lambda: (s := env.session(key))["status"] == "failed" and s)

    assert row["last_error"]["code"] == "spawn_failed" and row["last_error"]["reason"] == "process_error"
    assert env.engine.last.closed


def test_a_probe_that_hits_an_unexpected_error_is_a_502_not_a_500(env):
    env.engine.fail_with = RuntimeError("something nobody expected")

    response = env.client.post("/api/chat/agents/claude/connectors/refresh")

    assert response.status_code == 502 and response.json()["detail"]["code"] == "probe_failed"


@pytest.mark.parametrize("tool,allowed", [("PowerShell", False), ("Task", False), ("NotebookEdit", False),
                                           ("Write", True), ("Edit", True)])
def test_the_card_offers_allow_for_the_conversation_only_for_the_file_editing_tools(env, tool, allowed):
    _ask_on_query(env, tool=tool, tool_input={"command": "Set-Content x 1"} if tool == "PowerShell" else None)
    key = env.create(first_message="ASK tool")
    request = wait_until(lambda: [e for e in env.events(key)["events"] if e["kind"] == "permission.request"])[-1]

    assert request["payload"]["allow_session"] is allowed
    refused = env.client.post(f"/api/chat/permissions/{request['payload']['id']}/decide",
                              json={"behavior": "allow", "scope": "session"})
    assert (refused.status_code == 200) is allowed


def test_a_failing_chat_shutdown_does_not_skip_the_rest_of_the_shutdown(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch):
        import app.main as main_mod

        importlib.reload(main_mod)
        reached = []
        with TestClient(main_mod.app):
            async def broken(timeout=15.0):
                raise asyncio.TimeoutError()

            real_pty = main_mod.pty_manager.shutdown

            async def pty_shutdown():
                reached.append("pty")
                await real_pty()

            main_mod.chat_manager.shutdown = broken
            main_mod.pty_manager.shutdown = pty_shutdown
        closed = main_mod.chat_store._conn is None

    assert reached == ["pty"] and closed
