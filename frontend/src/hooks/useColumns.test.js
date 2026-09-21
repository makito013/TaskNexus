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

  // Phase 2 made this the one optimistic mutation: a dragged column has to
  // follow the finger, it cannot wait for the round-trip.
  it('applies the new order LOCALLY before the request resolves', async () => {
    const { result } = await renderLoaded();

    let resolveRequest;
    global.fetch = vi.fn(() => new Promise((resolve) => {
      resolveRequest = () => resolve({
        ok: true, status: 200, json: () => Promise.resolve([]),
      });
    }));

    let pending;
    await act(async () => {
      pending = result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']);
      // Nothing resolved yet — this is mid-flight, exactly where the finger is.
      await Promise.resolve();
    });

    expect(result.current.columns.map((c) => c.slug)).toEqual([
      'feito', 'a_fazer', 'em_andamento',
    ]);
    // Positions are renumbered locally so the optimistic rows are coherent.
    expect(result.current.columns.map((c) => c.position)).toEqual([1, 2, 3]);
    // The rest of each row survives the optimistic rebuild.
    expect(result.current.columns[0].label).toBe('Feito');
    expect(result.current.columns[0].is_done).toBe(true);

    await act(async () => { resolveRequest(); await pending; });
  });

  it('rolls back to the previous order when the server refuses the reorder', async () => {
    const { result } = await renderLoaded();

    // 409: another tab created or deleted a column, so this list is no longer
    // a permutation of what the server holds.
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: 'permutação inválida' }),
    }));

    await act(async () => {
      await expect(
        result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento'])
      ).rejects.toThrow();
    });

    // Back exactly where it started — not a re-fetched board, not a half-moved
    // one. There is no automatic retry in this phase, so the rollback IS the
    // whole recovery.
    expect(result.current.columns).toEqual(COLUMNS);
  });

  it('adopts the SERVER order once it answers, overriding the optimistic guess', async () => {
    const { result } = await renderLoaded();

    // The server is the authority on `position`, and may carry a label another
    // tab changed mid-drag.
    const serverAnswer = [
      { slug: 'feito', label: 'Entregue', position: 1, is_done: true },
      { slug: 'a_fazer', label: 'A Fazer', position: 2, is_done: false },
      { slug: 'em_andamento', label: 'Em Andamento', position: 3, is_done: false },
    ];
    mockFetchOnce(serverAnswer);

    await act(async () => {
      await result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']);
    });

    expect(result.current.columns).toEqual(serverAnswer);
    expect(result.current.columns[0].label).toBe('Entregue');
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

// -- QA: two reorders in flight at the same time ----------------------------
//
// `reorderColumns` writes optimistically and then lets the server's answer win,
// but it holds NO request sequence and cancels nothing. Nothing gates the
// control that triggers it either: dragging a column header is never disabled
// while a POST is in flight. So dragging and then immediately dragging again
// puts two reorders in the air, and the LAST RESPONSE TO ARRIVE wins rather
// than the last request sent.
//
// Both tests below are CHARACTERISATION tests: they pass, and what they pin is
// the broken behaviour, so it cannot change unnoticed. They are deliberately
// NOT xfail — unlike a violated invariant, there is no agreed correct behaviour
// here yet (sequence the requests? disable the controls in flight? accept
// last-write-wins?), and a strict xfail would assert a fix nobody has chosen.

function deferredResponse() {
  let settle;
  let fail;
  const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  return {
    promise,
    resolveWith: (body) => settle({ ok: true, status: 200, json: () => Promise.resolve(body) }),
    rejectWith409: () => settle({ ok: false, status: 409, json: () => Promise.resolve({}) }),
    fail,
  };
}

const ORDER_B = ['em_andamento', 'a_fazer', 'feito'];
const ORDER_C = ['feito', 'em_andamento', 'a_fazer'];

function serverAnswer(slugs) {
  return slugs.map((slug, index) => ({
    ...COLUMNS.find((c) => c.slug === slug), position: index + 1,
  }));
}

describe('useColumns — overlapping reorders (known gap)', () => {
  it('lets a stale response win when two reorders resolve out of order', async () => {
    const { result } = await renderLoaded();

    const first = deferredResponse();
    const second = deferredResponse();
    global.fetch = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    let p1;
    let p2;
    // Two reorders issued back to back, the second from the state the first
    // optimistically produced — exactly what two quick drags do.
    act(() => { p1 = result.current.reorderColumns(ORDER_B); });
    act(() => { p2 = result.current.reorderColumns(ORDER_C); });

    // Responses come back in the OPPOSITE order to the requests.
    await act(async () => {
      second.resolveWith(serverAnswer(ORDER_C));
      await p2;
      first.resolveWith(serverAnswer(ORDER_B));
      await p1;
    });

    // FINDING: the board settles on the FIRST request's order. The user's last
    // action is silently discarded and the UI now disagrees with the server,
    // with no error and no refetch to correct it. The correct end state is
    // ORDER_C — the last order actually sent.
    expect(result.current.columns.map((c) => c.slug)).toEqual(ORDER_B);
    expect(result.current.columns.map((c) => c.slug)).not.toEqual(ORDER_C);
  });

  it('rolls a failed reorder back over a newer successful one', async () => {
    const { result } = await renderLoaded();

    const first = deferredResponse();
    const second = deferredResponse();
    global.fetch = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    let p1;
    let p2;
    act(() => { p1 = result.current.reorderColumns(ORDER_B); });
    act(() => { p2 = result.current.reorderColumns(ORDER_C); });

    await act(async () => {
      second.resolveWith(serverAnswer(ORDER_C));
      await p2;
      // The first request is the one the server refuses (409: another tab
      // changed the column set while both were in the air).
      first.rejectWith409();
      await p1.catch(() => {});
    });

    // FINDING: the rollback restores the snapshot the FIRST call captured —
    // the pre-drag order — wiping out the second reorder, which the server
    // actually accepted. The board now shows an order the server does not have.
    expect(result.current.columns.map((c) => c.slug))
      .toEqual(COLUMNS.map((c) => c.slug));
    expect(result.current.columns.map((c) => c.slug)).not.toEqual(ORDER_C);
  });
});
