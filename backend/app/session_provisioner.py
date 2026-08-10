"""Provisioning of an agent's session id, before the PTY exists.

For `claude` the session id is INVENTED by us (`uuid4`) and imposed on the CLI
via `--session-id`. For `cursor-agent` the direction is inverted: the id is
EMITTED by the CLI (`cursor-agent create-chat` prints the chatId) and we can only
resume it later with `--resume <chatId>`. That introduces the backend's first
round-trip of I/O BEFORE the spawn — hence this module, instead of putting the
logic inside `_ensure_pty` (which already carries delicate invariants) or
`_build_agent_cmd` (which is synchronous, pure, and covered by contract tests
that would lose their meaning if it became async).

Central contract, valid for ANY agent type: if an id already exists
(`existing_id` truthy), it is returned as-is with ZERO I/O. That is what
guarantees that reconnects, reloads, `POST /continue`, `POST /paste` and the
5-minute grace-period expiry do not create an orphan chat on every trip through
`_ensure_pty`.

Note on language: comments and identifiers are English per the project
convention, but the `SessionProvisioningError` messages stay in Portuguese on
purpose — they are end-user-facing strings, rendered straight into the user's
terminal as the `detail` of the `spawn_failed` control frame.
"""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from typing import Any, Awaitable, Callable

from .command_runner import run_capture

# `create-chat` timeout. 10s rather than 5: this is a network call (the CLI talks
# to Cursor's backend), and the cost of a false timeout — the user staring at a
# failed terminal on the iPad — is higher than waiting a bit longer. Env var
# follows the same pattern as CLEANUP_DELAY/ACTIVITY_TIMEOUT in main.py.
CURSOR_CREATE_CHAT_TIMEOUT_SECONDS = float(
    os.getenv("CURSOR_CREATE_CHAT_TIMEOUT_SECONDS", "10.0")
)

# How much of the CLI's stderr goes into the error message. Untruncated, a whole
# Node stack trace would become an unreadable overlay on the iPad screen (the
# `detail` of the spawn_failed frame is rendered directly in the frontend
# terminal).
_STDERR_DETAIL_LIMIT = 500

# Canonical UUID (8-4-4-4-12 hex, hyphenated), matching the WHOLE line. Doubles
# as validation and as line selector — see _extract_chat_id.
_UUID_LINE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class SessionProvisioningError(OSError):
    """Failure while provisioning an agent's session id.

    Inherits from `OSError` ON PURPOSE, not from `Exception`: the `pty_endpoint`
    handler in main.py catches `(OSError, LookupError, TimeoutError)` and is the
    only barrier against the reconnect storm (an exception escaping from there
    aborts the freshly accepted WebSocket, the frontend cannot tell that apart
    from a network blip, reconnects, resends the InitFrame and hits the same
    error, forever). Being an `OSError`, this exception is caught by the catch
    that ALREADY EXISTS, without depending on anyone remembering to update the
    tuple. Same reasoning — and same precedent — as `PTYSpawnError` in
    pty_manager.py.

    The message is end-user-facing: it is rendered in the terminal as the
    `detail` of the `spawn_failed` frame. Hence it is written in PORTUGUESE and
    with actionable instructions, in the same spirit as the LookupError raised by
    `_ensure_pty`.
    """


async def _uuid4_provisioner(agent, cwd: str) -> str:
    """Historical behaviour, preserved for claude/gemini/terminal and for any
    unknown `ia`: the id is ours, invented locally, with no I/O.

    Being `async` with no `await` inside is intentional: it keeps every
    provisioner's signature identical, which lets the dispatch be a `.get()`
    with a default instead of an `if` checking whether the result is awaitable.
    """
    return str(uuid.uuid4())


def _extract_chat_id(stdout: str) -> str | None:
    """Return the first stdout line that is, IN ITS ENTIRETY, a canonical UUID.

    It scans every line instead of trusting a bare `stdout.strip()` because CLIs
    print banners and new-version notices BEFORE or AFTER the useful line —
    scanning covers both positions. Matching the whole line (rather than
    searching for the pattern embedded in some text) is simultaneously the
    selection and the VALIDATION of the value: a `--resume` without a valid value
    would open Cursor's interactive picker and strand the PTY in a TUI the UI has
    no way out of.

    It never scans stderr: the id is a stdout contract, and searching stderr
    would happily accept a fragment of an error message as an id.
    """
    for line in stdout.splitlines():
        candidate = line.strip()
        if _UUID_LINE.match(candidate):
            return candidate
    return None


