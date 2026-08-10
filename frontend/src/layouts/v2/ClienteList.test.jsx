// frontend/src/layouts/v2/ClienteList.test.jsx
// QA (retrabalho pontual — avatares no modo recolhido, pedido literal do
// Bruno: "deveria ao esconder ficar os icones avatar" + "do cliente,
// deveria ficar o avatar do cliente tb"): cobre o contrato isolado do
// `collapsed` em ClienteList.jsx — que antes só existia indiretamente via
// SidebarV2.test.jsx (que testava ausência de texto, não a presença dos
// avatares que substituem o texto). Este arquivo fecha essa lacuna:
// clique no avatar recolhido continua funcional, o item ativo mantém
// destaque visual mesmo sem o texto, e o glyph "Todos" aparece só quando
// não há cliente selecionado.
//
// `variant="mobile"` (usado por MobileMenuScreen.jsx) NÃO é exercitado aqui
// de propósito — está fora do escopo desta rodada (Bruno pediu para não
// mexer/revisar a navegação mobile ainda não commitada). O default
// `collapsed = false` já garante que MobileMenuScreen.jsx (que não passa
// essa prop) continua com visual idêntico ao de antes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ClienteList } from './ClienteList.jsx';

afterEach(() => cleanup());

const CLIENTES = [
  { id: 'cliente_projeto_1', nome: 'Cliente 1' },
  { id: 'podesubir', nome: 'Pode Subir' },
];

function baseProps(overrides = {}) {
  return {
    clientes: CLIENTES,
    selectedClienteId: null,
    onSelectCliente: vi.fn(),
    collapsed: true,
    ...overrides,
  };
}

describe('ClienteList — collapsed=true (avatares no lugar do texto)', () => {
  it('esconde o divider e o rótulo "Clientes" (texto), mas mostra um avatar circular por item', () => {
    render(<ClienteList {...baseProps()} />);
    expect(screen.queryByText('Clientes')).toBeNull();
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(3); // "Todos" + 2 clientes
  });

  it('"Todos" renderiza o glyph ✱ (não texto, não iniciais, não o ▦ do nav Board) quando recolhido e sem cliente selecionado', () => {
    render(<ClienteList {...baseProps({ selectedClienteId: null })} />);
    const todosItem = screen.getByTitle('Todos');
    expect(todosItem.textContent).toBe('✱');
  });

  it('clientes reais renderizam a inicial do nome quando recolhido', () => {
    render(<ClienteList {...baseProps()} />);
    expect(screen.getByTitle('Cliente 1').textContent).toBe('C');
    expect(screen.getByTitle('Pode Subir').textContent).toBe('P');
  });

  it('clicar no avatar recolhido de um cliente chama onSelectCliente com o id certo', () => {
    const onSelectCliente = vi.fn();
    render(<ClienteList {...baseProps({ onSelectCliente })} />);
    fireEvent.click(screen.getByTitle('Cliente 1'));
    expect(onSelectCliente).toHaveBeenCalledWith('cliente_projeto_1');
  });

  it('clicar no avatar recolhido de "Todos" chama onSelectCliente(null)', () => {
    const onSelectCliente = vi.fn();
    render(<ClienteList {...baseProps({ onSelectCliente, selectedClienteId: 'cliente_projeto_1' })} />);
    fireEvent.click(screen.getByTitle('Todos'));
    expect(onSelectCliente).toHaveBeenCalledWith(null);
  });

  it('item ativo mantém o destaque visual (background/cor) mesmo recolhido, sem o texto', () => {
    render(<ClienteList {...baseProps({ selectedClienteId: 'cliente_projeto_1' })} />);
    const clienteItem = screen.getByTitle('Cliente 1');
    const podeSubirItem = screen.getByTitle('Pode Subir');
    const todosItem = screen.getByTitle('Todos');
    expect(clienteItem.style.background).toBe('var(--v2-surface-2)');
    expect(clienteItem.style.color).toBe('var(--v2-text)');
    expect(podeSubirItem.style.background).toBe('transparent');
    expect(todosItem.style.background).toBe('transparent');
  });

  it('"Todos" mantém o destaque visual quando recolhido e nenhum cliente está selecionado', () => {
    render(<ClienteList {...baseProps({ selectedClienteId: null })} />);
    const todosItem = screen.getByTitle('Todos');
    expect(todosItem.style.background).toBe('var(--v2-surface-2)');
    expect(todosItem.style.color).toBe('var(--v2-text)');
  });
});

describe('ClienteList — collapsed=false (comportamento original preservado)', () => {
  it('mostra o texto por extenso, sem avatares', () => {
    render(<ClienteList {...baseProps({ collapsed: false })} />);
    expect(screen.getByText('Clientes')).toBeTruthy();
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('Cliente 1')).toBeTruthy();
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(0);
  });
});
