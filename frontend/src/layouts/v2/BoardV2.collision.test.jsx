// frontend/src/layouts/v2/BoardV2.collision.test.jsx
// The one piece of phase 3 that neither sibling test file can reach.
//
// BoardV2.test.jsx feeds `onDragEnd` a synthetic `{active, over}`, so it never
// runs the code that DECIDES what `over` is. BoardV2.dnd.test.jsx mounts the
// real providers but cannot drag a card, because dnd-kit's geometry needs real
// `getBoundingClientRect` values and jsdom reports zeros for everything.
//
// So the geometry is stubbed here and only OUR decisions are asserted: which
// containers each kind of drag is allowed to consider, that a card beats the
// column dropzone when both are under the pointer, and — the load-bearing one
// — that nothing under the pointer stays nothing instead of degrading into a
// nearest-match. That last rule is what makes "release it off the board and
// nothing happens" true; a distance fallback would quietly move the card to
// whatever happened to be closest.
//
// ⚠️ This does NOT replace manual testing of the real gesture. The mapping
// from pixels to a droppable is exactly the part still stubbed out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pointerWithin = vi.fn();
const closestCenter = vi.fn();

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    pointerWithin: (...args) => pointerWithin(...args),
    closestCenter: (...args) => closestCenter(...args),
  };
});

const { buildBoardCollisionDetection } = await import('./BoardV2.jsx');

// dnd-kit passes droppable containers as objects with an `id`; nothing else
// about them matters to the filtering under test.
const CONTAINERS = [
  { id: 'a_fazer' },
  { id: 'feito' },
  { id: 'dropzone:a_fazer' },
  { id: 'dropzone:feito' },
  { id: 'card:1' },
  { id: 'card:2' },
];

function detect(activeId, extra = {}) {
  return buildBoardCollisionDetection({
    active: { id: activeId },
    droppableContainers: CONTAINERS,
    ...extra,
  });
}

function idsPassedTo(spy) {
  return spy.mock.calls[0][0].droppableContainers.map((c) => c.id);
}

beforeEach(() => {
  pointerWithin.mockReset();
  closestCenter.mockReset();
  pointerWithin.mockReturnValue([]);
  closestCenter.mockReturnValue([]);
});

describe('buildBoardCollisionDetection — dragging a COLUMN', () => {
  it('considers only the columns, never a card or a dropzone', () => {
    detect('a_fazer');

    expect(idsPassedTo(closestCenter)).toEqual(['a_fazer', 'feito']);
  });

  it('keeps phase 2 behaviour: a distance match, not pointer containment', () => {
    // The column drag shipped and was validated live with closestCenter. It
    // has no "between two things" to get wrong, so it must not change.
    closestCenter.mockReturnValue([{ id: 'feito' }]);

    expect(detect('a_fazer')).toEqual([{ id: 'feito' }]);
    expect(pointerWithin).not.toHaveBeenCalled();
  });
});

describe('buildBoardCollisionDetection — dragging a CARD', () => {
  it('considers only cards and dropzones, never a column', () => {
    detect('card:1');

    expect(idsPassedTo(pointerWithin))
      .toEqual(['dropzone:a_fazer', 'dropzone:feito', 'card:1', 'card:2']);
  });

  it('prefers a CARD over the column dropzone when both are under the pointer', () => {
    // The dropzone covers the whole column body, cards included, so both are
    // reported on almost every hover. Without this preference every drop would
    // read as "released in empty space" and land at the end of the column.
    pointerWithin.mockReturnValue([{ id: 'dropzone:a_fazer' }, { id: 'card:2' }]);

    expect(detect('card:1')).toEqual([{ id: 'card:2' }]);
  });

  it('falls through to the dropzone when no card is under the pointer', () => {
    // An empty column, or the padding below the last card.
    pointerWithin.mockReturnValue([{ id: 'dropzone:feito' }]);

    expect(detect('card:1')).toEqual([{ id: 'dropzone:feito' }]);
  });

  it('reports NOTHING when the pointer is outside every droppable', () => {
    // The gap between two columns, the header row, off the board entirely.
    // "No valid target" is the specified product behaviour — the drop is
    // cancelled with no request at all.
    pointerWithin.mockReturnValue([]);

    expect(detect('card:1')).toEqual([]);
  });

  it('NEVER falls back to a distance match for a card', () => {
    // The regression this file exists for. A closestCenter fallback always
    // finds a nearest card somewhere on the board, so a release meant as
    // "never mind" would silently rewrite the vertical order Bruno arranged by
    // hand — the one thing the product decision says an accident must not do.
    pointerWithin.mockReturnValue([]);
    closestCenter.mockReturnValue([{ id: 'card:2' }]);

    expect(detect('card:1')).toEqual([]);
    expect(closestCenter).not.toHaveBeenCalled();
  });
});
