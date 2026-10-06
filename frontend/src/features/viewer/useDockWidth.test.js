// frontend/src/features/viewer/useDockWidth.test.js
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDockWidth, clampDockWidth, DOCK_MIN_WIDTH } from './useDockWidth.js';

const STORAGE_KEY = 'escritorio:viewer-dock-width';

function fakeHandle(columnWidth, columnRight = 1600) {
  const handle = new EventTarget();
  handle.setPointerCapture = vi.fn();
  handle.parentElement = {
    getBoundingClientRect: () => ({ width: columnWidth, right: columnRight }),
  };
  return handle;
}

describe('clampDockWidth', () => {
  it('limita entre o mínimo e 75% da janela', () => {
    expect(clampDockWidth(100, 1600)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(2000, 1600)).toBe(1200);
    expect(clampDockWidth(700, 1600)).toBe(700);
  });
});

describe('useDockWidth', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.innerWidth = 1600;
  });
  afterEach(() => window.localStorage.clear());

  it('sem preferência salva usa a largura padrão (null)', () => {
    const { result } = renderHook(() => useDockWidth());
    expect(result.current.width).toBeNull();
  });

  it('lê a largura salva, já limitada à janela', () => {
    window.localStorage.setItem(STORAGE_KEY, '5000');
    const { result } = renderHook(() => useDockWidth());
    expect(result.current.width).toBe(1200);
  });

  it('arrastar muda a largura, salva e pede refit só ao soltar', () => {
    const onRefit = vi.fn();
    window.addEventListener('escritorio:sidebar-toggled', onRefit);
    try {
      const { result } = renderHook(() => useDockWidth());
      const handle = fakeHandle(600);
      act(() => {
        result.current.handleProps.onPointerDown({
          button: 0, pointerId: 1, currentTarget: handle, preventDefault() {},
        });
      });
      expect(result.current.dragging).toBe(true);

      act(() => {
        const move = new Event('pointermove');
        move.clientX = 800; // borda direita 1600 → 800px de painel
        handle.dispatchEvent(move);
      });
      expect(result.current.width).toBe(800);
      expect(onRefit).not.toHaveBeenCalled();

      act(() => { handle.dispatchEvent(new Event('pointerup')); });
      expect(result.current.dragging).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('800');
      expect(onRefit).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('escritorio:sidebar-toggled', onRefit);
    }
  });

  it('setas do teclado alargam/estreitam e duplo clique restaura o padrão', () => {
    const { result } = renderHook(() => useDockWidth());
    const handle = fakeHandle(600);
    act(() => {
      result.current.handleProps.onKeyDown({ key: 'ArrowLeft', currentTarget: handle, preventDefault() {} });
    });
    expect(result.current.width).toBe(632);

    act(() => { result.current.handleProps.onDoubleClick(); });
    expect(result.current.width).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
