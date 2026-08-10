// frontend/src/hooks/useRoute.test.js
// Covers the minimal pushState/popstate router (ADR-4,
// .planning/phases/05-tarefas-board-jira/05-ARQUITETO.md seção 4.1): initial
// path reflects window.location, navigate() updates both the returned path
// and browser history, and a manual `popstate` (browser back button) updates
// the path without navigate() being called.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoute } from './useRoute.js';

describe('useRoute — initial state', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reflects window.location.pathname on mount', () => {
    window.history.pushState({}, '', '/board');
    const { result } = renderHook(() => useRoute());
    const [path] = result.current;
    expect(path).toBe('/board');
  });
});

describe('useRoute — navigate', () => {
  beforeEach(() => { window.history.pushState({}, '', '/'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('updates the returned path and calls window.history.pushState', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useRoute());

    act(() => { result.current[1]('/board'); });

    const [path] = result.current;
    expect(path).toBe('/board');
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/board');
    expect(window.location.pathname).toBe('/board');
  });
});

describe('useRoute — popstate (browser back/forward)', () => {
  beforeEach(() => { window.history.pushState({}, '', '/'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('updates the path when a popstate event fires, without calling navigate', () => {
    const { result } = renderHook(() => useRoute());

    act(() => { result.current[1]('/board'); });
    expect(result.current[0]).toBe('/board');

    // Simulate the browser back button: history moves back to '/' and fires
    // popstate WITHOUT any navigate() call from app code.
    window.history.pushState({}, '', '/');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const [path] = result.current;
    expect(path).toBe('/');
  });
});
