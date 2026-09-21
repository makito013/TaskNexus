// frontend/src/layouts/v2/BoardV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): cobre a apresentação
// v2 do Board — 4 colunas fixas por status (não por projeto), reaproveitando
// useCards tal como está (mockado aqui).
//
// Fase atual (cascata Cliente -> Projeto): a filtragem passou a sair de
// `useClienteProjetoFilter` (estado local desta tela) em vez de um cálculo
// inline, e a agregação é por PREFIXO de id (subárvore inteira), não mais por
// `sub_projetos` (só filhos diretos). Por isso as fixtures precisam declarar
// uma entrada de Project para CADA descendente — declarar só `sub_projetos`
// no pai não basta mais.
//
// The `selectedProjectId` prop is gone: card creation no longer takes a
// target from a prop, it comes from the CardFormModal's own payload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';
import { BoardV2 } from './BoardV2.jsx';

const mockUseCards = vi.fn();
vi.mock('../../hooks/useCards.js', () => ({
  useCards: (...args) => mockUseCards(...args),
}));

// `useColumns` is mocked at the HOOK level, the same way `useCards` already is
// in this file — not at the `api.*` level. These tests assert synchronously
// right after `render`, and a stubbed fetch would only resolve on a later tick,
// turning every `getByTestId('board-v2-col-…')` in this file into a `findBy`.
// The default stub returns the four legacy columns already loaded, so the
// pre-existing tests keep describing the same board they always did.
const mockUseColumns = vi.fn();
vi.mock('../../hooks/useColumns.js', () => ({
  useColumns: (...args) => mockUseColumns(...args),
}));

// dnd-kit's DndContext is replaced by a PASSTHROUGH that renders its children
// unchanged and records the drag callbacks, so a test can invoke `onDragEnd`
// with a synthetic `{active, over}`.
//
// This is a test SEAM, not a reimplementation of the library: no sensor,
// collision or transform behaviour is faked, and nothing here asserts anything
// about dnd-kit. It exists because a real drag CANNOT be simulated in jsdom —
// the sensors need pointer capture and real `getBoundingClientRect` values,
// and jsdom has neither (every rect is zeros). Driving the gesture would test
// jsdom's limitations, not our ordering.
//
// The ordering itself is covered directly in utils/boardColumnOrder.test.js,
// and the optimistic-apply/rollback pair in hooks/useColumns.test.js. What is
// left for THIS file is the wiring: does the drop hand the right slug list to
// the right action?
const dragHandlers = {};
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }) => {
      dragHandlers.onDragStart = onDragStart;
      dragHandlers.onDragEnd = onDragEnd;
      dragHandlers.onDragCancel = onDragCancel;
      return children;
    },
    DragOverlay: ({ children }) => children ?? null,
  };
});

// A drop of `activeSlug` onto `overSlug`. `overSlug` null = released outside
// any column, which is what dnd-kit reports for a drag abandoned off-board.
function drop(activeSlug, overSlug) {
  return dragHandlers.onDragEnd({
    active: { id: activeSlug },
    over: overSlug == null ? null : { id: overSlug },
  });
}

const LEGACY_COLUMNS = [
  { slug: 'a_fazer', label: 'A Fazer', position: 1, is_done: false },
  { slug: 'em_andamento', label: 'Em Andamento', position: 2, is_done: false },
  { slug: 'em_revisao', label: 'Em Revisão', position: 3, is_done: false },
  { slug: 'feito', label: 'Feito', position: 4, is_done: true },
];

function mockColumns(columns = LEGACY_COLUMNS, overrides = {}) {
  const doneColumn = columns.find((c) => c.is_done);
  const actions = {
    columns,
    loading: false,
    doneSlug: doneColumn ? doneColumn.slug : null,
    firstSlug: columns.length ? columns[0].slug : null,
    createColumn: vi.fn().mockResolvedValue({}),
    renameColumn: vi.fn().mockResolvedValue({}),
    reorderColumns: vi.fn().mockResolvedValue(columns),
    setDoneColumn: vi.fn().mockResolvedValue(columns),
    deleteColumn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  mockUseColumns.mockReturnValue(actions);
  return actions;
}

beforeEach(() => { mockColumns(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projects = [{ id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [], sub_projetos: [] }];

// Cliente com 2 subprojetos diretos — cada um com sua PRÓPRIA entrada de
// Project, como o backend realmente devolve (scan_projects lista todos os
// projetos, e `sub_projetos` é só o índice de filhos diretos de cada um).
const clienteWithSubs = {
  id: 'clienteB',
  nome: 'Cliente B',
  path: '/tmp/b',
  agentes: [],
  sub_projetos: ['clienteB/sub1', 'clienteB/sub2'],
};
const clienteWithSubsProjects = [
  clienteWithSubs,
  { id: 'clienteB/sub1', nome: 'Sub 1', path: '/tmp/b/sub1', agentes: [], sub_projetos: [] },
  { id: 'clienteB/sub2', nome: 'Sub 2', path: '/tmp/b/sub2', agentes: [], sub_projetos: [] },
];

// Hierarquia de 3 níveis: cliente -> projeto -> neto.
const deepProjects = [
  { id: 'clienteC', nome: 'Cliente C', path: '/tmp/c', agentes: [], sub_projetos: ['clienteC/proj'] },
  { id: 'clienteC/proj', nome: 'Projeto C', path: '/tmp/c/p', agentes: [], sub_projetos: ['clienteC/proj/neto'] },
  { id: 'clienteC/proj/neto', nome: 'Neto C', path: '/tmp/c/p/n', agentes: [], sub_projetos: [] },
];

function fakeCard(overrides = {}) {
  return {
    id: 1,
    titulo: 'Card 1',
    descricao: 'Descrição do card',
    projeto_id: 'projA',
    status: 'a_fazer',
    ultima_atualizacao_por: 'agente:claude',
    ...overrides,
  };
}

function mockNoCards() {
  mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
}

// Última chamada de useCards, ordenada — a ordem do array depende da ordem de
// `projects`, que não é o que estes testes querem afirmar.
function lastFetchedProjectIds() {
  const calls = mockUseCards.mock.calls;
  return [...calls[calls.length - 1][0]].sort();
}

// EVERY filter useCards was called with from `fromIndex` on. `lastFetched…`
// above only sees the final call, which hides a filter that was wrong for a
// single render and then corrected by an effect — exactly the shape of the
// cross-client leak the `rootId` guard in useClienteProjetoFilter.js exists to
// prevent. Assertions about "never leaked" must read this, not the last call.
function fetchedProjectIdCallsSince(fromIndex) {
  return mockUseCards.mock.calls.slice(fromIndex).map(([ids]) => ids);
}

describe('BoardV2 — 4 colunas fixas por status', () => {
  it('renders one column per status with the right card in each', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, status: 'a_fazer' }), fakeCard({ id: 2, status: 'feito', titulo: 'Card 2' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });

    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-col-a_fazer')).toBeTruthy();
    expect(screen.getByTestId('board-v2-col-feito')).toBeTruthy();
    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Card 1');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Card 2');
  });

  it('moving a card calls updateCard with the new status', () => {
    const updateCard = vi.fn();
    mockUseCards.mockReturnValue({ cards: [fakeCard()], createCard: vi.fn(), updateCard });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.change(screen.getByLabelText('Mover "Card 1"'), { target: { value: 'feito' } });
    expect(updateCard).toHaveBeenCalledWith(1, { status: 'feito' });
  });

  it('"+ Adicionar card" opens the modal in create mode with that column\'s status pre-selected', async () => {
    const createCard = vi.fn().mockResolvedValue({});
    mockUseCards.mockReturnValue({ cards: [], createCard, updateCard: vi.fn() });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    const column = screen.getByTestId('board-v2-col-em_andamento');
    fireEvent.click(within(column).getByText('+ Adicionar card'));

    expect(screen.getByText('Novo Card')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo card' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(createCard).toHaveBeenCalled());
    // The target now comes from the modal's own payload, not from a prop.
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Novo card',
      status: 'em_andamento',
      cliente_id: 'clienteB',
    }));
  });

  it('shows "+ Adicionar card" even with no client selected — the old blocker is gone', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId={null} />);
    expect(screen.getAllByText('+ Adicionar card').length).toBe(4);
    expect(screen.queryByText('Selecione um projeto na barra lateral para adicionar cards.')).toBeNull();
  });

  it('opens the create modal on the ACTIVE filter, not on stale defaults from the first opening', async () => {
    // Regression guard for the lazy-useState freeze: BoardV2 must mount the
    // modal conditionally, so reopening it after the filter changed rebuilds
    // the defaults. Mounting it permanently with open={false} fails here.
    mockNoCards();
    const bothClients = [...projects, ...clienteWithSubsProjects];
    const { rerender } = render(
      <BoardV2 projects={bothClients} selectedClienteId="clienteB" />
    );

    fireEvent.click(screen.getAllByText('+ Adicionar card')[0]);
    expect(screen.getByLabelText('Cliente').value).toBe('clienteB');
    fireEvent.click(screen.getByLabelText('Fechar'));

    rerender(<BoardV2 projects={bothClients} selectedClienteId="projA" />);
    fireEvent.click(screen.getAllByText('+ Adicionar card')[0]);

    await waitFor(() => expect(screen.getByLabelText('Cliente').value).toBe('projA'));
  });
});

