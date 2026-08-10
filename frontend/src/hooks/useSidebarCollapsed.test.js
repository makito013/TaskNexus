// frontend/src/hooks/useSidebarCollapsed.test.js
// Covers useSidebarCollapsed(): the localStorage-backed collapse preference
// shared by v1 and v2 layouts (Milestone 2, 05-TL.md Tarefa 12), plus the
// RF02 Tarefa 3 (plano Layout v2, 06-TL.md) addition — toggle() dispatching
// a global `escritorio:sidebar-toggled` CustomEvent so TerminalPanel can
// re-fit after the sidebar's CSS width transition settles (see
// TerminalPanel.test.jsx's "sidebar-toggled re-fit (RF02)" suite for the
// listener side of this contract).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSidebarCollapsed } from './useSidebarCollapsed.js';

const SIDEBAR_COLLAPSE_KEY = 'escritorio::sidebar_collapsed';

// jsdom não implementa window.matchMedia — o hook lê isso de forma síncrona
// no primeiro render quando não há preferência salva (mesmo shim usado em
// App.test.jsx / AppV2.test.jsx).
function stubMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('useSidebarCollapsed — initial state', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    localStorage.removeItem(SIDEBAR_COLLAPSE_KEY);
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(SIDEBAR_COLLAPSE_KEY);
  });

  it('defaults to expanded (false) on a wide viewport with no stored preference', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useSidebarCollapsed());
    const [collapsed] = result.current;
    expect(collapsed).toBe(false);
  });

  it('defaults to collapsed (true) on a narrow viewport with no stored preference', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useSidebarCollapsed());
    const [collapsed] = result.current;
    expect(collapsed).toBe(true);
  });

  it('reads a previously stored preference instead of the viewport default', () => {
    stubMatchMedia(false); // wide viewport (would default to expanded)
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, 'true');
    const { result } = renderHook(() => useSidebarCollapsed());
    const [collapsed] = result.current;
    expect(collapsed).toBe(true); // stored preference wins over the viewport default
  });
});

describe('useSidebarCollapsed — toggle', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    stubMatchMedia(false);
    localStorage.removeItem(SIDEBAR_COLLAPSE_KEY);
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(SIDEBAR_COLLAPSE_KEY);
  });

  it('flips the collapsed state', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);

    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(true);

    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(false);
  });

  it('persists the new value to localStorage under the shared key', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => { result.current[1](); });
    expect(localStorage.getItem(SIDEBAR_COLLAPSE_KEY)).toBe('true');
  });

  // RF02 Tarefa 2 (plano Layout v2, 06-TL.md)
  it('dispatches a global escritorio:sidebar-toggled event on every toggle', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    const handler = vi.fn();
    window.addEventListener('escritorio:sidebar-toggled', handler);

    try {
      act(() => { result.current[1](); });
      expect(handler).toHaveBeenCalledTimes(1);

      act(() => { result.current[1](); });
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('escritorio:sidebar-toggled', handler);
    }
  });
});

// Etapa 7 (plano de fix, RF02 Tarefa 2): `storageKey` virou parâmetro — este
// bloco cobre o motivo da mudança em si: duas instâncias do hook, cada uma
// com sua própria chave (SidebarV2 vs ChatSidebarV2 na prática), precisam
// manter estado e persistência totalmente independentes, sem pisar uma na
// outra no localStorage.
describe('useSidebarCollapsed — múltiplas instâncias com storageKeys diferentes (RF02)', () => {
  const KEY_A = 'escritorio::test_sidebar_a';
  const KEY_B = 'escritorio::test_sidebar_b';
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    stubMatchMedia(false);
    localStorage.removeItem(KEY_A);
    localStorage.removeItem(KEY_B);
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(KEY_A);
    localStorage.removeItem(KEY_B);
  });

  it('toggling one instance does not flip or persist state under the other instance\'s key', () => {
    const a = renderHook(() => useSidebarCollapsed(KEY_A));
    const b = renderHook(() => useSidebarCollapsed(KEY_B));

    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);

    act(() => { a.result.current[1](); });

    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(false); // instância B intocada
    expect(localStorage.getItem(KEY_A)).toBe('true');
    // KEY_B foi escrita 'false' pelo próprio effect de montagem de B (o hook
    // persiste o valor inicial), mas o toggle de A não a alterou.
    expect(localStorage.getItem(KEY_B)).toBe('false');

    act(() => { b.result.current[1](); });

    expect(a.result.current[0]).toBe(true); // instância A intocada pelo toggle de B
    expect(b.result.current[0]).toBe(true);
    expect(localStorage.getItem(KEY_A)).toBe('true');
    expect(localStorage.getItem(KEY_B)).toBe('true');
  });

  it('a stored preference under one key does not leak as the initial value for a different key', () => {
    localStorage.setItem(KEY_A, 'true');
    const a = renderHook(() => useSidebarCollapsed(KEY_A));
    const b = renderHook(() => useSidebarCollapsed(KEY_B));

    expect(a.result.current[0]).toBe(true); // lida do storage
    expect(b.result.current[0]).toBe(false); // sem storage próprio -> default de viewport
  });
});
