"""Canonical table of quiet-hours cases (app/quiet_hours.py).

This SAME table is replicated in frontend/src/utils/quietHours.test.js, case
by case, with the same ids and the same expected results — the logic is
mirrored on both sides (backend decides the contract's `quiet_hours_active`,
frontend decides whether to play the sound on the open tab) and without the
duplicated table the two implementations would silently diverge. If you
touch this, touch that too.

`now_utc_hour/minute` is the UTC clock of the instant; the server's timezone
enters through `utc_offset_minutes`. Writing it this way (instead of already
giving the local time) is what makes the offset cases meaningful: cases 16-19
change their result only because of the offset, with the same absolute
instant.
"""
import pytest

from app.quiet_hours import (
    current_utc_offset_minutes,
    is_within_quiet_hours,
    minutes_of_day,
    parse_time_of_day,
)


def epoch_at_utc(hour: int, minute: int) -> float:
    """Epoch of 1970-01-01 hh:mm UTC — the date is irrelevant, only the time matters."""
    return (hour * 60 + minute) * 60


# (id, enabled, start, end, now_utc_hour, now_utc_minute, utc_offset_minutes, expected)
QUIET_HOURS_CASES = [
    ("inside_overnight_before_midnight", True, "22:00", "07:00", 23, 30, 0, True),
    ("inside_overnight_after_midnight", True, "22:00", "07:00", 2, 0, 0, True),
    ("outside_overnight_morning", True, "22:00", "07:00", 9, 0, 0, False),
    ("outside_overnight_evening", True, "22:00", "07:00", 21, 59, 0, False),
    ("boundary_start_is_inclusive", True, "22:00", "07:00", 22, 0, 0, True),
    ("boundary_end_is_exclusive", True, "22:00", "07:00", 7, 0, 0, False),
    ("boundary_one_minute_before_end", True, "22:00", "07:00", 6, 59, 0, True),
    ("same_day_window_inside", True, "13:00", "14:00", 13, 30, 0, True),
    ("same_day_window_outside", True, "13:00", "14:00", 12, 59, 0, False),
    ("same_day_boundary_start_inclusive", True, "13:00", "14:00", 13, 0, 0, True),
    ("same_day_boundary_end_exclusive", True, "13:00", "14:00", 14, 0, 0, False),
    ("disabled_while_inside_range", False, "22:00", "07:00", 23, 30, 0, False),
    ("disabled_while_outside_range", False, "22:00", "07:00", 9, 0, 0, False),
    ("empty_window_start_equals_end_at_that_time", True, "08:00", "08:00", 8, 0, 0, False),
    ("empty_window_start_equals_end_other_time", True, "08:00", "08:00", 20, 0, 0, False),
    ("positive_offset_shifts_into_window", True, "22:00", "07:00", 20, 0, 180, True),
    ("same_instant_without_offset_is_outside", True, "22:00", "07:00", 20, 0, 0, False),
    ("negative_offset_wraps_to_previous_day", True, "22:00", "07:00", 1, 0, -180, True),
    ("negative_offset_shifts_out_of_window", True, "22:00", "07:00", 12, 0, -180, False),
    ("invalid_start_fails_open", True, "abc", "07:00", 23, 0, 0, False),
    ("missing_end_fails_open", True, "22:00", None, 23, 0, 0, False),
    ("out_of_range_hour_fails_open", True, "25:00", "07:00", 23, 0, 0, False),
]


@pytest.mark.parametrize(
    "case_id,enabled,start,end,hour,minute,offset,expected",
    QUIET_HOURS_CASES,
    ids=[case[0] for case in QUIET_HOURS_CASES],
)
def test_is_within_quiet_hours_canonical_table(
    case_id, enabled, start, end, hour, minute, offset, expected
):
    assert (
        is_within_quiet_hours(
            enabled=enabled,
            start=start,
            end=end,
            now_epoch_seconds=epoch_at_utc(hour, minute),
            utc_offset_minutes=offset,
        )
        is expected
    )


@pytest.mark.parametrize(
    "value,expected",
    [
        ("00:00", 0),
        ("07:00", 420),
        ("22:30", 1350),
        ("23:59", 1439),
        ("  22:00  ", 1320),  # <input type="time"> never sends whitespace, but manual editing can
        ("24:00", None),
        ("22:60", None),
        ("7:00", None),  # no leading zero isn't the format the input emits
        ("", None),
        (None, None),
        (2200, None),
    ],
)
def test_parse_time_of_day(value, expected):
    assert parse_time_of_day(value) == expected


def test_minutes_of_day_normalizes_negative_offset_into_the_previous_day():
    """00:30 UTC with offset -180 (UTC-3) is 21:30 of the PREVIOUS day — the
    result has to stay within [0, 1440), never go negative."""
    assert minutes_of_day(epoch_at_utc(0, 30), -180) == 21 * 60 + 30


def test_minutes_of_day_normalizes_positive_offset_into_the_next_day():
    assert minutes_of_day(epoch_at_utc(23, 30), 120) == 1 * 60 + 30


def test_current_utc_offset_minutes_matches_the_local_clock():
    """Doesn't pin a value (depends on the machine running the test) — only
    ensures the offset is the local clock's and falls within the real range
    of timezones."""
    from datetime import datetime

    expected = int(datetime.now().astimezone().utcoffset().total_seconds() // 60)
    offset = current_utc_offset_minutes()
    assert offset == expected
    assert -12 * 60 <= offset <= 14 * 60
