// frontend/src/features/viewer/ViewerFullscreen.test.jsx
// Fase V-2, passo 8 (6.5.3 e 6.7): tela cheia em portal, Esc/✕ voltam ao
// painel (iPad/PC) ou fecham tudo (celular); Esc digitado no terminal é do
// agente e não fecha nada.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ViewerProvider, useViewer, SURFACE_CHAT } from './ViewerContext.jsx';
import { ViewerFullscreen } from './ViewerFullscreen.jsx';
import { ViewerMobileButton } from './ViewerMobileButton.jsx';

const SCOPE = 'session:projA::claude';
let viewer;

function Harness({ closeEverything = false }) {
  viewer = useViewer();
  const surface = viewer.getSurface(SURFACE_CHAT);
  return (
    <div data-testid="app-root">
      <ViewerMobileButton scope={SCOPE} />
      <ViewerFullscreen scope={SCOPE} open={surface.fullscreen} closeEverything={closeEverything} />
    </div>
  );
}

describe('ViewerFullscreen', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) }));
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renderiza num portal em document.body, fora da árvore do app', () => {
    render(<ViewerProvider><Harness /></ViewerProvider>);
    act(() => { viewer.setFullscreen(SURFACE_CHAT, true); });
    const modal = screen.getByTestId('viewer-fullscreen');
    expect(modal.parentElement).toBe(document.body);
    expect(screen.getByTestId('app-root').contains(modal)).toBe(false);
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: '✕ Fechar' })).toBeTruthy();
  });

  it('Esc sai da tela cheia e mantém o painel aberto (iPad/PC)', () => {
    render(<ViewerProvider><Harness /></ViewerProvider>);
    act(() => { viewer.setFullscreen(SURFACE_CHAT, true); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(viewer.getSurface(SURFACE_CHAT)).toEqual({ open: true, fullscreen: false });
    expect(screen.queryByTestId('viewer-fullscreen')).toBeNull();
  });

  it('✕ Fechar no celular fecha o visualizador inteiro', () => {
    render(<ViewerProvider><Harness closeEverything /></ViewerProvider>);
    act(() => { viewer.setFullscreen(SURFACE_CHAT, true); });
    fireEvent.click(screen.getByRole('button', { name: '✕ Fechar' }));
    expect(viewer.getSurface(SURFACE_CHAT)).toEqual({ open: false, fullscreen: false });
  });

  it('Esc vindo do terminal (xterm) não fecha a tela cheia', () => {
    const term = document.createElement('div');
    term.className = 'xterm';
    const textarea = document.createElement('textarea');
    term.appendChild(textarea);
    document.body.appendChild(term);
    try {
      render(<ViewerProvider><Harness /></ViewerProvider>);
      act(() => { viewer.setFullscreen(SURFACE_CHAT, true); });
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(viewer.getSurface(SURFACE_CHAT).fullscreen).toBe(true);
    } finally {
      term.remove();
    }
  });

  it('botão do celular abre direto em tela cheia', () => {
    render(<ViewerProvider><Harness closeEverything /></ViewerProvider>);
    fireEvent.click(screen.getByTestId('viewer-mobile-button'));
    expect(viewer.getSurface(SURFACE_CHAT)).toEqual({ open: true, fullscreen: true });
    expect(screen.getByTestId('viewer-fullscreen')).toBeTruthy();
  });
});
