"""The command catalog (CA26, CA28, CA30), the model gate and what the runtime does at an `init`
(CA16f, CA29), over temporary trees and the scripted engine: no SDK, no binary, nothing of the
real `~/.claude`."""
from __future__ import annotations

import asyncio
import json

import pytest
import pytest_asyncio

from app.chat.commands import (
    CommandCatalog,
    command_name,
    validate_command_items,
    validate_model_items,
)
from app.chat.engine import ConnectorPolicy
from app.chat.errors import ChatCommandError
from app.chat.runtime import InitInfo
from app.chat.store import ChatStore
from tests.chat_fakes import KEY, Rig, init_message

pytestmark = pytest.mark.asyncio


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def front(**fields):
    lines = [f"{key}: {value}" for key, value in fields.items()]
    return "---\n" + "\n".join(lines) + "\n---\nbody\n"


@pytest.fixture
def tree(tmp_path):
    """A project with a command, a skill and a nested command; an extra folder; a fake home with a
    user command and skill, plugins in the cache layout."""
    project, extra, home = tmp_path / "proj", tmp_path / "extra", tmp_path / "home"
    write(project / ".claude" / "commands" / "orquestrador-status.md", front(
        description="Mostra o pipeline", **{"argument-hint": "[run]", "disable-model-invocation": "true"}))
    write(project / ".claude" / "commands" / "sub" / "deploy.md", front(description="Deploy"))
    write(project / ".claude" / "skills" / "x" / "SKILL.md", front(name="x", description="Skill X"))
    write(extra / ".claude" / "commands" / "extra-cmd.md", front(description="From the extra folder"))
    write(home / ".claude" / "commands" / "mine.md", front(description="Mine"))
    write(home / ".claude" / "skills" / "pausar-trabalho" / "SKILL.md", front(description="Pause the work"))
    write(home / ".claude" / "plugins" / "cache" / "mkt" / "plug" / "1.0.0" / "skills" / "y" / "SKILL.md",
          front(description="Plugin skill"))
    write(home / ".claude" / "plugins" / "cache" / "mkt" / "plug" / "1.0.0" / "commands" / "z.md",
          front(description="Plugin command"))
    return project, extra, home


@pytest_asyncio.fixture
async def store(tmp_path):
    chat_store = ChatStore(db_path=str(tmp_path / "catalog.db"))
    await chat_store.initialize()
    yield chat_store
    await chat_store.close()


def by_name(items):
    return {item["name"]: item for item in items}


async def listed(store, home, cwd, add_dirs=(), live=None, key="k"):
    return by_name(await CommandCatalog(store, home).for_session(key, str(cwd), [str(d) for d in add_dirs], live))


# -- the disk: project, add_dirs, user, plugins (CA26, CA30) ---------------------------------------------------


async def test_every_source_on_disk_is_listed_with_its_frontmatter(tree, store):
    project, extra, home = tree
    items = await listed(store, home, project, [extra])

    assert items["orquestrador-status"]["source"] == "project"
    assert items["orquestrador-status"]["description"] == "Mostra o pipeline"
    assert items["orquestrador-status"]["argument_hint"] == "[run]"
    assert items["orquestrador-status"]["disable_model_invocation"] is True
    assert items["sub:deploy"]["source"] == "project"
    assert items["x"]["source"] == "project" and items["x"]["description"] == "Skill X"
    assert items["extra-cmd"]["source"] == "project"
    assert items["mine"]["source"] == "user" and items["pausar-trabalho"]["source"] == "user"
    assert items["plug:y"]["source"] == "plugin" and items["plug:z"]["source"] == "plugin"
    assert items["compact"]["source"] == "builtin" and items["compact"]["handling"] == "dispatch"
    assert items["model"]["handling"] == "ui"


async def test_the_installed_plugins_file_wins_over_the_cache_layout(tree, store):
    _, _, home = tree
    plugins = home / ".claude" / "plugins"
    write(plugins / "store" / "elsewhere" / "skills" / "only-here" / "SKILL.md", front(description="Via the file"))
    write(plugins / "installed_plugins.json", json.dumps({"version": 2, "plugins": {
        "named@market": [{"scope": "user", "installPath": str(plugins / "store" / "elsewhere")}],
        "outside@market": [{"scope": "user", "installPath": str(home.parent)}],
    }}))
    write(home / ".claude" / "settings.json", json.dumps({"enabledPlugins": {"named@market": True}}))
    items = await listed(store, home, home / "empty")

    assert items["named:only-here"]["source"] == "plugin"
    assert "plug:y" not in items  # the file lists the installed ones; the cache is only the fallback
    assert not any(name.startswith("outside:") for name in items)  # an install path outside ~/.claude/plugins


