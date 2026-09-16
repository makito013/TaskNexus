// frontend/src/hooks/useColumns.test.js
// Board column state (task #43, phase 1). Same renderHook + mocked
// `global.fetch` pattern as useCards.test.js — the hook is exercised through
// the real `api` module, so the request shapes are covered too.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useColumns } from './useColumns.js';

const COLUMNS = [
  { slug: 'a_fazer', label: 'A Fazer', position: 1, is_done: false },
  { slug: 'em_andamento', label: 'Em Andamento', position: 2, is_done: false },
  { slug: 'feito', label: 'Feito', position: 3, is_done: true },
];

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn(() => Promise.resolve({
    ok, status, json: () => Promise.resolve(body),
  }));
}

async function renderLoaded(columns = COLUMNS) {
  mockFetchOnce(columns);
  const hook = renderHook(() => useColumns());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('useColumns — initial fetch', () => {
  it('loads the columns and derives doneSlug and firstSlug', async () => {
    const { result } = await renderLoaded();

    expect(result.current.columns).toEqual(COLUMNS);
    expect(result.current.doneSlug).toBe('feito');
    expect(result.current.firstSlug).toBe('a_fazer');
    expect(global.fetch).toHaveBeenCalledWith('/api/board/columns');
  });

  it('fetches ONCE — there is no poll, unlike useCards', async () => {
    vi.useFakeTimers();
    try {
      mockFetchOnce(COLUMNS);
      renderHook(() => useColumns());
      await vi.advanceTimersByTimeAsync(30000);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an empty board and stops loading when the read fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useColumns());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.columns).toEqual([]);
    // No done column known yet — consumers read this as "do not recompute".
    expect(result.current.doneSlug).toBeNull();
  });
});

describe('useColumns — mutations', () => {
  it('appends the column the server created, with the slug IT derived', async () => {
    const { result } = await renderLoaded();

    const created = { slug: 'em_homologacao', label: 'Em Homologação', position: 4, is_done: false };
    mockFetchOnce(created, { status: 201 });
    await act(async () => { await result.current.createColumn('Em Homologação'); });

    // The slug is never computed locally: accent stripping and collision
    // suffixes live on the backend, and duplicating them here would drift.
    expect(result.current.columns[3]).toEqual(created);
  });

  it('surfaces the backend message when creation is refused', async () => {
    const { result } = await renderLoaded();

    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: "Já existe uma coluna chamada 'Feito'" }),
    }));

    await act(async () => {
      await expect(result.current.createColumn('Feito')).rejects.toThrow(/Já existe/);
    });
    expect(result.current.columns).toEqual(COLUMNS);
  });

  it('replaces only the renamed column', async () => {
    const { result } = await renderLoaded();

    const renamed = { slug: 'a_fazer', label: 'Backlog', position: 1, is_done: false };
    mockFetchOnce(renamed);
    await act(async () => { await result.current.renameColumn('a_fazer', 'Backlog'); });

    expect(result.current.columns[0]).toEqual(renamed);
    expect(result.current.columns.slice(1)).toEqual(COLUMNS.slice(1));
  });

  it('sends the WHOLE order on reorder and adopts the list that comes back', async () => {
    const { result } = await renderLoaded();

    const reordered = [
      { slug: 'feito', label: 'Feito', position: 1, is_done: true },
      { slug: 'a_fazer', label: 'A Fazer', position: 2, is_done: false },
      { slug: 'em_andamento', label: 'Em Andamento', position: 3, is_done: false },
    ];
    mockFetchOnce(reordered);
    await act(async () => {
      await result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']);
    });

    expect(result.current.columns).toEqual(reordered);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/board/columns/reorder',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slugs: ['feito', 'a_fazer', 'em_andamento'] }),
      })
    );
  });

  it('replaces the whole list when the done mark moves — two rows change at once', async () => {
    const { result } = await renderLoaded();

    const afterDone = [
      { slug: 'a_fazer', label: 'A Fazer', position: 1, is_done: false },
      { slug: 'em_andamento', label: 'Em Andamento', position: 2, is_done: true },
      { slug: 'feito', label: 'Feito', position: 3, is_done: false },
    ];
    mockFetchOnce(afterDone);
    await act(async () => { await result.current.setDoneColumn('em_andamento'); });

    expect(result.current.doneSlug).toBe('em_andamento');
    expect(result.current.columns.filter((c) => c.is_done)).toHaveLength(1);
  });

  it('drops the deleted column from local state', async () => {
    const { result } = await renderLoaded();

    mockFetchOnce({ status: 'deleted', slug: 'em_andamento' });
    await act(async () => { await result.current.deleteColumn('em_andamento'); });

    expect(result.current.columns.map((c) => c.slug)).toEqual(['a_fazer', 'feito']);
  });

  it('rethrows a refused delete carrying reason and cards, leaving state intact', async () => {
    const { result } = await renderLoaded();

    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({
        detail: { reason: 'coluna_com_cards', message: 'A coluna ainda tem 3 card(s).', cards: 3 },
      }),
    }));

    let thrown;
    await act(async () => {
      thrown = await result.current.deleteColumn('em_andamento').catch((e) => e);
    });

    // The caller picks WHICH dialog to show from `reason`, never from prose.
    expect(thrown.reason).toBe('coluna_com_cards');
    expect(thrown.cards).toBe(3);
    expect(result.current.columns).toEqual(COLUMNS);
  });
});
