// frontend/src/layouts/v2/MobileMenuScreen.test.jsx
// QA (etapa 8, navegação mobile do Layout v2 — lacuna registrada em
// CONTEXTO.md seção 6: "só há teste para useMediaQuery/ResetLayoutButton,
// nenhum para MobileMenuScreen/MobileChatSheet no papel de navegação mobile
// em si"). Este arquivo cobre MobileMenuScreen.jsx ISOLADO (sem montar
// AppV2 inteiro) — NavTabs (variant="segmented") + ClienteList
// (variant="mobile") + AppearanceSwitch no rodapé, e a delegação pura das
// props onSelectScreen/onSelectCliente para quem monta este componente
// (AppV2.jsx). Os testes de INTEGRAÇÃO (o que acontece em AppV2 quando o
// usuário toca num cliente — chatModal vs. content direto, RF07/RF08) já
// existem em AppV2.test.jsx e não são duplicados aqui.
//
// AppearanceSwitch é montado de verdade (não mockado): ele não faz nenhuma
// chamada de rede no mount (só ao clicar num segmento — ver
// components/AppearanceSwitch.jsx), então é seguro renderizá-lo aqui só
// para confirmar que o rodapé existe; o comportamento de salvar/recarregar
// já tem cobertura própria (não deste arquivo).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MobileMenuScreen } from './MobileMenuScreen.jsx';

afterEach(() => cleanup());

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'tarefas', label: 'Tarefas', icon: '✓' },
  { id: 'agentes', label: 'Agentes', icon: '◈' },
];

const CLIENTES = [
  { id: 'cliente_projeto_1', nome: 'Cliente 1' },
  { id: 'podesubir', nome: 'Pode Subir' },
];

function baseProps(overrides = {}) {
  return {
    navItems: NAV_ITEMS,
    activeScreen: 'chat',
    onSelectScreen: vi.fn(),
    clientes: CLIENTES,
    selectedClienteId: null,
    onSelectCliente: vi.fn(),
    initialAppearance: { layout_version: 'v2', theme_mode: 'dark' },
    ...overrides,
  };
}

describe('MobileMenuScreen — estrutura básica', () => {
  it('renderiza como overlay identificável por data-testid="mobile-menu-screen"', () => {
    render(<MobileMenuScreen {...baseProps()} />);
    expect(screen.getByTestId('mobile-menu-screen')).toBeTruthy();
  });

  it('mostra a marca no header', () => {
    render(<MobileMenuScreen {...baseProps()} />);
    expect(screen.getByText('TaskNexus')).toBeTruthy();
  });
});

describe('MobileMenuScreen — NavTabs (variant="segmented")', () => {
  it('renderiza as 4 abas como role="tab", com a aba ativa marcada aria-selected', () => {
    render(<MobileMenuScreen {...baseProps({ activeScreen: 'board' })} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    const boardTab = screen.getByRole('tab', { name: /Board/i });
    expect(boardTab.getAttribute('aria-selected')).toBe('true');
    const chatTab = screen.getByRole('tab', { name: /Chat/i });
    expect(chatTab.getAttribute('aria-selected')).toBe('false');
  });

  it('tocar numa aba chama onSelectScreen com o id certo', () => {
    const onSelectScreen = vi.fn();
    render(<MobileMenuScreen {...baseProps({ onSelectScreen })} />);
    fireEvent.click(screen.getByRole('tab', { name: /Tarefas/i }));
    expect(onSelectScreen).toHaveBeenCalledWith('tarefas');
  });
});

describe('MobileMenuScreen — ClienteList (variant="mobile")', () => {
  it('renderiza "Todos" e cada cliente como texto (não recolhido — collapsed não é passado)', () => {
    render(<MobileMenuScreen {...baseProps()} />);
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('Cliente 1')).toBeTruthy();
    expect(screen.getByText('Pode Subir')).toBeTruthy();
    // variant="mobile" não deve virar o modo `collapsed` de avatares — este
    // é um componente de tela cheia, sempre com espaço para o texto.
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(0);
  });

  it('tocar num cliente chama onSelectCliente com o id certo', () => {
    const onSelectCliente = vi.fn();
    render(<MobileMenuScreen {...baseProps({ onSelectCliente })} />);
    fireEvent.click(screen.getByText('Cliente 1'));
    expect(onSelectCliente).toHaveBeenCalledWith('cliente_projeto_1');
  });

  it('tocar em "Todos" chama onSelectCliente(null)', () => {
    const onSelectCliente = vi.fn();
    render(<MobileMenuScreen {...baseProps({ onSelectCliente, selectedClienteId: 'cliente_projeto_1' })} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(onSelectCliente).toHaveBeenCalledWith(null);
  });

  it('quando clientes=[] (edge case), ainda mostra "Todos" e não quebra', () => {
    render(<MobileMenuScreen {...baseProps({ clientes: [] })} />);
    expect(screen.getByText('Todos')).toBeTruthy();
  });
});

describe('MobileMenuScreen — rodapé de aparência', () => {
  it('renderiza o AppearanceSwitch (controle "Aparência") no rodapé', () => {
    render(<MobileMenuScreen {...baseProps()} />);
    expect(screen.getByText('Aparência')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Layout' })).toBeTruthy();
  });
});