describe('BoardV2 — id, tipo e prazo no rosto do card', () => {
  it('shows the copyable card id', () => {
    mockUseCards.mockReturnValue({ cards: [fakeCard({ id: 128 })], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const card = screen.getByTestId('board-v2-card-128');
    expect(within(card).getByText('#128')).toBeTruthy();
    expect(within(card).getByLabelText('Copiar ID 128')).toBeTruthy();
  });

  it('renders the tipo chip when the card has a tipo, and NO chip when it does not', () => {
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, tipo: 'bug', titulo: 'Com tipo' }),
        fakeCard({ id: 2, tipo: null, titulo: 'Sem tipo' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(within(screen.getByTestId('board-v2-card-1')).getByText('BUG')).toBeTruthy();
    const untyped = screen.getByTestId('board-v2-card-2');
    for (const label of ['BUG', 'HOTFIX', 'HISTÓRIA']) {
      expect(within(untyped).queryByText(label)).toBeNull();
    }
  });

  it('renders the prazo, and only marks it late when the card is not done', () => {
    // jsdom cannot read the rendered colour (css: false), so the assertion is
    // on the inline style property the component actually sets.
    const past = '2020-01-01';
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, prazo: past, status: 'a_fazer', titulo: 'Atrasado' }),
        fakeCard({ id: 2, prazo: past, status: 'feito', titulo: 'Entregue' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const late = within(screen.getByTestId('board-v2-card-1')).getByText('1 jan 2020');
    expect(late.style.color).toBe('var(--v2-danger)');

    const done = within(screen.getByTestId('board-v2-card-2')).getByText('1 jan 2020');
    expect(done.style.color).toBe('var(--v2-text-faint)');
  });

  it('renders no prazo text when the card has none', () => {
    mockUseCards.mockReturnValue({ cards: [fakeCard({ id: 1, prazo: null })], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-card-1').textContent).not.toMatch(/\d{1,2} [a-z]{3}/);
  });
});

describe('BoardV2 — agregação de cards por CLIENTE (selectedClienteId, desacoplado do chat ativo)', () => {
  it('with no client selected ("Todos"), fetches cards for all projects — useCards([])', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId={null} />);
    expect(mockUseCards).toHaveBeenCalledWith([], 'feito');
  });

  // Órfãos (decisão do Bruno, sessão "card/tarefa órfão"): com QUALQUER
  // cliente fixo e o Tier 2 em "Todos os projetos", a query deixa de ser
  // escopada a `selectedProjectIds` (que só lista nós REAIS de `projects`) e
  // passa a buscar TUDO — useCards([]) — pra não deixar de fora um card cujo
  // projeto foi removido/é desconhecido. A restrição ao cliente agora é
  // responsabilidade da EXIBIÇÃO (filtro client-side), testada nos próximos
  // 3 testes.
  it('with any client fixed and Tier 2 on "Todos os projetos", fetches ALL cards (useCards([])) instead of a scoped query', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    expect(mockUseCards).toHaveBeenLastCalledWith([], 'feito');
  });

  it('with a client that has subprojects selected, still fetches everything (Tier 2 stays "Todos")', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('rolls a grandchild card up to its top-level client at the DISPLAY level, 3-level hierarchy', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 9, projeto_id: 'clienteC/proj/neto', titulo: 'Card do neto' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={deepProjects} selectedClienteId="clienteC" />);
    expect(lastFetchedProjectIds()).toEqual([]);
    expect(screen.getByTestId('board-v2-card-9').textContent).toContain('Card do neto');
  });

  it('never leaks another client\'s card into the DISPLAY, even before the project list has loaded', () => {
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, projeto_id: 'clienteB', titulo: 'Card Cliente B' }),
        fakeCard({ id: 2, projeto_id: 'clienteZ', titulo: 'Card Cliente Z' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    // `projects` ainda não resolveu (array vazio) — o filtro de exibição é
    // por PREFIXO puro (clienteIdFromProjetoId), não depende de `projects`
    // estar carregado pra não vazar o card do outro cliente.
    render(<BoardV2 projects={[]} selectedClienteId="clienteB" />);
    expect(screen.getByText('Card Cliente B')).toBeTruthy();
    expect(screen.queryByText('Card Cliente Z')).toBeNull();
  });
});

