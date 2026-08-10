from __future__ import annotations

import re
from datetime import datetime

"""Quiet-hours window for notifications (Phase 1 of the end-of-chat
notification feature).

Deliberately a PURE module: no dependency on FastAPI, the database, or the
clock — `is_within_quiet_hours` receives the instant as an argument. This
exists because the SAME logic is mirrored on the frontend
(frontend/src/utils/quietHours.js) for the sound played on the open tab; both
implementations are covered by the same canonical table of test cases
(backend/tests/test_quiet_hours.py and frontend/src/utils/quietHours.test.js),
precisely so they don't silently diverge.

Criteria decided here (and mirrored in the JS twin):

- **Inclusive start, exclusive end.** With 22:00-07:00, 22:00 is already
  quiet and 07:00 is no longer quiet.
- **`enabled` is its own boolean.** `start == end` no longer means "off"
  (old semantics, rejected): with `enabled=True` and `start == end` the
  window is empty, so it's never quiet.
- **Fail-open**: a missing/invalid time with `enabled=True` returns False.
  In a broken configuration it's preferable to over-notify than to silently
  swallow the "chat finished" alert.
- **The timezone is the SERVER's.** The window is defined on the server's
  local clock and the offset travels in the contract
  (`server_utc_offset_minutes`), so opening the app from a phone in another
  timezone via Tailscale doesn't shift the window.
"""

MINUTES_PER_DAY = 1440

# HH:MM 24h, zero-padded — same format that <input type="time"> emits.
_TIME_OF_DAY_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def parse_time_of_day(value: str | None) -> int | None:
    """"HH:MM" -> minutes since midnight. None when missing/invalid."""
    if not isinstance(value, str):
        return None
    match = _TIME_OF_DAY_PATTERN.match(value.strip())
    if match is None:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def minutes_of_day(epoch_seconds: float, utc_offset_minutes: int = 0) -> int:
    """Minutes since midnight in the timezone described by
    `utc_offset_minutes`.

    Python's `%` already normalizes negative offsets (timezones west of
    Greenwich) into the [0, 1440) range, so there's no special case."""
    return int((epoch_seconds // 60 + utc_offset_minutes) % MINUTES_PER_DAY)


def is_within_quiet_hours(
    enabled: bool,
    start: str | None,
    end: str | None,
    now_epoch_seconds: float,
    utc_offset_minutes: int = 0,
) -> bool:
    """True when `now_epoch_seconds` falls inside the quiet-hours window."""
    if not enabled:
        return False
    start_minutes = parse_time_of_day(start)
    end_minutes = parse_time_of_day(end)
    if start_minutes is None or end_minutes is None:
        return False
    if start_minutes == end_minutes:
        # Empty window (not "all day", not "off"): the `enabled` field is
        # what turns it off.
        return False
    now_minutes = minutes_of_day(now_epoch_seconds, utc_offset_minutes)
    if start_minutes < end_minutes:
        return start_minutes <= now_minutes < end_minutes
    # Window that crosses midnight (e.g. 22:00-07:00): it's quiet from the
    # start until 23:59 OR from midnight until the end.
    return now_minutes >= start_minutes or now_minutes < end_minutes


def current_utc_offset_minutes(now: datetime | None = None) -> int:
    """UTC offset of the SERVER's local clock, in minutes.

    Computed on every read instead of persisted on purpose: storing the
    offset in a column would make the window drift by one hour twice a year
    (daylight saving time) with nobody touching the setting."""
    reference = (now or datetime.now()).astimezone()
    offset = reference.utcoffset()
    if offset is None:  # pragma: no cover - astimezone() always resolves the offset
        return 0
    return int(offset.total_seconds() // 60)