async def test_a_plugin_turned_off_in_the_settings_is_not_listed(tree, store):
    _, _, home = tree
    plugins = home / ".claude" / "plugins"
    for name in ("on", "off"):
        write(plugins / "store" / name / "commands" / f"{name}-cmd.md", front(description=name))
    write(plugins / "installed_plugins.json", json.dumps({"version": 2, "plugins": {
        "on@market": [{"scope": "user", "installPath": str(plugins / "store" / "on")}],
        "off@market": [{"scope": "user", "installPath": str(plugins / "store" / "off")}],
    }}))
    write(home / ".claude" / "settings.json", json.dumps({"enabledPlugins": {"on@market": True, "off@market": False}}))
    items = await listed(store, home, home / "empty")

    assert "on:on-cmd" in items and not any(name.startswith("off:") for name in items)


@pytest.mark.parametrize("settings", [None, "{not json", json.dumps({"other": 1}), json.dumps([1])])
async def test_without_a_readable_enabled_plugins_the_cache_layout_is_used(tree, store, settings):
    _, _, home = tree
    plugins = home / ".claude" / "plugins"
    write(plugins / "store" / "reg" / "commands" / "reg-cmd.md", front(description="Registry only"))
    write(plugins / "installed_plugins.json", json.dumps({"version": 2, "plugins": {
        "reg@market": [{"scope": "user", "installPath": str(plugins / "store" / "reg")}]}}))
    if settings is not None:
        write(home / ".claude" / "settings.json", settings)
    items = await listed(store, home, home / "empty")

    assert "plug:z" in items and "reg:reg-cmd" not in items


async def test_an_unreadable_installed_plugins_file_falls_back_to_the_cache(tree, store):
    _, _, home = tree
    write(home / ".claude" / "plugins" / "installed_plugins.json", "{broken")
    write(home / ".claude" / "settings.json", json.dumps({"enabledPlugins": {"plug@mkt": True}}))

    assert "plug:z" in await listed(store, home, home / "empty")


async def test_an_orphaned_plugin_version_in_the_cache_is_ignored(tree, store):
    _, _, home = tree
    version = home / ".claude" / "plugins" / "cache" / "mkt" / "plug" / "0.9.0"
    write(version / "skills" / "old" / "SKILL.md", front(description="Old"))
    write(version / ".orphaned_at", "123")

    assert "plug:old" not in await listed(store, home, home / "empty")


async def test_a_command_that_is_not_user_invocable_is_hidden(tree, store):
    project, _, home = tree
    write(project / ".claude" / "skills" / "internal" / "SKILL.md", front(**{"user-invocable": "false"}))

    items = await listed(store, home, project)
    assert "internal" not in items and "x" in items


async def test_broken_oversized_or_aliased_frontmatter_is_an_item_without_description(tree, store):
    project, _, home = tree
    commands = project / ".claude" / "commands"
    write(commands / "broken.md", "---\ndescription: [unclosed\n---\n")
    write(commands / "unreadable.md", "\xff\xfe not text at all")
    write(commands / "huge.md", "---\ndescription: " + "a" * 200_000 + "\n---\n")
    write(commands / "bomb.md", "---\na: &a [x, x]\ndescription: *a\n---\n")
    write(commands / "list-hint.md", "---\ndescription: ok\nargument-hint: [issue, flag]\n---\n")

    items = await listed(store, home, project)

    for name in ("broken", "unreadable", "huge", "bomb"):
        assert items[name]["description"] == "", name
    assert items["list-hint"]["description"] == "ok" and items["list-hint"]["argument_hint"] == "[issue flag]"


async def test_the_first_folder_to_define_a_name_wins(tree, store):
    project, extra, home = tree
    write(extra / ".claude" / "commands" / "orquestrador-status.md", front(description="Extra copy"))

    items = await listed(store, home, project, [extra])
    assert items["orquestrador-status"]["description"] == "Mostra o pipeline"


