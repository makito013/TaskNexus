// frontend/src/layouts/v2/BoardV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): cobre a apresentação
// v2 do Board — 4 colunas fixas por status (não por projeto), reaproveitando
// useCards tal como está (mockado aqui, mesmo padrão de App.test.jsx para
// BoardView.jsx v1).
//
// Fase atual (cascata Cliente -> Projeto): a filtragem passou a sair de
// `useClienteProjetoFilter` (estado local desta tela) em vez de um cálculo
// inline, e a agregação é por PREFIXO de id (subárvore inteira), não mais por
// `sub_projetos` (só filhos diretos). Por isso as fixtures precisam declarar
// uma entrada de Project para CADA descendente — declarar só `sub_projetos`
// no pai não basta mais.
//
// `selectedProjectId` (singular, prop) continua sendo testado separadamente,
// no único papel que tem: o fluxo de criação de card.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { BoardV2 } from './BoardV2.jsx';

const mockUseCards = vi.fn();
vi.mock('../../hooks/useCards.js', () => ({
  useCards: (...args) => mockUseCards(...args),
}));

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

    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-col-a_fazer')).toBeTruthy();
    expect(screen.getByTestId('board-v2-col-feito')).toBeTruthy();
    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Card 1');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Card 2');
  });

  it('moving a card calls updateCard with the new status', () => {
    const updateCard = vi.fn();
    mockUseCards.mockReturnValue({ cards: [fakeCard()], createCard: vi.fn(), updateCard });
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);

    fireEvent.change(screen.getByLabelText('Mover "Card 1"'), { target: { value: 'feito' } });
    expect(updateCard).toHaveBeenCalledWith(1, { status: 'feito' });
  });

  it('"+ Adicionar card" creates a card in that column\'s status for the chat\'s active project (selectedProjectId), not the aggregated client filter', async () => {
    const createCard = vi.fn().mockResolvedValue({});
    mockUseCards.mockReturnValue({ cards: [], createCard, updateCard: vi.fn() });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId="projA" selectedClienteId="clienteB" />);

    const column = screen.getByTestId('board-v2-col-a_fazer');
    fireEvent.click(within(column).getByText('+ Adicionar card'));

    fireEvent.change(within(column).getByPlaceholderText('Título do card'), { target: { value: 'Novo card' } });
    fireEvent.click(within(column).getByText('Adicionar'));

    await waitFor(() => expect(within(column).queryByText('Adicionar')).toBeNull()); // form fecha
    // projeto_id vem de selectedProjectId (chat ativo), não do cliente agregado na sidebar.
    expect(createCard).toHaveBeenCalledWith({ titulo: 'Novo card', projeto_id: 'projA', status: 'a_fazer' });
  });

  it('disables card creation with a hint when no chat project is selected (selectedProjectId)', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedProjectId={null} selectedClienteId="projA" />);
    expect(screen.queryByText('+ Adicionar card')).toBeNull();
    expect(screen.getAllByText('Selecione um projeto na barra lateral para adicionar cards.').length).toBeGreaterThan(0);
  });
});

describe('BoardV2 — agregação de cards por CLIENTE (selectedClienteId, desacoplado do chat ativo)', () => {
  it('with no client selected ("Todos"), fetches cards for all projects — useCards([])', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId={null} />);
    expect(mockUseCards).toHaveBeenCalledWith([]);
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
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);
    expect(mockUseCards).toHaveBeenLastCalledWith([]);
  });

  it('with a client that has subprojects selected, still fetches everything (Tier 2 stays "Todos")', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('rolls a grandchild card up to its top-level client at the DISPLAY level, 3-level hierarchy', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 9, projeto_id: 'clienteC/proj/neto', titulo: 'Card do neto' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={deepProjects} selectedProjectId={null} selectedClienteId="clienteC" />);
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
    render(<BoardV2 projects={[]} selectedProjectId={null} selectedClienteId="clienteB" />);
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
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);
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
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);
    expect(screen.getByText('Card órfão')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteB/sub1' } });

    expect(screen.queryByText('Card órfão')).toBeNull();
  });
});

