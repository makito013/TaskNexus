// frontend/src/layouts/v2/BoardV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): cobre a apresentação
// v2 do Board — 4 colunas fixas por status (não por projeto), reaproveitando
// useCards tal como está (mockado aqui, mesmo padrão de App.test.jsx para
// BoardView.jsx v1).
//
// Fase 2 do plano (fix do Bruno, "cliente selecionado" desacoplado do chat
// ativo): a filtragem/agregação de `useCards` passou a seguir
// `selectedClienteId` (+ subprojetos), na mesma fórmula de BoardView.jsx v1
// — não mais `selectedProjectId` sozinho. `selectedProjectId` continua sendo
// testado separadamente, só no papel que ainda tem: o fluxo de criação de
// card (`handleCreate`/"+ Adicionar card").

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { BoardV2 } from './BoardV2.jsx';

const mockUseCards = vi.fn();
vi.mock('../../hooks/useCards.js', () => ({
  useCards: (...args) => mockUseCards(...args),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projects = [{ id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [], sub_projetos: [] }];

const clienteWithSubs = {
  id: 'clienteB',
  nome: 'Cliente B',
  path: '/tmp/b',
  agentes: [],
  sub_projetos: ['clienteB/sub1', 'clienteB/sub2'],
};

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
    render(<BoardV2 projects={[clienteWithSubs]} selectedProjectId="projA" selectedClienteId="clienteB" />);

    const column = screen.getByTestId('board-v2-col-a_fazer');
    fireEvent.click(within(column).getByText('+ Adicionar card'));

    fireEvent.change(within(column).getByPlaceholderText('Título do card'), { target: { value: 'Novo card' } });
    fireEvent.click(within(column).getByText('Adicionar'));

    await waitFor(() => expect(within(column).queryByText('Adicionar')).toBeNull()); // form fecha
    // projeto_id vem de selectedProjectId (chat ativo), não do cliente agregado na sidebar.
    expect(createCard).toHaveBeenCalledWith({ titulo: 'Novo card', projeto_id: 'projA', status: 'a_fazer' });
  });

  it('disables card creation with a hint when no chat project is selected (selectedProjectId)', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId={null} selectedClienteId="projA" />);
    expect(screen.queryByText('+ Adicionar card')).toBeNull();
    expect(screen.getAllByText('Selecione um projeto na barra lateral para adicionar cards.').length).toBeGreaterThan(0);
  });
});

describe('BoardV2 — agregação de cards por CLIENTE (selectedClienteId, desacoplado do chat ativo)', () => {
  it('with no client selected ("Todos"), fetches cards for all projects — useCards([])', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId={null} />);
    expect(mockUseCards).toHaveBeenCalledWith([]);
  });

  it('with a client that has no subprojects selected, fetches only that client\'s cards — useCards([clienteId])', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);
    expect(mockUseCards).toHaveBeenCalledWith(['projA']);
  });

  it('with a client that has subprojects selected, aggregates client + all its subprojects — useCards([clienteId, ...subProjetoIds])', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={[clienteWithSubs]} selectedProjectId={null} selectedClienteId="clienteB" />);
    expect(mockUseCards).toHaveBeenCalledWith(['clienteB', 'clienteB/sub1', 'clienteB/sub2']);
  });
});

describe('BoardV2 — tag de projeto no card (condicional: some quando redundante)', () => {
  it('shows the project-name tag on every card when no client is selected ("Todos")', () => {
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

  it('hides the project-name tag when the selected client resolves to exactly 1 project (no subprojects)', () => {
    mockUseCards.mockReturnValue({
      cards: [fakeCard({ id: 1, projeto_id: 'projA' })],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={projects} selectedProjectId="projA" selectedClienteId="projA" />);

    expect(screen.getByTestId('board-v2-card-1').textContent).not.toContain('Projeto A');
  });

  it('shows the project-name tag when the selected client has subprojects, to disambiguate which subproject each card belongs to', () => {
    mockUseCards.mockReturnValue({
      cards: [
        fakeCard({ id: 1, projeto_id: 'clienteB', titulo: 'Card cliente-only' }),
        fakeCard({ id: 2, projeto_id: 'clienteB/sub1', titulo: 'Card sub1' }),
      ],
      createCard: vi.fn(),
      updateCard: vi.fn(),
    });
    render(<BoardV2 projects={[clienteWithSubs]} selectedProjectId={null} selectedClienteId="clienteB" />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Cliente B');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('clienteB/sub1');
  });
});
