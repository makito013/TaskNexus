// frontend/src/views/BoardView.test.jsx
// Tarefa 26 (05-TL.md) — cobre BoardView.jsx: sub-toggle Lista/Board (com
// persistência em localStorage, mesmo padrão de useSidebarCollapsed em
// App.jsx), filtro de projeto repassado a useCards, agrupamento da visão
// Lista com o botão "Limpar concluídos" habilitado/desabilitado conforme
// há ou não card 'feito' no projeto, criação de card via "+ Novo Card" e
// edição de um card existente via CardFormModal.
//
// `useCards` e `api.fetchProjects` são mockados (BoardView não deve bater na
// rede de verdade em teste) — os demais componentes (ProjectGroupHeader,
// KanbanBoard, CardItem, CardFormModal, ClearFinishedModal) são os reais,
// mesmo padrão de KanbanBoard.test.jsx/TarefasGlobalView.test.jsx (que
// também preferem renderizar a árvore real em vez de mockar componentes de
// apresentação).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../services/api.js', () => ({
  api: {
    fetchProjects: vi.fn(),
  },
}));

vi.mock('../hooks/useCards.js', () => ({
  useCards: vi.fn(),
}));

import { api } from '../services/api.js';
import { useCards } from '../hooks/useCards.js';
import { BoardView } from './BoardView.jsx';

const VIEW_MODE_KEY = 'escritorio::board_view_mode';

const PROJETOS = [
  { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [], sub_projetos: [] },
  { id: 'escritorio-agentes', nome: 'Escritório de Agentes', path: '/escritorio', agentes: [], sub_projetos: [] },
];

function makeCard(overrides = {}) {
  return {
    id: 1,
    titulo: 'Card de teste',
    projeto_id: 'podesubir',
    parent_id: null,
    status: 'a_fazer',
    origem: 'bruno',
    ultima_atualizacao_por: 'bruno',
    descricao: null,
    criado_em: 1700000000,
    atualizado_em: Math.floor(Date.now() / 1000) - 3600,
    subcards: [],
    subcards_resumo: null,
    imagens: [],
    ...overrides,
  };
}

function setupUseCards({
  cards = [],
  createCard = vi.fn().mockResolvedValue(makeCard()),
  createSubcard = vi.fn().mockResolvedValue(makeCard()),
  updateCard = vi.fn().mockResolvedValue(makeCard()),
  deleteCard = vi.fn().mockResolvedValue({ status: 'ok' }),
  uploadCardImage = vi.fn(),
  deleteCardImage = vi.fn(),
  previewClearFinished = vi.fn().mockResolvedValue({ cards: 0, imagens: 0, imagens_com_falha: 0 }),
  clearFinished = vi.fn().mockResolvedValue({ cards: 0, imagens: 0, imagens_com_falha: 0 }),
} = {}) {
  useCards.mockReturnValue({
    cards,
    createCard,
    createSubcard,
    updateCard,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  });
  return { createCard, createSubcard, updateCard, deleteCard, uploadCardImage, deleteCardImage, previewClearFinished, clearFinished };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('BoardView — sub-toggle Lista/Board', () => {
  it('inicia na visão Lista e alterna para Board ao tocar no botão "Board"', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [makeCard({ id: 1, titulo: 'Card A', projeto_id: 'podesubir' })] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card A');

    // Visão Lista: linha de card, sem o cabeçalho de colunas do Kanban.
    expect(screen.queryByTestId('board-cols-header')).toBeNull();

    // "Board" também é o título fixo da topbar (<span>) — o sub-toggle é o
    // <button role="button" name="Board">, daí o getByRole para desambiguar.
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(await screen.findByTestId('board-cols-header')).not.toBeNull();
    expect(screen.getByTestId('kanban-board')).not.toBeNull();
  });

  it('persiste viewMode em localStorage (mesmo padrão de useSidebarCollapsed)', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [makeCard({ id: 1, titulo: 'Card A' })] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card A');

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    await screen.findByTestId('board-cols-header');

    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe('board');
  });

  it('lê viewMode já persistido em localStorage ao montar', async () => {
    localStorage.setItem(VIEW_MODE_KEY, 'board');
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [makeCard({ id: 1, titulo: 'Card A' })] });

    render(<BoardView navigate={vi.fn()} />);

    expect(await screen.findByTestId('board-cols-header')).not.toBeNull();
  });
});

