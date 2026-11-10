"""Permission policy (ADR-44) and the promise that nothing is ever written to settings (CA06a)."""
from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

import pytest

from app.chat import permissions
from app.chat.engine import PermissionDecision

SESSION_ALLOW = {"type": "addRules", "rules": [{"toolName": "Write", "ruleContent": None}],
                 "behavior": "allow", "destination": "session"}


def test_classify_tells_questions_plans_and_tools_apart():
    assert permissions.classify("AskUserQuestion") == "question"
    assert permissions.classify("ExitPlanMode") == "plan"
    assert permissions.classify("Write") == "tool"
    assert permissions.classify("mcp__claude_ai_Claude_Docs__guide") == "tool"


@pytest.mark.parametrize("destination", ["localSettings", "userSettings", "projectSettings", "session", None])
def test_add_rules_allow_is_kept_and_always_rewritten_to_the_session(destination):
    raw = [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "npm test"}],
            "behavior": "allow", "destination": destination}]

    assert permissions.sanitize_suggestions(raw) == [{
        "type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "npm test"}],
        "behavior": "allow", "destination": "session",
    }]


@pytest.mark.parametrize("dropped", [
    {"type": "setMode", "mode": "bypassPermissions", "destination": "session"},
    {"type": "addDirectories", "directories": ["C:/"], "destination": "localSettings"},
    {"type": "removeDirectories", "directories": ["C:/"]},
    {"type": "replaceRules", "rules": [{"toolName": "Bash"}], "behavior": "allow"},
    {"type": "removeRules", "rules": [{"toolName": "Bash"}], "behavior": "allow"},
    {"type": "addRules", "rules": [{"toolName": "Bash"}], "behavior": "deny"},
    {"type": "addRules", "rules": [{"toolName": "Bash"}], "behavior": "ask"},
    {"type": "addRules", "rules": [], "behavior": "allow"},
    {"type": "addRules", "rules": [{"toolName": ""}], "behavior": "allow"},
    "not a dict",
])
def test_every_other_suggestion_is_dropped(dropped):
    assert permissions.sanitize_suggestions([dropped]) == []


def test_sanitize_tolerates_garbage():
    assert permissions.sanitize_suggestions(None) == []
    assert permissions.sanitize_suggestions("x") == []


def test_minimal_rule_is_the_whole_tool_without_content():
    rule = permissions.minimal_session_rule("Write")

    assert rule["rules"] == [{"toolName": "Write", "ruleContent": None}]
    assert rule["destination"] == "session" and rule["behavior"] == "allow"


def test_deny_message_is_english_and_tells_the_model_not_to_work_around_it():
    text = permissions.deny_message("not now")

    assert "Do not try to achieve the same effect another way" in text and "not now" in text
    assert "Do not try" in permissions.deny_message(None)


def _decide(**overrides):
    base = dict(tool_name="Write", tool_input={"file_path": "a"}, suggestions=[], connector=None,
                behavior="allow", scope="once")
    base.update(overrides)
    return permissions.build_decision(**base)


def test_allow_once_remembers_nothing():
    decision = _decide()

    assert decision.behavior == "allow" and decision.updated_permissions == []


def test_allow_for_the_conversation_uses_the_sanitised_suggestion_or_the_minimal_rule():
    assert _decide(scope="session", suggestions=[SESSION_ALLOW]).updated_permissions == [SESSION_ALLOW]
    fallback = _decide(scope="session").updated_permissions
    assert fallback[0]["destination"] == "session" and fallback[0]["rules"][0]["toolName"] == "Write"


def test_a_connector_tool_can_never_be_allowed_for_the_conversation():
    with pytest.raises(permissions.ScopeNotAllowed):
        _decide(scope="session", connector="claude.ai Claude Docs")
    assert _decide(scope="once", connector="claude.ai Claude Docs").behavior == "allow"
    assert permissions.allow_session_possible("mcp__x__y", [], "claude.ai Claude Docs") is False


def _content_rule(tool_name, content):
    return {"type": "addRules", "rules": [{"toolName": tool_name, "ruleContent": content}],
            "behavior": "allow", "destination": "session"}


