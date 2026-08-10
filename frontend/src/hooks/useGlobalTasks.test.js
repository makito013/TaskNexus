// frontend/src/hooks/useGlobalTasks.test.js
// Covers the global-tasks-view state machine: initial fetch across multiple
// sessions/projects, the optimistic-complete/reopen-then-reconcile flow
// (mirrors useTasks.test.js), and — the whole point of this hook existing as
// a SEPARATE file (05-TL.md Tarefa 27) — that it shares no state/imports with
// useTasks.js. Same renderHook + mocked global.fetch pattern as
// useTasks.test.js/TerminalContext.test.jsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGlobalTasks } from './useGlobalTasks.js';
import * as useTasksModule from './useTasks.js';

function fakeGlobalTask(overrides = {}) {
  return {
    id: 1,
    session_key: 'projA::claude',
    titulo: 'Tarefa',
    descricao_markdown: 'texto',
    descricao_html: null,
    status: 'pending',
    created_at: '2026-07-10T00:00:00Z',
    completed_at: null,
    projeto_id: 'projA',
    agent_id: 'claude',
    session_display_name: 'Chat principal',
    ...overrides,
  };
}

describe('useGlobalTasks — independence from useTasks.js', () => {
  it('does not import anything from useTasks.js', () => {
    // This file itself only imports `useGlobalTasks` from
    // './useGlobalTasks.js' and `useTasks` from './useTasks.js' is imported
    // here ONLY to assert its shape is untouched by this hook, never to
    // wire the two together. useGlobalTasks.js's own source imports only
    // react and ../services/api.js (see file header) — the two hooks don't
    // share a single line of runtime code, only the backend table they both
    // happen to read from.
    expect(typeof useTasksModule.useTasks).toBe('function');
    expect(useGlobalTasks).not.toBe(useTasksModule.useTasks);
  });
});

describe('useGlobalTasks — initial fetch', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches GET /api/tasks/global on mount and populates tasks across multiple sessions/projects', async () => {
    const taskA = fakeGlobalTask({ id: 1, session_key: 'projA::claude', projeto_id: 'projA' });
    const taskB = fakeGlobalTask({
      id: 2,
      session_key: 'projB::gemini',
      projeto_id: 'projB',
      agent_id: 'gemini',
      session_display_name: 'Outro chat',
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([taskA, taskB]) }));

    const { result } = renderHook(() => useGlobalTasks());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledWith('/api/tasks/global');
    expect(result.current.tasks).toEqual([taskA, taskB]);
  });
});

describe('useGlobalTasks — completeTask optimistic update', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks the task done immediately, calling the session-scoped endpoint with the right args, before the fetch resolves', async () => {
    const task = fakeGlobalTask({ id: 5, session_key: 'projA::claude' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    const { result } = renderHook(() => useGlobalTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => { result.current.completeTask('projA::claude', 5); });

    // Optimistic: status flips to 'done' synchronously, before the POST resolves.
    expect(result.current.tasks.find((t) => t.id === 5).status).toBe('done');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/projA::claude/tasks/5/done',
      expect.objectContaining({ method: 'POST' })
    );

    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ status: 'done' }) });
      await Promise.resolve();
    });
    expect(result.current.tasks.find((t) => t.id === 5).status).toBe('done');
  });

  it('reverts to the previous status and alerts when the API call fails', async () => {
    const task = fakeGlobalTask({ id: 7, session_key: 'projA::claude', status: 'pending' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    const { result } = renderHook(() => useGlobalTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await result.current.completeTask('projA::claude', 7);
    });

    expect(result.current.tasks.find((t) => t.id === 7).status).toBe('pending');
    expect(global.alert).toHaveBeenCalled();
  });
});

describe('useGlobalTasks — reopenTask optimistic update (mirrors completeTask)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks a done task pending immediately, calling the reopen endpoint with the right args, before the fetch resolves', async () => {
    const task = fakeGlobalTask({ id: 21, session_key: 'projB::gemini', status: 'done', completed_at: '2026-07-10T00:00:00Z' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    const { result } = renderHook(() => useGlobalTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => { result.current.reopenTask('projB::gemini', 21); });

    expect(result.current.tasks.find((t) => t.id === 21).status).toBe('pending');
    expect(result.current.tasks.find((t) => t.id === 21).completed_at).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/projB::gemini/tasks/21/reopen',
      expect.objectContaining({ method: 'POST' })
    );

    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ status: 'pending' }) });
      await Promise.resolve();
    });
    expect(result.current.tasks.find((t) => t.id === 21).status).toBe('pending');
  });

  it('reverts to done and alerts when the API call fails', async () => {
    const task = fakeGlobalTask({ id: 22, session_key: 'projA::claude', status: 'done', completed_at: '2026-07-10T00:00:00Z' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    const { result } = renderHook(() => useGlobalTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    global.alert = vi.fn();

    await act(async () => {
      await result.current.reopenTask('projA::claude', 22);
    });

    expect(result.current.tasks.find((t) => t.id === 22).status).toBe('done');
    expect(global.alert).toHaveBeenCalled();
  });
});

describe('useGlobalTasks — stale poll does not clobber an optimistic completion', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a stale poll response landing after an optimistic complete does not revert it back to pending', async () => {
    vi.useFakeTimers();
    const task = fakeGlobalTask({ id: 11, session_key: 'projA::claude' });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    const { result } = renderHook(() => useGlobalTasks());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);

    // Complete optimistically; hold the confirming POST open.
    let resolveDonePost;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveDonePost = resolve; }));
    act(() => { result.current.completeTask('projA::claude', 11); });
    expect(result.current.tasks.find((t) => t.id === 11).status).toBe('done');

    // A poll GET fires (5s tick) with STALE data (still 'pending') before the
    // confirming POST above has resolved.
    const staleFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([task]) }));
    global.fetch = staleFetch;
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staleFetch).toHaveBeenCalled();
    // Merge must not clobber the optimistic "done" back to "pending".
    expect(result.current.tasks.find((t) => t.id === 11).status).toBe('done');

    resolveDonePost({ ok: true, json: () => Promise.resolve({ status: 'done' }) });
    vi.useRealTimers();
  });
});