describe('BoardView — filtro Cliente/Projeto (cascata)', () => {
  it('passa [] para useCards inicialmente ("Todos")', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Nenhum card ainda.');

    expect(useCards).toHaveBeenLastCalledWith([]);
  });

  it('clicar num cliente sem subprojetos passa [clienteId] pra useCards (Tier 2 não aparece)', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Nenhum card ainda.');

    fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['podesubir']));

    // "Este cliente não tem subprojetos" — texto informativo em vez do Tier 2.
    expect(screen.getByText(/não tem subprojetos/)).not.toBeNull();
  });

  it('trocar de cliente é single-select: o novo cliente substitui o anterior, não acumula', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Nenhum card ainda.');

    fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['podesubir']));

    fireEvent.click(screen.getByRole('button', { name: 'Escritório de Agentes' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['escritorio-agentes']));
  });

  it('"Todos" limpa a seleção de volta para []', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Nenhum card ainda.');

    fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['podesubir']));

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith([]));
  });

  describe('cliente com subprojetos', () => {
    const PROJETOS_COM_SUBPROJETOS = [
      { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [], sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
      { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
    ];

    it('selecionar só o cliente agrega [clienteId, ...subProjetoIds] e mostra o Tier 2', async () => {
      api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
      setupUseCards({ cards: [] });

      render(<BoardView navigate={vi.fn()} />);
      await screen.findByText('Nenhum card ainda.');

      fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));
      await waitFor(() =>
        expect(useCards).toHaveBeenLastCalledWith(['cliente_projeto_1', 'cliente_projeto_1/subprojeto_1'])
      );
      expect(screen.getByRole('button', { name: 'Subprojeto 1' })).not.toBeNull();
    });

    it('selecionar cliente + projeto específico passa só [clienteId, projetoId]', async () => {
      api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
      setupUseCards({ cards: [] });

      render(<BoardView navigate={vi.fn()} />);
      await screen.findByText('Nenhum card ainda.');

      fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));
      await waitFor(() =>
        expect(useCards).toHaveBeenLastCalledWith(['cliente_projeto_1', 'cliente_projeto_1/subprojeto_1'])
      );

      fireEvent.click(screen.getByRole('button', { name: 'Subprojeto 1' }));
      await waitFor(() =>
        expect(useCards).toHaveBeenLastCalledWith(['cliente_projeto_1', 'cliente_projeto_1/subprojeto_1'])
      );
    });

    it('trocar de cliente reseta a seleção de Projeto (Tier 2)', async () => {
      api.fetchProjects.mockResolvedValue([
        ...PROJETOS_COM_SUBPROJETOS,
        { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [], sub_projetos: [] },
      ]);
      setupUseCards({ cards: [] });

      render(<BoardView navigate={vi.fn()} />);
      await screen.findByText('Nenhum card ainda.');

      fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));
      await waitFor(() =>
        expect(useCards).toHaveBeenLastCalledWith(['cliente_projeto_1', 'cliente_projeto_1/subprojeto_1'])
      );
      fireEvent.click(screen.getByRole('button', { name: 'Subprojeto 1' }));
      await waitFor(() =>
        expect(useCards).toHaveBeenLastCalledWith(['cliente_projeto_1', 'cliente_projeto_1/subprojeto_1'])
      );

      // Troca de cliente: Tier 2 (Subprojeto 1) deve sumir e o filtro deve virar
      // só o novo cliente, sem carregar a seleção de projeto anterior.
      fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));
      await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['podesubir']));
      expect(screen.queryByRole('button', { name: 'Subprojeto 1' })).toBeNull();
    });
  });
});

describe('BoardView — boardClearEnabled nos 3 estados de seleção (visão Board)', () => {
  const PROJETOS_COM_SUBPROJETOS = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [], sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
  ];

  it('"Todos" (nenhum tier selecionado): botão desabilitado', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, projeto_id: 'cliente_projeto_1', status: 'feito' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card de teste');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    const btn = await screen.findByText('Limpar concluídos');
    expect(btn.disabled).toBe(true);
  });

  it('só Cliente selecionado: botão habilitado quando o cliente tem card "feito"', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, projeto_id: 'cliente_projeto_1', status: 'feito' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card de teste');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));

    const btn = await screen.findByText('Limpar concluídos');
    expect(btn.disabled).toBe(false);
  });

  it('Cliente + Projeto selecionados: botão opera sobre o projeto específico (tier mais específico)', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    const { previewClearFinished } = setupUseCards({
      cards: [
        makeCard({ id: 1, titulo: 'Card do cliente', projeto_id: 'cliente_projeto_1', status: 'a_fazer' }),
        makeCard({ id: 2, titulo: 'Card do subprojeto', projeto_id: 'cliente_projeto_1/subprojeto_1', status: 'feito' }),
      ],
    });
    previewClearFinished.mockResolvedValue({ cards: 1, imagens: 0, imagens_com_falha: 0 });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card do cliente');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Subprojeto 1' }));

    const btn = await screen.findByText('Limpar concluídos');
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    await waitFor(() => expect(previewClearFinished).toHaveBeenCalledWith('cliente_projeto_1/subprojeto_1'));
  });
});

