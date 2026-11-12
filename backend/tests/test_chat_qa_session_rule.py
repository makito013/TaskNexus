"""QA coverage for CA06 "allow for this conversation" (cycle 1b, live finding).

Live, with CLI 2.1.318 and SDK 0.1.69, the minimal session rule that `permissions` builds for a
tool without an `addRules` suggestion (e.g. `Write`, whose only suggestion is `setMode`) is
serialised by `PermissionUpdate.to_dict()` as `{"toolName": "Write", "ruleContent": None}`.
The CLI ignores that update (a second `Write` asks again); the same update WITHOUT the
`ruleContent` key is honoured (a second `Write` runs unasked). So a rule without content must
leave the key out of what goes on the wire.

These tests describe the wire format the CLI accepts; they fail until the product omits a null
`ruleContent`.
"""
from __future__ import annotations

import pytest

from app.chat import permissions, sdk_engine


@pytest.fixture
def sdk():
    """The real SDK classes; collected everywhere, skipped (not 'no tests ran') without the package."""
    return pytest.importorskip("claude_agent_sdk")


def _wire_updates(sdk, tool_name: str, tool_input: dict) -> list[dict]:
    decision = permissions.build_decision(
        tool_name=tool_name, tool_input=tool_input, suggestions=[], connector=None,
        behavior="allow", scope="session",
    )
    allow = sdk_engine.permission_result(sdk, decision)
    return [update.to_dict() for update in allow.updated_permissions]


def test_a_tool_wide_session_rule_never_sends_a_null_rule_content(sdk):
    updates = _wire_updates(sdk, "Write", {"file_path": "C:/work/a.txt", "content": "ok"})

    assert len(updates) == 1 and updates[0]["destination"] == "session"
    for rule in updates[0]["rules"]:
        assert rule["toolName"] == "Write"
        assert "ruleContent" not in rule or rule["ruleContent"] is not None


def test_a_bash_session_rule_is_refused_because_the_cli_ignores_rule_content():
    with pytest.raises(permissions.ScopeNotAllowed):
        permissions.build_decision(
            tool_name="Bash", tool_input={"command": "echo ok"}, suggestions=[], connector=None,
            behavior="allow", scope="session",
        )
