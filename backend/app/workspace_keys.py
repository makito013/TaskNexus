"""Pure key helpers for the workspace registry (ADR-20, ADR-21, ADR-24).

No I/O. The registry reuses the legacy `projeto_id` / `cliente_id` strings as
its keys, so these helpers answer three questions without touching the disk:

- is this key one the registry minted (synthetic) or one the folder scan emits
  (legacy)?
- is a key shaped safely enough to be stored (validate_key)?
- which workspace "scope" does a key belong to (workspace_scope_of)? This is
  the single function behind the "same workspace" rule of the agent hooks.

Synthetic keys are disjoint from scan ids by construction: `scan_projects`
prunes every folder whose name starts with ".", so no scan id has a segment
starting with ".", while every synthetic key has at least one.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from app.agent_discovery import cliente_id_from_projeto_id

if TYPE_CHECKING:  # the store imports this module; avoid the cycle at runtime
    from app.workspace_store import RegistrySnapshot

SYNTHETIC_WORKSPACE_PREFIX = ".w"
SYNTHETIC_PROJECT_PREFIX = ".p"
_SYNTHETIC_SEGMENT = re.compile(r"^\.(w|p)\d+$")
# Exactly what make_workspace_key / make_project_key produce. The workspace part
# of a project key is ".wN" or a legacy workspace key (never starts with ".").
_MINTED_KEY = re.compile(r"(?:\.w\d+|(?:\.w\d+|[^./][^/]*)/\.p\d+)")
MAX_KEY_LENGTH = 512


def workspace_key_of(key: str) -> str:
    """First segment of a key; for a legacy projeto_id this is the cliente_id."""
    return cliente_id_from_projeto_id(key)


def first_segment(key: str) -> str:
    return key.split("/", 1)[0]


def has_reserved_segment(key: str) -> bool:
    """True when ANY segment starts with "." (the whole reserved namespace).

    Wider than `is_synthetic_key`: use it to REFUSE keys (adoption guards), where
    "." segments that are not minted shapes must still be rejected. Do not use
    it to route resolution: that is `is_synthetic_key`'s job."""
    return any(segment.startswith(".") for segment in key.split("/"))


def is_synthetic_key(key: str) -> bool:
    """True only for the key shapes the registry mints: ".w12" (workspace),
    ".w12/.p38" and "Pessoal/.p37" (project: workspace key + ".pN").

    Deliberately narrow, for RESOLUTION and scope: any other key, even one with
    a "." segment such as "Pessoal/.hidden" or ".w1/.hidden", is NOT synthetic
    and follows the legacy path byte for byte (the V2 never refused it). The
    scan prunes every folder starting with ".", so the minted shapes are still
    disjoint from every scan id. To REFUSE keys use `has_reserved_segment`."""
    return _MINTED_KEY.fullmatch(key) is not None


def make_workspace_key(workspace_id: int) -> str:
    return f"{SYNTHETIC_WORKSPACE_PREFIX}{workspace_id}"


def make_project_key(workspace_key: str, project_id: int) -> str:
    return f"{workspace_key}/{SYNTHETIC_PROJECT_PREFIX}{project_id}"


def validate_key(key: str) -> None:
    """Raise ValueError when `key` could not safely be stored or put in a URL.

    Legacy keys may contain "." inside a segment ("meu.projeto"); a segment
    that STARTS with "." must be exactly a synthetic one (".w12" / ".p37").
    """
    if not isinstance(key, str) or not key:
        raise ValueError("key must be a non-empty string")
    if len(key) > MAX_KEY_LENGTH:
        raise ValueError(f"key is longer than {MAX_KEY_LENGTH} characters")
    if "::" in key:
        raise ValueError("key must not contain '::'")
    if "\\" in key:
        raise ValueError("key must not contain a backslash")
    if "\x00" in key:
        raise ValueError("key must not contain a NUL character")
    for segment in key.split("/"):
        if segment == "":
            raise ValueError("key must not have an empty segment")
        if segment in (".", ".."):
            raise ValueError("key must not contain '.' or '..' segments")
        if segment.startswith(".") and not _SYNTHETIC_SEGMENT.match(segment):
            raise ValueError(f"invalid synthetic segment: {segment!r}")


def workspace_scope_of(key: str, snapshot: "RegistrySnapshot") -> str:
    """Scope token used by the "same workspace" rule (opcoes2 section 3.1).

    Archived rows count: old cards stay governed by the workspace they had.
    For legacy keys the result is an injective function of the first segment,
    so `same_workspace(a, b)` is equivalent to the old "same cliente" rule.
    """
    project = snapshot.project_by_key.get(key)
    if project is not None:
        return f"ws:{project.workspace_id}"
    workspace = snapshot.workspace_by_key.get(key)
    if workspace is not None:
        return f"ws:{workspace.id}"
    if is_synthetic_key(key):
        return f"unknown:{key}"
    workspace = snapshot.workspace_by_key.get(first_segment(key))
    if workspace is not None:
        return f"ws:{workspace.id}"
    return f"legacy:{first_segment(key)}"


def same_workspace(a: str, b: str, snapshot: "RegistrySnapshot") -> bool:
    return workspace_scope_of(a, snapshot) == workspace_scope_of(b, snapshot)


def scope_workspace_key(key: str, snapshot: "RegistrySnapshot") -> str:
    """Key of the workspace a key belongs to (project -> its workspace,
    workspace -> itself, unregistered synthetic key -> itself, anything else ->
    its first segment). The third case mirrors the "unknown:" scope: an orphan
    synthetic key must not list the cards of the workspace its prefix names."""
    project = snapshot.project_by_key.get(key)
    if project is not None:
        workspace = snapshot.workspace_by_id.get(project.workspace_id)
        if workspace is not None:
            return workspace.key
    workspace = snapshot.workspace_by_key.get(key)
    if workspace is not None:
        return workspace.key
    if is_synthetic_key(key):
        return key
    return first_segment(key)