describe('BoardView — card cliente-only no filtro (Cliente/Projeto)', () => {
  const PROJETOS_COM_SUBPROJETOS = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [], sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
  ];

  it('card cliente-only (projeto_id="cliente_projeto_1") aparece quando só o Cliente está selecionado', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card cliente-only', projeto_id: 'cliente_projeto_1' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card cliente-only');

    fireEvent.click(screen.getByRole('button', { name: 'Cliente 1' }));
    // useCards é mockado (não re-filtra de verdade), então o card continua
    // renderizado — o que importa aqui é que o array passado inclui
    // "cliente_projeto_1" (coberto no describe acima) e a tela não quebra/filtra
    // localmente o card cliente-only pra fora.
    expect(screen.getByText('Card cliente-only')).not.toBeNull();
  });
});

describe('BoardView — badge de cliente sincronizada com o filtro (showAllClientes)', () => {
  const PROJETOS_COM_SUBPROJETOS = [
    { id: 'cliente_projeto_1', nome: 'Cliente 1', path: '/cliente_projeto_1', agentes: [], sub_projetos: ['cliente_projeto_1/subprojeto_1'] },
    { id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1', path: '/cliente_projeto_1/subprojeto_1', agentes: [], sub_projetos: [] },
    { id: 'podesubir', nome: 'Pode Subir', path: '/podesubir', agentes: [], sub_projetos: [] },
  ];

  it('visão Lista, "Todos" (nenhum tier selecionado): TODO card ganha a badge com o nome do cliente, mesmo cliente-como-projeto sem ambiguidade', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card Podesubir', projeto_id: 'podesubir' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card Podesubir');

    // Antes da feature "Todos", um card em 'podesubir' (sem sub_projetos)
    // NUNCA ganhava badge de cliente (shouldShowClienteBadge exige
    // sub_projetos não-vazio). Em modo "Todos" (showAllClientes), ele passa
    // a ganhar a badge com o nome do próprio cliente.
    expect(screen.getByText('Pode Subir', { selector: '.badge--cliente' })).not.toBeNull();
  });

  it('visão Lista, cliente específico selecionado: preserva o comportamento antigo (não-regressão) — cliente-como-projeto sem sub_projetos NÃO ganha badge', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card Podesubir', projeto_id: 'podesubir' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card Podesubir');

    fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));
    await waitFor(() => expect(useCards).toHaveBeenLastCalledWith(['podesubir']));

    expect(document.querySelector('.badge--cliente')).toBeNull();
  });

  it('visão Board, "Todos": KanbanBoard recebe showAllClientes=true e mostra a badge em todo card', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card Podesubir', projeto_id: 'podesubir' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card Podesubir');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(await screen.findByText('Pode Subir', { selector: '.badge--cliente' })).not.toBeNull();
  });

  it('visão Board, cliente selecionado: showAllClientes=false, preserva comportamento antigo (não-regressão)', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS_COM_SUBPROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card Podesubir', projeto_id: 'podesubir' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card Podesubir');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pode Subir' }));

    await screen.findByTestId('kanban-board');
    expect(document.querySelector('.badge--cliente')).toBeNull();
  });
});

describe('BoardView — visão Lista: agrupamento e "Limpar concluídos"', () => {
  it('agrupa cards por projeto usando ProjectGroupHeader (countLabel="cards")', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({
      cards: [
        makeCard({ id: 1, titulo: 'Card A', projeto_id: 'podesubir' }),
        makeCard({ id: 2, titulo: 'Card B', projeto_id: 'escritorio-agentes' }),
        makeCard({ id: 3, titulo: 'Card C', projeto_id: 'podesubir' }),
      ],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card A');

    // "Pode Subir"/"Escritório de Agentes" também existem como chip de
    // filtro (button) — o rótulo do ProjectGroupHeader é um <span>, daí
    // filtrar por tagName para checar especificamente o cabeçalho de grupo.
    const podeSubirLabels = screen.getAllByText('Pode Subir');
    expect(podeSubirLabels.some((el) => el.tagName === 'SPAN')).toBe(true);
    const escritorioLabels = screen.getAllByText('Escritório de Agentes');
    expect(escritorioLabels.some((el) => el.tagName === 'SPAN')).toBe(true);
    expect(screen.getByText('2 cards')).not.toBeNull();
    expect(screen.getByText('1 cards')).not.toBeNull();
  });

  it('botão "Limpar concluídos" fica desabilitado quando o projeto não tem nenhum card "feito"', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({
      cards: [makeCard({ id: 1, titulo: 'Card A', projeto_id: 'podesubir', status: 'a_fazer' })],
    });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card A');

    const btn = screen.getByText('Limpar concluídos');
    expect(btn.disabled).toBe(true);
  });

  it('botão "Limpar concluídos" fica habilitado quando há ao menos um card "feito" e abre o ClearFinishedModal', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    const { previewClearFinished } = setupUseCards({
      cards: [
        makeCard({ id: 1, titulo: 'Card A', projeto_id: 'podesubir', status: 'a_fazer' }),
        makeCard({ id: 2, titulo: 'Card B', projeto_id: 'podesubir', status: 'feito' }),
      ],
    });
    previewClearFinished.mockResolvedValue({ cards: 1, imagens: 0, imagens_com_falha: 0 });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card A');

    const btn = screen.getByText('Limpar concluídos');
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => expect(previewClearFinished).toHaveBeenCalledWith('podesubir'));
    expect(await screen.findByText(/Limpar concluídos — Pode Subir/)).not.toBeNull();
  });
});

