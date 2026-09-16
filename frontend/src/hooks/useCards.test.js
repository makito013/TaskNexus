// frontend/src/hooks/useCards.test.js
// Covers the Board hook's core contract (05-TL.md Tarefa 18): initial
// fetch, no-refetch-needed mutations (create/createSubcard), the
// alert()-on-failure/no-ghost-state guarantee for mutations, and the
// deterministic local-removal strategy for clearFinished. Same
// renderHook + mocked global.fetch pattern as useTasks.test.js.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCards } from './useCards.js';

function fakeCard(overrides = {}) {
  return {
    id: 1,
    titulo: 'Card',
    projeto_id: 'projA',
    parent_id: null,
    status: 'a_fazer',
    origem: 'bruno',
    ultima_atualizacao_por: 'bruno',
    descricao: null,
    session_key: null,
    criado_em: 1000,
    atualizado_em: 1000,
    imagens: [],
    subcards: [],
    subcards_resumo: null,
    ...overrides,
  };
}

describe('useCards — initial fetch', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('populates state with the cards returned by GET /api/cards', async () => {
    const cards = [fakeCard({ id: 1 }), fakeCard({ id: 2, titulo: 'Outro' })];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(cards) }));

    const { result } = renderHook(() => useCards());

    await waitFor(() => expect(result.current.cards).toEqual(cards));
    expect(global.fetch).toHaveBeenCalledWith('/api/cards');
  });

  it('requests repeated projeto_id query params when selectedProjectIds is passed', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

    renderHook(() => useCards(['projA', 'projB']));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toBe('/api/cards?projeto_id=projA&projeto_id=projB');
  });
});

describe('useCards — createCard', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('adds the created card to state without waiting for a new fetch', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([]));

    const created = fakeCard({ id: 42, titulo: 'Novo card' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) }));

    await act(async () => {
      await result.current.createCard({ titulo: 'Novo card', projeto_id: 'projA' });
    });

    expect(result.current.cards).toEqual([created]);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cards',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('forwards cliente_id (card cliente-only, sem projeto_id) no corpo da requisição', async () => {
    // Regressão da feature Cliente/Projeto: api.createCard field-picks os
    // campos do payload — cliente_id precisa estar nessa lista, senão o
    // card cliente-only chega no backend sem nem projeto_id nem cliente_id
    // e vira 400 (ver backend/app/card_store.py CardStore.create ramo 4).
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([]));

    const created = fakeCard({ id: 43, titulo: 'Card do cliente', projeto_id: 'cliente_projeto_1' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) }));

    await act(async () => {
      await result.current.createCard({ titulo: 'Card do cliente', cliente_id: 'cliente_projeto_1' });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cards',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          titulo: 'Card do cliente',
          projeto_id: undefined,
          cliente_id: 'cliente_projeto_1',
          status: undefined,
          descricao: undefined,
        }),
      })
    );
  });

  it('does not append the created card optimistically when its projeto_id is outside the active filter', async () => {
    // Regression test for the BoardV2 "sidebar client A + chat targets
    // client B" scenario: creating a card outside the currently active
    // filter must not flash it on screen and then have it vanish on the
    // next poll — it should simply never appear locally (the poll for
    // whoever is actually looking at project B will show it correctly).
    global.fetch = vi.fn((url, options) => {
      if (options && options.method === 'POST') {
        const created = fakeCard({ id: 42, titulo: 'Card em B', projeto_id: 'projB' });
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) });
      }
      // GET (initial fetch / poll) — filtered list for the active project A,
      // which never includes the card just created in B.
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const { result } = renderHook(() => useCards(['projA']));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    let created;
    await act(async () => {
      created = await result.current.createCard({ titulo: 'Card em B', projeto_id: 'projB' });
    });

    // Contract preserved: createCard still resolves with the created card
    // (BoardV2.handleCreate relies on this to close the "add card" form).
    expect(created).toEqual(expect.objectContaining({ id: 42, projeto_id: 'projB' }));
    // But it never entered local state — no flash-then-vanish.
    expect(result.current.cards).toEqual([]);
  });

  it('still appends the created card optimistically when its projeto_id is inside the active filter', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useCards(['projA', 'projB']));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    const created = fakeCard({ id: 42, titulo: 'Card em A', projeto_id: 'projA' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) }));

    await act(async () => {
      await result.current.createCard({ titulo: 'Card em A', projeto_id: 'projA' });
    });

    expect(result.current.cards).toEqual([created]);
  });

  it('appends the created card optimistically regardless of projeto_id when no filter is active (selectedProjectIds=[])', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useCards([]));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    const created = fakeCard({ id: 42, titulo: 'Card em qualquer projeto', projeto_id: 'projZ' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) }));

    await act(async () => {
      await result.current.createCard({ titulo: 'Card em qualquer projeto', projeto_id: 'projZ' });
    });

    expect(result.current.cards).toEqual([created]);
  });

  it('alerts and does not add a ghost card when the network call fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([]));

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await expect(
        result.current.createCard({ titulo: 'Vai falhar', projeto_id: 'projA' })
      ).rejects.toThrow();
    });

    expect(result.current.cards).toEqual([]);
    expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Falha ao criar card'));
  });
});

