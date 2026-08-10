// frontend/src/views/TarefasGlobalView.test.jsx
// Tarefa 28 (05-TL.md) — cobre TarefasGlobalView.jsx: agrupamento por
// projeto (nomes resolvidos via /api/projects), grupo "Projeto desconhecido"
// sempre por último, completar/reabrir via os círculos binários, os estados
// vazio/loading, e o teste crítico do achado #4 (05-TL.md, item 4): a ação
// que garante a sessão viva ANTES de navegar precisa chamar
// useTerminal().startSession(...) e SÓ DEPOIS navigate('/') — nesta ordem
// exata, verificada aqui via mock.invocationCallOrder, não só por
// inspeção visual.
//
// Decisão de implementação testada aqui (ver comentário no topo de
// TarefasGlobalView.jsx): "abrir chat" (tocar na tag do chat de origem) e
// "continuar" (botão ▶) são DUAS ações distintas, não uma só — a tag chama
// startSession+navigate (sem mandar mensagem), o botão ▶ chama
// api.continueSession diretamente (sem navegar). Os testes abaixo cobrem as
// duas explicitamente para não deixar a distinção só documentada em
// comentário.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../services/api.js', () => ({
  api: {
    fetchProjects: vi.fn(),
    continueSession: vi.fn(),
  },
}));

vi.mock('../hooks/useGlobalTasks.js', () => ({
  useGlobalTasks: vi.fn(),
}));

vi.mock('../components/TerminalContext.jsx', () => ({
  useTerminal: vi.fn(),
}));

import { api } from '../services/api.js';
import { useGlobalTasks } from '../hooks/useGlobalTasks.js';
import { useTerminal } from '../components/TerminalContext.jsx';
import { TarefasGlobalView } from './TarefasGlobalView.jsx';

const PROJECTS = [
  { id: 'projA', nome: 'Projeto A', path: '/projA', agentes: [], sub_projetos: [] },
  { id: 'projB', nome: 'Projeto B', path: '/projB', agentes: [], sub_projetos: [] },
];

function makeTask(overrides) {
  return {
    id: 1,
    session_key: 'projA::claude',
    projeto_id: 'projA',
    agent_id: 'claude',
    session_display_name: null,
    titulo: 'Tarefa',
    descricao_markdown: '',
    descricao_html: null,
    status: 'pending',
    created_at: 0,
    completed_at: null,
    ...overrides,
  };
}

