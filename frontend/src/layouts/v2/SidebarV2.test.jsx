// frontend/src/layouts/v2/SidebarV2.test.jsx
// QA (feature Clientes na sidebar v2, Bloco A/B): cobre a navegação lateral
// do v2 depois da renomeação "Projetos" -> "Clientes" — item "Todos" no
// topo, seleção de um cliente específico, estado ativo (Todos vs cliente),
// e que a seção de clientes/rodapé de aparência somem quando a sidebar está
// recolhida (mesmo padrão de antes, só validando que a troca de rótulo não
// quebrou o resto do componente).
//
// QA (retrabalho pontual — avatares no modo recolhido): o bloco "recolhida
// (collapsed=true)" abaixo documentava "não mostra a seção de clientes...
// quando recolhida" checando só a AUSÊNCIA do texto — o que ainda é
// verdade, mas dava a entender (erroneamente) que nada é renderizado ali.
// Desde o retrabalho, cada cliente vira um avatar circular clicável no
// lugar do nome; a cobertura detalhada desse contrato (clique, destaque do
// item ativo, glyph "Todos") vive em ClienteList.test.jsx — aqui só
// atualizamos a descrição/asserção para não desinformar sobre o que
// realmente aparece na tela recolhida.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarV2 } from './SidebarV2.jsx';

afterEach(() => cleanup());

const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'board', label: 'Board', icon: '▦' },
];

const CLIENTES = [
  { id: 'cliente_projeto_1', nome: 'Cliente 1' },
  { id: 'podesubir', nome: 'Pode Subir' },
];

function baseProps(overrides = {}) {
  return {
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    clientes: CLIENTES,
    selectedClienteId: null,
    onSelectCliente: vi.fn(),
    navItems: NAV_ITEMS,
    activeScreen: 'chat',
    onSelectScreen: vi.fn(),
    initialAppearance: { layout_version: 'v2', theme_mode: 'dark' },
    ...overrides,
  };
}

describe('SidebarV2 — seção "Clientes" (renomeada de "Projetos")', () => {
  it('mostra o cabeçalho de seção "Clientes", não "Projetos"', () => {
    render(<SidebarV2 {...baseProps()} />);
    expect(screen.getByText('Clientes')).toBeTruthy();
    expect(screen.queryByText('Projetos')).toBeNull();
  });

  it('mostra "Todos" no topo da lista, antes de qualquer cliente', () => {
    render(<SidebarV2 {...baseProps()} />);
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('Cliente 1')).toBeTruthy();
    expect(screen.getByText('Pode Subir')).toBeTruthy();
  });

  it('clicar em "Todos" chama onSelectCliente(null)', () => {
    const onSelectCliente = vi.fn();
    render(<SidebarV2 {...baseProps({ onSelectCliente, selectedClienteId: 'cliente_projeto_1' })} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(onSelectCliente).toHaveBeenCalledWith(null);
  });

  it('clicar num cliente chama onSelectCliente(cliente.id)', () => {
    const onSelectCliente = vi.fn();
    render(<SidebarV2 {...baseProps({ onSelectCliente })} />);
    fireEvent.click(screen.getByText('Cliente 1'));
    expect(onSelectCliente).toHaveBeenCalledWith('cliente_projeto_1');
  });

  it('sem cliente selecionado (selectedClienteId=null): "Todos" fica com o estilo de item ativo', () => {
    render(<SidebarV2 {...baseProps({ selectedClienteId: null })} />);
    const todosItem = screen.getByText('Todos');
    expect(todosItem.style.color).toBe('var(--v2-text)');
  });

  it('com um cliente selecionado: o item daquele cliente fica com o estilo de item ativo, "Todos" não', () => {
    render(<SidebarV2 {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    const clienteItem = screen.getByText('Cliente 1');
    const todosItem = screen.getByText('Todos');
    expect(clienteItem.style.color).toBe('var(--v2-text)');
    expect(todosItem.style.color).toBe('var(--v2-text-dim)');
  });
});

describe('SidebarV2 — recolhida (collapsed=true)', () => {
  it('esconde o TEXTO da seção de clientes e o rodapé de aparência, mas mostra avatares clicáveis no lugar do nome', () => {
    render(<SidebarV2 {...baseProps({ collapsed: true })} />);
    expect(screen.queryByText('Clientes')).toBeNull();
    expect(screen.queryByText('Todos')).toBeNull();
    expect(screen.queryByText('Cliente 1')).toBeNull();
    expect(screen.queryByText('Aparência')).toBeNull();
    // Avatares (glyph "Todos" + inicial de cada cliente) tomam o lugar do
    // texto — cobertura detalhada de clique/destaque em ClienteList.test.jsx.
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(3);
  });

  it('ainda mostra os itens de navegação (só ícone) quando recolhida', () => {
    render(<SidebarV2 {...baseProps({ collapsed: true })} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('clicar no avatar recolhido de um cliente ainda chama onSelectCliente (integração com SidebarV2)', () => {
    const onSelectCliente = vi.fn();
    render(<SidebarV2 {...baseProps({ collapsed: true, onSelectCliente })} />);
    fireEvent.click(screen.getByTitle('Cliente 1'));
    expect(onSelectCliente).toHaveBeenCalledWith('cliente_projeto_1');
  });
});

describe('SidebarV2 — RF01: nav + Clientes rolam juntos num único wrapper', () => {
  // QA (etapa 8, RF01): antes do fix só `projectList` (a lista de clientes)
  // tinha overflowY:auto — nav/divider/"Clientes" ficavam fora da área de
  // rolagem e "somiam" ao rolar até o fim de uma lista longa de clientes.
  // Este teste falharia contra a implementação antiga: nav.parentElement
  // (o antigo container fixo) e clientesLabel.parentElement (projectList,
  // que era o único rolável) eram elementos DIFERENTES.
  it('o nav (role=tablist) e o rótulo "Clientes" têm o MESMO ancestor direto, com overflowY:auto', () => {
    render(<SidebarV2 {...baseProps()} />);
    const nav = screen.getByRole('tablist');
    const clientesLabel = screen.getByText('Clientes');
    expect(nav.parentElement).toBe(clientesLabel.parentElement);
    expect(nav.parentElement.style.overflowY).toBe('auto');
  });

  it('o rodapé de aparência ("Aparência") fica FORA do wrapper rolável', () => {
    render(<SidebarV2 {...baseProps()} />);
    const nav = screen.getByRole('tablist');
    const scrollArea = nav.parentElement;
    const aparenciaHeading = screen.getByText('Aparência');
    expect(scrollArea.contains(aparenciaHeading)).toBe(false);
  });
});

describe('SidebarV2 — navegação entre telas', () => {
  it('clicar num nav item chama onSelectScreen com o id certo', () => {
    const onSelectScreen = vi.fn();
    render(<SidebarV2 {...baseProps({ onSelectScreen })} />);
    fireEvent.click(screen.getByRole('tab', { name: /Board/i }));
    expect(onSelectScreen).toHaveBeenCalledWith('board');
  });

  it('Enter/Espaço no nav item (teclado) também chama onSelectScreen', () => {
    const onSelectScreen = vi.fn();
    render(<SidebarV2 {...baseProps({ onSelectScreen })} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /Board/i }), { key: 'Enter' });
    expect(onSelectScreen).toHaveBeenCalledWith('board');
  });
});