@pytest.mark.parametrize("tool_name,tool_input", [
    ("Bash", {"command": "echo ok > C:/tmp/x.txt"}),
    ("Bash", {}),
])
def test_bash_can_only_be_allowed_once(tool_name, tool_input):
    assert permissions.allow_session_possible(tool_name, [], None) is False
    with pytest.raises(permissions.ScopeNotAllowed):
        _decide(tool_name=tool_name, tool_input=tool_input, scope="session")
    assert _decide(tool_name=tool_name, tool_input=tool_input, scope="once").behavior == "allow"


@pytest.mark.parametrize("tool_name", ["Write", "Edit"])
def test_a_tool_whose_rule_has_no_content_can_be_allowed_for_the_conversation(tool_name):
    assert permissions.allow_session_possible(tool_name, [], None) is True
    assert permissions.allow_session_possible(tool_name, [_content_rule(tool_name, None)], None) is True
    rules = _decide(tool_name=tool_name, scope="session").updated_permissions
    assert rules[0]["rules"] == [{"toolName": tool_name, "ruleContent": None}]


@pytest.mark.parametrize("tool_name,content", [("WebFetch", "domain:example.com"), ("Read", "//C:/tmp/**")])
def test_a_cli_suggestion_with_rule_content_cannot_be_allowed_for_the_conversation(tool_name, content):
    suggestions = [_content_rule(tool_name, content)]

    assert permissions.allow_session_possible(tool_name, suggestions, None) is False
    with pytest.raises(permissions.ScopeNotAllowed):
        _decide(tool_name=tool_name, suggestions=suggestions, scope="session")
    assert _decide(tool_name=tool_name, suggestions=suggestions, scope="once").updated_permissions == []


def test_one_content_rule_among_several_makes_the_whole_request_once_only():
    suggestions = [_content_rule("Write", None), _content_rule("WebFetch", "domain:example.com")]

    assert permissions.allow_session_possible("Write", suggestions, None) is False


def test_unknown_scope_is_refused():
    with pytest.raises(permissions.ScopeNotAllowed):
        _decide(scope="forever")


def test_deny_carries_the_guiding_message_and_the_interrupt_flag():
    decision = _decide(behavior="deny", message="no files", interrupt=True)

    assert (decision.behavior, decision.interrupt) == ("deny", True)
    assert "no files" in decision.message


def test_answers_become_updated_input_only_for_a_question():
    question = _decide(tool_name="AskUserQuestion", tool_input={"questions": []}, answers={"Color?": "Blue"})
    other = _decide(answers={"x": "y"})

    assert question.updated_input == {"questions": [], "answers": {"Color?": "Blue"}}
    assert other.updated_input is None


def test_build_helpers_use_the_classes_they_are_given_and_import_nothing():
    class Allow:
        def __init__(self, updated_input=None, updated_permissions=None):
            self.updated_input, self.updated_permissions = updated_input, updated_permissions

    class Deny:
        def __init__(self, message="", interrupt=False):
            self.message, self.interrupt = message, interrupt

    class Update:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class Rule:
        def __init__(self, tool_name, rule_content=None):
            self.tool_name, self.rule_content = tool_name, rule_content

    allow = permissions.build_allow(Allow, Update, Rule, PermissionDecision(
        behavior="allow", updated_permissions=[SESSION_ALLOW]))
    deny = permissions.build_deny(Deny, PermissionDecision(behavior="deny", message="m", interrupt=True))

    assert allow.updated_permissions[0].destination == "session"
    assert allow.updated_permissions[0].rules[0].tool_name == "Write"
    assert (deny.message, deny.interrupt) == ("m", True)
    assert "claude_agent_sdk" not in Path(permissions.__file__).read_text(encoding="utf-8").replace(
        "never imports the SDK", "")


# -- CA06a: no decision writes a settings file ----------------------------------------------------------