// Helper: configura os dois hooks mockados com valores default sobrescritos
// pelas chamadas fornecidas em cada teste.
function setupHooks({ tasks = [], loading = false, completeTask = vi.fn(), reopenTask = vi.fn(), startSession = vi.fn() } = {}) {
  useGlobalTasks.mockReturnValue({ tasks, loading, completeTask, reopenTask });
  useTerminal.mockReturnValue({ startSession });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TarefasGlobalView — agrupamento por projeto', () => {
  it('agrupa tarefas por projeto_id usando o nome resolvido via /api/projects', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    setupHooks({
      tasks: [
        makeTask({ id: 1, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Tarefa A1' }),
        makeTask({ id: 2, session_key: 'projB::claude', projeto_id: 'projB', titulo: 'Tarefa B1' }),
      ],
    });

    const { container } = render(<TarefasGlobalView navigate={vi.fn()} />);

    await screen.findByText('Projeto A');
    // getByText já lança se não encontrar — a chamada bem-sucedida É a
    // asserção (sem @testing-library/jest-dom instalado neste projeto, ver
    // App.test.jsx, não há .toBeInTheDocument() disponível).
    screen.getByText('Projeto B');
    screen.getByText('Tarefa A1');
    screen.getByText('Tarefa B1');
    // Nomes resolvidos, não os ids crus.
    expect(container.textContent).not.toMatch(/\bprojA\b/);
    expect(container.textContent).not.toMatch(/\bprojB\b/);
  });

  it('coloca o grupo "Projeto desconhecido" sempre por último', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    setupHooks({
      tasks: [
        // Ordem de chegada propositalmente com o órfão no meio — a UI deve
        // reordenar para o final independente da ordem de `tasks`.
        makeTask({ id: 1, session_key: 'ghost::claude', projeto_id: 'ghost', titulo: 'Tarefa fantasma' }),
        makeTask({ id: 2, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Tarefa A1' }),
        makeTask({ id: 3, session_key: 'projB::claude', projeto_id: 'projB', titulo: 'Tarefa B1' }),
      ],
    });

    const { container } = render(<TarefasGlobalView navigate={vi.fn()} />);

    await screen.findByText('Projeto A');
    const text = container.textContent;
    const idxA = text.indexOf('Projeto A');
    const idxB = text.indexOf('Projeto B');
    const idxGhost = text.indexOf('Projeto desconhecido (ghost)');
    expect(idxGhost).toBeGreaterThan(-1);
    expect(idxGhost).toBeGreaterThan(idxA);
    expect(idxGhost).toBeGreaterThan(idxB);
  });
});

describe('TarefasGlobalView — completar/reabrir', () => {
  it('tocar no círculo de uma tarefa pendente chama completeTask', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    const completeTask = vi.fn();
    const reopenTask = vi.fn();
    setupHooks({
      tasks: [makeTask({ id: 42, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Escrever testes', status: 'pending' })],
      completeTask,
      reopenTask,
    });

    render(<TarefasGlobalView navigate={vi.fn()} />);
    await screen.findByText('Projeto A');

    fireEvent.click(screen.getByLabelText('Marcar "Escrever testes" como concluída'));

    expect(completeTask).toHaveBeenCalledWith('projA::claude', 42);
    expect(reopenTask).not.toHaveBeenCalled();
  });

  it('tocar no círculo de uma tarefa concluída (dentro de "Concluídas") chama reopenTask', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    const completeTask = vi.fn();
    const reopenTask = vi.fn();
    setupHooks({
      tasks: [
        // Precisa de ao menos uma pendente para a tela não cair no estado
        // vazio global (que substitui a listagem inteira).
        makeTask({ id: 1, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Pendente', status: 'pending' }),
        makeTask({ id: 2, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Já feita', status: 'done' }),
      ],
      completeTask,
      reopenTask,
    });

    render(<TarefasGlobalView navigate={vi.fn()} />);
    await screen.findByText('Projeto A');

    // Sub-seção de concluídas vem colapsada por padrão — abre primeiro. O
    // texto do toggle é "▸ Concluídas (1)" partido em múltiplos nós de texto
    // (chevron + label), daí o matcher por regex via nome acessível do botão
    // em vez de getByText com string exata.
    fireEvent.click(screen.getByRole('button', { name: /Concluídas \(1\)/ }));
    fireEvent.click(screen.getByLabelText('Reabrir "Já feita" (marcar como pendente)'));

    expect(reopenTask).toHaveBeenCalledWith('projA::claude', 2);
    expect(completeTask).not.toHaveBeenCalled();
  });
});

describe('TarefasGlobalView — ações de navegação (achado #4, 05-TL.md)', () => {
  it('CRÍTICO: tocar na tag do chat ("abrir chat") chama startSession e SÓ DEPOIS navigate(\'/\')', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    const startSession = vi.fn();
    const navigate = vi.fn();
    setupHooks({
      tasks: [
        makeTask({
          id: 7,
          session_key: 'projA::claude',
          projeto_id: 'projA',
          agent_id: 'claude',
          session_display_name: 'Chat Principal',
          titulo: 'Revisar PR',
          status: 'pending',
        }),
      ],
      startSession,
    });

    render(<TarefasGlobalView navigate={navigate} />);
    await screen.findByText('Projeto A');

    fireEvent.click(screen.getByRole('button', { name: 'Chat Principal' }));

    expect(startSession).toHaveBeenCalledWith('projA::claude', 'projA', 'claude');
    expect(navigate).toHaveBeenCalledWith('/');
    // Ordem exata importa (achado #4): startSession precisa ter sido
    // invocado ANTES de navigate, não depois.
    expect(startSession.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it('tocar no botão "continuar" (▶) chama api.continueSession diretamente, SEM navegar nem chamar startSession', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    api.continueSession.mockResolvedValue({ status: 'ok' });
    const startSession = vi.fn();
    const navigate = vi.fn();
    setupHooks({
      tasks: [
        makeTask({ id: 9, session_key: 'projA::claude', projeto_id: 'projA', titulo: 'Rodar suíte', status: 'pending' }),
      ],
      startSession,
    });

    render(<TarefasGlobalView navigate={navigate} />);
    await screen.findByText('Projeto A');

    fireEvent.click(screen.getByRole('button', { name: 'Continuar sessão' }));

    await waitFor(() => expect(api.continueSession).toHaveBeenCalledWith('projA::claude'));
    expect(navigate).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });
});

describe('TarefasGlobalView — estados vazio e loading', () => {
  it('mostra a copy do estado vazio global quando não há nenhuma tarefa pendente', async () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    setupHooks({ tasks: [], loading: false });

    render(<TarefasGlobalView navigate={vi.fn()} />);

    await screen.findByText('Nenhuma tarefa pendente em nenhum projeto. Tudo em dia.');
    expect(screen.queryByText('Carregando...')).toBeNull();
  });

  it('mostra um estado de loading diferente do estado vazio enquanto useGlobalTasks.loading é true', () => {
    api.fetchProjects.mockResolvedValue(PROJECTS);
    setupHooks({ tasks: [], loading: true });

    render(<TarefasGlobalView navigate={vi.fn()} />);

    screen.getByText('Carregando...');
    expect(screen.queryByText('Nenhuma tarefa pendente em nenhum projeto. Tudo em dia.')).toBeNull();
  });
});
