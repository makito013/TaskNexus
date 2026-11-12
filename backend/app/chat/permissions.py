"""Permission policy of the chat (ADR-44): no SDK import, no I/O beyond resolving paths.

Rules that never bend:
- "Allow for this conversation" only ever means `destination: "session"`: nothing is written
  to any settings file, user, project or local (DP4, CA06a).
- Of the SDK's `suggestions` only `addRules` with `behavior: "allow"` survive, rewritten to
  the session destination. Modes, directories, deny/ask rules and replace/remove are dropped.
- "Allow for this conversation" exists only for a closed list of file-editing tools
  (`SESSION_ALLOWED_TOOLS`); every other tool (Bash, PowerShell, Task, connectors, tools a new
  CLI adds) can only be allowed once. See `allow_session_possible`.
- A denial tells the model not to work around it (A14).
"""
from __future__ import annotations

import os
from typing import Iterable

from .engine import PermissionDecision

QUESTION_TOOL = "AskUserQuestion"
PLAN_TOOL = "ExitPlanMode"
SESSION_DESTINATION = "session"
# The only tools "allow for this conversation" may be offered for: edits of one file, whose
# `file_path` the PreToolUse gate below keeps inside the conversation's folders. `MultiEdit`
# is in the CLI's tool list too. `NotebookEdit` is left out on purpose (it takes
# `notebook_path`, and a notebook cell can run code).
SESSION_ALLOWED_TOOLS = frozenset({"Write", "Edit", "MultiEdit"})


class ScopeNotAllowed(Exception):
    """`session` was asked for a tool that cannot be remembered."""


def classify(tool_name: str) -> str:
    """tool | question | plan: which kind of card the request needs."""
    if tool_name == QUESTION_TOOL:
        return "question"
    if tool_name == PLAN_TOOL:
        return "plan"
    return "tool"


def _session_rule(rules: list[dict]) -> dict:
    return {
        "type": "addRules",
        "rules": rules,
        "behavior": "allow",
        "destination": SESSION_DESTINATION,
    }


def sanitize_suggestions(raw: object) -> list[dict]:
    """Keep only what "allow for this conversation" may remember (see the module docstring)."""
    if not isinstance(raw, (list, tuple)):
        return []
    kept: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "addRules" or item.get("behavior") != "allow":
            continue
        rules = []
        for rule in item.get("rules") or []:
            if isinstance(rule, dict) and isinstance(rule.get("toolName"), str) and rule["toolName"]:
                content = rule.get("ruleContent")
                rules.append({
                    "toolName": rule["toolName"],
                    "ruleContent": content if isinstance(content, str) else None,
                })
        if rules:
            kept.append(_session_rule(rules))
    return kept


def minimal_session_rule(tool_name: str) -> dict:
    """The narrowest rule the CLI honours for this tool: the whole tool, with no content."""
    return _session_rule([{"toolName": tool_name, "ruleContent": None}])


def deny_message(reason: str | None = None) -> str:
    """English text for the model, steering it away from workarounds (A14)."""
    base = (
        "The user denied this action. Do not try to achieve the same effect another way "
        "(another tool, a shell command or a different path); ask the user how to proceed."
    )
    reason = (reason or "").strip()
    return f"{base} User's note: {reason}" if reason else base


def effective_session_rules(tool_name: str, suggestions: list[dict]) -> list[dict]:
    """The session rules `build_decision` applies for "allow for this conversation"."""
    return suggestions or [minimal_session_rule(tool_name)]


def allow_session_possible(tool_name: str, suggestions: list[dict], connector: str | None) -> bool:
    """Single source of truth for the card's `allow_session` and for refusing `scope: "session"`.

    A closed list: only the file-editing tools of `SESSION_ALLOWED_TOOLS` can be allowed for the
    conversation (decision of 2026-11-10). A shell (`Bash`, `PowerShell`), `Task`, `Skill`,
    `NotebookEdit`, the question and plan tools, connector tools and any tool a newer CLI
    adds fail to the safe side: once only.

    Even for a listed tool the rule must be for the whole tool, on listed tools only: the CLI
    (observed live on 2.1.318 and 2.1.319, SDK 0.1.69) silently ignores a session rule that
    carries a `ruleContent`, so the button would promise what it cannot deliver, and a
    suggestion that names another tool would remember more than the card shows.
    """
    if connector is not None or tool_name not in SESSION_ALLOWED_TOOLS:
        return False
    return all(rule.get("ruleContent") is None and rule.get("toolName") in SESSION_ALLOWED_TOOLS
               for update in effective_session_rules(tool_name, suggestions)
               for rule in update["rules"])


def edit_path_verdict(tool_name: str, tool_input: object, cwd: str, add_dirs: Iterable[str]) -> str | None:
    """PreToolUse gate for the tools of `SESSION_ALLOWED_TOOLS`: "ask" when the file is not
    inside `cwd` or one of `add_dirs`, else None.

    Without it a rule remembered for the conversation would also cover files anywhere on the
    machine (Decision 2 of 2026-11-10). Paths are compared after `realpath` (so `..`, links and
    junctions cannot hide an escape) and `normcase` (Windows ignores case and accepts `/`).
    Anything that is not a clean absolute path inside the folders asks.
    """
    if tool_name not in SESSION_ALLOWED_TOOLS:
        return None
    raw = tool_input.get("file_path") if isinstance(tool_input, dict) else None
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
        return "ask"
    # Only a clean absolute path passes: the CLI hands the hook one, but this must not depend on
    # it. `~`, a relative path, quotes or blanks at the ends are raw forms that a later layer
    # could read differently from here, so they ask.
    if raw != raw.strip() or not os.path.isabs(raw):
        return "ask"
    try:
        target = _canonical(raw)
        for root in (cwd, *add_dirs):
            base = _canonical(root)
            if os.path.commonpath([base, target]) == base:
                return None
    except (ValueError, OSError):
        pass  # different drives, embedded NUL, an unreadable link: outside
    return "ask"


def _canonical(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def build_decision(
    *,
    tool_name: str,
    tool_input: dict,
    suggestions: list[dict],
    connector: str | None,
    behavior: str,
    scope: str = "once",
    message: str | None = None,
    interrupt: bool = False,
    answers: dict | None = None,
) -> PermissionDecision:
    """Turn what the user decided into what the engine answers. `suggestions` are the
    already sanitised ones stored with the request."""
    if behavior == "deny":
        return PermissionDecision(
            behavior="deny", message=deny_message(message), interrupt=bool(interrupt)
        )
    if scope not in ("once", "session"):
        raise ScopeNotAllowed(f"unknown scope: {scope}")
    if scope == "session" and not allow_session_possible(tool_name, suggestions, connector):
        raise ScopeNotAllowed("this tool can only be allowed once")

    updated_input = None
    if answers is not None and classify(tool_name) == "question":
        updated_input = {**tool_input, "answers": answers}
    updated_permissions: list[dict] = []
    if scope == "session":
        updated_permissions = effective_session_rules(tool_name, suggestions)
    return PermissionDecision(
        behavior="allow", updated_input=updated_input, updated_permissions=updated_permissions
    )