def _hash_tree(*roots: Path) -> dict[str, str]:
    result = {}
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                result[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


@pytest.mark.asyncio
@pytest.mark.parametrize("behavior,scope", [("allow", "once"), ("allow", "session"), ("deny", "once")])
async def test_no_decision_touches_any_settings_file(tmp_path, monkeypatch, behavior, scope):
    """Fake HOME and a project with `.claude/settings.local.json`: the files hash the same
    before and after a decision made through the runtime with the scripted engine."""
    from tests.chat_fakes import Rig

    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    (home / ".claude" / "settings.json").write_text('{"permissions": {"allow": []}}', encoding="utf-8")
    project = tmp_path / "proj"
    (project / ".claude").mkdir(parents=True)
    (project / ".claude" / "settings.local.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    before = _hash_tree(home, project)

    async with Rig(tmp_path / "chat.db") as rig:
        runtime = await rig.start()
        waiting = rig.engine.last.ask_permission(
            "Write", {"file_path": "a.txt"}, suggestions=[{**SESSION_ALLOW, "destination": "localSettings"}])
        await rig.wait_for(lambda: runtime.pending)
        pid = next(iter(runtime.pending))
        await runtime.decide(pid, behavior=behavior, scope=scope, by="ws")
        result = await asyncio.wait_for(waiting, 2)

    assert result.behavior == behavior
    for update in result.updated_permissions:
        assert update["destination"] == "session"
    assert _hash_tree(home, project) == before
    assert os.path.exists(home / ".claude" / "settings.json")


# -- the closed list of "allow for this conversation" (Decision 1 of 2026-11-10) ---------------------------


@pytest.mark.parametrize("tool_name", ["Write", "Edit", "MultiEdit"])
def test_the_file_editing_tools_can_be_allowed_for_the_conversation(tool_name):
    assert permissions.allow_session_possible(tool_name, [], None) is True


@pytest.mark.parametrize("tool_name", [
    "Bash", "PowerShell", "Task", "Skill", "NotebookEdit", "AskUserQuestion", "ExitPlanMode",
    "WebFetch", "Read", "Glob", "SomeToolANewCliAdds", "mcp__claude_ai_Claude_Docs__guide", "mcp__escritorio-cards__criar_card",
])
def test_every_other_tool_can_only_be_allowed_once(tool_name):
    assert permissions.allow_session_possible(tool_name, [], None) is False
    with pytest.raises(permissions.ScopeNotAllowed):
        permissions.build_decision(tool_name=tool_name, tool_input={}, suggestions=[], connector=None,
                                   behavior="allow", scope="session")
    assert permissions.build_decision(tool_name=tool_name, tool_input={}, suggestions=[], connector=None,
                                      behavior="allow", scope="once").updated_permissions == []


def test_a_connector_tool_stays_once_only_even_with_a_listed_name():
    assert permissions.allow_session_possible("Write", [], "claude.ai Claude Docs") is False


def test_a_suggestion_that_names_another_tool_or_carries_content_blocks_the_button():
    other_tool = [{"type": "addRules", "rules": [{"toolName": "PowerShell", "ruleContent": None}],
                   "behavior": "allow", "destination": "session"}]
    with_content = [{"type": "addRules", "rules": [{"toolName": "Write", "ruleContent": "C:/x/*"}],
                     "behavior": "allow", "destination": "session"}]

    assert permissions.allow_session_possible("Write", other_tool, None) is False
    assert permissions.allow_session_possible("Write", with_content, None) is False


def test_the_card_and_the_refusal_use_the_same_list():
    for tool_name in ("Write", "PowerShell", "Task"):
        possible = permissions.allow_session_possible(tool_name, [], None)
        try:
            permissions.build_decision(tool_name=tool_name, tool_input={}, suggestions=[], connector=None,
                                       behavior="allow", scope="session")
            granted = True
        except permissions.ScopeNotAllowed:
            granted = False
        assert possible is granted


# -- Write/Edit stay inside the conversation's folders (Decision 2) --------------------------------------


def test_an_edit_inside_the_cwd_or_an_added_folder_passes_and_one_outside_asks(tmp_path):
    cwd, extra, outside = tmp_path / "proj", tmp_path / "extra", tmp_path / "other"
    for folder in (cwd / "sub", extra, outside):
        folder.mkdir(parents=True)
    verdict = lambda path, tool="Edit": permissions.edit_path_verdict(  # noqa: E731
        tool, {"file_path": str(path)}, str(cwd), [str(extra)])

    assert verdict(cwd / "a.txt") is None
    assert verdict(cwd / "sub" / "deep" / "new.txt", "Write") is None
    assert verdict(extra / "b.txt") is None
    assert verdict(outside / "c.txt") == "ask"
    assert verdict(tmp_path / "proj-sibling" / "d.txt") == "ask"  # a prefix of the name is not inside


def test_dot_dot_slashes_relative_paths_and_case_are_normalised(tmp_path):
    cwd = tmp_path / "Proj"
    cwd.mkdir()
    outside = tmp_path / "out.txt"
    escaped = f"{cwd}{os.sep}..{os.sep}out.txt"

    assert permissions.edit_path_verdict("Edit", {"file_path": escaped}, str(cwd), []) == "ask"
    assert permissions.edit_path_verdict("Edit", {"file_path": r"..\out.txt"}, str(cwd), []) == "ask"
    assert permissions.edit_path_verdict("Edit", {"file_path": "a/b.txt"}, str(cwd), []) == "ask"  # raw relative: asks
    assert permissions.edit_path_verdict("Edit", {"file_path": str(cwd / "a.txt").replace("\\", "/")}, str(cwd), []) is None
    if os.name == "nt":  # Windows paths ignore case
        assert permissions.edit_path_verdict("Edit", {"file_path": str(cwd / "a.txt").upper()}, str(cwd), []) is None
        assert permissions.edit_path_verdict("Edit", {"file_path": str(outside).upper()}, str(cwd), []) == "ask"


def test_a_link_inside_the_folder_that_points_outside_asks(tmp_path):
    cwd, outside = tmp_path / "proj", tmp_path / "secret"
    cwd.mkdir()
    outside.mkdir()
    link = cwd / "link"
    try:
        os.symlink(outside, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        if os.name != "nt":
            pytest.skip("symlinks are not available")
        import subprocess

        made = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True)
        if made.returncode != 0:
            pytest.skip("neither a symlink nor a junction could be created")

    assert permissions.edit_path_verdict("Write", {"file_path": str(link / "x.txt")}, str(cwd), []) == "ask"


def test_a_missing_or_odd_path_asks_and_other_tools_are_not_gated(tmp_path):
    cwd = str(tmp_path)
    for tool_input in ({}, {"file_path": ""}, {"file_path": None}, {"file_path": 3}, "text", None,
                       {"file_path": "bad\x00name"}):
        assert permissions.edit_path_verdict("Write", tool_input, cwd, []) == "ask"
    assert permissions.edit_path_verdict("Read", {"file_path": "C:/elsewhere/x"}, cwd, []) is None
    assert permissions.edit_path_verdict("PowerShell", {"command": "x"}, cwd, []) is None


@pytest.mark.parametrize("make", [
    lambda inside, outside: "~/x.txt",
    lambda inside, outside: "~",
    lambda inside, outside: "~\\x.txt",
    lambda inside, outside: " " + str(inside / "a.txt"),
    lambda inside, outside: str(inside / "a.txt") + " ",
    lambda inside, outside: "\t" + str(inside / "a.txt"),
    lambda inside, outside: "\n" + str(inside / "a.txt"),
    lambda inside, outside: str(inside / "a.txt") + "\n",
    lambda inside, outside: '"' + str(inside / "a.txt") + '"',
    lambda inside, outside: "'" + str(inside / "a.txt") + "'",
    lambda inside, outside: "a.txt",
    lambda inside, outside: "sub/x.txt",
    lambda inside, outside: "./a.txt",
    lambda inside, outside: "../other/out.txt",
    lambda inside, outside: " " + str(outside / "out.txt"),
    lambda inside, outside: '"' + str(outside / "out.txt") + '"',
], ids=["tilde-slash", "tilde-alone", "tilde-backslash", "leading-space", "trailing-space", "leading-tab",
        "leading-newline", "trailing-newline", "double-quoted", "single-quoted", "bare-name", "relative",
        "dot-relative", "dotdot-relative", "outside-leading-space", "outside-quoted"])
def test_anything_that_is_not_a_clean_absolute_path_asks_even_when_it_could_resolve_inside(tmp_path, make):
    inside, outside = tmp_path / "proj", tmp_path / "other"
    inside.mkdir()
    outside.mkdir()

    assert permissions.edit_path_verdict("Edit", {"file_path": make(inside, outside)}, str(inside), []) == "ask"
    assert permissions.edit_path_verdict("Write", {"file_path": str(inside / "a.txt")}, str(inside), []) is None
