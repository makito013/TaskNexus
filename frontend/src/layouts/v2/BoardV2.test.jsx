// frontend/src/layouts/v2/BoardV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): cobre a apresentação
// v2 do Board — 4 colunas fixas por status (não por projeto), reaproveitando
// useCards tal como está (mockado aqui, mesmo padrão de App.test.jsx para
// BoardView.jsx v1).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { BoardV2 } from './BoardV2.jsx';

const mockUseCards = vi.fn();
vi.mock('../../hooks/useCards.js', () => ({
  useCards: (...args) => mockUseCards(...args),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projects = [{ id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [], sub_projetos: [] }];

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

    render(<BoardV2 projects={projects} selectedProjectId="projA" />);

    expect(screen.getByTestId('board-v2-col-a_fazer')).toBeTruthy();
    expect(screen.getByTestId('board-v2-col-feito')).toBeTruthy();
    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Card 1');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Card 2');
  });

  it('passes selectedProjectId as the useCards filter', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId="projA" />);
    expect(mockUseCards).toHaveBeenCalledWith(['projA']);
  });

  it('moving a card calls updateCard with the new status', () => {
    const updateCard = vi.fn();
    mockUseCards.mockReturnValue({ cards: [fakeCard()], createCard: vi.fn(), updateCard });
    render(<BoardV2 projects={projects} selectedProjectId="projA" />);

    fireEvent.change(screen.getByLabelText('Mover "Card 1"'), { target: { value: 'feito' } });
    expect(updateCard).toHaveBeenCalledWith(1, { status: 'feito' });
  });

  it('"+ Adicionar card" creates a card in that column\'s status for the selected project', async () => {
    const createCard = vi.fn().mockResolvedValue({});
    mockUseCards.mockReturnValue({ cards: [], createCard, updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId="projA" />);

    const column = screen.getByTestId('board-v2-col-a_fazer');
    fireEvent.click(within(column).getByText('+ Adicionar card'));

    fireEvent.change(within(column).getByPlaceholderText('Título do card'), { target: { value: 'Novo card' } });
    fireEvent.click(within(column).getByText('Adicionar'));

    await waitFor(() => expect(within(column).queryByText('Adicionar')).toBeNull()); // form fecha
    expect(createCard).toHaveBeenCalledWith({ titulo: 'Novo card', projeto_id: 'projA', status: 'a_fazer' });
  });

  it('disables card creation with a hint when no project is selected', () => {
    mockUseCards.mockReturnValue({ cards: [], createCard: vi.fn(), updateCard: vi.fn() });
    render(<BoardV2 projects={projects} selectedProjectId={null} />);
    expect(screen.queryByText('+ Adicionar card')).toBeNull();
    expect(screen.getAllByText('Selecione um projeto na barra lateral para adicionar cards.').length).toBeGreaterThan(0);
  });

  it('with no project selected, shows a project-name tag on each card to disambiguate cross-project cards', () => {
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
    render(<BoardV2 projects={multiProjects} selectedProjectId={null} />);

    expect(screen.getByTestId('board-v2-card-1').textContent).toContain('Projeto A');
    expect(screen.getByTestId('board-v2-card-2').textContent).toContain('Projeto B');
  });
});
