// frontend/src/utils/haptics.test.js
// The contract that matters here is the DEGRADATION: this runs on iOS Safari,
// where `navigator.vibrate` does not exist at all, and it is called from
// inside a pointer handler — so anything it throws would abort the drag it was
// meant to decorate.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DRAG_PICKUP_VIBRATION_MS, vibrate, vibrateDragPickup } from './haptics.js';

const originalVibrate = Object.getOwnPropertyDescriptor(navigator, 'vibrate');

function setVibrate(value) {
  Object.defineProperty(navigator, 'vibrate', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalVibrate) {
    Object.defineProperty(navigator, 'vibrate', originalVibrate);
  } else {
    delete navigator.vibrate;
  }
  vi.restoreAllMocks();
});

describe('vibrate', () => {
  it('asks the platform to vibrate for the duration given', () => {
    const spy = vi.fn();
    setVibrate(spy);

    expect(vibrate(25)).toBe(true);
    expect(spy).toHaveBeenCalledWith(25);
  });

  it('does nothing and reports false where the API does not exist', () => {
    // iOS Safari and desktop Safari — supported platforms for this board, not
    // an edge case.
    delete navigator.vibrate;

    expect(vibrate(10)).toBe(false);
  });

  it('does nothing when the API is present but not callable', () => {
    setVibrate(undefined);

    expect(vibrate(10)).toBe(false);
  });

  it('never lets a throwing implementation escape', () => {
    // Some engines throw when the Vibration API is disabled by policy or the
    // document has no user activation. This is called from inside a pointer
    // handler, so an escaping error would abort the drag itself.
    setVibrate(() => { throw new Error('blocked by permissions policy'); });

    expect(() => vibrate(10)).not.toThrow();
    expect(vibrate(10)).toBe(false);
  });
});

describe('vibrateDragPickup', () => {
  it('uses the short pickup confirmation duration', () => {
    const spy = vi.fn();
    setVibrate(spy);

    vibrateDragPickup();

    expect(spy).toHaveBeenCalledWith(DRAG_PICKUP_VIBRATION_MS);
  });

  it('keeps the pickup tick short enough to not read as an alert', () => {
    // Pinned as a decision, not as trivia: picking cards up repeatedly must
    // never feel like the device is buzzing at you.
    expect(DRAG_PICKUP_VIBRATION_MS).toBeLessThanOrEqual(20);
    expect(DRAG_PICKUP_VIBRATION_MS).toBeGreaterThan(0);
  });
});
