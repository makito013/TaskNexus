import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useIsTouchDevice } from './useIsTouchDevice.js';

describe('useIsTouchDevice', () => {
  let originalMatchMedia;
  let hadOntouchstart;
  let originalOntouchstart;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    hadOntouchstart = 'ontouchstart' in window;
    originalOntouchstart = window.ontouchstart;
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    if (hadOntouchstart) window.ontouchstart = originalOntouchstart;
    else delete window.ontouchstart;
  });

  it('returns true when the pointer media query matches', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    delete window.ontouchstart;
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });

  it('returns true when "ontouchstart" exists even with a fine pointer', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    window.ontouchstart = null;
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });

  it('returns false when neither coarse pointer nor ontouchstart is present', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    delete window.ontouchstart;
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);
  });

  it('does not throw when window.matchMedia is not a function (jsdom default)', () => {
    delete window.matchMedia;
    delete window.ontouchstart;
    let result;
    expect(() => {
      result = renderHook(() => useIsTouchDevice());
    }).not.toThrow();
    expect(result.result.current).toBe(false);
  });
});
