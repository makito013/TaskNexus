// frontend/src/components/board/SortableBoardColumn.jsx
// Drag-to-reorder wrapper around one board column (task #43, phase 2).
//
// Exists as its own component purely because `useSortable` is a hook: it has
// to be called once per column, and a hook cannot be called inside the `.map`
// body of the parent. Everything visual about the column itself still lives in
// BoardV2 — this file only adds the drag affordances around it.
//
// `children` is a FUNCTION, not a node. The drag is armed by listeners that
// `useSortable` produces HERE, but they have to land on the column's own
// HEADER, whose markup lives in BoardV2. Passing them back down through a
// render prop keeps that row of controls in one file instead of splitting it
// across two.
//
// The activation surface is the WHOLE HEADER (Bruno's call after testing phase
// 2 live, matching Jira): grab anywhere in the header bar and drag. The
// dedicated ⠿ grip that shipped first is gone — a 28px target you had to aim
// at, when the whole bar was available.
//
// The "⋯" button inside the header keeps working, and that falls out of the
// sensors rather than needing special handling: MouseSensor only arms after
// 6px of travel and TouchSensor after a stationary hold
// (`BOARD_DRAG_LONG_PRESS_MS` in BoardV2), so a plain click never crosses
// either threshold and the button's native `click` fires untouched. (It is
// MouseSensor, not PointerSensor, for a reason that broke touch entirely —
// see `boardDragSensors` in BoardV2.)
// Proven with the REAL providers mounted in BoardV2.dnd.test.jsx — in the
// passthrough-mocked file the listeners are empty, so a click there would
// "pass" for the wrong reason.

import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';

// Phase 3 addition: besides being sortable itself, a column is also a DROP
// TARGET for cards. It has to be, and an empty column is why — a
// `SortableContext` with zero items registers no collision target at all, so
// without this there would be literally nothing to drop the first card of a
// new column onto.
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

