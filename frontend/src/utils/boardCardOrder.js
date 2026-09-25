// frontend/src/utils/boardCardOrder.js
// Pure ordering math for dragging a CARD inside/between board columns
// (task #43, phase 3). Companion to boardColumnOrder.js, which does the same
// job for the columns themselves, and it exists for the same reason spelled
// out there: dnd-kit's gesture cannot be exercised in jsdom (its sensors need
// pointer capture and real `getBoundingClientRect` values, and jsdom gives
// neither), so everything that DECIDES anything lives here, in functions that
// take arrays and return arrays, and the component keeps only the part that
// genuinely needs a browser.
//
// Two functions, two jobs:
//
//   computeCardDrop  — what to TELL THE SERVER: the pair of neighbour ids the
//                      card was dropped between.
//   applyCardMove    — what to SHOW IMMEDIATELY: the same move applied to the
//                      local array, so the card does not snap back to where it
//                      was while the request is in flight.

// The card's neighbours, not its position. The backend computes the actual
// `board_position` from these two ids (see backend/app/board_positions.py), and
// the frontend never sends a number: an id that went stale is DETECTABLE and
// becomes a clean 409, while a stale float is perfectly writable and would
// corrupt the order in silence.
//
// `columnCardIds` is the destination column as it is CURRENTLY RENDERED, in
// order. `activeId` may or may not be in it — a card dragged in from another
// column is not. `overId` is the card it was dropped on, or null when it was
// dropped on the column's empty area (which means "the end").
//
// Returns `{ after_id, before_id }`, or `null` when there is nothing to do:
// the caller skips both the optimistic update and the request, exactly like
// the identity check `reorderColumns` gives its caller.
export function computeCardDrop(columnCardIds, activeId, overId) {
  if (!Array.isArray(columnCardIds)) return null;
  if (activeId == null) return null;

  const from = columnCardIds.indexOf(activeId);
  const next = [...columnCardIds];
  if (from !== -1) next.splice(from, 1);

  let to;
  if (overId === activeId) {
    // Picked up and put back on itself. The no-op check below turns this into
    // a cancelled drag.
    to = from === -1 ? next.length : from;
  } else if (overId == null) {
    // Dropped on the column's EMPTY space — which is only reachable when no
    // card is under the pointer (the collision detection prefers a card over
    // the column's dropzone), so it genuinely means "past the last one".
    // A card that was already last ends up rebuilding the same array and the
    // no-op check cancels it.
    to = next.length;
  } else {
    // Index in the ORIGINAL array, then insert after removing — the same
    // arrayMove semantics `reorderColumns` uses, and the same ones dnd-kit's
    // sortable preview animates while the finger is still down. Dropping onto
    // a card BELOW you therefore lands you after it, not before it, which is
    // what the preview promised.
    to = columnCardIds.indexOf(overId);
    // An `over` the destination column does not contain: a stale drag against
    // a board another tab has since changed. Cancel rather than guess.
    if (to === -1) return null;
  }

  next.splice(to, 0, activeId);

  // Nothing actually moved — the card was dropped back into its own slot.
  if (from !== -1 && next.every((id, index) => id === columnCardIds[index])) {
    return null;
  }

  return {
    after_id: to > 0 ? next[to - 1] : null,
    before_id: to < next.length - 1 ? next[to + 1] : null,
  };
}

// The optimistic half: the same move, applied to the local card array.
//
// It splices the ARRAY rather than just rewriting `board_position`, because
// the board renders each column in array order — it does not sort. The server
// is what sorts (`ORDER BY board_position ASC, id ASC`), so a local write to
// `board_position` alone would change nothing on screen until the next poll.
//
// `cards` is the WHOLE list, every column at once, which is how useCards holds
// it. Returns the same reference untouched when `cardId` is not in it.
export function applyCardMove(cards, cardId, { status, afterId, beforeId }) {
  if (!Array.isArray(cards)) return cards;
  const index = cards.findIndex((c) => c.id === cardId);
  if (index === -1) return cards;

  const moving = { ...cards[index], status };
  const rest = [...cards.slice(0, index), ...cards.slice(index + 1)];

  // `beforeId` wins when both are given: landing directly above a known card
  // is the tighter of the two constraints, and it is also the one the drop
  // indicator drew on screen.
  let at = -1;
  if (beforeId != null) {
    at = rest.findIndex((c) => c.id === beforeId);
  } else if (afterId != null) {
    const afterIndex = rest.findIndex((c) => c.id === afterId);
    at = afterIndex === -1 ? -1 : afterIndex + 1;
  }
  // No usable anchor (an empty destination column, or a neighbour that is not
  // in local state because a filter hides it): the end of the list. Position
  // within the global array only matters RELATIVE to the cards of the same
  // column, and there are none to be relative to.
  if (at === -1) at = rest.length;

  rest.splice(at, 0, moving);
  return rest;
}
