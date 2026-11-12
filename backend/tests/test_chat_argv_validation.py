"""GHSA-h4mw-j7qp-8mwm / CVE-2026-96620 (claude-agent-sdk < 0.2.121, we pin 0.1.69).

The SDK turns `resume`, `session_id`, `model` and `add_dirs` into raw argv, so a value that
starts with `-` becomes a flag of the CLI (`--mcp-config=...` runs a command). Decision of
the user: keep 0.1.69 and validate every such value before the spawn, with a test.
"""
from __future__ import annotations

import asyncio

import pytest

from app.chat import engine as engine_module
from app.chat.engine import (
    ArgvValueError,
    ChatSpec,
    EngineCallbacks,
    ResumeFailed,
    SpawnFailed,
    validate_add_dirs,
    validate_model,
    validate_session_id,
)
from app.chat.sdk_engine import AgentSdkEngine

GOOD_UUID = "3a67aea6-2d96-4b50-b409-d89bc7e9f034"
EVIL = [
    "--mcp-config=" + '{"mcpServers":{"x":{"command":"calc.exe"}}}',
    "--mcp-config",
    "-p",
    "--dangerously-skip-permissions",
    "--settings=evil.json",
    "--add-dir=C:/",
    "-",
    "",
]


async def _no_tool(*args):  # pragma: no cover - never called
    raise AssertionError


async def _no_stop(payload):  # pragma: no cover
    return None


CALLBACKS = EngineCallbacks(can_use_tool=_no_tool, on_stop=_no_stop)


def _spec(**overrides) -> ChatSpec:
    base = dict(cli_path="C:/bin/claude.exe", cwd="C:/work/proj", session_id=GOOD_UUID)
    base.update(overrides)
    return ChatSpec(**base)


# -- the validators ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("value", EVIL + ["not-a-uuid", GOOD_UUID + "x", " " + GOOD_UUID, GOOD_UUID + "\n", None, 5, [GOOD_UUID]])
def test_session_ids_must_be_uuids(value):
    with pytest.raises(ArgvValueError):
        validate_session_id(value, "resume")
    assert not engine_module.is_valid_session_id(value)


def test_a_uuid_passes_and_is_canonicalised():
    assert validate_session_id(GOOD_UUID.upper()) == GOOD_UUID


@pytest.mark.parametrize("value", EVIL + ["-opus", "a b", "a;b", "a" * 65, "model\n", None, 5, "$(calc)"])
def test_models_must_look_like_an_alias_or_an_id(value):
    with pytest.raises(ArgvValueError):
        validate_model(value)


@pytest.mark.parametrize("value", ["haiku", "sonnet", "opus[1m]", "claude-sonnet-4-5-20250929", "fable"])
def test_real_aliases_and_ids_pass(value):
    assert validate_model(value) == value


@pytest.mark.parametrize("bad", [
    ["--mcp-config=x"], ["-x"], ["relative/dir"], [""], ["C:/ok", "--evil"], ["C:/a\nb"], "C:/work", [5],
])
def test_add_dirs_must_be_absolute_paths_not_starting_with_a_dash(bad):
    with pytest.raises(ArgvValueError):
        validate_add_dirs(bad)


def test_absolute_folders_from_the_registry_pass():
    assert validate_add_dirs(["C:/work/b", "D:\\projects\\c", "/home/u/d"]) == ["C:/work/b", "D:\\projects\\c", "/home/u/d"]


@pytest.mark.parametrize("mode", ["bypassPermissions", "dontAsk", "--x", "", "acceptEdits "])
def test_only_the_three_modes_may_reach_the_cli(mode):
    with pytest.raises(ArgvValueError):
        _spec(permission_mode=mode).validate()


# -- nothing invalid reaches the SDK ------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("evil", EVIL[:5])
@pytest.mark.parametrize("field,exc", [("resume", ResumeFailed), ("session_id", SpawnFailed),
                                       ("model", SpawnFailed), ("add_dirs", SpawnFailed)])
async def test_spawn_refuses_an_invalid_value_before_loading_the_sdk(monkeypatch, field, exc, evil):
    loaded = []
    monkeypatch.setattr("app.chat.sdk_engine.load_sdk", lambda: loaded.append(1) or pytest.fail("SDK loaded"))
    spec = _spec(session_id=None if field == "resume" else GOOD_UUID)
    setattr(spec, field, [evil] if field == "add_dirs" else evil)

    with pytest.raises(exc) as refused:
        await AgentSdkEngine().spawn(spec, CALLBACKS)

    assert loaded == []
    assert field in str(refused.value) or "invalid" in str(refused.value)
    if exc is SpawnFailed:
        assert refused.value.reason == "process_error"
