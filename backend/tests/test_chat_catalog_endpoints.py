"""`/api/chat` command and model catalog over the real app and the scripted engine (CA26, CA28,
CA29): the per-conversation list, the registry, the model gate, the `commands.changed` frame."""
from __future__ import annotations

import sqlite3

import pytest

from app.chat.api import HTTP_STATUS, _http_error
from app.chat.commands import CommandCatalog
from app.chat.errors import ChatCommandError, ChatError
from tests.chat_fakes import init_message
from tests.test_chat_endpoints import PROJECT, env, wait_until  # noqa: F401 - fixtures
from tests.test_chat_ws import open_ws, read_until


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def home(env, tmp_path):
    """The catalog reads a fake home, never the real `~/.claude`."""
    home = tmp_path / "home"
    service = env.main.chat_service
    service.catalog = CommandCatalog(service.chat_store, home)
    return home


def commands_of(env, key):
    response = env.client.get(f"/api/chat/sessions/{key}/commands")
    assert response.status_code == 200, response.text
    return {item["name"]: item for item in response.json()}


def models_of(env):
    return {item["value"]: item for item in env.client.get("/api/chat/models").json()}


def started(env, **body):
    key = env.create(**body)
    wait_until(lambda: env.session(key)["status"] not in ("new",))
    return key


# -- the list of a conversation (CA26) -------------------------------------------------------------------------


def test_the_list_joins_project_user_plugin_session_and_builtin_commands(env, home, tmp_path):
    write(tmp_path / PROJECT / ".claude" / "commands" / "orquestrador-status.md",
          "---\ndescription: Pipeline status\nargument-hint: '[run]'\n---\n")
    write(home / ".claude" / "skills" / "pausar-trabalho" / "SKILL.md", "---\ndescription: Pause\n---\n")
    write(home / ".claude" / "plugins" / "cache" / "mkt" / "superpowers" / "1.0.0" / "skills" / "brainstorming"
          / "SKILL.md", "---\ndescription: Brainstorm\n---\n")
    env.engine.server_info = {"commands": [{"name": "only-live", "description": "Live", "argumentHint": "<x>"}]}

    async def on_query(process, text):
        process.push(init_message(process.session_id, slash_commands=["compact", "only-live", "login"]))

    env.engine.on_query = on_query
    key = env.create(first_message="hello")
    wait_until(lambda: env.engine.processes and env.engine.last.server_info_calls)

    items = commands_of(env, key)

    assert items["orquestrador-status"] == {
        "name": "orquestrador-status", "description": "Pipeline status", "argument_hint": "[run]",
        "source": "project", "handling": "dispatch", "disable_model_invocation": False}
    assert items["pausar-trabalho"]["source"] == "user"
    assert items["superpowers:brainstorming"]["source"] == "plugin"
    assert items["only-live"]["source"] == "session" and items["only-live"]["argument_hint"] == "<x>"
    assert items["compact"]["source"] == "builtin" and items["model"]["handling"] == "ui"
    assert "login" not in items and "theme" not in items


def test_without_a_live_process_the_list_is_the_disk_and_the_registry(env, home, tmp_path):
    write(tmp_path / PROJECT / ".claude" / "commands" / "mine.md", "---\ndescription: Mine\n---\n")
    key = started(env)
    env.client.post(f"/api/chat/sessions/{key}/close")

    items = commands_of(env, key)
    assert items["mine"]["source"] == "project" and "compact" in items


def test_an_unknown_conversation_is_a_404(env):
    response = env.client.get("/api/chat/sessions/nope::claude::zzzzzz/commands")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "session_not_found"


# -- the registry (CA28) ---------------------------------------------------------------------------------------


def test_put_commands_persists_and_hides_what_is_disabled_or_hidden(env, home):
    key = started(env)
    response = env.client.put("/api/chat/commands", json={"commands": [
        {"name": "compact", "handling": "dispatch", "enabled": False},
        {"name": "my-own", "handling": "dispatch", "description": "Mine", "sort": 5},
    ]})
    assert response.status_code == 200
    registered = {item["name"]: item for item in response.json()}
    assert registered["compact"]["enabled"] is False and registered["compact"]["source"] == "user"
    assert registered["my-own"]["description"] == "Mine" and registered["clear"]["source"] == "seed"
    assert {item["name"] for item in env.client.get("/api/chat/commands").json()} == set(registered)

    items = commands_of(env, key)
    assert "compact" not in items and items["my-own"]["source"] == "builtin"