// Mesma decisão do Bruno já testada do lado de Tarefas
// (TarefasV2.test.jsx, describe "tarefa órfã sob um cliente específico"),
// agora do lado do Board.
describe('BoardV2 — card órfão sob um cliente específico', () => {
  it('keeps an orphan sub-project card visible under a specific client while Tier 2 is on "Todos os projetos"', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, titulo: 'Card órfão', projeto_id: 'clienteB/removido' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);
    expect(screen.getByText('Card órfão')).toBeTruthy();
  });

  it('drops the orphan card only once Tier 2 narrows to a specific real project', () => {
    const orphanCard = fakeCard({ id: 1, titulo: 'Card órfão', projeto_id: 'clienteB/removido' });
    // useCards está inteiramente mockado — simula aqui o que o BACKEND real
    // faria: uma query ESCOPADA (ids não-vazio) nunca devolve um projeto que
    // não está entre os ids pedidos; só a query "sem filtro" (ids == [])
    // traria o card órfão junto.
    mockUseCards.mockImplementation((ids) => ({
      cards: ids.length === 0 ? [orphanCard] : [],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    }));
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);
    expect(screen.getByText('Card órfão')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteB/sub1' } });

    expect(screen.queryByText('Card órfão')).toBeNull();
  });
});

describe('BoardV2 — cascata de filtro (selects locais de Cliente e Projeto)', () => {
  it('shows only the project select when the sidebar already fixed a client', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    expect(screen.queryByLabelText('Filtrar por cliente')).toBeNull();
    expect(screen.getByLabelText('Filtrar por projeto')).toBeTruthy();
  });

  it('hides the project select ONLY when the sidebar fixed a client that has no subprojects', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    expect(screen.queryByLabelText('Filtrar por projeto')).toBeNull();
  });

  it('shows both selects as soon as the board opens in "Todos", with the project one disabled until a client is picked', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente')).toBeTruthy();
    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(true);
    // Sem cliente escolhido não há lista de projetos a oferecer ainda.
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os projetos']);
  });

  it('enables the project select once a client with subprojects is picked in "Todos"', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(false);
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos os projetos',
      'Sub 1',
      'Sub 2',
    ]);
    // Tier 2 ainda em "Todos os projetos" — a query busca tudo (órfãos
    // incluídos); ver describe "agregação de cards por CLIENTE" acima.
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('keeps the project select visible, with no options beyond "Todos os projetos", for a client without subprojects picked in "Todos"', () => {
    mockNoCards();
    render(<BoardV2 projects={[...projects, ...clienteWithSubsProjects]} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'projA' } });

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect).toBeTruthy();
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os projetos']);
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('going back to "Todos os clientes" in the local select fetches every project again', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    const clienteSelect = screen.getByLabelText('Filtrar por cliente');
    fireEvent.change(clienteSelect, { target: { value: 'clienteB' } });
    fireEvent.change(clienteSelect, { target: { value: '' } });

    expect(mockUseCards).toHaveBeenLastCalledWith([], 'feito');
  });

  it('the project select lists only DIRECT children, but filtering by one of them reaches its whole subtree (shallow dropdown, deep result)', () => {
    mockNoCards();
    render(<BoardV2 projects={deepProjects} selectedClienteId="clienteC" />);

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    // Só o filho direto aparece no dropdown — o neto não.
    expect(within(projetoSelect).getByText('Projeto C')).toBeTruthy();
    expect(within(projetoSelect).queryByText('Neto C')).toBeNull();

    fireEvent.change(projetoSelect, { target: { value: 'clienteC/proj' } });

    // ...mas o filtro por trás traz o neto junto (subárvore inteira do projeto
    // escolhido — e nada acima dele, ver o teste de cards cliente-only abaixo).
    expect(lastFetchedProjectIds()).toContain('clienteC/proj/neto');
  });

  it('drops client-only cards when a specific project is selected — the filter narrows to that subtree only', () => {
    mockNoCards();
    render(<BoardV2 projects={deepProjects} selectedClienteId="clienteC" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    // No 'clienteC' in the list: a card attached straight to the client, with
    // no specific project, is out of scope once a project is picked.
    expect(lastFetchedProjectIds()).toEqual(['clienteC/proj', 'clienteC/proj/neto']);
  });

  it('resets the selected project when the effective client changes', () => {
    mockNoCards();
    const { rerender } = render(
      <BoardV2 projects={[...deepProjects, ...clienteWithSubsProjects]} selectedClienteId="clienteC" />
    );

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    rerender(
      <BoardV2 projects={[...deepProjects, ...clienteWithSubsProjects]} selectedClienteId="clienteB" />
    );

    // Nenhum resquício de clienteC no filtro, e o select volta pra "Todos os projetos".
    expect(screen.getByLabelText('Filtrar por projeto').value).toBe('');
    // Tier 2 voltou pra "Todos" junto com a troca de cliente — busca tudo de novo.
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('resets the local client pick when the sidebar leaves "Todos"', () => {
    mockNoCards();
    const allProjects = [...clienteWithSubsProjects, ...deepProjects];
    const { rerender } = render(
      <BoardV2 projects={allProjects} selectedClienteId={null} />
    );

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });
    rerender(<BoardV2 projects={allProjects} selectedClienteId="clienteC" />);
    // Sidebar volta pra "Todos": a escolha local anterior não pode ressuscitar.
    rerender(<BoardV2 projects={allProjects} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente').value).toBe('');
    expect(mockUseCards).toHaveBeenLastCalledWith([], 'feito');
  });
});

