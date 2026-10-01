// frontend/src/layouts/v2/useViewerDockCollapse.test.js
// Fase N, passo 6 (8.2.4, 8.3.3 e 8.4): recolhimento automático das colunas
// com o visualizador encaixado. O visualizador só chega na Fase V, então aqui
// `viewerOpen` é controlado pelo teste — é exatamente o valor que a Fase V vai
// ligar no AppV2.
//
// Os testes de preferência usam o useSidebarCollapsed REAL: a garantia que
// importa é "o recolhimento automático nunca grava no localStorage", e isso só
// se prova com o hook que grava de verdade.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewerDockCollapse } from './useViewerDockCollapse.js';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed.js';

const SIDEBAR_KEY = 'escritorio::test_dock_sidebar';
const CHAT_KEY = 'escritorio::test_dock_chat';

// Harness: as duas preferências reais + o hook do encaixe, como no AppV2.
function useHarness({ viewerOpen, isWide }) {
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed(SIDEBAR_KEY);
  const [chatSidebarCollapsed, toggleChatSidebar] = useSidebarCollapsed(CHAT_KEY);
  const dock = useViewerDockCollapse({
    viewerOpen,
    isWide,
    sidebarCollapsed,
    toggleSidebar,
    chatSidebarCollapsed,
    toggleChatSidebar,
  });
  return { dock, pref: { sidebarCollapsed, chatSidebarCollapsed } };
}

let originalMatchMedia;
let refitEvents;
const onRefit = () => { refitEvents += 1; };

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  // useSidebarCollapsed consulta a NARROW query só quando não há nada salvo.
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.setItem(SIDEBAR_KEY, 'false');
  localStorage.setItem(CHAT_KEY, 'false');
  refitEvents = 0;
  window.addEventListener('escritorio:sidebar-toggled', onRefit);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.removeEventListener('escritorio:sidebar-toggled', onRefit);
  localStorage.removeItem(SIDEBAR_KEY);
  localStorage.removeItem(CHAT_KEY);
});

const renderDock = (props) => renderHook((p) => useHarness(p), { initialProps: props });

describe('useViewerDockCollapse — sem visualizador (tudo como antes)', () => {
  it('repassa a preferência salva e os toggles mexem nela', () => {
    const { result } = renderDock({ viewerOpen: false, isWide: true });
    expect(result.current.dock.viewerDocked).toBe(false);
    expect(result.current.dock.sidebarCollapsed).toBe(false);
    expect(result.current.dock.chatSidebarCollapsed).toBe(false);

    act(() => result.current.dock.onToggleSidebar());
    expect(result.current.dock.sidebarCollapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('true');
  });

  it('não dispara refit no mount', () => {
    renderDock({ viewerOpen: false, isWide: true });
    expect(refitEvents).toBe(0);
  });
});

describe('useViewerDockCollapse — visualizador encaixado (≥ 1100px)', () => {
  it('abrir recolhe as duas colunas sem gravar nada no localStorage, e dispara refit', () => {
    const { result, rerender } = renderDock({ viewerOpen: false, isWide: true });
    rerender({ viewerOpen: true, isWide: true });

    expect(result.current.dock.viewerDocked).toBe(true);
    expect(result.current.dock.sidebarCollapsed).toBe(true);
    expect(result.current.dock.chatSidebarCollapsed).toBe(true);
    expect(result.current.pref).toEqual({ sidebarCollapsed: false, chatSidebarCollapsed: false });
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');
    expect(localStorage.getItem(CHAT_KEY)).toBe('false');
    expect(refitEvents).toBe(1);
  });

  it('expandir uma coluna com o painel aberto a mantém expandida, sem tocar na preferência', () => {
    const { result, rerender } = renderDock({ viewerOpen: false, isWide: true });
    rerender({ viewerOpen: true, isWide: true });
    act(() => result.current.dock.onToggleSidebar());

    expect(result.current.dock.sidebarCollapsed).toBe(false);
    expect(result.current.dock.chatSidebarCollapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');
    // Abrir (1) + o toggle manual (1).
    expect(refitEvents).toBe(2);

    // Um re-render qualquer não desfaz a expansão manual.
    rerender({ viewerOpen: true, isWide: true });
    expect(result.current.dock.sidebarCollapsed).toBe(false);

    act(() => result.current.dock.onToggleChatSidebar());
    expect(result.current.dock.chatSidebarCollapsed).toBe(false);
    expect(localStorage.getItem(CHAT_KEY)).toBe('false');
  });

  it('fechar o painel devolve exatamente o estado de antes e dispara refit', () => {
    localStorage.setItem(CHAT_KEY, 'true'); // lista de chats já recolhida por escolha do usuário
    const { result, rerender } = renderDock({ viewerOpen: false, isWide: true });
    expect(result.current.dock.chatSidebarCollapsed).toBe(true);

    rerender({ viewerOpen: true, isWide: true });
    act(() => result.current.dock.onToggleChatSidebar()); // expande com o painel aberto
    rerender({ viewerOpen: false, isWide: true });

    expect(result.current.dock.sidebarCollapsed).toBe(false);
    expect(result.current.dock.chatSidebarCollapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');
    expect(localStorage.getItem(CHAT_KEY)).toBe('true');
    // Abrir + toggle + fechar.
    expect(refitEvents).toBe(3);
  });

  it('reabrir começa recolhido de novo (a expansão manual valia só para aquela abertura)', () => {
    const { result, rerender } = renderDock({ viewerOpen: false, isWide: true });
    rerender({ viewerOpen: true, isWide: true });
    act(() => result.current.dock.onToggleSidebar());
    rerender({ viewerOpen: false, isWide: true });
    rerender({ viewerOpen: true, isWide: true });
    expect(result.current.dock.sidebarCollapsed).toBe(true);
  });
});

describe('useViewerDockCollapse — telas médias e rotação', () => {
  it('abaixo de 1100px o painel não encaixa: nada recolhe e não há refit', () => {
    const { result, rerender } = renderDock({ viewerOpen: false, isWide: false });
    rerender({ viewerOpen: true, isWide: false });
    expect(result.current.dock.viewerDocked).toBe(false);
    expect(result.current.dock.sidebarCollapsed).toBe(false);
    expect(result.current.dock.chatSidebarCollapsed).toBe(false);
    expect(refitEvents).toBe(0);
  });

  it('girar para retrato com o painel aberto desfaz o recolhimento; voltar para paisagem recolhe de novo', () => {
    const { result, rerender } = renderDock({ viewerOpen: true, isWide: true });
    expect(result.current.dock.sidebarCollapsed).toBe(true);
    act(() => result.current.dock.onToggleSidebar()); // expande à mão

    rerender({ viewerOpen: true, isWide: false });
    expect(result.current.dock.sidebarCollapsed).toBe(false);
    expect(result.current.dock.chatSidebarCollapsed).toBe(false);

    rerender({ viewerOpen: true, isWide: true });
    expect(result.current.dock.sidebarCollapsed).toBe(true);
    expect(result.current.dock.chatSidebarCollapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');
  });

  it('no retrato, com o painel aberto, os toggles voltam a mexer na preferência', () => {
    const { result } = renderDock({ viewerOpen: true, isWide: false });
    act(() => result.current.dock.onToggleSidebar());
    expect(result.current.pref.sidebarCollapsed).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('true');
  });
});
