// The optional third argument of useCards (V3 board): quiet mutation errors, a
// poll that sleeps with the tab, and per-filter read state. With no options the
// hook is exactly the V2 one (useCards.test.js stays untouched).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { api } from '../services/api.js';
import { useCards } from './useCards.js';

const card = (overrides = {}) => ({
  id: 1, titulo: 'Card', projeto_id: 'projA', parent_id: null, status: 'a_fazer',
  imagens: [], subcards: [], subcards_resumo: null, ...overrides,
});

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete document.visibilityState;
});

describe('useCards options: onMutationError', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card()]);
  });

  it('defaults to the global alert(), resolved when the failure happens', async () => {
    vi.spyOn(api, 'createCard').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCards([]));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    await act(async () => { await expect(result.current.createCard({})).rejects.toThrow('boom'); });
    expect(alertSpy).toHaveBeenCalledWith('Falha ao criar card. Tente novamente.');
    vi.unstubAllGlobals();
  });

  it('calls the given handler with the message and the error, and never alert()', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const failure = new Error('boom');
    vi.spyOn(api, 'deleteCard').mockRejectedValue(failure);
    const onMutationError = vi.fn();
    const { result } = renderHook(() => useCards([], null, { onMutationError }));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    await act(async () => { await expect(result.current.deleteCard(1)).rejects.toBe(failure); });
    expect(onMutationError).toHaveBeenCalledWith('Falha ao excluir card. Tente novamente.', failure);
    expect(alertSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('uses the handler of the latest render without recreating the mutations', async () => {
    vi.spyOn(api, 'updateCard').mockRejectedValue(new Error('nope'));
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ handler }) => useCards([], null, { onMutationError: handler }), {
      initialProps: { handler: first },
    });
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    const updateBefore = result.current.updateCard;
    rerender({ handler: second });
    expect(result.current.updateCard).toBe(updateBefore);
    await act(async () => { await expect(result.current.updateCard(1, {})).rejects.toThrow(); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('Falha ao atualizar card. Tente novamente.', expect.any(Error));
  });

  it('keeps the attachment message of the backend', async () => {
    vi.spyOn(api, 'uploadCardAttachment').mockRejectedValue(new Error('Arquivo grande demais'));
    const onMutationError = vi.fn();
    const { result } = renderHook(() => useCards([], null, { onMutationError }));
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    await act(async () => { await expect(result.current.uploadCardAttachment(1, new Blob(['x']))).rejects.toThrow(); });
    expect(onMutationError).toHaveBeenCalledWith('Arquivo grande demais. Tente novamente.', expect.any(Error));
  });
});

describe('useCards options: all off', () => {
  it('returns no read-state fields and renders only for the data', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card()]);
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useCards([]); });
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    expect('loaded' in result.current).toBe(false);
    expect('readError' in result.current).toBe(false);
    expect(renders).toBe(2);
  });

  it('adds no visibility listener', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue([]);
    const add = vi.spyOn(document, 'addEventListener');
    const { result } = renderHook(() => useCards([]));
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalled());
    expect(result.current.cards).toEqual([]);
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
  });

  it('keeps polling while the tab is hidden', async () => {
    vi.useFakeTimers();
    setVisibility('hidden');
    vi.spyOn(api, 'fetchCards').mockResolvedValue([]);
    renderHook(() => useCards([]));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.fetchCards.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('useCards options: pauseWhenHidden', () => {
  it('skips the ticks while hidden and reads once when the tab is visible again', async () => {
    vi.useFakeTimers();
    setVisibility('hidden');
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card()]);
    renderHook(() => useCards([], null, { pauseWhenHidden: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(api.fetchCards).not.toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.fetchCards).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.fetchCards).toHaveBeenCalledTimes(2);
  });

  it('a visible tab polls as usual and the listener is removed on unmount', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    vi.spyOn(api, 'fetchCards').mockResolvedValue([]);
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useCards([], null, { pauseWhenHidden: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.fetchCards).toHaveBeenCalledTimes(2);
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);
  });
});