// Casos de borda levantados pelo QA. O foco aqui é o que só aparece ENTRE
// renders (janelas de 1 render) e o que só aparece no fluxo completo — coisas
// que uma asserção sobre o estado final não consegue enxergar.
describe('BoardV2 — casos de borda do filtro (QA)', () => {
  const mixedProjects = [...deepProjects, ...clienteWithSubsProjects];

  // Regressão-alvo: a guarda `selectedProjetoId.startsWith(effectiveClienteId + '/')`
  // em useClienteProjetoFilter.js. Sem ela, o render em que o cliente muda
  // ainda usa o projeto do cliente ANTERIOR (o reset roda num useEffect, um
  // render depois) e useCards dispara um GET real pelos cards do outro
  // cliente. O efeito seguinte corrige o filtro, então a última chamada fica
  // correta e uma asserção sobre ela passa mesmo com a guarda removida.
  it('never queries another client\'s projects on the render where the sidebar client changes', () => {
    mockNoCards();
    const { rerender } = render(
      <BoardV2 projects={mixedProjects} selectedClienteId="clienteC" />
    );
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    const callsBefore = mockUseCards.mock.calls.length;
    rerender(<BoardV2 projects={mixedProjects} selectedClienteId="clienteB" />);

    const calls = fetchedProjectIdCallsSince(callsBefore);
    expect(calls.length).toBeGreaterThan(0);
    const foreign = calls.flat().filter((id) => id !== 'clienteB' && !id.startsWith('clienteB/'));
    expect(foreign).toEqual([]);
  });

  // Mesma guarda, pelo outro caminho de troca de cliente: o select local em
  // modo "Todos". Aqui cliente e projeto mudam dentro do MESMO evento.
  it('never queries another client\'s projects when the local client select switches clients in "Todos"', () => {
    mockNoCards();
    render(<BoardV2 projects={mixedProjects} selectedClienteId={null} />);

    const clienteSelect = screen.getByLabelText('Filtrar por cliente');
    fireEvent.change(clienteSelect, { target: { value: 'clienteC' } });
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    const callsBefore = mockUseCards.mock.calls.length;
    fireEvent.change(clienteSelect, { target: { value: 'clienteB' } });

    const calls = fetchedProjectIdCallsSince(callsBefore);
    expect(calls.length).toBeGreaterThan(0);
    const foreign = calls.flat().filter((id) => id !== 'clienteB' && !id.startsWith('clienteB/'));
    expect(foreign).toEqual([]);
  });

  // Órfãos (decisão do Bruno): a query agora é `[]` (sem filtro) de propósito
  // sempre que um cliente está fixo com Tier 2 em "Todos" — o invariante "não
  // vaza card de outro cliente" migrou da QUERY pra EXIBIÇÃO (filtro
  // client-side por `clienteIdFromProjetoId`), que não depende de `projects`
  // ter carregado. Cobre o mesmo cenário do teste antigo (render antes de
  // `projects` resolver, depois um rerender com a lista carregada), agora
  // checando a tela em vez dos argumentos da query.
  it('never leaks another client\'s card into the DISPLAY on any render, including before the project list has loaded', () => {
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, projeto_id: 'clienteB', titulo: 'Card Cliente B' }),
        fakeCard({ id: 2, projeto_id: 'clienteZ', titulo: 'Card Cliente Z' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    const { rerender } = render(
      <BoardV2 projects={[]} selectedClienteId="clienteB" />
    );
    expect(screen.getByText('Card Cliente B')).toBeTruthy();
    expect(screen.queryByText('Card Cliente Z')).toBeNull();

    rerender(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);
    expect(screen.getByText('Card Cliente B')).toBeTruthy();
    expect(screen.queryByText('Card Cliente Z')).toBeNull();
  });

  // Fluxo completo da hierarquia de 3 níveis, não só a fórmula isolada: abrir
  // em "Todos", escolher o cliente, escolher o projeto INTERMEDIÁRIO e ver o
  // card do NETO na tela, com as duas tags certas.
  it('shows a grandchild card when filtering by the intermediate project, picked through both selects', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 9, projeto_id: 'clienteC/proj/neto', titulo: 'Card do neto' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={deepProjects} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteC' } });
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    // Same rule as the "drops client-only cards" test above: the subtree of
    // the picked project, and only it.
    expect(lastFetchedProjectIds()).toEqual(['clienteC/proj', 'clienteC/proj/neto']);
    const card = screen.getByTestId('board-v2-card-9');
    expect(card.textContent).toContain('Card do neto');
    expect(card.textContent).toContain('Cliente C');
    expect(card.textContent).toContain('Neto C');
  });

  // Card antigo no banco apontando para um projeto que não existe mais no
  // disco: a tela não pode quebrar. Decisão do Bruno (sessão "card/tarefa
  // órfão"): NÃO mostra o id cru como se fosse nome — omite a tag de
  // cliente/projeto inteira, mostra só o card (título + avatar).
  it('renders a card whose projeto_id is unknown to the project list, showing no client/project tag at all', () => {
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 7, projeto_id: 'ghost/x', titulo: 'Card de projeto removido' }),
        fakeCard({ id: 8, projeto_id: 'ghost', titulo: 'Card de cliente removido' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId={null} />);

    const orphan = screen.getByTestId('board-v2-card-7');
    expect(orphan.textContent).toContain('Card de projeto removido');
    expect(within(orphan).queryByText('ghost')).toBeNull();
    expect(within(orphan).queryByText('ghost/x')).toBeNull();
    // The span COUNT is no longer the assertion: the card face gained an id
    // badge (its own spans) in this round. What must stay true is that no
    // client/project pill renders at all when the id does not resolve.
    expect(within(orphan).queryAllByTestId('card-tag')).toHaveLength(0);
    expect(orphan.textContent).not.toContain('ghost');

    const orphanClient = screen.getByTestId('board-v2-card-8');
    expect(within(orphanClient).queryByText('ghost')).toBeNull();
    expect(within(orphanClient).queryAllByTestId('card-tag')).toHaveLength(0);
    expect(orphanClient.textContent).not.toContain('ghost');
  });

  // 4ª combinação de visibilidade do select de Projeto (as outras 3 já estão
  // cobertas acima): sidebar fixando um cliente QUE TEM subprojetos — visível
  // e habilitado, não só presente.
  it('shows the project select enabled when the sidebar fixed a client that has subprojects', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(false);
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos os projetos',
      'Sub 1',
      'Sub 2',
    ]);
  });
});

