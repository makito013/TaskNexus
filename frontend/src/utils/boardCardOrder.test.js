// frontend/src/utils/boardCardOrder.test.js
// The ordering logic of phase 3's card drag, tested directly — this is where
// the off-by-one lives, not in the dnd wiring (which jsdom cannot drive).

import { describe, it, expect } from 'vitest';
import { applyCardMove, computeCardDrop } from './boardCardOrder.js';

describe('computeCardDrop — inside the same column', () => {
  const column = [1, 2, 3, 4];

  it('moving a card DOWN lands it after the card it was dropped on', () => {
    // Dropping 1 onto 3 gives [2, 3, 1, 4] — the same arrayMove the sortable
    // preview animated under the finger.
    expect(computeCardDrop(column, 1, 3)).toEqual({ after_id: 3, before_id: 4 });
  });

  it('moving a card UP lands it before the card it was dropped on', () => {
    // Dropping 4 onto 2 gives [1, 4, 2, 3].
    expect(computeCardDrop(column, 4, 2)).toEqual({ after_id: 1, before_id: 2 });
  });

  it('moving to the very top reports no upper neighbour', () => {
    expect(computeCardDrop(column, 3, 1)).toEqual({ after_id: null, before_id: 1 });
  });

  it('moving to the very bottom reports no lower neighbour', () => {
    expect(computeCardDrop(column, 1, 4)).toEqual({ after_id: 4, before_id: null });
  });

  it('dropping on the column body sends the card to the end', () => {
    expect(computeCardDrop(column, 2, null)).toEqual({ after_id: 4, before_id: null });
  });

  it('is a no-op when the card is dropped on itself', () => {
    expect(computeCardDrop(column, 2, 2)).toBeNull();
  });

  it('is a no-op when the last card is dropped on the column body again', () => {
    // The identity case that must not cost a request: it is already there.
    expect(computeCardDrop(column, 4, null)).toBeNull();
  });

  it('dropping on the neighbour directly above is a real move, not a no-op', () => {
    // Easy to mistake for "stay put", but dropping 2 onto 1 takes 1's slot:
    // [2, 1, 3, 4]. Only a drop on ITSELF leaves the order alone.
    expect(computeCardDrop(column, 2, 1)).toEqual({ after_id: null, before_id: 1 });
  });
});

describe('computeCardDrop — arriving from another column', () => {
  const destination = [10, 20, 30];

  it('takes the slot of the card it was dropped on, pushing it down', () => {
    expect(computeCardDrop(destination, 99, 20)).toEqual({ after_id: 10, before_id: 20 });
  });

  it('dropped on the first card, it becomes the new first', () => {
    expect(computeCardDrop(destination, 99, 10)).toEqual({ after_id: null, before_id: 10 });
  });

  it('dropped on the column body, it goes to the end', () => {
    expect(computeCardDrop(destination, 99, null)).toEqual({ after_id: 30, before_id: null });
  });

  it('into an EMPTY column, both neighbours are null', () => {
    expect(computeCardDrop([], 99, null)).toEqual({ after_id: null, before_id: null });
  });

  it('is never a no-op, even when the resulting slot looks unchanged', () => {
    // The card is changing COLUMN, so there is always something to write —
    // the no-op shortcut must not swallow a cross-column move.
    expect(computeCardDrop([], 99, null)).not.toBeNull();
  });
});

describe('computeCardDrop — defensive', () => {
  it('cancels when the over card is not in the destination column', () => {
    // A stale drag against a board another tab has since changed.
    expect(computeCardDrop([1, 2], 3, 999)).toBeNull();
  });

  it('cancels with no active card', () => {
    expect(computeCardDrop([1, 2], null, 1)).toBeNull();
  });

  it('cancels when the column list is not an array', () => {
    expect(computeCardDrop(undefined, 1, 2)).toBeNull();
  });
});

describe('applyCardMove', () => {
  const cards = [
    { id: 1, titulo: 'Um', status: 'a_fazer' },
    { id: 2, titulo: 'Dois', status: 'a_fazer' },
    { id: 3, titulo: 'Tres', status: 'feito' },
  ];

  it('splices the card above its `beforeId` neighbour', () => {
    const next = applyCardMove(cards, 2, { status: 'a_fazer', afterId: null, beforeId: 1 });
    expect(next.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it('splices the card below its `afterId` neighbour when there is no `beforeId`', () => {
    const next = applyCardMove(cards, 1, { status: 'a_fazer', afterId: 2, beforeId: null });
    expect(next.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it('appends to the end when neither neighbour is given', () => {
    const next = applyCardMove(cards, 1, { status: 'em_revisao', afterId: null, beforeId: null });
    expect(next.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('rewrites the status of the moved card and of nobody else', () => {
    const next = applyCardMove(cards, 1, { status: 'feito', afterId: null, beforeId: 3 });
    expect(next.find((c) => c.id === 1).status).toBe('feito');
    expect(next.find((c) => c.id === 2).status).toBe('a_fazer');
  });

  it('does not mutate the array it was given', () => {
    const before = cards.map((c) => c.id);
    applyCardMove(cards, 1, { status: 'feito', afterId: null, beforeId: null });
    expect(cards.map((c) => c.id)).toEqual(before);
  });

  it('keeps every other field of the moved card', () => {
    const next = applyCardMove(cards, 1, { status: 'feito', afterId: null, beforeId: null });
    expect(next.find((c) => c.id === 1).titulo).toBe('Um');
  });

  it('returns the same reference when the card is not in the list', () => {
    expect(applyCardMove(cards, 999, { status: 'feito', afterId: null, beforeId: null }))
      .toBe(cards);
  });

  it('falls back to the end when the anchor is not in local state', () => {
    // A neighbour hidden by the board's client-side client filter: the anchor
    // is real on the server (which is what decides the order anyway), it just
    // is not here.
    const next = applyCardMove(cards, 1, { status: 'a_fazer', afterId: null, beforeId: 777 });
    expect(next.map((c) => c.id)).toEqual([2, 3, 1]);
  });
});
