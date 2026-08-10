// frontend/src/components/TerminalContext.test.jsx
// Regression test for D-13 / gap 1 (auto-spawn-on-select).
//
// Guards against: selecting a different agent after page load — even one with
// a server-confirmed-live PTY — silently auto-mounting it. Only the
// page-load-restored session (activeSessionKey read from localStorage at
// provider mount) may auto-remount. See .planning/debug/auto-spawn-on-select.md
// and 03-05-SUMMARY.md (D-13).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { TerminalProvider, useTerminal } from './TerminalContext.jsx';

describe('TerminalContext — D-13 auto-remount scope', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-remounts only the page-load-restored session; a later selection never auto-mounts, even for a server-confirmed-live PTY', async () => {
    // Simulate a page reload with projA::claude previously selected.
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');

    // Both projA::claude and projB::claude are reported alive on the server —
    // proving the assertion below isn't "the server doesn't know about projB"
    // but that selection alone is insufficient even when the PTY is alive.
    const activeOnServer = {
      'projA::claude': { status: 'idle', connected: false },
      'projB::claude': { status: 'idle', connected: false },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(activeOnServer),
      })
    );

    const { result, unmount } = renderHook(() => useTerminal(), {
      wrapper: TerminalProvider,
    });

    // Page-load recovery still works: the restored session auto-remounts.
    await waitFor(() => {
      expect(result.current.sessions.some((s) => s.sessionKey === 'projA::claude')).toBe(true);
    });

    // Select a different agent (server-confirmed alive) without an explicit
    // startSession/"Iniciar chat" click.
    act(() => {
      result.current.selectAgent('projB', 'claude');
    });

    expect(result.current.activeSessionKey).toBe('projB::claude');

    // Give any (incorrect) auto-mount effect a chance to fire.
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.sessions.some((s) => s.sessionKey === 'projB::claude')).toBe(false);

    unmount();
  });

  it('falls back to a persisted (PTY-dead) session on reload, instead of stranding the user on StartChatCTA', async () => {
    // Reproduces the mobile bug: phone locked long enough that the background
    // tab got discarded AND the backend's grace-period cleanup already killed
    // the PTY by the time the page reloads. /api/sessions/active no longer
    // has the key, but /api/sessions/persisted (sessions.db) still does — the
    // reload must still auto-remount so the WS connect resumes via --resume,
    // same as manually reopening the chat from "Chats Abertos" already does.
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');

    global.fetch = vi.fn((url) => {
      if (url.includes('/sessions/active')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.includes('/sessions/persisted')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 'projA::claude': { display_name: null } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { result, unmount } = renderHook(() => useTerminal(), {
      wrapper: TerminalProvider,
    });

    await waitFor(() => {
      expect(result.current.sessions.some((s) => s.sessionKey === 'projA::claude')).toBe(true);
    });

    unmount();
  });

  it('leaves the user on StartChatCTA when the session is gone from both active and persisted', async () => {
    // The user explicitly terminated it, or it never existed — no recovery
    // path should fire, matching pre-fix behavior for this case.
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    const { result, unmount } = renderHook(() => useTerminal(), {
      wrapper: TerminalProvider,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.sessions.some((s) => s.sessionKey === 'projA::claude')).toBe(false);

    unmount();
  });

  it('selectProject (the live sidebar-click path) also never auto-mounts a server-confirmed-live session it has no local tab for', async () => {
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');

    const activeOnServer = {
      'projA::claude': { status: 'idle', connected: false },
      'projB::claude': { status: 'idle', connected: false },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(activeOnServer) })
    );

    const { result, unmount } = renderHook(() => useTerminal(), {
      wrapper: TerminalProvider,
    });

    await waitFor(() => {
      expect(result.current.sessions.some((s) => s.sessionKey === 'projA::claude')).toBe(true);
    });

    act(() => {
      result.current.selectProject('projB');
    });

    // No local tab for projB exists yet, so activeSessionKey clears to null —
    // the UI renders the per-agent start buttons, never a silent reattach.
    expect(result.current.activeSessionKey).toBe(null);

    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.sessions.some((s) => s.sessionKey === 'projB::claude')).toBe(false);

    unmount();
  });
});