@pytest.mark.parametrize("body", [
    {"commands": "x"}, {"commands": [{"name": "Bad Name", "handling": "dispatch"}]},
    {"commands": [{"name": "ok", "handling": "nope"}]}, {"other": []},
])
def test_put_commands_refuses_what_is_invalid_in_the_contract_shape(env, body):
    response = env.client.put("/api/chat/commands", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_command"
    assert all(item["name"] != "Bad Name" for item in env.client.get("/api/chat/commands").json())


def test_put_commands_tells_every_reader_of_every_conversation(env, home):
    key = started(env)
    with open_ws(env, key) as first, open_ws(env, key) as second:
        for ws in (first, second):
            read_until(ws, "replay.complete")
        assert env.client.put("/api/chat/commands", json={"commands": [
            {"name": "compact", "handling": "dispatch", "enabled": False}]}).status_code == 200
        frames = [read_until(ws, "commands.changed")[-1] for ws in (first, second)]

    assert all(frame["seq"] is None and frame["session_key"] == key for frame in frames)


def test_the_writes_of_the_catalog_check_the_origin(env):
    for url, body in (("/api/chat/commands", {"commands": []}), ("/api/chat/models", {"models": []})):
        assert env.client.put(url, json=body, headers={"Origin": "http://evil.example"}).status_code == 403
        assert env.client.put(url, json=body).status_code == 200


# -- the models (CA29) -----------------------------------------------------------------------------------------


LONE_SURROGATES = [chr(0xD800), chr(0xDFFF)]


@pytest.mark.parametrize("lone", LONE_SURROGATES)
@pytest.mark.parametrize("field", ["description", "argument_hint"])
def test_put_commands_refuses_a_lone_surrogate_without_a_500(env, lone, field):
    body = {"commands": [{"name": "surrogate-cmd", "handling": "dispatch", field: f"a{lone}b"}]}
    response = env.client.put("/api/chat/commands", json=body)
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_command"
    assert all(item["name"] != "surrogate-cmd" for item in env.client.get("/api/chat/commands").json())


@pytest.mark.parametrize("lone", LONE_SURROGATES)
@pytest.mark.parametrize("field", ["description", "display_name"])
def test_put_models_refuses_a_lone_surrogate_without_a_500(env, lone, field):
    body = {"models": [{"value": "surrogate-model", "display_name": "Name", field: f"a{lone}b"}]}
    response = env.client.put("/api/chat/models", json=body)
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_model"
    assert "surrogate-model" not in models_of(env)


def test_models_are_seeded_once_and_the_edits_survive_another_boot(env):
    assert list(models_of(env)) == ["fable", "opus", "sonnet", "haiku"]
    assert env.client.put("/api/chat/models", json={"models": [
        {"value": "opus", "display_name": "My Opus", "enabled": False}]}).status_code == 200

    from app.chat.store import ChatStore

    async def reboot():
        again = ChatStore(db_path=str(env.db))
        await again.initialize()
        try:
            return await again.list_models()
        finally:
            await again.close()

    import asyncio

    models = {m["value"]: m for m in asyncio.run(reboot())}
    assert len(models) == 4 and models["opus"]["display_name"] == "My Opus" and models["opus"]["enabled"] is False
    assert [row[0] for row in env.sql("SELECT COUNT(*) FROM chat_commands")] == [19]


@pytest.mark.parametrize("body", [{"models": [{"value": "--mcp-config=x"}]}, {"models": {}}, {"models": [{"value": "a b"}]}])
def test_put_models_refuses_what_is_invalid(env, body):
    response = env.client.put("/api/chat/models", json=body)
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_model"


def test_the_models_of_the_binary_join_at_the_first_init_as_server_info(env):
    env.engine.server_info = {"models": [{"value": "default", "displayName": "Default", "description": "Best"},
                                         {"value": "opus", "displayName": "Opus 5.5"}]}
    key = env.create(first_message="hello")
    wait_until(lambda: "default" in models_of(env))

    models = models_of(env)
    assert models["default"]["source"] == "server_info" and models["default"]["display_name"] == "Default"
    assert models["opus"]["source"] == "seed" and models["opus"]["display_name"] == "Opus"  # not overwritten
    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "set_model", "model": "default"})
        assert read_until(ws, "model.changed")[-1]["model"] == "default"


