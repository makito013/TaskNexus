// frontend/src/hooks/useMediaQuery.test.js
// Espelha o padrão de useSidebarCollapsed.test.js: estado inicial via
// `matches`, mudança via disparo do handler de `change` (mock de
// matchMedia retornando um objeto controlável), fallback addListener
// (Safari antigo) e cleanup do listener no unmount.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery.js';

const QUERY = '(max-width: 640px)';

// Fábrica de um MediaQueryList controlável: guarda o handler registrado via
// addEventListener/change pra que o teste possa disparar manualmente,
// simulando o navegador mudando de viewport.
function makeControllableMatchMedia(initialMatches) {
  let matches = initialMatches;
  let changeHandler = null;
  const mql = {
    get matches() { return matches; },
    addEventListener: (event, handler) => { if (event === 'change') changeHandler = handler; },
    removeEventListener: vi.fn(),
    addListener: undefined,
    removeListener: undefined,
  };
  return {
    matchMediaFn: vi.fn(() => mql),
    fireChange: (nextMatches) => {
      matches = nextMatches;
      changeHandler?.({ matches: nextMatches });
    },
    mql,
  };
}

describe('useMediaQuery — estado inicial', () => {
  let originalMatchMedia;

  beforeEach(() => { originalMatchMedia = window.matchMedia; });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('retorna true quando a query já bate no primeiro render', () => {
    const { matchMediaFn } = makeControllableMatchMedia(true);
    window.matchMedia = matchMediaFn;
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(true);
  });

  it('retorna false quando a query não bate no primeiro render', () => {
    const { matchMediaFn } = makeControllableMatchMedia(false);
    window.matchMedia = matchMediaFn;
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);
  });

  it('chama matchMedia com a query passada', () => {
    const { matchMediaFn } = makeControllableMatchMedia(false);
    window.matchMedia = matchMediaFn;
    renderHook(() => useMediaQuery(QUERY));
    expect(matchMediaFn).toHaveBeenCalledWith(QUERY);
  });
});

describe('useMediaQuery — reage a mudanças de viewport', () => {
  let originalMatchMedia;

  beforeEach(() => { originalMatchMedia = window.matchMedia; });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('atualiza o valor quando o listener de change dispara', () => {
    const { matchMediaFn, fireChange } = makeControllableMatchMedia(false);
    window.matchMedia = matchMediaFn;
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);

    act(() => fireChange(true));
    expect(result.current).toBe(true);

    act(() => fireChange(false));
    expect(result.current).toBe(false);
  });
});

describe('useMediaQuery — fallback addListener (Safari antigo)', () => {
  let originalMatchMedia;

  beforeEach(() => { originalMatchMedia = window.matchMedia; });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('usa addListener/removeListener quando addEventListener não existe no MediaQueryList', () => {
    let changeHandler = null;
    const addListener = vi.fn((handler) => { changeHandler = handler; });
    const removeListener = vi.fn();
    const mql = {
      matches: false,
      addListener,
      removeListener,
      // Sem addEventListener/removeEventListener — força o fallback.
    };
    window.matchMedia = vi.fn(() => mql);

    const { result, unmount } = renderHook(() => useMediaQuery(QUERY));
    expect(addListener).toHaveBeenCalledTimes(1);

    act(() => changeHandler({ matches: true }));
    expect(result.current).toBe(true);

    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});

describe('useMediaQuery — cleanup do listener no unmount', () => {
  let originalMatchMedia;

  beforeEach(() => { originalMatchMedia = window.matchMedia; });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('remove o listener via removeEventListener ao desmontar', () => {
    const { matchMediaFn, mql } = makeControllableMatchMedia(false);
    window.matchMedia = matchMediaFn;
    const { unmount } = renderHook(() => useMediaQuery(QUERY));

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
