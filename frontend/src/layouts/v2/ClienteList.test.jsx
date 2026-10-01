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

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ClienteList } from './ClienteList.jsx';
import { useNavScope } from '../../hooks/useNavScope.js';

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

// ---------------------------------------------------------------------------
// Fase N (08-planejamento-navegacao-cliente-projeto.md, 8.2.1 e 8.4): a mesma
// área vira um drill-down Clientes → Projetos → subprojetos, com voltar.
// ---------------------------------------------------------------------------

const TREE = [
  { id: 'podesubir', nome: 'podesubir', elegivel: true },
  { id: 'podesubir/site-institucional', nome: 'site-institucional', elegivel: true },
  { id: 'podesubir/api-pagamentos', nome: 'api-pagamentos', elegivel: false },
  { id: 'podesubir/api-pagamentos/v1', nome: 'v1', elegivel: true },
  { id: 'podesubir/api-pagamentos/v2', nome: 'v2', elegivel: true },
  { id: 'podesubir/app-mobile', nome: 'app-mobile', elegivel: true },
  { id: 'agrupadora', nome: 'agrupadora', elegivel: false },
  { id: 'agrupadora/a', nome: 'a', elegivel: true },
  { id: 'interno', nome: 'interno', elegivel: true },
];
const TREE_CLIENTES = TREE.filter((p) => !p.id.includes('/'));

