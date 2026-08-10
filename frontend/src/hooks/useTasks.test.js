// frontend/src/hooks/useTasks.test.js
// Covers the task-drawer state machine: create/complete round-trips against
// the real endpoint contract, the optimistic-complete-then-reconcile flow
// (Designer decision 8), and drawer-gated polling (decision 10) — same
// renderHook + mocked global.fetch pattern as TerminalContext.test.jsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTasks } from './useTasks.js';

function fakeTask(overrides = {}) {
  return {
    id: 1,
    session_key: 'projA::claude',
    titulo: 'Tarefa',
    descricao_markdown: 'texto',
    descricao_html: null,
    status: 'pending',
    created_at: '2026-07-10T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

describe('useTasks — createTask', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the tasks endpoint and appends the created task to tasksBySession', async () => {
    const created = fakeTask({ id: 42, titulo: 'Nova tarefa' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(created) }));

    const { result } = renderHook(() => useTasks('projA::claude'));

    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: 'Nova tarefa', descricao_markdown: 'texto' });
    });

    expect(result.current.tasksBySession['projA::claude']).toEqual([created]);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/projA::claude/tasks',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.current.pendingCounts['projA::claude']).toBe(1);
  });
});

describe('useTasks — completeTask optimistic update', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks the task done immediately, before the fetch resolves', async () => {
    const task = fakeTask({ id: 5 });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => { result.current.completeTask('projA::claude', 5); });

    // Optimistic: status flips to 'done' synchronously, before the POST resolves.
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');
    expect(result.current.pendingCounts['projA::claude']).toBe(0);

    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ status: 'done' }) });
      await Promise.resolve();
    });
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');
  });

  it('reverts to the previous status when the API call fails', async () => {
    const task = fakeTask({ id: 7 });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await result.current.completeTask('projA::claude', 7);
    });

    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('pending');
    expect(global.alert).toHaveBeenCalled();
  });

  it('a stale poll response landing after an optimistic complete does not revert it back to pending', async () => {
    const task = fakeTask({ id: 11 });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    // Complete optimistically; hold the confirming POST open.
    let resolveDonePost;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveDonePost = resolve; }));
    act(() => { result.current.completeTask('projA::claude', 11); });
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');

    // A poll GET lands in the meantime with STALE data (still 'pending' —
    // simulates the response having been in flight before the tap resolved
    // server-side).
    const staleFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    global.fetch = staleFetch;
    act(() => { result.current.openDrawer(); });
    await waitFor(() => expect(staleFetch).toHaveBeenCalled());

    // Merge must not clobber the optimistic "done" back to "pending".
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');

    act(() => { result.current.closeDrawer(); });
    resolveDonePost({ ok: true, json: () => Promise.resolve({ status: 'done' }) });
  });
});

describe('useTasks — uncompleteTask optimistic update', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks a done task pending immediately, before the fetch resolves, clearing completed_at', async () => {
    const task = fakeTask({ id: 21, status: 'done', completed_at: '2026-07-10T00:00:00Z' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => { result.current.uncompleteTask('projA::claude', 21); });

    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('pending');
    expect(result.current.tasksBySession['projA::claude'][0].completed_at).toBeNull();
    expect(result.current.pendingCounts['projA::claude']).toBe(1);

    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ status: 'pending' }) });
      await Promise.resolve();
    });
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('pending');
  });

  it('reverts to done when the API call fails', async () => {
    const task = fakeTask({ id: 22, status: 'done', completed_at: '2026-07-10T00:00:00Z' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await result.current.uncompleteTask('projA::claude', 22);
    });

    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');
    expect(global.alert).toHaveBeenCalled();
  });
});

describe('useTasks — uncompleteTask clears the optimisticDoneIds marker', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a stale "done" poll response landing after a confirmed uncomplete does not flip the task back to done', async () => {
    const task = fakeTask({ id: 31 });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(task) }));
    const { result } = renderHook(() => useTasks('projA::claude'));
    await act(async () => {
      await result.current.createTask('projA::claude', { titulo: task.titulo, descricao_markdown: task.descricao_markdown });
    });

    // 1. Complete it and let the confirming POST resolve — this is what
    // populates optimisticDoneIds (completeTask only removes the entry on
    // FAILURE, so it stays set after a successful completion).
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'done' }) }));
    await act(async () => {
      await result.current.completeTask('projA::claude', 31);
    });
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('done');

    // 2. Uncomplete it and let the confirming POST resolve — this is where
    // the optimisticDoneIds entry must be deleted (the behavior under test).
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'pending' }) }));
    await act(async () => {
      await result.current.uncompleteTask('projA::claude', 31);
    });
    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('pending');

    // 3. A poll GET lands with a fresh, correctly-pending row. If the
    // optimisticDoneIds entry from step 1 were still set, mergeTasks' guard
    // (`has(key) && status !== 'done'`) would wrongly flip this back to
    // 'done'. It must NOT — the task stays pending.
    const pollFetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ ...task, status: 'pending', completed_at: null }]),
    }));
    global.fetch = pollFetch;
    act(() => { result.current.openDrawer(); });
    await waitFor(() => expect(pollFetch).toHaveBeenCalled());

    expect(result.current.tasksBySession['projA::claude'][0].status).toBe('pending');
  });
});

describe('useTasks — polling gated by drawer open state', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('starts a poll interval on openDrawer and clears it on closeDrawer', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { result } = renderHook(() => useTasks('projA::claude'));

    expect(setIntervalSpy).not.toHaveBeenCalled();

    act(() => { result.current.openDrawer(); });
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalled());

    act(() => { result.current.closeDrawer(); });
    await waitFor(() => expect(clearIntervalSpy).toHaveBeenCalled());
  });

  it('never calls setInterval while the drawer stays closed', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    renderHook(() => useTasks('projA::claude'));
    await new Promise((r) => setTimeout(r, 30));

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('auto-closes the drawer if the active session disappears (e.g. last tab closed)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

    const { result, rerender } = renderHook(
      ({ key }) => useTasks(key),
      { initialProps: { key: 'projA::claude' } }
    );

    act(() => { result.current.openDrawer(); });
    expect(result.current.drawerOpen).toBe(true);

    rerender({ key: null });

    await waitFor(() => expect(result.current.drawerOpen).toBe(false));
  });
});
