"""Errors of the service layer and the redaction of text that leaves the backend.

`ChatError` is the one family of errors of the contract (`ChatCommandError` is a kind of it);
`api.py` turns a code into `{"detail": {"code", "message"}}` and an HTTP status.
`public_detail` is the one place where technical text is made safe for a client, which may be
another device on the network.
"""
from __future__ import annotations

import re

# A Windows path may hold spaces (`C:\\Program Files\\...`), so from the drive letter the match runs to
# the end of the line or the next quote/bracket; the rest of such a sentence goes with it, which is
# the safe side for text shown to another device. UNC and the usual POSIX roots are covered too.
_LOCAL_PATH_RE = re.compile(
    r"""(?:[A-Za-z]:[\\/][^\r\n'"<>|]*|\\\\[^\s'"<>|]+|(?<![\w.])/(?:home|Users|root|tmp|var|opt|mnt)/[^\s'"<>|]*)"""
)


def public_detail(text: object) -> str:
    """Technical text safe for a client: local filesystem paths are replaced (the client may be
    another device on the network)."""
    return _LOCAL_PATH_RE.sub("<path>", str(text or ""))[:500]


def public_last_error(last_error: dict | None) -> dict | None:
    """A stored `last_error` with its `detail` redacted, as clients may see it."""
    if last_error and "detail" in last_error:
        return {**last_error, "detail": public_detail(last_error["detail"])}
    return last_error


class ChatError(Exception):
    """An error of the contract: `code` is a stable code of the REST/WS contracts. The HTTP status
    of a code is `api.py`'s business (`HTTP_STATUS`), never the raiser's."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class ChatCommandError(ChatError):
    """A command the chat refuses; over the WebSocket it is a `command.rejected` with this code."""
