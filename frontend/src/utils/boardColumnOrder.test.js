// frontend/src/utils/boardColumnOrder.test.js
// The real test surface of phase 2's drag: dnd-kit's gesture cannot run in
// jsdom, so the ordering decision is tested here, directly, and the component
// test only invokes `onDragEnd` with a synthetic event.

import { describe, it, expect } from 'vitest';
import { reorderColumns } from './boardColumnOrder.js';

const SLUGS = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];

describe('reorderColumns — real moves', () => {
  it('moves a column to the start', () => {
    expect(reorderColumns(SLUGS, 'feito', 'a_fazer')).toEqual([
      'feito', 'a_fazer', 'em_andamento', 'em_revisao',
    ]);
  });

  it('moves a column to the end', () => {
    expect(reorderColumns(SLUGS, 'a_fazer', 'feito')).toEqual([
      'em_andamento', 'em_revisao', 'feito', 'a_fazer',
    ]);
  });

  it('moves from the middle to the middle, leftwards', () => {
    expect(reorderColumns(SLUGS, 'em_revisao', 'em_andamento')).toEqual([
      'a_fazer', 'em_revisao', 'em_andamento', 'feito',
    ]);
  });

  it('moves from the middle to the middle, rightwards', () => {
    expect(reorderColumns(SLUGS, 'em_andamento', 'em_revisao')).toEqual([
      'a_fazer', 'em_revisao', 'em_andamento', 'feito',
    ]);
  });

  it('moves onto an ADJACENT column, which reads as a swap of the pair', () => {
    expect(reorderColumns(SLUGS, 'a_fazer', 'em_andamento')).toEqual([
      'em_andamento', 'a_fazer', 'em_revisao', 'feito',
    ]);
  });

  // The distinction that a naive "swap the two" implementation gets wrong:
  // everything between the source and the target has to shift by one, not stay
  // put while two ends trade places.
  it('shifts the columns in between rather than swapping the two ends', () => {
    const result = reorderColumns(SLUGS, 'a_fazer', 'feito');
    expect(result).toEqual(['em_andamento', 'em_revisao', 'feito', 'a_fazer']);
    // A swap would have produced ['feito', 'em_andamento', 'em_revisao', 'a_fazer'].
    expect(result[0]).not.toBe('feito');
  });

  it('never loses, duplicates or invents a slug', () => {
    const result = reorderColumns(SLUGS, 'em_revisao', 'a_fazer');
    expect([...result].sort()).toEqual([...SLUGS].sort());
    expect(result).toHaveLength(SLUGS.length);
  });

  it('does not mutate the input array', () => {
    const original = [...SLUGS];
    reorderColumns(SLUGS, 'a_fazer', 'feito');
    expect(SLUGS).toEqual(original);
  });
});

describe('reorderColumns — no-ops', () => {
  // Identity, not just equality: the caller skips the optimistic update and the
  // POST on this check, so returning a fresh equal array would cost a pointless
  // round-trip on every cancelled drag.
  it('returns the SAME reference when the column is dropped on itself', () => {
    expect(reorderColumns(SLUGS, 'a_fazer', 'a_fazer')).toBe(SLUGS);
  });

  it('returns the SAME reference when dropped outside any column', () => {
    expect(reorderColumns(SLUGS, 'a_fazer', null)).toBe(SLUGS);
    expect(reorderColumns(SLUGS, 'a_fazer', undefined)).toBe(SLUGS);
  });

  it('returns the SAME reference for a slug that is not on the board', () => {
    // A stale drag: another tab deleted or renamed the column mid-gesture.
    expect(reorderColumns(SLUGS, 'fantasma', 'a_fazer')).toBe(SLUGS);
    expect(reorderColumns(SLUGS, 'a_fazer', 'fantasma')).toBe(SLUGS);
  });

  it('returns the SAME reference on a single-column board', () => {
    const one = ['unica'];
    expect(reorderColumns(one, 'unica', 'unica')).toBe(one);
  });

  it('handles an empty board without throwing', () => {
    expect(reorderColumns([], 'a_fazer', 'feito')).toEqual([]);
  });

  it('tolerates a non-array first argument instead of throwing', () => {
    expect(reorderColumns(null, 'a_fazer', 'feito')).toBeNull();
  });
});
