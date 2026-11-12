"""What the chat needs to know about an agent of the registry, in one place: its environment as
the PTY expands it (CT4) and whether it can have a chat at all."""
from __future__ import annotations

import os

from .errors import ChatError

NOT_CHAT_CAPABLE_MESSAGE = "only claude agents have a chat"


def expanded_env(agent) -> dict[str, str]:
    """`%VAR%`/`$VAR` in an agent's env, like the PTY does (CT4). `agent` may be None."""
    return {name: os.path.expandvars(value) for name, value in ((agent.env if agent else None) or {}).items()}


def require_chat_capable(agent) -> None:
    if agent.ia != "claude":
        raise ChatError("agent_not_chat_capable", NOT_CHAT_CAPABLE_MESSAGE)