// Fase 4 (épico "visualização global de cards presa ao agente aberto"): o
// título do card agora abre o CardFormModal (components/board/, componente
// real, não mockado) em modo 'edit'. Testes novos em inglês (convenção de
// nomenclatura da persona Dev) — os describes/its acima ficam em português
// por serem pré-existentes, não migrados nesta fase.
describe('BoardV2 - CardFormModal integration via the clickable card title', () => {
  function mockCardsWithActions(cards, overrides = {}) {
    const actions = {
      cards,
      createCard: vi.fn(),
      updateCard: vi.fn().mockResolvedValue({}),
      deleteCard: vi.fn().mockResolvedValue({}),
      uploadCardImage: vi.fn(),
      deleteCardImage: vi.fn(),
      ...overrides,
    };
    mockUseCards.mockReturnValue(actions);
    return actions;
  }

  it('opens the edit modal with the clicked card data', () => {
    mockCardsWithActions([fakeCard({ id: 1, titulo: 'Card 1' })]);
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('Card 1'));

    expect(screen.getByText('Editar Card')).toBeTruthy();
    expect(screen.getByLabelText('Título').value).toBe('Card 1');
  });

  it('submitting the form calls updateCard with the edited card id and the new payload', async () => {
    const { updateCard } = mockCardsWithActions([fakeCard({ id: 1, titulo: 'Card 1' })]);
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('Card 1'));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Card 1 edited' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(updateCard).toHaveBeenCalled());
    expect(updateCard).toHaveBeenCalledWith(1, expect.objectContaining({ titulo: 'Card 1 edited', id: 1 }));
  });

  it('deleting the card calls deleteCard and closes the modal', async () => {
    const { deleteCard } = mockCardsWithActions([fakeCard({ id: 1, titulo: 'Card 1' })]);
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('Card 1'));
    fireEvent.click(screen.getByText('Excluir'));

    await waitFor(() => expect(deleteCard).toHaveBeenCalledWith(1));
    expect(screen.queryByText('Editar Card')).toBeNull();
  });

  it('closing the modal without saving ("x" button) does not call updateCard', () => {
    const { updateCard } = mockCardsWithActions([fakeCard({ id: 1, titulo: 'Card 1' })]);
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('Card 1'));
    fireEvent.click(screen.getByLabelText('Fechar'));

    expect(screen.queryByText('Editar Card')).toBeNull();
    expect(updateCard).not.toHaveBeenCalled();
  });

  // QA edge case: `editingCardId` only stores the id, not a snapshot — the
  // edited card is derived via `cards.find(...)` on every render (see comment
  // above `editingCardId` in BoardV2.jsx). If the card disappears from
  // `cards` while the modal is open — deleted from another tab/session, or
  // dropped by the Cliente/Projeto display filter — `cards.find` returns
  // `undefined` and the `{editingCard && <CardFormModal ... />}` guard must
  // unmount the modal instead of handing `card={undefined}` to
  // CardFormModal (which dereferences `card.id`/`card.subcards` once
  // `isEdit` is true).
  it('closes the modal by itself, without crashing, if the card being edited disappears from the list', () => {
    const actions = mockCardsWithActions([fakeCard({ id: 1, titulo: 'Card 1' })]);
    const { rerender } = render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('Card 1'));
    expect(screen.getByText('Editar Card')).toBeTruthy();

    // Simulates the card vanishing from `cards` — e.g. deleted elsewhere, or
    // filtered out by a Cliente/Projeto change while the modal stays open.
    mockUseCards.mockReturnValue({ ...actions, cards: [] });
    expect(() => {
      rerender(<BoardV2 projects={projects} selectedClienteId="projA" />);
    }).not.toThrow();

    expect(screen.queryByText('Editar Card')).toBeNull();
  });

  it('binds image upload/delete to the card actually being edited, not a stale id from a previous modal', () => {
    const card1 = fakeCard({ id: 1, titulo: 'Card 1', imagens: [{ id: 'img-1', url: '/x/1.png' }] });
    const card2 = fakeCard({ id: 2, titulo: 'Card 2', imagens: [] });
    const { uploadCardImage, deleteCardImage } = mockCardsWithActions([card1, card2]);
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // Open card 1, delete its existing image — must go out bound to card 1's id.
    fireEvent.click(screen.getByText('Card 1'));
    fireEvent.click(screen.getByLabelText('Excluir imagem'));
    expect(deleteCardImage).toHaveBeenCalledWith(1, 'img-1');

    // Close and reopen on card 2 — the closure must now point at card 2, not
    // the previously edited card 1.
    fireEvent.click(screen.getByLabelText('Fechar'));
    fireEvent.click(screen.getByText('Card 2'));

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const fileInput = screen.getByTestId('image-attachments-input-2');
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(uploadCardImage).toHaveBeenCalledWith(2, file);
  });
});

// "Limpar concluídos" — ported from the deleted v1 board, which was its only
// surface. Divergence D-5 of the plan: the button does NOT live inside
// `ClienteProjetoFilterBar`. That bar returns `null` whenever the sidebar
// fixed a client with no subprojects — exactly the case where clearing is most
// useful — and it is shared with TarefasV2, where a card action makes no
// sense. It lives in BoardV2's own header row instead, and the test named for
// the null case below is what keeps someone from "simplifying" that back.
describe('BoardV2 - clear finished cards', () => {
  function mockCardsWithClear(cards = [], overrides = {}) {
    const actions = {
      cards,
      createCard: vi.fn(),
      updateCard: vi.fn(),
      previewClearFinished: vi.fn().mockResolvedValue({ cards: 3, imagens: 2 }),
      clearFinished: vi.fn().mockResolvedValue({ cards: 3, imagens: 2 }),
      ...overrides,
    };
    mockUseCards.mockReturnValue(actions);
    return actions;
  }

  it('disables the button, with an explanatory title, while no client or project is selected', () => {
    mockCardsWithClear();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    const button = screen.getByText('Limpar concluídos');
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Selecione um cliente ou projeto para limpar concluídos');
  });

  it('still renders the button for a fixed client WITHOUT subprojects, where the filter bar renders nothing at all', () => {
    mockCardsWithClear();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // The shared bar is genuinely absent here — that is the whole point.
    expect(screen.queryByTestId('cliente-projeto-filter-bar')).toBeNull();
    expect(screen.getByText('Limpar concluídos').disabled).toBe(false);
  });

  it('opens the sheet on the client tier when no specific project is picked', async () => {
    const { previewClearFinished } = mockCardsWithClear();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    fireEvent.click(screen.getByText('Limpar concluídos'));

    await waitFor(() => expect(previewClearFinished).toHaveBeenCalledWith('clienteB'));
    expect(screen.getByRole('dialog', { name: 'Limpar concluídos — Cliente B' })).toBeTruthy();
  });

  it('targets the most specific tier: the Tier 2 project once one is picked', async () => {
    const { previewClearFinished } = mockCardsWithClear();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteB/sub1' } });
    fireEvent.click(screen.getByText('Limpar concluídos'));

    await waitFor(() => expect(previewClearFinished).toHaveBeenCalledWith('clienteB/sub1'));
    expect(previewClearFinished).not.toHaveBeenCalledWith('clienteB');
  });

  it('confirming the sheet calls clearFinished with the same target and closes it', async () => {
    const { clearFinished } = mockCardsWithClear();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    fireEvent.click(screen.getByText('Limpar concluídos'));
    fireEvent.click(await screen.findByText('Apagar permanentemente'));

    await waitFor(() => expect(clearFinished).toHaveBeenCalledWith('clienteB'));
    await waitFor(() => expect(screen.queryByText('Apagar permanentemente')).toBeNull());
  });

  it('never titles the sheet "null" for a client the project list cannot resolve', async () => {
    mockCardsWithClear();
    // `projects` has no entry for 'clienteB' — resolveProjectName returns null
    // by design, and the raw id has to stand in inside a destructive dialog.
    render(<BoardV2 projects={[]} selectedClienteId="clienteB" />);

    fireEvent.click(screen.getByText('Limpar concluídos'));

    expect(await screen.findByRole('dialog', { name: 'Limpar concluídos — clienteB' })).toBeTruthy();
  });
});

