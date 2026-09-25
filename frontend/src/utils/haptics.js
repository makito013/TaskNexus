// frontend/src/utils/haptics.js
// Short haptic confirmations for gestures that "grab" something (task #43,
// phase 3 follow-up).
//
// Why this exists: a long-press drag arms after a delay with NO movement
// required — dnd-kit's TouchSensor runs `setTimeout(handleStart, delay)`, so
// the drag is live once the hold elapses whether or not the finger has
// travelled. The visual feedback that fires at that moment (the source fading
// to a placeholder, the overlay lifting) is drawn exactly where the finger
// already is, so on a tablet the user sees none of it and cannot tell the item
// is ready to move until they drag it somewhere and find out.
//
// (That timer only governs touch because the board registers MouseSensor, not
// PointerSensor, alongside the TouchSensor — see `boardDragSensors` in BoardV2.
// While PointerSensor was there it claimed every touch and armed on movement,
// so this tick used to fire mid-swipe rather than at the end of a hold.)
//
// A vibration is the one channel a fingertip cannot cover. It is the standard
// "I've got it" confirmation in mobile drag interfaces, and it costs one call.

// Deliberately at the bottom of the useful range. This is a CONFIRMATION, not
// an alert: long enough to register as a distinct tick under the finger, short
// enough that repeatedly picking cards up never feels like the device is
// buzzing at you.
export const DRAG_PICKUP_VIBRATION_MS = 10;

// Fire-and-forget. Returns whether the platform was asked to vibrate, which is
// for TESTS and for callers that want to know — never something to branch user
// behaviour on.
//
// Degrades silently by design, and there are three separate ways it has to:
//   - `navigator` absent (SSR, a bare test environment);
//   - `navigator.vibrate` absent — desktop Safari and EVERY browser on iOS,
//     which is a supported platform for this board, not an edge case;
//   - the call throwing, which some engines do when the Vibration API is
//     disabled by policy or the document lacks user activation.
//
// The empty `catch` is the exception to "never swallow an exception": a failed
// haptic is cosmetic, and letting it escape would abort the pointer handler
// that raised it — turning "no vibration" into "the drag does not start" on
// exactly the platforms that already cannot vibrate.
export function vibrate(durationMs) {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.vibrate !== 'function') return false;
  try {
    navigator.vibrate(durationMs);
    return true;
  } catch {
    return false;
  }
}

// The specific signal for "this is now picked up and will follow your finger".
export function vibrateDragPickup() {
  return vibrate(DRAG_PICKUP_VIBRATION_MS);
}
