// frontend/src/features/viewer/useDockWidth.js
// Largura do painel encaixado escolhida pelo usuário (arrastando a borda
// esquerda do ViewerDock). `null` = largura padrão (DOCK_WIDTH, responsiva).
//
// A largura arrastada fica salva em localStorage (é preferência por
// navegador, como o recolhimento da sidebar) e é limitada a [MIN, 75vw] a
// cada render — encolher a janela nunca deixa o painel engolir o terminal.
//
// Refit do terminal: durante o arrasto o xterm não é reajustado a cada pixel
// (o fit() é caro e redesenharia o claude dezenas de vezes); ao SOLTAR, o hook
// dispara `escritorio:sidebar-toggled`, o mesmo evento que o TerminalPanel já
// escuta para refazer o fit() 250ms depois.
import { useCallback, useEffect, useState } from 'react';

export const DOCK_MIN_WIDTH = 360;
export const DOCK_MAX_RATIO = 0.75;
const STORAGE_KEY = 'escritorio:viewer-dock-width';
const KEYBOARD_STEP = 32;

function readStored() {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(width) {
  try {
    if (width == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Sem storage (aba anônima, bloqueado): a largura vale só nesta sessão.
  }
}

export function clampDockWidth(width, viewportWidth = window.innerWidth) {
  const max = Math.max(DOCK_MIN_WIDTH, viewportWidth * DOCK_MAX_RATIO);
  return Math.min(Math.max(width, DOCK_MIN_WIDTH), max);
}

function notifyLayoutChanged() {
  window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
}

/**
 * @returns {{ width: number|null, dragging: boolean,
 *   handleProps: object }} `width` já limitada; `handleProps` vai na alça.
 */
export function useDockWidth() {
  const [stored, setStored] = useState(readStored);
  const [dragging, setDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = stored == null ? null : clampDockWidth(stored, viewportWidth);

  const commit = useCallback((next) => {
    setStored(next);
    writeStored(next);
    notifyLayoutChanged();
  }, []);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    // A coluna do dock é o pai da alça; a borda direita dela é a da janela.
    const column = handle.parentElement;
    const right = column.getBoundingClientRect().right;
    // Pointer capture: o iframe do HtmlView/PdfView não "rouba" o arrasto.
    handle.setPointerCapture?.(event.pointerId);
    setDragging(true);
    let last = column.getBoundingClientRect().width;

    const onMove = (e) => {
      last = clampDockWidth(right - e.clientX);
      setStored(last);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setDragging(false);
      commit(last);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [commit]);

  const onKeyDown = useCallback((event) => {
    const column = event.currentTarget.parentElement;
    const current = column.getBoundingClientRect().width;
    // A alça fica à ESQUERDA: seta para a esquerda alarga o painel.
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commit(clampDockWidth(current + KEYBOARD_STEP));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commit(clampDockWidth(current - KEYBOARD_STEP));
    }
  }, [commit]);

  // Duplo clique volta à largura padrão (responsiva).
  const onDoubleClick = useCallback(() => commit(null), [commit]);

  return {
    width,
    dragging,
    handleProps: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Redimensionar visualizador',
      'aria-valuemin': DOCK_MIN_WIDTH,
      'aria-valuemax': Math.round(Math.max(DOCK_MIN_WIDTH, viewportWidth * DOCK_MAX_RATIO)),
      ...(width != null && { 'aria-valuenow': Math.round(width) }),
      title: 'Arraste para redimensionar · duplo clique restaura',
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
      onDoubleClick,
    },
  };
}
