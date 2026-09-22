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
// sensors rather than needing special handling: PointerSensor only arms after
// 6px of travel and TouchSensor after a 280ms hold, so a plain click never
// crosses either threshold and the button's native `click` fires untouched.
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
    // The defensive pair already validated on TerminalShortcutsFab's long
    // press: `touchAction: none` stops the browser claiming the gesture as a
    // scroll before the 280ms sensor delay elapses, and the iOS callout
    // suppression stops a long press raising the system preview/selection
    // bubble mid-drag. Both matter MORE now that the surface is the whole
    // header rather than one small grip.
    touchAction: 'none',
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
  const wrapperStyle = {
    height: '100%',
    flexShrink: 0,
    transform: toTranslate(transform),
    transition,
    ...(isDragging
      ? { opacity: 0.4, borderRadius: '12px', outline: '1px dashed var(--v2-accent)' }
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