async def _create_cursor_chat(agent, cwd: str) -> str:
    """Create a new Cursor chat and return the chatId emitted by the CLI.

    argv is `[agent.cmd[0], "create-chat"]` — only the executable; the rest of
    `agent.cmd` is discarded on purpose: the registry's flags (`--model`,
    `--mode`, `--force`…) belong to an INTERACTIVE session and the subcommand
    likely rejects them; a non-zero exit there would surface as an unexplainable
    `spawn_failed`. Known limitation: `agent.cmd` flags do not reach
    `create-chat`. Authentication, which is what actually matters, does — it
    travels via `agent.env` (e.g. `CURSOR_API_KEY`), which IS forwarded.

    Using `agent.cmd[0]` instead of the literal `"cursor-agent"` is deliberate
    too: it is the exact same string the PTY will spawn later. If one resolves,
    the other resolves, and there is ONE single place to configure the binary
    path — relevant because it is not on the backend's PATH today.

    `cwd = proj.path` (the project directory): Cursor's `--workspace` defaults to
    the cwd, so the chat is born in the right workspace with no extra flag.
    """
    # R1: `models.Agent.cmd` is a free-form list with no non-empty validation at
    # the model level. An `agent.cmd == []` would make `agent.cmd[0]` raise
    # IndexError — which is NOT an OSError, would escape the pty_endpoint catch
    # and reopen the reconnect storm. Converted here, at the only boundary that
    # indexes the list.
    if not agent.cmd:
        raise SessionProvisioningError(
            "Não foi possível criar um chat no Cursor: o agente está cadastrado "
            "sem comando. Informe o caminho do executável 'cursor-agent' no "
            "campo de comando do agente."
        )

    argv = [agent.cmd[0], "create-chat"]
    try:
        result = await run_capture(
            argv,
            cwd=cwd,
            timeout=CURSOR_CREATE_CHAT_TIMEOUT_SECONDS,
            extra_env=agent.env or None,
        )
    except subprocess.TimeoutExpired as exc:
        # TimeoutExpired is a SubprocessError, NOT an OSError — without this
        # conversion it would escape the pty_endpoint catch. It is the easiest
        # case to forget in the whole failure map.
        raise SessionProvisioningError(
            f"Não foi possível criar um chat no Cursor: tempo esgotado após "
            f"{CURSOR_CREATE_CHAT_TIMEOUT_SECONDS:.0f}s. Verifique se "
            f"'{argv[0]}' está instalado e autenticado (cursor-agent status)."
        ) from exc

    # FileNotFoundError/NotADirectoryError/PermissionError are deliberately NOT
    # caught: they already are OSError, the pty_endpoint catch recognises them,
    # and the native message ("No such file or directory: 'cursor-agent'") is
    # more informative than any paraphrase of ours.

    if result.exit_code != 0:
        raise SessionProvisioningError(
            f"Não foi possível criar um chat no Cursor: '{argv[0]} create-chat' "
            f"terminou com código {result.exit_code}. "
            f"Verifique se o Cursor está autenticado (cursor-agent status). "
            f"Saída de erro: {_truncate(result.stderr)}"
        )

    chat_id = _extract_chat_id(result.stdout)
    if chat_id is None:
        raise SessionProvisioningError(
            f"Não foi possível criar um chat no Cursor: '{argv[0]} create-chat' "
            f"não devolveu um id de chat reconhecível. "
            f"Saída recebida: {_truncate(result.stdout) or '(vazia)'}"
        )
    return chat_id


def _truncate(text: str) -> str:
    """Collapse whitespace and cut at _STDERR_DETAIL_LIMIT — the string ends up
    in a single-line message rendered in the user's terminal."""
    collapsed = " ".join((text or "").split())
    if len(collapsed) <= _STDERR_DETAIL_LIMIT:
        return collapsed
    return collapsed[:_STDERR_DETAIL_LIMIT] + "…"


# Dict dispatch rather than an `if` chain: adding an agent type means adding an
# entry. Deliberately not an abstract base class — that would be two
# implementations for four agent types, pure over-engineering.
# `.get(ia, _uuid4_provisioner)` makes uuid4 the default behaviour, which is
# exactly what every non-Cursor agent has always done.
_PROVISIONERS: dict[str, Callable[[Any, str], Awaitable[str]]] = {
    "cursor": _create_cursor_chat,
}


async def provision_session_id(agent, cwd: str, existing_id: str | None) -> str:
    """Return the session id to use for this spawn.

    `existing_id` truthy → returned as-is, ZERO I/O, for any `ia`. That path is
    what prevents orphan chats: reconnects, reloads, `POST /continue`,
    `POST /paste` and grace-period expiry all pass through here, and none of them
    may trigger a fresh `create-chat`. Note that the `''` sentinel written by
    `ConversationStore.reset_claude_session_id` is falsy — on purpose: after a
    `POST /reset` the session really does need to be born again.

    `existing_id` falsy → dispatch on `agent.ia`. Only `"cursor"` performs I/O;
    everything else (claude, gemini, terminal, `agent is None`, unknown `ia`)
    returns a local `uuid4`, identical to the behaviour before this feature.

    Raises `SessionProvisioningError` (which is an `OSError`) on any provisioning
    failure. It never degrades to "session without an id": a Cursor session
    without `--resume` would be a session without memory, and the product
    decision is to fail visibly rather than deliver that silently.
    """
    if existing_id:
        return existing_id

    ia = getattr(agent, "ia", None) or ""
    provisioner = _PROVISIONERS.get(ia, _uuid4_provisioner)
    return await provisioner(agent, cwd)
