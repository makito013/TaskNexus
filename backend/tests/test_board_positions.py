"""Unit tests for the pure position math (app/board_positions.py).

Everything that touches the cards TABLE lives in test_card_store.py — this
file only covers the arithmetic, which has no I/O.
"""

import pytest
from app.board_positions import EPSILON, compute_insert_position, needs_rebalance


# -- compute_insert_position -------------------------------------------------


def test_empty_column_starts_at_zero():
    # Same value CardStore._NEXT_POSITION_SQL gives the first card of a column,
    # so "dragged into an empty column" and "created in an empty column" agree.
    assert compute_insert_position(None, None) == 0.0


def test_drop_at_the_top_goes_one_below_the_current_first():
    assert compute_insert_position(None, 1.0) == 0.0
    assert compute_insert_position(None, -3.5) == -4.5


def test_drop_at_the_bottom_goes_one_above_the_current_last():
    assert compute_insert_position(4.0, None) == 5.0


def test_drop_in_the_middle_is_the_midpoint():
    assert compute_insert_position(1.0, 2.0) == 1.5
    assert compute_insert_position(2.0, 5.0) == 3.5


def test_midpoint_of_negative_neighbours_stays_between_them():
    position = compute_insert_position(-4.0, -1.0)
    assert -4.0 < position < -1.0


def test_inverted_anchors_are_not_this_function_s_problem():
    # Arithmetic still answers; rejecting inverted anchors is the caller's job
    # (it is a conflict about the board's state, not a math error).
    assert compute_insert_position(5.0, 1.0) == 3.0


# -- needs_rebalance ---------------------------------------------------------


def test_a_comfortable_gap_needs_no_rebalance():
    assert needs_rebalance(1.0, 2.0) is False


def test_a_gap_tighter_than_epsilon_triggers_a_rebalance():
    assert needs_rebalance(1.0, 1.0 + EPSILON / 2) is True


def test_a_gap_of_exactly_epsilon_does_not_trigger():
    # The trigger is `<`, not `<=` — pinned so a future tweak to the comparison
    # is a deliberate change rather than an accident.
    #
    # Anchored at ZERO on purpose. `1.0 + EPSILON` minus `1.0` is
    # 9.99999999999889…e-05 in double, NOT 1e-4, so that pair would test
    # floating-point representation rather than the comparison. From zero the
    # subtraction is exact.
    assert needs_rebalance(0.0, EPSILON) is False


def test_zero_gap_triggers_a_rebalance():
    assert needs_rebalance(2.0, 2.0) is True


@pytest.mark.parametrize(
    "pos_after,pos_before",
    [(None, None), (None, 1.0), (1.0, None)],
)
def test_an_edge_drop_never_triggers_a_rebalance(pos_after, pos_before):
    # Top and bottom add or subtract a whole 1.0 — they cannot run out of room,
    # so renumbering the column would be pure churn.
    assert needs_rebalance(pos_after, pos_before) is False


def test_repeated_halving_of_the_same_gap_reaches_the_trigger():
    # The property that makes the EPSILON worth having: the midpoint rule alone
    # converges, so something has to notice. Counted rather than assumed — and
    # the count is small enough (14) that normal use really does get here.
    low, high = 1.0, 2.0
    steps = 0
    while not needs_rebalance(low, high):
        high = compute_insert_position(low, high)
        steps += 1
        assert steps < 100, "the gap never got tight enough to trigger"
    assert steps == 14