describe('BoardV2 — tags de cliente e projeto no card', () => {
  it('shows the client tag on every card, including in "Todos"', () => {
    const multiProjects = [
      { id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [], sub_projetos: [] },
      { id: 'projB', nome: 'Projeto B', path: '/tmp/b', agentes: [], sub_projetos: [] },
    ];
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, projeto_id: 'projA', titulo: 'Card A' }),
        fakeCard({ id: 2, projeto_id: 'projB', titulo: 'Card B' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={multiProjects} selectedClienteId={null} />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Projeto A');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Projeto B');
  });

  it('keeps the client tag even when the selected client resolves to exactly 1 project', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, projeto_id: 'projA' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Projeto A');
  });

  it('does not repeat the name when the card belongs to the client itself (client-as-project)', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, projeto_id: 'clienteB', titulo: 'Card cliente-only' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    const card = screen.getByTestId('board-v2-card-1');
    expect(within(card).getAllByText('Cliente B')).toHaveLength(1);
  });

  it('shows both the client tag and the project tag when the card belongs to a subproject', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 2, projeto_id: 'clienteB/sub1', titulo: 'Card sub1' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    const card = screen.getByTestId('board-v2-card-2');
    expect(card.textContent).toContain('Cliente B');
    expect(card.textContent).toContain('Sub 1');
    // The project tag is the single `card-tag` pill; the client name rides in
    // the id badge, not in a tag.
    const tags = within(card).queryAllByTestId('card-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe('Sub 1');
  });

  it('renders no tag at all for a card with no projeto_id, never an empty pill', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 3, projeto_id: null, titulo: 'Card órfão' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId={null} />);

    const card = screen.getByTestId('board-v2-card-3');
    expect(card.textContent).toContain('Card órfão');
    // Same note as the orphan test above: assert on the absence of a tag, not
    // on a span count the id badge legitimately changed.
    expect(within(card).queryAllByTestId('card-tag')).toHaveLength(0);
    expect(within(card).queryByText('Projeto A')).toBeNull();
    expect(card.textContent).not.toContain('null');
  });
});


// Dynamic columns (task #43, phase 1). Everything below is new surface: the
// board no longer has four fixed statuses, and the column header is where
// creating, renaming, reordering, marking-done and deleting all happen.
describe('BoardV2 - dynamic columns', () => {
  it('renders one column per entry of useColumns, in board order', () => {
    mockColumns([
      { slug: 'backlog', label: 'Backlog', position: 1, is_done: false },
      { slug: 'entregue', label: 'Entregue', position: 2, is_done: true },
    ]);
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-col-backlog')).toBeTruthy();
    expect(screen.getByTestId('board-v2-col-entregue')).toBeTruthy();
    // The four legacy statuses are not hard-coded anywhere any more.
    expect(screen.queryByTestId('board-v2-col-a_fazer')).toBeNull();
  });

  it('renders no column scroller at all while the columns are loading', () => {
    mockColumns(LEGACY_COLUMNS, { loading: true, columns: [], doneSlug: null, firstSlug: null });
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // Painting an empty board with doneSlug=null for one frame would flash
    // every card as "not done" and strand the ghost column on its own.
    expect(screen.queryByTestId('board-v2-col-a_fazer')).toBeNull();
    expect(screen.queryByText('+ Nova coluna')).toBeNull();
  });

  it('populates the card status select from the columns, not from a fixed list', () => {
    mockColumns([
      { slug: 'backlog', label: 'Backlog', position: 1, is_done: false },
      { slug: 'entregue', label: 'Entregue', position: 2, is_done: true },
    ]);
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, status: 'backlog' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const select = screen.getByLabelText('Mover "Card 1"');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Backlog', 'Entregue']);
  });

  it('marks the done column with a "✓" badge and only that one', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const badges = screen.getAllByLabelText('Coluna concluída');
    expect(badges).toHaveLength(1);
    expect(within(screen.getByTestId('board-v2-col-feito')).getByLabelText('Coluna concluída')).toBeTruthy();
  });
});

describe('BoardV2 - creating a column through the ghost column', () => {
  it('turns the ghost into an input and creates the column on Enter', async () => {
    const { createColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('+ Nova coluna'));
    const input = screen.getByLabelText('Nome da nova coluna');
    fireEvent.change(input, { target: { value: 'Em Homologação' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(createColumn).toHaveBeenCalledWith('Em Homologação'));
  });

  it('creates the column on blur too', async () => {
    const { createColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('+ Nova coluna'));
    const input = screen.getByLabelText('Nome da nova coluna');
    fireEvent.change(input, { target: { value: 'Bloqueado' } });
    fireEvent.blur(input);

    await waitFor(() => expect(createColumn).toHaveBeenCalledWith('Bloqueado'));
  });

  it('creates nothing on Escape, and the draft does not survive to the next opening', async () => {
    const { createColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('+ Nova coluna'));
    const input = screen.getByLabelText('Nome da nova coluna');
    fireEvent.change(input, { target: { value: 'Descartada' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(createColumn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('+ Nova coluna'));
    expect(screen.getByLabelText('Nome da nova coluna').value).toBe('');
  });

  it('creates nothing for a blank name', () => {
    const { createColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('+ Nova coluna'));
    const input = screen.getByLabelText('Nome da nova coluna');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(createColumn).not.toHaveBeenCalled();
  });
});

describe('BoardV2 - renaming a column through the "⋯" menu', () => {
  function openRename() {
    fireEvent.click(screen.getByLabelText('Ações da coluna A Fazer'));
    fireEvent.click(screen.getByText('Renomear coluna'));
  }

  // Renaming left the column title when the whole header became the drag
  // surface: click-to-edit and click-and-drag cannot share the same pixels.
  it('no longer turns the title into an input when clicked', () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByText('A Fazer'));

    expect(screen.queryByLabelText('Novo nome da coluna')).toBeNull();
    expect(renameColumn).not.toHaveBeenCalled();
  });

  it('opens a dialog prefilled with the current label', () => {
    mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();

    expect(screen.getByRole('dialog', { name: 'Renomear coluna — A Fazer' })).toBeTruthy();
    expect(screen.getByLabelText('Novo nome da coluna').value).toBe('A Fazer');
  });

  it('focuses the input with the text selected, ready to be replaced', () => {
    mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();

    const input = screen.getByLabelText('Novo nome da coluna');
    expect(document.activeElement).toBe(input);
    // Same affordance the inline input had: typing replaces the whole name.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('A Fazer'.length);
  });

  it('renames on "Confirmar"', async () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Backlog' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() => expect(renameColumn).toHaveBeenCalledWith('a_fazer', 'Backlog'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames on Enter', async () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    const input = screen.getByLabelText('Novo nome da coluna');
    fireEvent.change(input, { target: { value: 'Backlog' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(renameColumn).toHaveBeenCalledWith('a_fazer', 'Backlog'));
  });

  it('trims surrounding whitespace before sending', async () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: '   Backlog   ' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() => expect(renameColumn).toHaveBeenCalledWith('a_fazer', 'Backlog'));
  });

  it('does not rename on "Cancelar"', () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Backlog' },
    });
    fireEvent.click(screen.getByText('Cancelar'));

    expect(renameColumn).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not rename on Escape', () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Backlog' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(renameColumn).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not call the API when the name is unchanged', () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.click(screen.getByText('Confirmar'));

    expect(renameColumn).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks confirming a blank name without a round-trip', () => {
    const { renameColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: '   ' },
    });

    expect(screen.getByText('Confirmar').disabled).toBe(true);
    fireEvent.click(screen.getByText('Confirmar'));
    expect(renameColumn).not.toHaveBeenCalled();
  });

  // The old inline input reverted silently on a duplicate name, so the user
  // retyped the same thing with no idea why it kept snapping back.
  it('shows the backend rejection INSIDE the dialog and keeps it open', async () => {
    const reject = vi.fn().mockRejectedValue(
      new Error("Já existe uma coluna chamada 'Feito'")
    );
    mockColumns(LEGACY_COLUMNS, { renameColumn: reject });
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Feito' },
    });
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Já existe/));
    // Still open, still holding what was typed — nothing to retype.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Novo nome da coluna').value).toBe('Feito');
  });

  // QA: the inline error is owned by BoardV2 and only cleared on the next
  // confirm, on close, and on open — never on typing. So after a rejection the
  // message keeps accusing a name the user has already edited away.
  // Characterisation: it is arguably the right call (keeping the reason visible
  // while you fix it beats a message that vanishes as you start typing), but it
  // is a choice nobody wrote down, so this pins it.
  it('keeps a rejection message visible while the user edits the name', async () => {
    const reject = vi.fn().mockRejectedValue(
      new Error("Já existe uma coluna chamada 'Feito'")
    );
    mockColumns(LEGACY_COLUMNS, { renameColumn: reject });
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openRename();
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Feito' },
    });
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // The user fixes the name — the stale accusation stays on screen.
    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: 'Concluído' },
    });

    expect(screen.getByRole('alert').textContent).toMatch(/Já existe/);
    expect(screen.getByLabelText('Novo nome da coluna').value).toBe('Concluído');
  });

  it('opens on the column whose menu was used, not a stale one', () => {
    mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByLabelText('Ações da coluna Em Revisão'));
    fireEvent.click(screen.getByText('Renomear coluna'));

    expect(screen.getByLabelText('Novo nome da coluna').value).toBe('Em Revisão');
  });
});