# -- the live process and the registry (CA26, CA28) ------------------------------------------------------------


LIVE = InitInfo(
    slash_commands=["compact", "orquestrador-status", "only-in-session", "login", "superpowers:brainstorming"],
    commands=[
        {"name": "orquestrador-status", "description": "From the session", "argumentHint": "[session hint]"},
        {"name": "only-in-session", "description": "Session only", "argumentHint": "<x>"},
        {"name": "compact", "description": "Session compact", "argumentHint": ""},
    ],
)


async def test_names_only_the_session_knows_are_listed_as_session_and_metadata_prefers_the_disk(tree, store):
    project, _, home = tree
    items = await listed(store, home, project, live=LIVE)

    assert items["only-in-session"]["source"] == "session"
    assert items["only-in-session"]["argument_hint"] == "<x>"
    assert items["superpowers:brainstorming"]["source"] == "session"  # a name with no description at all
    assert items["orquestrador-status"]["description"] == "Mostra o pipeline"  # disk over session
    assert items["orquestrador-status"]["argument_hint"] == "[run]"
    assert items["compact"]["description"] == "Session compact"  # session over the registry
    assert items["compact"]["source"] == "builtin"


async def test_without_a_live_process_the_list_is_the_disk_and_the_registry(tree, store):
    project, _, home = tree
    items = await listed(store, home, project, live=None)

    assert "only-in-session" not in items
    assert {"orquestrador-status", "compact", "model"} <= items.keys()


async def test_disabled_and_hidden_commands_do_not_appear_and_the_terminal_ones_never_dispatch(tree, store):
    project, _, home = tree
    await store.put_commands(validate_command_items([
        {"name": "compact", "handling": "dispatch", "enabled": False},
        {"name": "clear", "handling": "hidden"},
        {"name": "theme", "handling": "dispatch"},  # even asked for: a terminal-only command
        {"name": "orquestrador-status", "handling": "hidden"},  # the registry also silences a disk command
    ]))
    items = await listed(store, home, project, live=LIVE)

    for name in ("compact", "clear", "login", "theme", "orquestrador-status"):
        assert name not in items, name
    assert items["context"]["handling"] == "dispatch"


async def test_the_registry_handling_wins_over_what_the_disk_says(tree, store):
    project, _, home = tree
    await store.put_commands(validate_command_items([{"name": "sub:deploy", "handling": "ui"}]))

    assert (await listed(store, home, project))["sub:deploy"]["handling"] == "ui"


async def test_the_list_is_cached_per_conversation_until_it_is_invalidated(tree, store):
    project, _, home = tree
    catalog = CommandCatalog(store, home)
    first = by_name(await catalog.for_session("k", str(project), [], None))
    write(project / ".claude" / "commands" / "later.md", front(description="Added later"))
    assert "later" not in by_name(await catalog.for_session("k", str(project), [], None)) and "later" not in first

    catalog.invalidate("k")
    assert "later" in by_name(await catalog.for_session("k", str(project), [], None))


# -- what the client may send ---------------------------------------------------------------------------------


@pytest.mark.parametrize("raw", [
    "not a list", [1], [{"handling": "dispatch"}], [{"name": "Upper", "handling": "dispatch"}],
    [{"name": "/slash", "handling": "dispatch"}], [{"name": "a", "handling": "other"}],
    [{"name": "a", "handling": "ui", "enabled": "yes"}], [{"name": "a", "handling": "ui", "sort": True}],
    [{"name": "a", "handling": "ui"}, {"name": "a", "handling": "ui"}],
    [{"name": "a", "handling": "ui", "description": "x" * 501}],
    [{"name": f"c{n}", "handling": "ui"} for n in range(201)],
])
async def test_invalid_command_entries_are_refused(raw):
    with pytest.raises(ChatCommandError) as refused:
        validate_command_items(raw)
    assert refused.value.code == "invalid_command"


async def test_valid_command_entries_are_normalised():
    assert validate_command_items([{"name": "ns:cmd_1", "handling": "dispatch"}]) == [{
        "name": "ns:cmd_1", "handling": "dispatch", "enabled": True, "sort": 0,
        "description": None, "argument_hint": None,
    }]


