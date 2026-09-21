// frontend/src/utils/boardColumnOrder.js
// Pure array reordering for the board's columns (task #43, phase 2 — drag to
// reorder).
//
// This lives in its own module, apart from the drag wiring, for one concrete
// reason: dnd-kit's gesture cannot be exercised in jsdom. Its sensors rely on
// pointer capture and on real `getBoundingClientRect` values, and jsdom
// provides neither (every rect is zeros). A test that "simulates a drag"
// against dnd-kit passes or fails for reasons unrelated to the ordering logic.
//
// So the ordering — the part that actually decides what the board looks like
// and what the server is told — is computed HERE, by a function that takes
// three strings and returns an array, and is tested directly. The component
// keeps only the part that genuinely needs a browser.

// Move `activeSlug` to the position currently held by `overSlug`, shifting the
// slugs in between. This is a MOVE, not a swap: dragging the first column onto
// the third leaves the third where the second was, which is what the drop
// indicator promised the user.
//
// Returns the SAME array reference when the move is a no-op, so the caller can
// skip the optimistic update and the network round-trip with an identity check
// (`next === slugs`) instead of comparing contents element by element.
//
// No-ops, all of which happen in normal use:
//   - `overSlug` null/undefined — dropped outside any column;
//   - `activeSlug === overSlug` — picked a column up and put it back;
//   - either slug absent from `slugs` — a stale drag against a board that
//     another tab has since changed.
export function reorderColumns(slugs, activeSlug, overSlug) {
  if (!Array.isArray(slugs)) return slugs;
  if (activeSlug == null || overSlug == null) return slugs;
  if (activeSlug === overSlug) return slugs;

  const from = slugs.indexOf(activeSlug);
  const to = slugs.indexOf(overSlug);
  if (from === -1 || to === -1) return slugs;

  const next = [...slugs];
  // Remove first, then insert: splicing the removal out shifts the target
  // index when moving rightwards, which is exactly the behaviour a drop
  // "onto" a column to the right should have.
  next.splice(from, 1);
  next.splice(to, 0, activeSlug);
  return next;
}
