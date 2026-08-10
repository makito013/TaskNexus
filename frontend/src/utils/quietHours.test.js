// frontend/src/utils/quietHours.test.js
// Canonical table of quiet-hours cases — REPLICATED from
// backend/tests/test_quiet_hours.py, case by case, with the same ids and
// the same expected results. The logic is mirrored on both sides (backend
// returns `quiet_hours_active` in the contract, frontend decides whether to
// play the sound on the open tab) and without the duplicated table the two
// implementations would silently diverge. If you touch this, touch that too.
import { describe, it, expect } from 'vitest';
import { isWithinQuietHours, isQuietNow, minutesOfDay, parseTimeOfDay } from './quietHours.js';

/** Epoch of 1970-01-01 hh:mm UTC — the date is irrelevant, only the time matters. */
function epochAtUtc(hour, minute) {
  return (hour * 60 + minute) * 60;
}

// [id, enabled, start, end, nowUtcHour, nowUtcMinute, utcOffsetMinutes, expected]
const QUIET_HOURS_CASES = [
  ['inside_overnight_before_midnight', true, '22:00', '07:00', 23, 30, 0, true],
  ['inside_overnight_after_midnight', true, '22:00', '07:00', 2, 0, 0, true],
  ['outside_overnight_morning', true, '22:00', '07:00', 9, 0, 0, false],
  ['outside_overnight_evening', true, '22:00', '07:00', 21, 59, 0, false],
  ['boundary_start_is_inclusive', true, '22:00', '07:00', 22, 0, 0, true],
  ['boundary_end_is_exclusive', true, '22:00', '07:00', 7, 0, 0, false],
  ['boundary_one_minute_before_end', true, '22:00', '07:00', 6, 59, 0, true],
  ['same_day_window_inside', true, '13:00', '14:00', 13, 30, 0, true],
  ['same_day_window_outside', true, '13:00', '14:00', 12, 59, 0, false],
  ['same_day_boundary_start_inclusive', true, '13:00', '14:00', 13, 0, 0, true],
  ['same_day_boundary_end_exclusive', true, '13:00', '14:00', 14, 0, 0, false],
  ['disabled_while_inside_range', false, '22:00', '07:00', 23, 30, 0, false],
  ['disabled_while_outside_range', false, '22:00', '07:00', 9, 0, 0, false],
  ['empty_window_start_equals_end_at_that_time', true, '08:00', '08:00', 8, 0, 0, false],
  ['empty_window_start_equals_end_other_time', true, '08:00', '08:00', 20, 0, 0, false],
  ['positive_offset_shifts_into_window', true, '22:00', '07:00', 20, 0, 180, true],
  ['same_instant_without_offset_is_outside', true, '22:00', '07:00', 20, 0, 0, false],
  ['negative_offset_wraps_to_previous_day', true, '22:00', '07:00', 1, 0, -180, true],
  ['negative_offset_shifts_out_of_window', true, '22:00', '07:00', 12, 0, -180, false],
  ['invalid_start_fails_open', true, 'abc', '07:00', 23, 0, 0, false],
  ['missing_end_fails_open', true, '22:00', null, 23, 0, 0, false],
  ['out_of_range_hour_fails_open', true, '25:00', '07:00', 23, 0, 0, false],
];

describe('isWithinQuietHours — canonical table (mirrors the backend)', () => {
  it.each(QUIET_HOURS_CASES)(
    '%s',
    (_caseId, enabled, start, end, hour, minute, utcOffsetMinutes, expected) => {
      expect(
        isWithinQuietHours({
          enabled,
          start,
          end,
          nowEpochSeconds: epochAtUtc(hour, minute),
          utcOffsetMinutes,
        }),
      ).toBe(expected);
    },
  );
});

describe('parseTimeOfDay', () => {
  it.each([
    ['00:00', 0],
    ['07:00', 420],
    ['22:30', 1350],
    ['23:59', 1439],
    ['  22:00  ', 1320],
    ['24:00', null],
    ['22:60', null],
    ['7:00', null],
    ['', null],
    [null, null],
    [2200, null],
  ])('parseTimeOfDay(%o) === %o', (value, expected) => {
    expect(parseTimeOfDay(value)).toBe(expected);
  });
});

describe('minutesOfDay', () => {
  it('normalizes a negative offset into the previous day instead of going negative', () => {
    expect(minutesOfDay(epochAtUtc(0, 30), -180)).toBe(21 * 60 + 30);
  });

  it('normalizes a positive offset into the next day', () => {
    expect(minutesOfDay(epochAtUtc(23, 30), 120)).toBe(1 * 60 + 30);
  });
});

describe('isQuietNow — applies the /api/settings/notifications contract', () => {
  const settings = {
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    server_utc_offset_minutes: 180,
  };

  it('uses the SERVER offset, not the device timezone', () => {
    // 20:00 UTC = 23:00 on the server (UTC+3) -> inside the window.
    expect(isQuietNow(settings, epochAtUtc(20, 0))).toBe(true);
    // The same instant with a zero offset would fall outside — proves the
    // contract's offset is what governs.
    expect(isQuietNow({ ...settings, server_utc_offset_minutes: 0 }, epochAtUtc(20, 0))).toBe(false);
  });

  it('treats missing settings as "not quiet" (fail-open before the first fetch resolves)', () => {
    expect(isQuietNow(null, epochAtUtc(23, 0))).toBe(false);
    expect(isQuietNow(undefined, epochAtUtc(23, 0))).toBe(false);
  });

  it('defaults a missing offset to 0 instead of producing NaN', () => {
    const noOffset = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '07:00' };
    expect(isQuietNow(noOffset, epochAtUtc(23, 0))).toBe(true);
    expect(isQuietNow(noOffset, epochAtUtc(9, 0))).toBe(false);
  });
});