def test_set_model_outside_the_catalog_is_rejected_and_inside_it_is_confirmed_at_once(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))

    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "set_model", "model": "gpt-9", "request_id": "r1"})
        rejected = read_until(ws, "command.rejected")[-1]
        ws.send_json({"type": "set_model", "model": "sonnet"})  # no turn in between: the CLI answered
        changed = read_until(ws, "model.changed")[-1]

    assert rejected["code"] == "model_not_allowed" and rejected["request_id"] == "r1"
    assert changed["model"] == "sonnet" and ("set_model", "sonnet") in env.engine.last.calls
    assert ("set_model", "gpt-9") not in env.engine.last.calls
    assert env.session(key)["model"] == "sonnet"


def test_a_model_the_user_turned_off_is_refused_by_set_model_and_by_create(env):
    key = started(env)
    env.client.put("/api/chat/models", json={"models": [{"value": "haiku", "enabled": False}]})

    with open_ws(env, key) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "set_model", "model": "haiku"})
        assert read_until(ws, "command.rejected")[-1]["code"] == "model_not_allowed"

    refused = env.client.post("/api/chat/sessions", json={"project_ref": PROJECT, "agent_id": "claude", "model": "haiku"})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "model_not_allowed"
    assert env.client.post("/api/chat/sessions", json={
        "project_ref": PROJECT, "agent_id": "claude", "model": "sonnet"}).status_code == 201


def test_set_model_without_a_process_checks_the_catalog_too(env):
    key = started(env)
    env.client.post(f"/api/chat/sessions/{key}/close")

    with open_ws(env, key) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "set_model", "model": "nope"})
        assert read_until(ws, "command.rejected")[-1]["code"] == "model_not_allowed"
        ws.send_json({"type": "set_model", "model": "opus"})
        assert read_until(ws, "model.changed")[-1]["model"] == "opus"


# -- commands the app handles itself (task 5) --------------------------------------------------------------------


def test_a_ui_command_sent_as_a_message_is_rejected_and_never_reaches_the_process(env):
    key = env.create(first_message="hi")
    wait_until(lambda: "turn.ended" in env.kinds(key))
    queries = list(env.engine.last.queries)

    with open_ws(env, key, since=env.events(key)["last_seq"]) as ws:
        read_until(ws, "replay.complete")
        ws.send_json({"type": "send", "text": "/model sonnet", "request_id": "m1"})
        rejected = read_until(ws, "command.rejected")[-1]
        ws.send_json({"type": "send", "text": "/compact"})  # a `dispatch` command goes through
        read_until(ws, "turn.ended")

    assert rejected["code"] == "invalid_frame" and rejected["request_id"] == "m1"
    assert env.engine.last.queries == queries + ["/compact"]
    assert "/model sonnet" not in [e["payload"].get("text") for e in env.events(key)["events"]]


def test_a_ui_command_as_the_first_message_is_refused_before_a_conversation_exists(env):
    response = env.client.post("/api/chat/sessions", json={
        "project_ref": PROJECT, "agent_id": "claude", "first_message": "/model opus"})

    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_frame"
    assert env.sessions() == []


# -- one family of errors -------------------------------------------------------------------------------------


def test_a_command_error_on_a_rest_route_has_a_status_of_the_contract_and_is_never_a_500(env):
    for code in ("model_not_allowed", "mode_not_allowed", "invalid_frame", "process_error", "engine_unavailable",
                 "permission_not_found", "already_decided", "permission_expired", "scope_not_allowed"):
        assert _http_error(ChatCommandError(code, "x")).status_code == HTTP_STATUS[code]
    assert _http_error(ChatError("some_new_code")).status_code == 400
    assert _http_error(ChatCommandError("model_not_allowed")).detail == {
        "code": "model_not_allowed", "message": "model_not_allowed"}


def test_the_statuses_of_the_contract_did_not_move(env):
    expected = {"permission_not_found": 404, "already_decided": 409, "permission_expired": 410,
                "scope_not_allowed": 422, "session_not_found": 404, "engine_conflict": 409,
                "engine_unavailable": 503, "probe_failed": 502, "invalid_engine": 422}
    assert {code: HTTP_STATUS[code] for code in expected} == expected


def test_the_registry_tables_exist_next_to_the_other_chat_tables(env):
    tables = {row[0] for row in env.sql("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"chat_commands", "chat_models"} <= tables
    conn = sqlite3.connect(env.db)
    try:
        assert conn.execute("SELECT source FROM chat_models WHERE value = 'haiku'").fetchone() == ("seed",)
    finally:
        conn.close()