describe('useCards options: trackReadState', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('is not loaded until the first answer, then loaded without error', async () => {
    vi.spyOn(api, 'fetchCards').mockResolvedValue([card()]);
    const { result } = renderHook(() => useCards([], null, { trackReadState: true }));
    expect(result.current.loaded).toBe(false);
    expect(result.current.readError).toBeNull();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.readError).toBeNull();
  });

  it('a failing first read is an error and still not loaded', async () => {
    vi.spyOn(api, 'fetchCards').mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useCards([], null, { trackReadState: true }));
    await waitFor(() => expect(result.current.readError).toBeInstanceOf(Error));
    expect(result.current.loaded).toBe(false);
  });

  it('a failing later poll keeps the data and the loaded flag and clears when it works again', async () => {
    vi.useFakeTimers();
    const fetchCards = vi.spyOn(api, 'fetchCards');
    fetchCards.mockResolvedValueOnce([card()]);
    const { result } = renderHook(() => useCards([], null, { trackReadState: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loaded).toBe(true);

    fetchCards.mockRejectedValueOnce(new Error('500'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.readError).toBeInstanceOf(Error);
    expect(result.current.loaded).toBe(true);
    expect(result.current.cards).toHaveLength(1);

    fetchCards.mockResolvedValueOnce([card(), card({ id: 2 })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.readError).toBeNull();
    expect(result.current.cards).toHaveLength(2);
  });

  it('read state belongs to the filter: a new filter starts not loaded', async () => {
    vi.spyOn(api, 'fetchCards').mockImplementation(async (ids) => [card({ projeto_id: ids[0] ?? 'all' })]);
    const { result, rerender } = renderHook(({ ids }) => useCards(ids, null, { trackReadState: true }), {
      initialProps: { ids: ['projA'] },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ ids: ['projB'] });
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.cards[0].projeto_id).toBe('projB');
  });

  it('ignores the answer of a previous filter that arrives late', async () => {
    const resolvers = {};
    vi.spyOn(api, 'fetchCards').mockImplementation((ids) => new Promise((resolve) => { resolvers[ids[0]] = resolve; }));
    const { result, rerender } = renderHook(({ ids }) => useCards(ids, null, { trackReadState: true }), {
      initialProps: { ids: ['projA'] },
    });
    rerender({ ids: ['projB'] });
    await act(async () => { resolvers.projB([card({ id: 2, projeto_id: 'projB' })]); });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { resolvers.projA([card({ id: 1, projeto_id: 'projA' })]); });
    expect(result.current.cards.map((entry) => entry.projeto_id)).toEqual(['projB']);
  });

  it('without the option the same late answer of a previous filter is applied (V2 behaviour kept)', async () => {
    const resolvers = {};
    vi.spyOn(api, 'fetchCards').mockImplementation((ids) => new Promise((resolve) => { resolvers[ids[0]] = resolve; }));
    const { result, rerender } = renderHook(({ ids }) => useCards(ids), { initialProps: { ids: ['projA'] } });
    rerender({ ids: ['projB'] });
    await act(async () => { resolvers.projB([card({ id: 2, projeto_id: 'projB' })]); });
    await act(async () => { resolvers.projA([card({ id: 1, projeto_id: 'projA' })]); });
    expect(result.current.cards.map((entry) => entry.projeto_id)).toEqual(['projA']);
  });
});

describe('useCards options: late failure of a previous filter', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('does not become the read error of the current filter', async () => {
    const calls = {};
    vi.spyOn(api, 'fetchCards').mockImplementation((ids) => new Promise((resolve, reject) => { calls[ids[0]] = { resolve, reject }; }));
    const { result, rerender } = renderHook(({ ids }) => useCards(ids, null, { trackReadState: true }), {
      initialProps: { ids: ['projA'] },
    });
    rerender({ ids: ['projB'] });
    await act(async () => { calls.projB.resolve([card({ id: 2, projeto_id: 'projB' })]); });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { calls.projA.reject(new Error('late')); });
    expect(result.current.readError).toBeNull();
    expect(result.current.loaded).toBe(true);
  });

  it('a failure of the current filter after a switch is its error', async () => {
    vi.spyOn(api, 'fetchCards').mockImplementation(async (ids) => {
      if (ids[0] === 'projB') throw new Error('down');
      return [card()];
    });
    const { result, rerender } = renderHook(({ ids }) => useCards(ids, null, { trackReadState: true }), {
      initialProps: { ids: ['projA'] },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ ids: ['projB'] });
    await waitFor(() => expect(result.current.readError).toBeInstanceOf(Error));
    expect(result.current.loaded).toBe(false);
  });
});
