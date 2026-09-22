// frontend/src/components/board/SortableBoardCard.jsx
// Drag-to-reposition wrapper around one board card (task #43, phase 3).
// Sibling of SortableBoardColumn.jsx, and deliberately built the same way —
// the two live in the SAME DndContext, so anything they do differently is a
// difference someone has to hold in their head.
//
// Exists as its own component for the same mechanical reason as the column
// one: `useSortable` is a hook, it has to run once per card, and a hook cannot
// be called inside the `.map` body of the parent. Everything visual about the
// card itself stays in BoardV2.
//
// `children` is a FUNCTION for the same reason too: the listeners produced
// here have to land on markup that lives in BoardV2, and a render prop keeps
// the card's face in one file instead of splitting it across two.
//
// The whole card is the drag surface, matching the column, where the whole
// header bar is. The controls inside it — the clickable title and the status
// `<select>` — keep working without any special handling: the shared sensors
// only arm after 6px of travel (mouse) or a 280ms hold (touch), and neither a
// click nor a tap on a select crosses those thresholds.
//
// ⚠️ Same accepted gap as the column: there is no KeyboardSensor in this
// DndContext, so dragging a card is pointer/touch only. Unlike the column,
// though, the card is NOT left without a keyboard route — the status `<select>`
// in its footer still moves it between columns (landing it at the end of the
// destination). Vertical position within a column has no keyboard path.

import { useSortable } from '@dnd-kit/sortable';

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

// Hand-written rather than imported from `@dnd-kit/utilities` — see the same
// note in SortableBoardColumn.jsx: that package is a TRANSITIVE dependency of
// core/sortable, not one this project declares. The scale component the helper
// adds cannot apply here either, since a dragged card is never scaled.
function toTranslate(transform) {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

const styles = {
  // Merged INTO the card's own style by BoardV2, not replacing it.
  drag: (dragging) => ({
    cursor: dragging ? 'grabbing' : 'grab',
    // The defensive pair already validated twice: on TerminalShortcutsFab's
    // long press and then on the column header in phase 2. `touchAction: none`
    // stops the browser claiming the gesture as a scroll before the 280ms
    // sensor delay elapses — and a card sits inside a VERTICALLY scrolling
    // column body, so here it is load-bearing in both axes. The iOS callout
    // suppression stops a long press raising the system selection bubble over
    // the card's text mid-drag.
    touchAction: 'none',
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  }),
};

export function SortableBoardCard({ cardId, titulo, children }) {
  const {
    // `attributes` is deliberately NOT destructured — same wholesale drop as
    // SortableBoardColumn, and for the same reasons. The one that matters most
    // here is `aria-describedby`: it points at dnd-kit's hidden English
    // instructions for a space-bar/arrow-key drag this build does not
    // implement, and aria-describedby deliberately exposes `display: none`
    // content, so a screen reader really would read it out on a pt-BR board.
    // `role="button"`/`tabIndex` are just as wrong: this element CONTAINS the
    // title button and the status select, and a control wrapping controls
    // misreports what is clickable while adding a focus stop that arms nothing
    // (no KeyboardSensor is registered).
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardDndId(cardId) });

  // The source card stays IN FLOW while dragging — faded, not removed — so the
  // column does not visibly collapse by one card's height the moment the drag
  // arms, and the gap it leaves reads as the placeholder it is. Same 0.4 and
  // same dashed-accent vocabulary as the dragged column in phase 2.
  const dragProps = {
    ref: setNodeRef,
    style: {
      transform: toTranslate(transform),
      transition,
      ...styles.drag(isDragging),
      // 2px with an offset, matching SortableBoardColumn — see the block
      // there. The drag arms on the 280ms timer with no movement, and a card
      // is roughly finger-sized, so the ring around it is most of what is left
      // visible at the instant it becomes draggable.
      ...(isDragging
        ? {
          opacity: 0.4,
          outline: '2px dashed var(--v2-accent)',
          outlineOffset: '2px',
        }
        : null),
    },
    // The accessible name is ours, not dnd-kit's. It only works because
    // BoardV2 puts `role="group"` on the same element: ARIA 1.2 forbids naming
    // a generic element, so on a roleless <div> this label would be dropped
    // exactly like dnd-kit's own `aria-roledescription` is. The role and the
    // label must stay together.
    'aria-label': `Card ${titulo ?? cardId} — arraste para reposicionar`,
    ...listeners,
  };

  return children({ dragProps, isDragging });
}
