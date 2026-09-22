"""Pure position math for manual card ordering inside a board column
(Phase 3 of task #43).

Its own module rather than a second half of `board_columns.py`: that file's
docstring states that the only thing it knows how to do is turn a label into a
slug, and card-position arithmetic has nothing to do with slugs. Keeping the
two apart also keeps this one testable as what it is — three numbers in, one
number out, no I/O, no database.

The model is the classic sparse-float ordering: every top-level card carries a
`board_position` (REAL), and inserting between two neighbours means taking the
midpoint of their positions. No neighbour is renumbered on an ordinary insert,
so a drop costs exactly ONE row write.

The cost of that is precision: halving the same gap over and over eventually
runs out of double. `needs_rebalance` is the escape hatch — when the gap gets
tight, the caller renumbers the whole column as 1.0, 2.0, 3.0… and computes the
midpoint again over the fresh values.
"""

from __future__ import annotations

# Minimum gap two neighbours may have before the caller must renumber the
# column instead of squeezing another card between them.
#
# DELIBERATELY LOOSE. A double only runs out of room around 1e-16, so 1e-4
# fires roughly twelve orders of magnitude early — after ~14 successive
# insertions into the same gap rather than after ~50. That is the point: a
# rebalancing path that only ever runs in theory is a rebalancing path nobody
# has ever watched work. At this threshold normal use exercises it, and the
# renumbering it triggers is a handful of UPDATEs on one column.
EPSILON = 1e-4


def compute_insert_position(
    pos_after: float | None, pos_before: float | None
) -> float:
    """Position for a card dropped between the two neighbours whose positions
    are `pos_after` (the card ABOVE it, so the one it lands after) and
    `pos_before` (the card BELOW it).

    Either may be None, and each None means a different edge of the column:

    - both None  -> the column is empty; start the sequence at 0.0, the same
      value `CardStore._NEXT_POSITION_SQL` gives the first card of a column.
    - `pos_after` None -> dropped at the TOP; go one below the current first.
    - `pos_before` None -> dropped at the BOTTOM; go one above the current
      last. Same rule the automatic `max + 1` of a plain status change uses, so
      "dragged to the end" and "moved by an agent" land on the same value.
    - neither None -> the midpoint.

    Nothing here validates that `pos_after < pos_before`: inverted anchors are
    a CONFLICT about the state of the board (the client computed them against a
    stale list), not an arithmetic problem, so the caller rejects them before
    it gets here.
    """
    if pos_after is None and pos_before is None:
        return 0.0
    if pos_after is None:
        return pos_before - 1.0
    if pos_before is None:
        return pos_after + 1.0
    return (pos_after + pos_before) / 2.0


def needs_rebalance(pos_after: float | None, pos_before: float | None) -> bool:
    """True when the gap between two neighbours is too tight to keep halving.

    Only ever true on the MIDDLE path. An insertion at the top or the bottom
    adds or subtracts a whole 1.0 and can never run out of room, so an edge
    drop (either anchor None) is never a reason to renumber a column."""
    if pos_after is None or pos_before is None:
        return False
    return (pos_before - pos_after) < EPSILON
