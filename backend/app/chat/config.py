"""The limits of the chat and where they come from. The numbers live here once: the manager, the
runtime and `ChatSpec` take their defaults from the constants, and `ChatConfig.from_env` takes
its fallbacks from the class defaults, so changing a value here changes the production path too.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MAX_PROCESSES = 6
DEFAULT_IDLE_TIMEOUT = 1800.0
DEFAULT_PENDING_TTL = 14400.0
DEFAULT_CONNECT_TIMEOUT = 60.0
DEFAULT_COMMAND_TIMEOUT = 30.0


@dataclass
class ChatConfig:
    max_processes: int = DEFAULT_MAX_PROCESSES
    idle_timeout: float = DEFAULT_IDLE_TIMEOUT
    pending_ttl: float = DEFAULT_PENDING_TTL
    connect_timeout: float = DEFAULT_CONNECT_TIMEOUT
    command_timeout: float = DEFAULT_COMMAND_TIMEOUT

    @classmethod
    def from_env(cls, env=os.environ) -> "ChatConfig":
        def number(name: str, default: float) -> float:
            try:
                return float(env.get(name, default))
            except (TypeError, ValueError):
                return default

        return cls(
            max_processes=int(number("CHAT_MAX_PROCESSES", cls.max_processes)),
            idle_timeout=number("CHAT_IDLE_TIMEOUT", cls.idle_timeout),
            pending_ttl=number("CHAT_PENDING_TTL", cls.pending_ttl),
            connect_timeout=number("CHAT_CONNECT_TIMEOUT", cls.connect_timeout),
            command_timeout=number("CHAT_COMMAND_TIMEOUT", cls.command_timeout),
        )
