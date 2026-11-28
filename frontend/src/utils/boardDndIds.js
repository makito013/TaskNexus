// Sortable ids of the board's drag and drop, shared by the V2 components and the
// V3 board. Pure strings: no React, no dnd-kit.

// Prefix that makes a card's sortable id unmistakable next to a column's.
// Columns are keyed by BARE SLUG (`em_andamento`), so without this the two
// namespaces would share one id space inside the DndContext and `onDragEnd`
// would have to guess what it was handed. Exported because BoardV2 both builds
// these ids and branches on them.
export const CARD_DND_ID_PREFIX = 'card:';

export function cardDndId(cardId) {
  return `${CARD_DND_ID_PREFIX}${cardId}`;
}

// True for an id produced by `cardDndId`. Written as a helper so the prefix
// test lives next to the prefix instead of being spelled out at every call.
export function isCardDndId(id) {
  return String(id ?? '').startsWith(CARD_DND_ID_PREFIX);
}

// The numeric card id back out of a sortable id, or null for anything that is
// not one. Numeric because `cards[].id` is a number and a string would quietly
// fail every `===` against it.
export function cardIdFromDndId(id) {
  if (!isCardDndId(id)) return null;
  const raw = String(id).slice(CARD_DND_ID_PREFIX.length);
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

// A column is also a DROP TARGET for cards: a `SortableContext` with zero items
// registers no collision target at all, so an empty column needs its own id to
// drop the first card onto.
//
// Separate id namespace from both the column's own sortable id (a bare slug)
// and a card's (`card:` prefixed), so `onDragEnd` can tell all three apart by
// inspecting the id instead of guessing from context.
export const COLUMN_DROPZONE_ID_PREFIX = 'dropzone:';

export function columnDropzoneId(slug) {
  return `${COLUMN_DROPZONE_ID_PREFIX}${slug}`;
}

export function isColumnDropzoneId(id) {
  return String(id ?? '').startsWith(COLUMN_DROPZONE_ID_PREFIX);
}

export function slugFromColumnDropzoneId(id) {
  if (!isColumnDropzoneId(id)) return null;
  return String(id).slice(COLUMN_DROPZONE_ID_PREFIX.length);
}
