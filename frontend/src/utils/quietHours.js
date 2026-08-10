// frontend/src/utils/quietHours.js
// EXACT mirror of backend/app/quiet_hours.py — same canonical table of test
// cases on both sides (frontend/src/utils/quietHours.test.js and
// backend/tests/test_quiet_hours.py). If you touch this, touch that too.
//
// Why duplicate instead of just using the `quiet_hours_active` the backend
// already returns: that value is a snapshot of the instant of the GET, and
// the 7s poll in TerminalContext decides whether to play a sound many times
// between one settings fetch and the next — the window would flip on/off
// with a delay of up to several minutes. The frontend recomputes locally on
// every tick using the SERVER's offset (`server_utc_offset_minutes` from the
// contract), never the device's timezone: the window is defined on the
// server's clock, so opening the app from a phone in another timezone (via
// Tailscale) can't move it.
//
// Criteria (identical to the backend):
// - inclusive start, exclusive end (22:00-07:00: 22:00 is quiet, 07:00 is not);
// - `enabled` is its own boolean — `start === end` does NOT mean "off", it
//   means an empty window (never quiet);
// - fail-open: a missing/invalid time with enabled=true returns false.

export const MINUTES_PER_DAY = 1440;

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" -> minutes since midnight. null when missing/invalid. */
export function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_OF_DAY_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight in the timezone described by `utcOffsetMinutes`.
 * JS's `%` keeps the sign of the dividend (unlike Python), so the
 * `+ MINUTES_PER_DAY) % MINUTES_PER_DAY` is mandatory for negative offsets —
 * without it, a timezone west of Greenwich would produce negative minutes
 * and the window comparison would come out wrong. */
export function minutesOfDay(epochSeconds, utcOffsetMinutes = 0) {
  const raw = Math.floor(epochSeconds / 60) + utcOffsetMinutes;
  return ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** true when `nowEpochSeconds` falls inside the quiet-hours window. */
export function isWithinQuietHours({
  enabled,
  start,
  end,
  nowEpochSeconds,
  utcOffsetMinutes = 0,
}) {
  if (!enabled) return false;
  const startMinutes = parseTimeOfDay(start);
  const endMinutes = parseTimeOfDay(end);
  if (startMinutes === null || endMinutes === null) return false;
  // Empty window (not "all day", not "off"): the `enabled` field is what
  // turns it off.
  if (startMinutes === endMinutes) return false;
  const nowMinutes = minutesOfDay(nowEpochSeconds, utcOffsetMinutes);
  if (startMinutes < endMinutes) {
    return startMinutes <= nowMinutes && nowMinutes < endMinutes;
  }
  // Window that crosses midnight (e.g. 22:00-07:00).
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/** Convenience shortcut: applies the window to the contract returned by
 * GET /api/settings/notifications, at instant `nowEpochSeconds` (default:
 * now). Kept separate from `isWithinQuietHours` so the pure function stays
 * free of ANY clock reads, and is therefore testable without a mock. */
export function isQuietNow(settings, nowEpochSeconds = Date.now() / 1000) {
  if (!settings) return false;
  return isWithinQuietHours({
    enabled: settings.quiet_hours_enabled,
    start: settings.quiet_hours_start,
    end: settings.quiet_hours_end,
    nowEpochSeconds,
    utcOffsetMinutes: settings.server_utc_offset_minutes ?? 0,
  });
}