describe('BoardV2 - the column "⋯" menu', () => {
  function openMenu(columnLabel) {
    fireEvent.click(screen.getByLabelText(`Ações da coluna ${columnLabel}`));
  }

  it('marks a column as done from the menu', async () => {
    const { setDoneColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('A Fazer');
    fireEvent.click(screen.getByText('Marcar como concluída'));

    await waitFor(() => expect(setDoneColumn).toHaveBeenCalledWith('a_fazer'));
  });

  it('shows an informational line instead of the action on the done column itself', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('Feito');
    // Done is a radio, not a toggle: there is nothing to un-check here.
    expect(screen.getByText('✓ Esta é a coluna concluída')).toBeTruthy();
    expect(screen.queryByText('Marcar como concluída')).toBeNull();
  });

  it('closes on Escape', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('A Fazer');
    expect(screen.getByTestId('board-column-menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-column-menu')).toBeNull();
  });

  it('closes on a click outside', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('A Fazer');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('board-column-menu')).toBeNull();
  });

  it('is born disabled, with a tooltip, when there is only one column left', () => {
    mockColumns([{ slug: 'unica', label: 'Única', position: 1, is_done: true }]);
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('Única');
    const item = screen.getByText('Excluir coluna');
    expect(item.disabled).toBe(true);
    expect(item.title).toBe('O board precisa ter pelo menos uma coluna.');
  });

  // The component already knows `is_done` — sending the user through a
  // guaranteed 409 taught them nothing the menu could not say up front.
  it('is born disabled on the DONE column, without a round-trip to the 409', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('Feito');
    const item = screen.getByText('Excluir coluna');
    expect(item.disabled).toBe(true);
    expect(item.title).toMatch(/concluída não pode ser excluída/);
  });

  it('stays enabled on an ordinary column', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('A Fazer');
    const item = screen.getByText('Excluir coluna');
    expect(item.disabled).toBe(false);
    expect(item.title).toBeFalsy();
  });

  it('prefers the last-column message when a single column is also the done one', () => {
    mockColumns([{ slug: 'unica', label: 'Única', position: 1, is_done: true }]);
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    openMenu('Única');
    expect(screen.getByText('Excluir coluna').title)
      .toBe('O board precisa ter pelo menos uma coluna.');
  });
});