describe('TerminalContext — Bug 1 regression (auto-remount polling loop)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not loop /api/sessions/active calls after mount — call count stabilizes', async () => {
    // Simulate a page reload with a persisted, server-confirmed-alive session —
    // this is exactly the condition that fires the auto-remount effect.
    localStorage.setItem('escritorio::active_session_key', 'projA::claude');

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ 'projA::claude': { status: 'idle', connected: false } }),
      })
    );
    global.fetch = fetchMock;

    const { result, unmount } = renderHook(() => useTerminal(), {
      wrapper: TerminalProvider,
    });

    await waitFor(() => {
      expect(result.current.sessions.some((s) => s.sessionKey === 'projA::claude')).toBe(true);
    });

    // Let any pending promise chains settle.
    await new Promise((r) => setTimeout(r, 100));
    const countAfterSettle = fetchMock.mock.calls.length;

    // Bug 1 (pre-fix): the auto-remount effect had `[startSession]` as its
    // deps. startSession is recreated whenever activeSessions/persistedSessions
    // change, and this effect's own body updates activeSessions — so it kept
    // re-firing and re-calling fetchActiveSessions in a tight loop with no
    // 7s wait involved. Waiting again here must NOT grow the call count.
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchMock.mock.calls.length).toBe(countAfterSettle);

    unmount();
  });
});

describe('TerminalContext — multi-chat session model', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selectProject keeps showing a project\'s existing tab instead of clearing it', async () => {
    const { result } = renderHook(() => useTerminal(), { wrapper: TerminalProvider });

    act(() => { result.current.startSession('projA::claude', 'projA', 'claude'); });
    expect(result.current.activeSessionKey).toBe('projA::claude');

    // Switch away, then back — must land on the same tab, not null.
    act(() => { result.current.selectProject('projB'); });
    expect(result.current.activeSessionKey).toBe(null);

    act(() => { result.current.selectProject('projA'); });
    expect(result.current.activeSessionKey).toBe('projA::claude');
  });

  it('startNewInstance reuses the bare key first, then suffixes for a second simultaneous chat of the same agent', () => {
    const { result } = renderHook(() => useTerminal(), { wrapper: TerminalProvider });

    let firstKey;
    act(() => { firstKey = result.current.startNewInstance('projA', 'claude'); });
    expect(firstKey).toBe('projA::claude');

    let secondKey;
    act(() => { secondKey = result.current.startNewInstance('projA', 'claude'); });
    expect(secondKey).not.toBe('projA::claude');
    expect(secondKey.startsWith('projA::claude::')).toBe(true);

    expect(result.current.sessions.filter((s) => s.projectId === 'projA' && s.agentId === 'claude')).toHaveLength(2);
  });

  it('terminateSession falls back to a sibling tab of the same project, then to null when none remain', async () => {
    const { result } = renderHook(() => useTerminal(), { wrapper: TerminalProvider });

    act(() => { result.current.startSession('projA::claude', 'projA', 'claude'); });
    act(() => { result.current.startSession('projA::gemini', 'projA', 'gemini'); });
    expect(result.current.activeSessionKey).toBe('projA::gemini');

    await act(async () => { await result.current.terminateSession('projA::gemini'); });
    expect(result.current.activeSessionKey).toBe('projA::claude');

    await act(async () => { await result.current.terminateSession('projA::claude'); });
    expect(result.current.activeSessionKey).toBe(null);
  });
});

describe('TerminalContext — renameSession (D-08)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets display_name optimistically before the API call resolves', async () => {
    // Seed persistedSessions via the poll, same as a real 7s tick() would —
    // renameSession's optimistic update is a no-op for a key persistedSessions
    // doesn't know about yet (see TerminalContext.jsx renameSession guard).
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ 'projA::claude': {} }) })
    );
    const { result } = renderHook(() => useTerminal(), { wrapper: TerminalProvider });
    await waitFor(() => expect(result.current.persistedSessions['projA::claude']).toBeDefined());

    // Make the upcoming PATCH hang so we can assert the optimistic value
    // while it is still unresolved.
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => {
      result.current.renameSession('projA::claude', 'Ecom Principal');
    });

    expect(result.current.persistedSessions['projA::claude']?.display_name).toBe('Ecom Principal');

    resolveFetch({ ok: true, json: () => Promise.resolve({ status: 'renamed' }) });
  });

  it('reverts display_name to the previous value when the API call fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ 'projA::claude': { display_name: 'Nome Antigo' } }),
      })
    );
    const { result } = renderHook(() => useTerminal(), { wrapper: TerminalProvider });
    await waitFor(() =>
      expect(result.current.persistedSessions['projA::claude']?.display_name).toBe('Nome Antigo')
    );

    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    await act(async () => {
      await result.current.renameSession('projA::claude', 'Nome Novo');
    });

    expect(result.current.persistedSessions['projA::claude']?.display_name).toBe('Nome Antigo');
  });
});