describe('BoardView — "+ Novo Card"', () => {
  it('abre o CardFormModal em modo create-top e submeter chama createCard', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    const { createCard } = setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Nenhum card ainda.');

    fireEvent.click(screen.getByText('+ Novo Card'));

    expect(await screen.findByText('Novo Card')).not.toBeNull();
    // Modo create-top mostra o campo Cliente (feature Cliente/Projeto — 1º
    // select da cascata; nenhum dos PROJETOS desta fixture tem
    // subprojetos, então o 2º select "Projeto (opcional)" não aparece).
    expect(screen.getByLabelText('Cliente')).not.toBeNull();
    expect(screen.queryByLabelText('Projeto (opcional)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nova tarefa' } });
    fireEvent.click(screen.getByText('Criar Card'));

    await waitFor(() => expect(createCard).toHaveBeenCalled());
    expect(createCard).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: 'Nova tarefa', cliente_id: 'podesubir' })
    );
  });
});

describe('BoardView — editar card existente', () => {
  it('tocar no título de um card abre o modal já preenchido e submeter chama updateCard', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    const card = makeCard({
      id: 42,
      titulo: 'Corrigir bug do terminal',
      projeto_id: 'podesubir',
      status: 'em_andamento',
      descricao: 'texto original',
    });
    const { updateCard } = setupUseCards({ cards: [card] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Corrigir bug do terminal');

    fireEvent.click(screen.getByText('Corrigir bug do terminal'));

    expect(await screen.findByText('Editar Card')).not.toBeNull();
    expect(screen.getByDisplayValue('Corrigir bug do terminal')).not.toBeNull();
    // Modo editar não mostra o campo Projeto (só create-top mostra).
    expect(screen.queryByLabelText('Projeto')).toBeNull();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Corrigir bug do terminal (revisado)' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(updateCard).toHaveBeenCalledWith(42, expect.objectContaining({
      titulo: 'Corrigir bug do terminal (revisado)',
    })));
  });

  it('encontra e edita um subcard (busca recursiva dentro de subcards)', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    const parent = makeCard({
      id: 1,
      titulo: 'Card pai',
      projeto_id: 'podesubir',
      subcards: [
        { id: 99, titulo: 'Subtarefa X', status: 'a_fazer', descricao: '', imagens: [], parent_id: 1 },
      ],
      subcards_resumo: { total: 1, feitos: 0 },
    });
    const { updateCard } = setupUseCards({ cards: [parent] });

    render(<BoardView navigate={vi.fn()} />);
    await screen.findByText('Card pai');

    // Expande o contador de subtarefas para revelar a SubcardRow.
    fireEvent.click(screen.getByText(/subtarefas/));
    fireEvent.click(screen.getByText('Subtarefa X'));

    expect(await screen.findByText('Editar Card')).not.toBeNull();
    expect(screen.getByDisplayValue('Subtarefa X')).not.toBeNull();

    // Touch the title so the edit is not a no-op: the modal now gates a
    // Salvar click that changed nothing (empty-body PATCH would steal the
    // attribution). What this test is actually about is the recursive lookup
    // finding subcard 99 — the id in the update call is what proves it.
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Subtarefa X (revisada)' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(updateCard).toHaveBeenCalledWith(99, expect.objectContaining({
      id: 99,
      titulo: 'Subtarefa X (revisada)',
    })));
  });
});

describe('BoardView — estado vazio', () => {
  it('mostra "Nenhum card ainda." quando cards está vazio', async () => {
    api.fetchProjects.mockResolvedValue(PROJETOS);
    setupUseCards({ cards: [] });

    render(<BoardView navigate={vi.fn()} />);

    expect(await screen.findByText('Nenhum card ainda.')).not.toBeNull();
  });
});