describe('BoardV2 — cascata de filtro (selects locais de Cliente e Projeto)', () => {
  it('shows only the project select when the sidebar already fixed a client', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);

    expect(screen.queryByLabelText('Filtrar por cliente')).toBeNull();
    expect(screen.getByLabelText('Filtrar por projeto')).toBeTruthy();
  });

  it('hides the project select ONLY when the sidebar fixed a client that has no subprojects', () => {
    mockNoCards();
    render(<BoardV2 projects={projects} selectedProjectId={null} selectedClienteId="projA" />);
    expect(screen.queryByLabelText('Filtrar por projeto')).toBeNull();
  });

  it('shows both selects as soon as the board opens in "Todos", with the project one disabled until a client is picked', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente')).toBeTruthy();
    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(true);
    // Sem cliente escolhido não há lista de projetos a oferecer ainda.
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os projetos']);
  });

  it('enables the project select once a client with subprojects is picked in "Todos"', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId={null} />);

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
    render(<BoardV2 projects={[...projects, ...clienteWithSubsProjects]} selectedProjectId={null} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'projA' } });

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect).toBeTruthy();
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os projetos']);
    expect(lastFetchedProjectIds()).toEqual([]);
  });

  it('going back to "Todos os clientes" in the local select fetches every project again', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId={null} />);

    const clienteSelect = screen.getByLabelText('Filtrar por cliente');
    fireEvent.change(clienteSelect, { target: { value: 'clienteB' } });
    fireEvent.change(clienteSelect, { target: { value: '' } });

    expect(mockUseCards).toHaveBeenLastCalledWith([]);
  });

  it('the project select lists only DIRECT children, but filtering by one of them reaches its whole subtree (shallow dropdown, deep result)', () => {
    mockNoCards();
    render(<BoardV2 projects={deepProjects} selectedProjectId={null} selectedClienteId="clienteC" />);

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    // Só o filho direto aparece no dropdown — o neto não.
    expect(within(projetoSelect).getByText('Projeto C')).toBeTruthy();
    expect(within(projetoSelect).queryByText('Neto C')).toBeNull();

    fireEvent.change(projetoSelect, { target: { value: 'clienteC/proj' } });

    // ...mas o filtro por trás traz o neto junto.
    expect(lastFetchedProjectIds()).toContain('clienteC/proj/neto');
  });

  it('keeps client-only cards visible when a specific project is selected (definitive product behavior)', () => {
    mockNoCards();
    render(<BoardV2 projects={deepProjects} selectedProjectId={null} selectedClienteId="clienteC" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    expect(lastFetchedProjectIds()).toEqual(['clienteC', 'clienteC/proj', 'clienteC/proj/neto']);
  });

  it('resets the selected project when the effective client changes', () => {
    mockNoCards();
    const { rerender } = render(
      <BoardV2 projects={[...deepProjects, ...clienteWithSubsProjects]} selectedProjectId={null} selectedClienteId="clienteC" />
    );

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    rerender(
      <BoardV2 projects={[...deepProjects, ...clienteWithSubsProjects]} selectedProjectId={null} selectedClienteId="clienteB" />
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
      <BoardV2 projects={allProjects} selectedProjectId={null} selectedClienteId={null} />
    );

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });
    rerender(<BoardV2 projects={allProjects} selectedProjectId={null} selectedClienteId="clienteC" />);
    // Sidebar volta pra "Todos": a escolha local anterior não pode ressuscitar.
    rerender(<BoardV2 projects={allProjects} selectedProjectId={null} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente').value).toBe('');
    expect(mockUseCards).toHaveBeenLastCalledWith([]);
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
      <BoardV2 projects={mixedProjects} selectedProjectId={null} selectedClienteId="clienteC" />
    );
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    const callsBefore = mockUseCards.mock.calls.length;
    rerender(<BoardV2 projects={mixedProjects} selectedProjectId={null} selectedClienteId="clienteB" />);

    const calls = fetchedProjectIdCallsSince(callsBefore);
    expect(calls.length).toBeGreaterThan(0);
    const foreign = calls.flat().filter((id) => id !== 'clienteB' && !id.startsWith('clienteB/'));
    expect(foreign).toEqual([]);
  });

  // Mesma guarda, pelo outro caminho de troca de cliente: o select local em
  // modo "Todos". Aqui cliente e projeto mudam dentro do MESMO evento.
  it('never queries another client\'s projects when the local client select switches clients in "Todos"', () => {
    mockNoCards();
    render(<BoardV2 projects={mixedProjects} selectedProjectId={null} selectedClienteId={null} />);

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
      <BoardV2 projects={[]} selectedProjectId={null} selectedClienteId="clienteB" />
    );
    expect(screen.getByText('Card Cliente B')).toBeTruthy();
    expect(screen.queryByText('Card Cliente Z')).toBeNull();

    rerender(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);
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
    render(<BoardV2 projects={deepProjects} selectedProjectId={null} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteC' } });
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    expect(lastFetchedProjectIds()).toEqual(['clienteC', 'clienteC/proj', 'clienteC/proj/neto']);
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
    render(<BoardV2 projects={projects} selectedProjectId={null} selectedClienteId={null} />);

    const orphan = screen.getByTestId('board-v2-card-7');
    expect(orphan.textContent).toContain('Card de projeto removido');
    expect(within(orphan).queryByText('ghost')).toBeNull();
    expect(within(orphan).queryByText('ghost/x')).toBeNull();
    // Só o avatar (1 span) — nenhuma tag de cliente/projeto.
    expect(orphan.querySelectorAll('span').length).toBe(1);

    const orphanClient = screen.getByTestId('board-v2-card-8');
    expect(within(orphanClient).queryByText('ghost')).toBeNull();
    expect(orphanClient.querySelectorAll('span').length).toBe(1);
  });

  // 4ª combinação de visibilidade do select de Projeto (as outras 3 já estão
  // cobertas acima): sidebar fixando um cliente QUE TEM subprojetos — visível
  // e habilitado, não só presente.
  it('shows the project select enabled when the sidebar fixed a client that has subprojects', () => {
    mockNoCards();
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(false);
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos os projetos',
      'Sub 1',
      'Sub 2',
    ]);
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
    render(<BoardV2 projects={multiProjects} selectedProjectId={null} selectedClienteId={null} />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Projeto A');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Projeto B');
  });

  it('keeps the client tag even when the selected client resolves to exactly 1 project', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, projeto_id: 'projA' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Projeto A');
  });

  it('does not repeat the name when the card belongs to the client itself (client-as-project)', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, projeto_id: 'clienteB', titulo: 'Card cliente-only' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);

    const card = screen.getByTestId('board-v2-card-1');
    expect(within(card).getAllByText('Cliente B')).toHaveLength(1);
  });

  it('shows both the client tag and the project tag when the card belongs to a subproject', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 2, projeto_id: 'clienteB/sub1', titulo: 'Card sub1' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={clienteWithSubsProjects} selectedProjectId={null} selectedClienteId="clienteB" />);

    const card = screen.getByTestId('board-v2-card-2');
    expect(card.textContent).toContain('Cliente B');
    expect(card.textContent).toContain('Sub 1');
  });

  it('renders no tag at all for a card with no projeto_id, never an empty pill', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 3, projeto_id: null, titulo: 'Card órfão' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedProjectId={null} selectedClienteId={null} />);

    const card = screen.getByTestId('board-v2-card-3');
    expect(card.textContent).toContain('Card órfão');
    expect(card.querySelectorAll('span').length).toBe(1); // só o avatar
  });
});