@pytest.mark.parametrize("raw", [
    {}, [{"value": "--mcp-config=x"}], [{"value": ""}], [{"value": "a", "display_name": " "}],
    [{"value": "a"}, {"value": "a"}], [{"value": "a", "enabled": 1}],
])
async def test_invalid_model_entries_are_refused(raw):
    with pytest.raises(ChatCommandError) as refused:
        validate_model_items(raw)
    assert refused.value.code == "invalid_model"


async def test_a_model_entry_without_a_display_name_shows_its_value():
    assert validate_model_items([{"value": "opus[1m]"}])[0]["display_name"] == "opus[1m]"


@pytest.mark.parametrize("text,name", [
    ("/model sonnet", "model"), ("/Model", "model"), ("/ns:cmd arg", "ns:cmd"), ("hello /model", ""),
    ("/", ""), ("//etc/passwd", ""), ("/ model", ""),
])
async def test_the_command_a_message_starts_with(text, name):
    assert command_name(text) == name


# -- the registry in the store ---------------------------------------------------------------------------------


async def test_seeds_are_idempotent_and_keep_the_users_edits(tmp_path):
    path = str(tmp_path / "seeds.db")
    first = ChatStore(db_path=path)
    await first.initialize()
    assert [m["value"] for m in await first.list_models()] == ["fable", "opus", "sonnet", "haiku"]
    await first.put_models(validate_model_items([{"value": "opus", "display_name": "Mine", "enabled": False}]))
    await first.put_commands(validate_command_items([{"name": "compact", "handling": "hidden"}]))
    await first.close()

    second = ChatStore(db_path=path)
    await second.initialize()
    models, commands = {m["value"]: m for m in await second.list_models()}, {c["name"]: c for c in await second.list_commands()}
    await second.close()

    assert len(models) == 4 and models["opus"]["display_name"] == "Mine" and models["opus"]["enabled"] is False
    assert models["opus"]["source"] == "user" and models["haiku"]["source"] == "seed"
    assert commands["compact"]["handling"] == "hidden" and commands["compact"]["source"] == "user"
    assert commands["model"]["handling"] == "ui" and commands["clear"]["handling"] == "dispatch"
    assert {n for n, c in commands.items() if c["handling"] == "hidden"} >= {"login", "logout", "theme",
                                                                          "terminal-setup", "permissions", "resume"}


async def test_models_of_the_binary_join_the_catalog_without_touching_what_is_there(store):
    await store.put_models(validate_model_items([{"value": "opus", "display_name": "Mine"}]))
    await store.seed_models_from_server_info([
        {"value": "opus", "displayName": "Opus 5.5"}, {"value": "default", "displayName": "Default", "description": "d"},
        {"value": "--evil"}, {"displayName": "no value"}, {"value": "opus[1m]"},
    ])
    models = {m["value"]: m for m in await store.list_models()}

    assert models["opus"]["display_name"] == "Mine" and models["opus"]["source"] == "user"
    assert models["default"]["source"] == "server_info" and models["default"]["description"] == "d"
    assert models["opus[1m]"]["display_name"] == "opus[1m]"
    assert "--evil" not in models and len(models) == 6


# -- the runtime: the init, in the owner task (ADR-39) ---------------------------------------------------------


async def test_the_init_asks_the_process_for_its_info_from_the_owner_task_and_tells_the_service_once(tmp_path):
    async with Rig(tmp_path / "chat.db") as rig:
        rig.engine.server_info = {
            "commands": [{"name": "compact", "description": "d", "argumentHint": ""}, "junk"],
            "models": [{"value": "default"}], "account": {"email": "never read"},
        }

        async def on_query(process, text):
            process.push(init_message(process.session_id, slash_commands=["compact", "mine"]))

        rig.engine.on_query = on_query
        runtime = await rig.start()
        await runtime.submit("send", text="one")
        await rig.wait_for(lambda: rig.inits)
        await runtime.submit("send", text="two")  # the same init again: nothing new to tell
        await rig.wait_for(lambda: rig.engine.last.server_info_calls == 2)

    assert rig.inits == [InitInfo(slash_commands=["compact", "mine"], commands=rig.engine.server_info["commands"][:1],
                                  models=[{"value": "default"}])]
    assert rig.engine.violations == []