describe('BoardV2 - deleting a column', () => {
  function requestDelete(columnLabel) {
    fireEvent.click(screen.getByLabelText(`Ações da coluna ${columnLabel}`));
    fireEvent.click(screen.getByText('Excluir coluna'));
  }

  it('confirms and deletes an empty column', async () => {
    const { deleteColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    requestDelete('A Fazer');
    expect(screen.getByRole('dialog', { name: 'Excluir coluna — A Fazer' })).toBeTruthy();

    fireEvent.click(screen.getAllByText('Excluir coluna').slice(-1)[0]);
    await waitFor(() => expect(deleteColumn).toHaveBeenCalledWith('a_fazer'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('downgrades to the card-count dialog when the backend refuses, with no destructive button left', async () => {
    const refusal = Object.assign(new Error('A coluna ainda tem 3 card(s).'), {
      reason: 'coluna_com_cards', cards: 3,
    });
    mockColumns(LEGACY_COLUMNS, { deleteColumn: vi.fn().mockRejectedValue(refusal) });
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    requestDelete('A Fazer');
    fireEvent.click(screen.getAllByText('Excluir coluna').slice(-1)[0]);

    await waitFor(() => expect(screen.getByText(/3 card\(s\)/)).toBeTruthy());
    // Only "Cancelar" survives — offering a button that always fails is worse
    // than offering none.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Cancelar')).toBeTruthy();
    expect(within(dialog).queryByText('Excluir coluna')).toBeNull();
  });

  it('downgrades to the informational dialog, with "Entendi", for the done column', async () => {
    const refusal = Object.assign(new Error('A coluna concluída não pode ser excluída.'), {
      reason: 'coluna_concluida', cards: 0,
    });
    mockColumns(LEGACY_COLUMNS, { deleteColumn: vi.fn().mockRejectedValue(refusal) });
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    requestDelete('Em Andamento');
    fireEvent.click(screen.getAllByText('Excluir coluna').slice(-1)[0]);

    await waitFor(() => expect(screen.getByText('Entendi')).toBeTruthy());
    expect(within(screen.getByRole('dialog')).queryByText('Cancelar')).toBeNull();
  });

  it('closes without deleting when cancelled', () => {
    const { deleteColumn } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    requestDelete('A Fazer');
    fireEvent.click(screen.getByText('Cancelar'));

    expect(deleteColumn).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Fail-safe: a refusal code this build does not know must NOT degrade to the
  // destructive variant. It used to — the old test was "destructive unless the
  // reason is one of two known refusals", so a newer backend, a typo or a proxy
  // rewriting the body would re-offer a deletion the server had just refused.
  it('falls back to a SAFE variant for a reason it does not recognise', async () => {
    const refusal = Object.assign(new Error('Recusado por um motivo novo'), {
      reason: 'motivo_que_este_build_nao_conhece', cards: 0,
    });
    const { deleteColumn } = mockColumns(
      LEGACY_COLUMNS, { deleteColumn: vi.fn().mockRejectedValue(refusal) }
    );
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    requestDelete('A Fazer');
    fireEvent.click(screen.getAllByText('Excluir coluna').slice(-1)[0]);

    await waitFor(() => expect(
      screen.getByText(/Não foi possível excluir a coluna/)
    ).toBeTruthy());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Excluir coluna')).toBeNull();
    expect(within(dialog).getByText('Cancelar')).toBeTruthy();

    // And no second attempt is reachable from the dialog.
    expect(deleteColumn).toHaveBeenCalledTimes(1);
  });
});

describe('BoardV2 - doneSlug threading', () => {
  it('marks a card as late against the DONE COLUMN, not the literal "feito"', () => {
    mockColumns([
      { slug: 'feito', label: 'Feito', position: 1, is_done: false },
      { slug: 'entregue', label: 'Entregue', position: 2, is_done: true },
    ]);
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, prazo: '2020-01-01', status: 'feito', titulo: 'Em "Feito", mas nao concluido' }),
        fakeCard({ id: 2, prazo: '2020-01-01', status: 'entregue', titulo: 'Concluido de verdade' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // 'feito' lost the done mark, so a past deadline there IS late now.
    expect(within(screen.getByTestId('board-v2-card-1')).getByText('1 jan 2020').style.color)
      .toBe('var(--v2-danger)');
    expect(within(screen.getByTestId('board-v2-card-2')).getByText('1 jan 2020').style.color)
      .toBe('var(--v2-text-faint)');
  });

  it('hands the resolved doneSlug down to useCards', () => {
    mockColumns([
      { slug: 'backlog', label: 'Backlog', position: 1, is_done: false },
      { slug: 'entregue', label: 'Entregue', position: 2, is_done: true },
    ]);
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(mockUseCards).toHaveBeenLastCalledWith([], 'entregue');
  });
});


// Drag to reorder (task #43, phase 2). The arrows tested above are unchanged
// and still work — drag is an addition, not a replacement.
describe('BoardV2 - dragging a column to reorder', () => {
  // The whole header bar is the drag surface — no dedicated grip to aim at.
  it('makes every column header a drag surface', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    for (const slug of ['a_fazer', 'em_andamento', 'em_revisao', 'feito']) {
      const header = screen.getByTestId(`board-v2-col-header-${slug}`);
      expect(header.style.cursor).toBe('grab');
      expect(header.style.touchAction).toBe('none');
      // The old 28px grip is gone.
      expect(screen.queryByTestId(`board-v2-grip-${slug}`)).toBeNull();
    }
  });

  // The header carries the drag listeners, so this is the regression that
  // matters most: the controls INSIDE it must still take a plain click. The
  // sensors make that true without special handling — PointerSensor needs 6px
  // of travel, TouchSensor a 280ms hold, and a click crosses neither.
  // NOTE: "a click inside the drag surface still reaches the button" is NOT
  // testable in this file. The DndContext here is a passthrough mock, so
  // `useSortable` falls back to dnd-kit's default internal context, whose
  // `activators` list is EMPTY — the header ends up with no listeners at all
  // and a click trivially "works" because nothing is competing for it. That
  // assertion lives in BoardV2.dnd.test.jsx, with the real providers mounted
  // and a real pointerDown/pointerUp/click sequence.
  it('keeps the "⋯" menu openable from inside the drag surface', () => {
    mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    fireEvent.click(screen.getByLabelText('Ações da coluna A Fazer'));

    expect(screen.getByTestId('board-column-menu')).toBeTruthy();
  });

  it('sends the COMPLETE slug list, in the new order, on drop', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('feito', 'a_fazer'); });

    // The endpoint takes the whole board, not a moved pair.
    expect(reorderColumns).toHaveBeenCalledWith([
      'feito', 'a_fazer', 'em_andamento', 'em_revisao',
    ]);
  });

  it('moves a column rightwards, shifting the ones in between', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('a_fazer', 'em_revisao'); });

    expect(reorderColumns).toHaveBeenCalledWith([
      'em_andamento', 'em_revisao', 'a_fazer', 'feito',
    ]);
  });

  it('does nothing when a column is dropped on itself', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('a_fazer', 'a_fazer'); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('does nothing when a column is released outside any column', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('a_fazer', null); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('does nothing on a single-column board', async () => {
    const { reorderColumns } = mockColumns(
      [{ slug: 'unica', label: 'Única', position: 1, is_done: true }]
    );
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('unica', 'unica'); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('surfaces a refused reorder instead of failing silently', async () => {
    // The hook already rolled the order back; the alert only explains it.
    // There is no automatic retry in this phase — the rollback IS the recovery.
    const reject = vi.fn().mockRejectedValue(new Error('Falha ao reordenar colunas'));
    mockColumns(LEGACY_COLUMNS, { reorderColumns: reject });
    mockNoCards();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('feito', 'a_fazer'); });

    expect(reject).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/reordenar/i));
    alertSpy.mockRestore();
  });

  it('a cancelled drag never reaches the API', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    act(() => { dragHandlers.onDragStart({ active: { id: 'a_fazer' } }); });
    act(() => { dragHandlers.onDragCancel(); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  // QA: `over` can carry an id that is not a column of this board. Two ways in
  // normal use — another tab deleted the column while the finger was down, and
  // the ghost "+ Nova coluna" affordance sitting at the end of the same
  // scroller. Neither may produce a request.
  it('ignores a drop onto a column another tab deleted mid-drag', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('a_fazer', 'coluna_que_sumiu'); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('ignores a drag whose ACTIVE column another tab deleted mid-drag', async () => {
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('coluna_que_sumiu', 'a_fazer'); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('never treats the "+ Nova coluna" ghost as a drop target', async () => {
    // The ghost is a plain <button> in the same flex scroller, deliberately
    // left out of SortableContext's `items`, so dnd-kit cannot report it as
    // `over` in the first place. This pins the second line of defence: even if
    // it somehow arrived, an id that is not in the slug list is a no-op rather
    // than a column flung to an index of -1.
    const { reorderColumns } = mockColumns();
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('a_fazer', '__ghost_new_column__'); });

    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('drops against the CURRENT board, not a stale slug list', async () => {
    // A board the user already reordered once: the drop has to be computed
    // against what is on screen now.
    const { reorderColumns } = mockColumns([
      { slug: 'feito', label: 'Feito', position: 1, is_done: true },
      { slug: 'a_fazer', label: 'A Fazer', position: 2, is_done: false },
      { slug: 'em_andamento', label: 'Em Andamento', position: 3, is_done: false },
    ]);
    mockNoCards();
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    await act(async () => { await drop('em_andamento', 'feito'); });

    expect(reorderColumns).toHaveBeenCalledWith([
      'em_andamento', 'feito', 'a_fazer',
    ]);
  });
});