// Written by hand instead of importing `CSS.Transform.toString` from
// `@dnd-kit/utilities`: that package is a TRANSITIVE dependency of core and
// sortable, not one this project declares, and importing straight from it
// would break the day either parent stops depending on it. The helper's extra
// work over this line is the scale component, which cannot apply here — every
// board column is a fixed 300px, so `scaleX`/`scaleY` are always 1.
function toTranslate(transform) {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

const styles = {
  // Merged INTO the header's own style by BoardV2, not replacing it.
  headerDrag: (dragging) => ({
    cursor: dragging ? 'grabbing' : 'grab',
    // `manipulation`, NOT `none` — changed together with the sensor fix in
    // BoardV2's `boardDragSensors`, and the two only work as a pair.
    //
    // This used to be `none`, "to stop the browser claiming the gesture as a
    // scroll before the sensor delay elapses". That goal is backwards for what
    // Bruno asked for: a SWIPE must scroll the board, and only a still HOLD may
    // grab. dnd-kit already arranges exactly that on its own side — during the
    // hold its `handleMove` returns BEFORE calling `preventDefault` (verified in
    // AbstractPointerSensor.handleMove), leaving the gesture to the browser, and
    // it only starts blocking native scroll once the drag has armed. So during
    // the hold, whether a swipe scrolls is decided purely by this property:
    //
    //   `none`         -> the browser never pans. A swipe here would cancel the
    //                     pickup (past the 8px tolerance) AND not scroll: a
    //                     dead gesture. It only ever "worked" because
    //                     PointerSensor was stealing every touch and turning
    //                     the swipe into a drag, which was the other bug.
    //   `manipulation` -> the browser pans on a swipe, which moves the finger
    //                     past the tolerance and cancels the pickup: scroll
    //                     wins. A still finger never pans, so the hold
    //                     completes and arms; from then on dnd-kit
    //                     preventDefaults every touchmove (TouchSensor.setup
    //                     installs the non-passive listener iOS needs for that)
    //                     and the board stops scrolling under the drag.
    //                     It also still disables double-tap zoom.
    //
    // ⚠️ Cannot be verified in jsdom (no native scrolling there). The tablet
    // test is the evidence. If a hold ever gets stolen as a scroll on a real
    // device, THIS is the line — but check the sensor list first.
    touchAction: 'manipulation',
    // The iOS callout suppression is unchanged and matters more than ever: the
    // hold now genuinely lasts `BOARD_DRAG_LONG_PRESS_MS` with the finger still,
    // which is exactly when iOS would raise its preview/selection bubble.
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
  }),
};

export function SortableBoardColumn({ slug, label, children }) {
  const {
    // `attributes` is deliberately NOT destructured — see the block below for
    // why every one of them is dropped.
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slug });

  // The card drop target, covering the column's card list (see the block at
  // the top of this file for why an empty column needs one of its own). It is
  // NOT gated on the column being empty: the whole body is the target, and the
  // collision detection in BoardV2 prefers a card over it whenever the pointer
  // is actually over one, so this only ever wins in genuinely empty space.
  const { setNodeRef: setDropzoneRef, isOver: isCardOver } = useDroppable({
    id: columnDropzoneId(slug),
  });

  // The source column stays IN FLOW while dragging — it is not removed and not
  // absolutely positioned — so the row never collapses by 300px mid-gesture.
  // Faded to 0.4 and outlined in dashed accent, it doubles as the drop
  // placeholder: as the other columns shift around it, this gap is exactly
  // where the column will land. Same dashed-accent vocabulary as the ghost
  // "+ Nova coluna" column, so a dashed border on this row already reads as
  // "something goes here".
  // `height: 100%` is load-bearing, not decoration. This wrapper became the
  // scroller's flex child, displacing the column itself — and the column sizes
  // itself with `height: 100%`, which resolves against its PARENT. Without a
  // definite height here that chain breaks and every column collapses to the
  // height of its cards. jsdom cannot see it (no layout engine), so it is
  // reasoned about rather than tested.
  // The outline is 2px, not the 1px this shipped with. The TouchSensor arms
  // the drag after `BOARD_DRAG_LONG_PRESS_MS` WITHOUT any movement (dnd-kit
  // runs `setTimeout(handleStart, delay)`), and every signal that fires at that
  // moment is drawn underneath the finger that caused it. A ring around the
  // whole column is the part of the feedback a fingertip cannot cover: the
  // column is 300px wide and full height, so its edges are nowhere near the
  // contact patch.
  //
  // (Added after Bruno "held the column and nothing seemed to happen". The
  // deeper cause of that report turned out to be that touch was never on the
  // timer at all — see `boardDragSensors` in BoardV2 — but the ring is still
  // right now that the hold genuinely arms with the finger still.)
  //
  // `outlineOffset` pushes it clear of the column's own border so the two do
  // not read as one thick line.
  const wrapperStyle = {
    height: '100%',
    flexShrink: 0,
    transform: toTranslate(transform),
    transition,
    ...(isDragging
      ? {
        opacity: 0.4,
        borderRadius: '12px',
        outline: '2px dashed var(--v2-accent)',
        outlineOffset: '2px',
      }
      : null),
  };

  // dnd-kit's `attributes` are dropped WHOLESALE — only `listeners` are kept.
  // Each of the five it produces is either harmful or inert here:
  //
  //   role="button" / tabIndex=0 — they exist to make a dedicated grip a
  //     focusable, button-like activator. Right for the old ⠿; wrong for the
  //     header BAR, which CONTAINS the "⋯" button. An interactive element
  //     wrapping an interactive element misreports what is actually clickable,
  //     and the focus stop armed nothing anyway: BoardV2 passes an explicit
  //     sensor list (Pointer + Touch) with no KeyboardSensor.
  //
  //   aria-roledescription="sortable" / aria-disabled — role-gated. ARIA 1.2
  //     forbids `roledescription` on a generic element, so on a plain <div>
  //     both are simply ignored. Keeping them would be dead markup that LOOKS
  //     like an accessibility feature — the worst kind, because it stops
  //     anyone from adding the real thing.
  //
  //   aria-describedby — the one that is NOT inert, and the reason this is a
  //     removal rather than a trim. It points at dnd-kit's hidden instructions
  //     node, and `aria-describedby` deliberately exposes `display: none`
  //     content, so a screen reader would read "To pick up a draggable item,
  //     press the space bar…": English, in a pt-BR product, describing a
  //     keyboard interaction this build does not implement.
  //
  // The accessible name comes from our own `aria-label` below instead — which
  // only works because BoardV2 puts `role="group"` on the same element. ARIA
  // 1.2 forbids naming a generic element, so on a roleless <div> this label
  // would be dropped exactly like `aria-roledescription` was; the role is what
  // makes it real, and the two must stay together.
  //
  // ⚠️ There is NO keyboard route to reordering any more: the ◀▶ arrows that
  // provided it were removed at Bruno's request, and no KeyboardSensor is
  // registered. A conscious trade, recorded in BoardV2's header.
  //
  // Truthful pt-BR instructions and announcements are configured once, on the
  // DndContext in BoardV2, where the live region actually lives.
  const headerDragProps = {
    ref: setActivatorNodeRef,
    style: styles.headerDrag(isDragging),
    'aria-label': `Coluna ${label ?? slug} — arraste para reordenar`,
    ...listeners,
  };

  // Merged into the column BODY's own style by BoardV2. `isCardOver` is the
  // "you can drop here" cue for a column with no cards in it — an empty column
  // has no card for the drop indicator line to sit above, so the body tints
  // its own border instead. A populated column gets the line, drawn by
  // BoardV2, and does not need this.
  const bodyDropProps = {
    ref: setDropzoneRef,
    isCardOver,
  };

  return (
    <div ref={setNodeRef} style={wrapperStyle}>
      {children({ headerDragProps, bodyDropProps, isDragging })}
    </div>
  );
}