async def test_a_process_that_cannot_give_its_info_does_not_break_the_conversation(tmp_path):
    async with Rig(tmp_path / "chat.db") as rig:
        runtime = await rig.start()

        async def failing():
            raise RuntimeError("no info")

        rig.engine.last.get_server_info = failing
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: not runtime.turn_running)
        await runtime.submit("send", text="again")

    assert rig.inits == [] and "turn.ended" in await rig.kinds()


# -- CA16f: the init's own server list ------------------------------------------------------------------------


async def test_a_connector_the_init_reports_outside_the_allowlist_closes_the_process(tmp_path):
    async with Rig(tmp_path / "chat.db") as rig:
        async def on_query(process, text):
            process.push(init_message(process.session_id, tools=["Read"], mcp_servers=[
                {"name": "claude.ai Claude Docs", "status": "connected", "source": "claudeai"},
                {"name": "claude.ai Rovo", "status": "needs-auth", "source": "claudeai"},
                {"name": "escritorio-cards", "status": "connected", "scope": "dynamic"}]))

        rig.engine.on_query = on_query
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: rig.closed)

    status = [e["payload"] for e in await rig.events("status")]
    assert status[0]["reason"] == "connector_exposed" and "claude.ai Claude Docs" in status[0]["detail"]
    assert "needs-auth" not in status[0]["detail"] and "escritorio" not in status[0]["detail"]
    assert rig.engine.last.closed and (await rig.store.get_chat_session(KEY))["status"] == "failed"
    assert await rig.events("session.started") == []


async def test_with_an_allowlist_a_connector_nobody_blocks_closes_the_process_and_a_known_one_does_not(tmp_path):
    policy = ConnectorPolicy(allowed=("claude.ai Claude Docs",), known=(
        {"name": "claude.ai Claude Docs", "tool_prefix": "mcp__claude_ai_Claude_Docs__"},
        {"name": "claude.ai Google Drive", "tool_prefix": "mcp__claude_ai_Google_Drive__"}))
    servers = [{"name": "claude.ai Claude Docs", "status": "connected", "source": "claudeai"},
               {"name": "claude.ai Google Drive", "status": "connected", "source": "claudeai"}]
    async with Rig(tmp_path / "ok.db", connector_policy=policy) as rig:
        async def on_query(process, text):
            process.push(init_message(process.session_id, mcp_servers=servers))

        rig.engine.on_query = on_query
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: rig.engine.last.queries == ["hi"])
        await asyncio.sleep(0.2)  # the init is read and audited after the query went out
        assert runtime.alive and "session.started" in await rig.kinds()

    async with Rig(tmp_path / "new.db", connector_policy=policy) as rig:
        async def new_connector(process, text):
            process.push(init_message(process.session_id, mcp_servers=servers + [
                {"name": "claude.ai Brand New", "status": "connected", "source": "claudeai"}]))

        rig.engine.on_query = new_connector
        runtime = await rig.start()
        await runtime.submit("send", text="hi")
        await rig.wait_for(lambda: rig.closed)

    assert (await rig.events("status"))[0]["payload"]["reason"] == "connector_exposed"


# -- CA29: set_model with a live process -----------------------------------------------------------------------


async def test_a_model_the_cli_refuses_is_neither_announced_nor_stored(tmp_path):
    async with Rig(tmp_path / "chat.db", model="haiku") as rig:
        runtime = await rig.start()
        rig.engine.set_model_error = RuntimeError("control request failed")
        with pytest.raises(ChatCommandError) as refused:
            await runtime.submit("set_model", model="sonnet")

    assert refused.value.code == "process_error"
    assert await rig.events("model.changed") == []
    assert (await rig.store.get_chat_session(KEY))["model"] is None  # the Rig row never had one


async def test_the_confirmation_updates_the_stored_model_and_the_state_frame(tmp_path):
    async with Rig(tmp_path / "chat.db", model="haiku") as rig:
        runtime = await rig.start()
        reader, _ = await rig.hub.add_reader()
        await runtime.submit("set_model", model="sonnet")
        frames = []
        while not reader.queue.empty():
            frames.append(reader.queue.get_nowait())

    assert [f["type"] for f in frames if f["type"] in ("model.changed", "session.state")] == ["model.changed", "session.state"]
    assert [f for f in frames if f["type"] == "session.state"][-1]["model"] == "sonnet"
    assert (await rig.store.get_chat_session(KEY))["model"] == "sonnet"
