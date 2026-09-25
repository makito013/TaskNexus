"""Pure helpers for the dynamic board columns (Phase 1 of task #43).

No I/O lives here on purpose: the only thing this module knows how to do is
turn a human-typed label into a stable slug, given the set of slugs already
taken. Persistence is CardStore's job (board_columns table), and the REST
surface is main.py's.

The slug is the value stored in `cards.status`, so it is IMMUTABLE once a
column exists — renaming a column only ever rewrites its `label`. That is why
the generation rules below have to be conservative (ASCII, lowercase,
underscore-separated): the slug travels through MCP tool arguments, query
strings and legacy rows that predate this table.
"""

from __future__ import annotations

import re
import unicodedata

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")

# Used when the label carries no ASCII-representable alphanumerics at all
# (an emoji-only label, for instance). Better a generic-but-valid slug than a
# ValueError the UI would have to translate.
_FALLBACK_SLUG = "column"


def normalize_column_label(label: str) -> str:
    """Casefolded, whitespace-collapsed form of a label — the key used to
    decide whether two labels are "the same" for the duplicate check.

    Deliberately NOT the slug: two labels can share a slug while differing as
    text ("A Fazer" vs "a-fazer"), and the product decision is to block on the
    LABEL being duplicated, case-insensitively."""
    return " ".join(label.split()).casefold()


def slugify_column_label(label: str, taken: set[str]) -> str:
    """Turn `label` into a slug not present in `taken`.

    NFKD + accent strip -> lowercase -> every run of non-[a-z0-9] becomes a
    single '_' -> trim '_' from both ends -> fallback to "column" when empty.
    A collision against `taken` appends "_2", "_3", ... until free.

    `taken` must hold EVERY existing slug, including the four legacy ones
    (a_fazer/em_andamento/em_revisao/feito) — a slug generated on top of one of
    those would silently adopt another column's cards."""
    decomposed = unicodedata.normalize("NFKD", label)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    lowered = ascii_only.lower()
    slug = _NON_SLUG_CHARS.sub("_", lowered).strip("_")
    if not slug:
        slug = _FALLBACK_SLUG

    if slug not in taken:
        return slug

    suffix = 2
    while f"{slug}_{suffix}" in taken:
        suffix += 1
    return f"{slug}_{suffix}"