describe('useCards — createSubcard', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('inserts the subcard under the correct parent card in local state', async () => {
    const parent = fakeCard({ id: 1, titulo: 'Pai' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([parent]) }));
    // `doneSlug` (2nd argument, from useColumns) is what "feitos" is counted
    // against — the hook no longer hard-codes 'feito'.
    const { result } = renderHook(() => useCards(undefined, 'feito'));
    await waitFor(() => expect(result.current.cards).toEqual([parent]));

    const subcard = fakeCard({ id: 99, titulo: 'Sub', parent_id: 1 });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(subcard) }));

    await act(async () => {
      await result.current.createSubcard(1, { titulo: 'Sub' });
    });

    expect(result.current.cards[0].subcards).toEqual([subcard]);
    expect(result.current.cards[0].subcards_resumo).toEqual({ total: 1, feitos: 0 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cards/1/subcards',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('useCards — updateCard', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('applies the PATCH response without wiping locally-loaded imagens/subcards', async () => {
    const parent = fakeCard({
      id: 1,
      titulo: 'Pai',
      imagens: [{ id: 5, card_id: 1, filename: 'a.png', url: '/x', mime_type: 'image/png', size_bytes: 10, criado_em: 1 }],
      subcards: [fakeCard({ id: 2, titulo: 'Sub', parent_id: 1 })],
      subcards_resumo: { total: 1, feitos: 0 },
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([parent]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([parent]));

    // PATCH response mirrors the real backend contract: imagens/subcards
    // always come back empty/null (CardStore.update() uses get(), which
    // doesn't hydrate them) — see note at top of useCards.js.
    const patchResponse = fakeCard({ id: 1, titulo: 'Pai renomeado', imagens: [], subcards: [], subcards_resumo: null });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(patchResponse) }));

    await act(async () => {
      await result.current.updateCard(1, { titulo: 'Pai renomeado' });
    });

    expect(result.current.cards[0].titulo).toBe('Pai renomeado');
    expect(result.current.cards[0].imagens).toHaveLength(1);
    expect(result.current.cards[0].subcards).toHaveLength(1);
  });

  it('merges tipo and prazo from the PATCH response into local state (whitelist U6)', async () => {
    // Without tipo/prazo in the selective merge, the board keeps showing the
    // stale value until the 5s poll — the field is saved to the DB but the
    // chip on the card face and the modal rail lag behind. Nothing else in
    // the suite catches a dropped key here, so this is the regression guard.
    const card = fakeCard({ id: 1, tipo: null, prazo: null });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([card]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([card]));

    const patchResponse = fakeCard({ id: 1, tipo: 'hotfix', prazo: '2026-09-15' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(patchResponse) }));

    await act(async () => {
      await result.current.updateCard(1, { tipo: 'hotfix', prazo: '2026-09-15' });
    });

    expect(result.current.cards[0].tipo).toBe('hotfix');
    expect(result.current.cards[0].prazo).toBe('2026-09-15');
  });

  it('applies an empty-string clear sentinel for tipo/prazo coming back from PATCH', async () => {
    const card = fakeCard({ id: 1, tipo: 'bug', prazo: '2026-09-15' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([card]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toEqual([card]));

    // Backend turns "" into NULL, so the PATCH response echoes null back.
    const patchResponse = fakeCard({ id: 1, tipo: null, prazo: null });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(patchResponse) }));

    await act(async () => {
      await result.current.updateCard(1, { tipo: '', prazo: '' });
    });

    expect(result.current.cards[0].tipo).toBeNull();
    expect(result.current.cards[0].prazo).toBeNull();
  });
});