function navProps(overrides = {}) {
  return {
    clientes: TREE_CLIENTES,
    projects: TREE,
    selectedClienteId: null,
    selectedProjetoId: null,
    level: 'clientes',
    parentId: null,
    onSelectCliente: vi.fn(),
    onEnterCliente: vi.fn(),
    onSelectProjeto: vi.fn(),
    onEnterProjeto: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

const inPodesubir = (overrides = {}) => navProps({
  selectedClienteId: 'podesubir',
  level: 'projetos',
  parentId: 'podesubir',
  ...overrides,
});

// Rótulos visíveis das linhas, na ordem da tela (o botão de voltar não é linha).
const rowTitles = () => Array.from(document.querySelectorAll('[data-nav-id]')).map((el) => el.getAttribute('title'));

describe('ClienteList — nível Clientes (drill-down)', () => {
  it('mostra "›" só nos clientes que têm subprojetos', () => {
    render(<ClienteList {...navProps()} />);
    expect(screen.getByTitle('podesubir').textContent).toBe('podesubir›');
    expect(screen.getByTitle('agrupadora').textContent).toBe('agrupadora›');
    expect(screen.getByTitle('interno').textContent).toBe('interno');
    expect(screen.getByTitle('Todos').textContent).toBe('Todos');
  });

  it('tocar num cliente COM subprojetos entra no nível Projetos (onEnterCliente), sem o onSelectCliente', () => {
    const props = navProps();
    render(<ClienteList {...props} />);
    fireEvent.click(screen.getByText('podesubir'));
    expect(props.onEnterCliente).toHaveBeenCalledWith('podesubir');
    expect(props.onSelectCliente).not.toHaveBeenCalled();
  });

  it('tocar num cliente SEM subprojetos só seleciona (decisão do Bruno)', () => {
    const props = navProps();
    render(<ClienteList {...props} />);
    fireEvent.click(screen.getByText('interno'));
    expect(props.onSelectCliente).toHaveBeenCalledWith('interno');
    expect(props.onEnterCliente).not.toHaveBeenCalled();
  });

  it('sem onEnterCliente (uso antigo), nenhum cliente vira drill-down: tudo só seleciona', () => {
    const onSelectCliente = vi.fn();
    render(<ClienteList clientes={TREE_CLIENTES} projects={TREE} selectedClienteId={null} onSelectCliente={onSelectCliente} />);
    expect(screen.getByTitle('podesubir').textContent).toBe('podesubir');
    fireEvent.click(screen.getByText('podesubir'));
    expect(onSelectCliente).toHaveBeenCalledWith('podesubir');
  });

  it('linhas são alcançáveis pelo teclado: Enter e Espaço ativam', () => {
    const props = navProps();
    render(<ClienteList {...props} />);
    const interno = screen.getByTitle('interno');
    expect(interno.getAttribute('role')).toBe('button');
    expect(interno.tabIndex).toBe(0);
    fireEvent.keyDown(interno, { key: 'Enter' });
    fireEvent.keyDown(screen.getByTitle('podesubir'), { key: ' ' });
    expect(props.onSelectCliente).toHaveBeenCalledWith('interno');
    expect(props.onEnterCliente).toHaveBeenCalledWith('podesubir');
  });

  it('o cliente com filhos é anunciado como "ver projetos" (o "›" é decorativo)', () => {
    render(<ClienteList {...navProps()} />);
    expect(screen.getByRole('button', { name: 'podesubir, ver projetos' })).toBeTruthy();
  });
});

describe('ClienteList — nível Projetos', () => {
  it('mostra "← Clientes" (44px, largura toda), o rótulo CLIENTE · PROJETOS e as linhas na ordem', () => {
    render(<ClienteList {...inPodesubir()} />);
    const back = screen.getByRole('button', { name: 'Voltar para Clientes' });
    expect(back.textContent).toBe('←Clientes');
    expect(back.style.minHeight).toBe('var(--touch-target, 44px)');
    expect(back.style.width).toBe('100%');
    expect(screen.getByText('podesubir · Projetos')).toBeTruthy();
    expect(rowTitles()).toEqual([
      'Todos os projetos',
      'Raiz',
      'api-pagamentos',
      'app-mobile',
      'site-institucional',
    ]);
    // O rótulo de seção "Clientes" do nível de cima não aparece aqui — o
    // único "Clientes" na tela é o do próprio botão de voltar.
    expect(screen.getAllByText('Clientes')).toHaveLength(1);
    expect(back.contains(screen.getByText('Clientes'))).toBe(true);
  });

  it('"Raiz" só aparece quando a pasta do cliente é elegível para chat', () => {
    render(<ClienteList {...navProps({ selectedClienteId: 'agrupadora', level: 'projetos', parentId: 'agrupadora' })} />);
    expect(rowTitles()).toEqual(['Todos os projetos', 'a']);
  });

  it('"← Clientes" chama onBack', () => {
    const props = inPodesubir();
    render(<ClienteList {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Clientes' }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it('"Todos os projetos" seleciona o cliente inteiro (null); "Raiz" seleciona o próprio cliente; folha seleciona o projeto', () => {
    const props = inPodesubir();
    render(<ClienteList {...props} />);
    fireEvent.click(screen.getByText('Todos os projetos'));
    fireEvent.click(screen.getByText('Raiz'));
    fireEvent.click(screen.getByText('site-institucional'));
    expect(props.onSelectProjeto.mock.calls).toEqual([[null], ['podesubir'], ['podesubir/site-institucional']]);
    expect(props.onEnterProjeto).not.toHaveBeenCalled();
  });

  it('projeto COM filhos mostra "›" e entra mais um nível (onEnterProjeto)', () => {
    const props = inPodesubir();
    render(<ClienteList {...props} />);
    expect(screen.getByTitle('api-pagamentos').textContent).toBe('api-pagamentos›');
    fireEvent.click(screen.getByText('api-pagamentos'));
    expect(props.onEnterProjeto).toHaveBeenCalledWith('podesubir/api-pagamentos');
    expect(props.onSelectProjeto).not.toHaveBeenCalled();
  });

  it('destaque: "Todos os projetos" sem projeto; a linha do projeto escolhido; o ancestral de uma seleção mais funda', () => {
    const { rerender } = render(<ClienteList {...inPodesubir()} />);
    expect(screen.getByTitle('Todos os projetos').getAttribute('aria-current')).toBe('true');

    rerender(<ClienteList {...inPodesubir({ selectedProjetoId: 'podesubir/site-institucional' })} />);
    expect(screen.getByTitle('Todos os projetos').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTitle('site-institucional').style.background).toBe('var(--v2-surface-2)');

    rerender(<ClienteList {...inPodesubir({ selectedProjetoId: 'podesubir/api-pagamentos/v2' })} />);
    expect(screen.getByTitle('api-pagamentos').getAttribute('aria-current')).toBe('true');

    rerender(<ClienteList {...inPodesubir({ selectedProjetoId: 'podesubir' })} />);
    expect(screen.getByTitle('Raiz').getAttribute('aria-current')).toBe('true');
  });

  it('nível 3: o voltar nomeia o pai, o rótulo nomeia o projeto listado, sem "Raiz"', () => {
    const props = inPodesubir({ parentId: 'podesubir/api-pagamentos', selectedProjetoId: 'podesubir/api-pagamentos' });
    render(<ClienteList {...props} />);
    expect(screen.getByRole('button', { name: 'Voltar para podesubir' })).toBeTruthy();
    expect(screen.getByText('api-pagamentos · Projetos')).toBeTruthy();
    expect(rowTitles()).toEqual(['Todos os projetos', 'v1', 'v2']);
    expect(screen.getByTitle('Todos os projetos').getAttribute('aria-current')).toBe('true');

    // "Todos os projetos" aqui = a subárvore do projeto listado.
    fireEvent.click(screen.getByText('Todos os projetos'));
    expect(props.onSelectProjeto).toHaveBeenCalledWith('podesubir/api-pagamentos');
  });
});

describe('ClienteList — nível Projetos recolhido (68px)', () => {
  it('"←" no topo e avatares (✱ Todos os projetos, ⌂ Raiz, inicial por projeto) com o nome no title', () => {
    const props = inPodesubir({ collapsed: true });
    render(<ClienteList {...props} />);
    const back = screen.getByTitle('Voltar para Clientes');
    expect(back.textContent).toBe('←');
    expect(screen.queryByText('podesubir · Projetos')).toBeNull();
    expect(screen.getByTitle('Todos os projetos').textContent).toBe('✱');
    expect(screen.getByTitle('Raiz').textContent).toBe('⌂');
    expect(screen.getByTitle('site-institucional').textContent).toBe('S');
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(5);

    fireEvent.click(back);
    fireEvent.click(screen.getByTitle('api-pagamentos'));
    fireEvent.click(screen.getByTitle('app-mobile'));
    expect(props.onBack).toHaveBeenCalled();
    expect(props.onEnterProjeto).toHaveBeenCalledWith('podesubir/api-pagamentos');
    expect(props.onSelectProjeto).toHaveBeenCalledWith('podesubir/app-mobile');
  });

  it('recolhida no nível Clientes: cliente com filhos também entra ao tocar no avatar', () => {
    const props = navProps({ collapsed: true });
    render(<ClienteList {...props} />);
    fireEvent.click(screen.getByTitle('podesubir'));
    expect(props.onEnterCliente).toHaveBeenCalledWith('podesubir');
  });
});

describe('ClienteList — variante mobile', () => {
  it('linhas e botão de voltar com 54px', () => {
    render(<ClienteList {...inPodesubir({ variant: 'mobile' })} />);
    expect(screen.getByRole('button', { name: 'Voltar para Clientes' }).style.minHeight).toBe('54px');
    expect(screen.getByTitle('site-institucional').style.minHeight).toBe('54px');
    expect(document.querySelectorAll('.v2-cliente-avatar')).toHaveLength(0);
  });
});

// Harness com o hook real: prova o ciclo inteiro (entrar, descer, voltar) e
// o que só aparece entre renders — animação por direção e foco depois de
// navegar pelo teclado.
function Harness({ onScope }) {
  const nav = useNavScope(TREE);
  onScope?.(nav);
  return (
    <ClienteList
      clientes={TREE_CLIENTES}
      projects={TREE}
      selectedClienteId={nav.clienteId}
      selectedProjetoId={nav.projetoId}
      level={nav.level}
      parentId={nav.parentId}
      onSelectCliente={nav.selectCliente}
      onEnterCliente={nav.enterCliente}
      onSelectProjeto={nav.selectProjeto}
      onEnterProjeto={nav.enterProjeto}
      onBack={nav.back}
    />
  );
}

describe('ClienteList + useNavScope — ciclo completo', () => {
  beforeEach(() => localStorage.clear());

  it('Clientes → Projetos → subprojetos → voltar → voltar', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('podesubir'));
    expect(screen.getByText('podesubir · Projetos')).toBeTruthy();

    fireEvent.click(screen.getByText('api-pagamentos'));
    expect(screen.getByText('api-pagamentos · Projetos')).toBeTruthy();
    fireEvent.click(screen.getByText('v2'));
    expect(screen.getByTitle('v2').getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para podesubir' }));
    expect(screen.getByText('podesubir · Projetos')).toBeTruthy();
    expect(screen.getByTitle('api-pagamentos').getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Clientes' }));
    expect(screen.getByText('Clientes')).toBeTruthy();
    // Voltar é só navegação: o cliente continua selecionado.
    expect(screen.getByTitle('podesubir').getAttribute('aria-current')).toBe('true');
  });

  it('anima para a frente ao entrar e para trás ao voltar, e não anima no primeiro render', () => {
    render(<Harness />);
    const listOf = () => document.querySelector('[data-nav-id]').parentElement;
    expect(listOf().className).toBe('');

    fireEvent.click(screen.getByText('podesubir'));
    expect(listOf().className).toBe('v2-nav-level-enter-forward');

    // Um re-render no mesmo nível (trocar a seleção) não tira a classe.
    fireEvent.click(screen.getByText('app-mobile'));
    expect(listOf().className).toBe('v2-nav-level-enter-forward');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Clientes' }));
    expect(listOf().className).toBe('v2-nav-level-enter-back');
  });

  it('pelo teclado: entrar leva o foco ao botão de voltar; voltar devolve o foco à linha de onde se veio', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByTitle('podesubir'), { key: 'Enter' });
    const back = screen.getByRole('button', { name: 'Voltar para Clientes' });
    expect(document.activeElement).toBe(back);

    fireEvent.keyDown(back, { key: 'Enter' });
    fireEvent.click(back);
    expect(document.activeElement).toBe(screen.getByTitle('podesubir'));
  });

  it('pelo toque, a navegação não move o foco', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('podesubir'));
    expect(document.activeElement).toBe(document.body);
  });
});
