// frontend/src/hooks/useKeyboardSuppressed.test.js
// Cobre useKeyboardSuppressed(): a preferência "esconder teclado" do terminal
// (Rodada 2, Frente C), persistida em localStorage e espelhada entre
// consumidores distantes na árvore por um CustomEvent no window.
//
// O lado CONSUMIDOR deste contrato está em outros dois arquivos, e é lá que os
// efeitos de verdade são asseverados: components/TerminalPanel.test.jsx (o
// `readOnly` na textarea, o blur único, os gates de focus) e
// layouts/v2/TerminalShortcutsPanel.test.jsx (o toggle e o aria-pressed). Aqui
// fica só o que o hook é dono: formato de persistência, defaults, e as duas
// falhas de localStorage que o Safari em modo privado produz.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  KEYBOARD_SUPPRESSED_EVENT,
  KEYBOARD_SUPPRESSED_STORAGE_KEY,
  useKeyboardSuppressed,
} from './useKeyboardSuppressed.js';

// `localStorage` é REAL nesta suíte. Limpar nos dois lados, porque um teste que
// falhe no meio deixaria a preferência ligada para o próximo.
beforeEach(() => {
  localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
});

describe('useKeyboardSuppressed', () => {
  it('defaults to false when nothing is stored', () => {
    const { result } = renderHook(() => useKeyboardSuppressed());

    // Um modo que suprime o teclado NUNCA pode ser o default: o usuário novo não
    // teria como descobrir por que não consegue digitar.
    expect(result.current[0]).toBe(false);
  });

  it('reads the persisted preference on mount', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');

    const { result } = renderHook(() => useKeyboardSuppressed());

    expect(result.current[0]).toBe(true);
  });

  it('persists as String(boolean), the same format useSidebarCollapsed uses', () => {
    const { result } = renderHook(() => useKeyboardSuppressed());

    act(() => { result.current[1](); });

    // 'true'/'false', nunca '1'/'0': duas preferências do mesmo repo com dois
    // formatos é como a próxima leitura erra.
    expect(localStorage.getItem(KEYBOARD_SUPPRESSED_STORAGE_KEY)).toBe('true');

    act(() => { result.current[1](); });

    expect(localStorage.getItem(KEYBOARD_SUPPRESSED_STORAGE_KEY)).toBe('false');
    expect(result.current[0]).toBe(false);
  });

  it('mirrors the new value into every other live instance of the hook', () => {
    const first = renderHook(() => useKeyboardSuppressed());
    const second = renderHook(() => useKeyboardSuppressed());

    act(() => { first.result.current[1](); });

    // É ESTE comportamento que substitui o prop-drilling: o toggle vive dentro do
    // painel de atalhos e o efeito é aplicado pelo TerminalPanel, dois ramos
    // distantes da árvore.
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);
  });

  it('dispatches exactly one event per toggle, carrying the new value', () => {
    const details = [];
    const listener = (e) => details.push(e.detail);
    window.addEventListener(KEYBOARD_SUPPRESSED_EVENT, listener);

    const { result } = renderHook(() => useKeyboardSuppressed());
    act(() => { result.current[1](); });
    act(() => { result.current[1](); });

    // Um por toque. Dois indicariam que o efeito colateral foi para dentro do
    // updater do setState, que o React pode invocar duas vezes em StrictMode.
    expect(details).toEqual([true, false]);

    window.removeEventListener(KEYBOARD_SUPPRESSED_EVENT, listener);
  });

  it('falls back to false when localStorage throws on read (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    // Sem o try/catch na LEITURA o componente inteiro estoura no primeiro render
    // — e o Safari em modo privado lança já ali, não só na escrita.
    expect(() => renderHook(() => useKeyboardSuppressed())).not.toThrow();
  });

  it('still toggles in memory when localStorage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const { result } = renderHook(() => useKeyboardSuppressed());
    act(() => { result.current[1](); });

    // A UI tem que responder ao toque mesmo sem conseguir persistir: o que se
    // perde é a sobrevivência ao reload, não a sessão atual.
    expect(result.current[0]).toBe(true);
  });
});