describe('useCards — clearFinished', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('removes finished cards for the affected project from local state', async () => {
    const finishedA = fakeCard({ id: 1, projeto_id: 'projA', status: 'feito' });
    const pendingA = fakeCard({ id: 2, projeto_id: 'projA', status: 'a_fazer' });
    const finishedB = fakeCard({ id: 3, projeto_id: 'projB', status: 'feito' });
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve([finishedA, pendingA, finishedB]),
    }));
    const { result } = renderHook(() => useCards(undefined, 'feito'));
    await waitFor(() => expect(result.current.cards).toHaveLength(3));

    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ cards: 1, imagens: 0, imagens_com_falha: 0 }),
    }));

    await act(async () => {
      await result.current.clearFinished('projA');
    });

    expect(result.current.cards).toEqual([pendingA, finishedB]);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/cards/limpar-concluidos?projeto_id=projA',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('alerts and leaves state untouched when the clear call fails', async () => {
    const finishedA = fakeCard({ id: 1, projeto_id: 'projA', status: 'feito' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([finishedA]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await expect(result.current.clearFinished('projA')).rejects.toThrow();
    });

    expect(result.current.cards).toEqual([finishedA]);
    expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Falha ao limpar concluídos'));
  });
});


// The board's "done" column is user-managed (task #43): every local
// recomputation that used to compare against the literal 'feito' now compares
// against the `doneSlug` the caller threads in from useColumns.
describe('useCards — doneSlug threading', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('counts the subcard summary against the done COLUMN, not the literal "feito"', async () => {
    const parent = fakeCard({
      id: 1,
      subcards: [
        fakeCard({ id: 2, parent_id: 1, status: 'em_revisao' }),
        fakeCard({ id: 3, parent_id: 1, status: 'feito' }),
      ],
      subcards_resumo: { total: 2, feitos: 1 },
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([parent]) }));
    const { result } = renderHook(() => useCards(undefined, 'em_revisao'));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    // Touching a subcard triggers the recount. With 'em_revisao' as the done
    // column, the 'feito' subcard is the one that stops counting.
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(fakeCard({ id: 2, parent_id: 1, status: 'em_revisao', titulo: 'Sub editado' })),
    }));
    await act(async () => {
      await result.current.updateCard(2, { titulo: 'Sub editado' });
    });

    expect(result.current.cards[0].subcards_resumo).toEqual({ total: 2, feitos: 1 });
    expect(result.current.cards[0].subcards.map((s) => s.status)).toEqual(['em_revisao', 'feito']);
  });

  it('leaves the server-sent summary alone while doneSlug is still null', async () => {
    const parent = fakeCard({
      id: 1,
      subcards: [fakeCard({ id: 2, parent_id: 1, status: 'feito' })],
      subcards_resumo: { total: 1, feitos: 1 },
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([parent]) }));
    // No doneSlug: the columns have not loaded yet.
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(fakeCard({ id: 2, parent_id: 1, status: 'feito', titulo: 'Sub editado' })),
    }));
    await act(async () => {
      await result.current.updateCard(2, { titulo: 'Sub editado' });
    });

    // Recomputing here would have flashed a wrong "0 de 1" over a correct
    // server-side count, because nothing is known to be done yet.
    expect(result.current.cards[0].subcards_resumo).toEqual({ total: 1, feitos: 1 });
  });

  it('clears the cards of the done COLUMN, following it when the mark moves', async () => {
    const revisao = fakeCard({ id: 1, projeto_id: 'projA', status: 'em_revisao' });
    const feito = fakeCard({ id: 2, projeto_id: 'projA', status: 'feito' });
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve([revisao, feito]),
    }));
    const { result } = renderHook(() => useCards(undefined, 'em_revisao'));
    await waitFor(() => expect(result.current.cards).toHaveLength(2));

    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ cards: 1, imagens: 0, imagens_com_falha: 0 }),
    }));
    await act(async () => {
      await result.current.clearFinished('projA');
    });

    expect(result.current.cards).toEqual([feito]);
  });

  it('removes nothing locally when clearing while doneSlug is still null', async () => {
    const feito = fakeCard({ id: 1, projeto_id: 'projA', status: 'feito' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([feito]) }));
    const { result } = renderHook(() => useCards());
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ cards: 1, imagens: 0, imagens_com_falha: 0 }),
    }));
    await act(async () => {
      await result.current.clearFinished('projA');
    });

    // Guessing would risk hiding cards the backend kept; the 5s poll settles it.
    expect(result.current.cards).toEqual([feito]);
  });
});
