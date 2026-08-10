// frontend/src/layouts/v2/TarefasV2.test.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): cobre a apresentação
// v2 de Tarefas — lista única agrupada só por status ("Em aberto"/
// "Concluídas"), reaproveitando useGlobalTasks tal como está (mockado aqui,
// mesmo padrão de App.test.jsx para TarefasGlobalView.jsx v1).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TarefasV2 } from './TarefasV2.jsx';

const mockUseGlobalTasks = vi.fn();
vi.mock('../../hooks/useGlobalTasks.js', () => ({
  useGlobalTasks: () => mockUseGlobalTasks(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function fakeTask(overrides = {}) {
  return {
    id: 1,
    titulo: 'Revisar PR',
    status: 'pending',
    session_key: 'projA::claude',
    projeto_id: 'projA',
    agent_id: 'claude',
    session_display_name: null,
    completed_at: null,
    ...overrides,
  };
}

function fakeProject(overrides = {}) {
  return { id: 'projA', nome: 'Projeto A', path: '/tmp/projA', agentes: [], sub_projetos: [], ...overrides };
}

describe('TarefasV2 — lista única agrupada por status', () => {
  it('shows a loading state while useGlobalTasks has not resolved yet', () => {
    mockUseGlobalTasks.mockReturnValue({ tasks: [], loading: true, completeTask: vi.fn(), reopenTask: vi.fn() });
    render(<TarefasV2 />);
    expect(screen.getByText('Carregando...')).toBeTruthy();
    expect(screen.queryByText(/Nenhuma tarefa pendente/)).toBeNull();
  });

  it('shows the global empty state when there are no tasks at all', () => {
    mockUseGlobalTasks.mockReturnValue({ tasks: [], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    render(<TarefasV2 />);
    expect(screen.getByText(/Nenhuma tarefa pendente em nenhum projeto\. Tudo em dia\./)).toBeTruthy();
  });

  it('groups pending tasks under "Em aberto" and done tasks under "Concluídas", each with a count', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' }),
        fakeTask({ id: 2, titulo: 'Tarefa feita', status: 'done' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    expect(screen.getByTestId('tarefas-v2-group-header-open').textContent).toContain('(1)');
    expect(screen.getByTestId('tarefas-v2-group-header-done').textContent).toContain('(1)');
    expect(screen.getByText('Tarefa aberta')).toBeTruthy();
    expect(screen.getByText('Tarefa feita')).toBeTruthy();
  });

  it('clicking the circle on a pending task calls completeTask', () => {
    const completeTask = vi.fn();
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask,
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);
    fireEvent.click(screen.getByLabelText('Concluir "Tarefa aberta"'));
    expect(completeTask).toHaveBeenCalledWith('projA::claude', 1);
  });

  it('clicking the circle on a done task calls reopenTask', () => {
    const reopenTask = vi.fn();
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 2, titulo: 'Tarefa feita', status: 'done' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask,
    });
    render(<TarefasV2 />);
    fireEvent.click(screen.getByLabelText('Reabrir "Tarefa feita"'));
    expect(reopenTask).toHaveBeenCalledWith('projA::claude', 2);
  });

  it('shows "quem" (session_display_name or agent_id) as the meta, and a colored status badge', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending', agent_id: 'claude', session_display_name: 'Bugfix urgente' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);
    expect(screen.getByText('Bugfix urgente')).toBeTruthy();
    expect(screen.getByText('Em aberto', { selector: 'span' })).toBeTruthy();
  });
});

describe('TarefasV2 — agrupamento por cliente (selectedClienteId/projects)', () => {
  const projects = [fakeProject({ id: 'cliente_projeto_1', nome: 'Cliente 1' }), fakeProject({ id: 'podesubir', nome: 'Pode Subir' })];

  it('filters to only the selected cliente when tasks belong to multiple clientes, preserving open/done', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente 1 aberta', status: 'pending', projeto_id: 'cliente_projeto_1' }),
        fakeTask({ id: 2, titulo: 'Tarefa Cliente 1 feita', status: 'done', projeto_id: 'cliente_projeto_1' }),
        fakeTask({ id: 3, titulo: 'Tarefa Pode Subir', status: 'pending', projeto_id: 'podesubir' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId="cliente_projeto_1" />);

    expect(screen.getByText('Tarefa Cliente 1 aberta')).toBeTruthy();
    expect(screen.getByText('Tarefa Cliente 1 feita')).toBeTruthy();
    expect(screen.queryByText('Tarefa Pode Subir')).toBeNull();
    expect(screen.getByTestId('tarefas-v2-group-header-open').textContent).toContain('(1)');
    expect(screen.getByTestId('tarefas-v2-group-header-done').textContent).toContain('(1)');
    // Modo cliente específico: sem header de cliente acima do markup.
    expect(screen.queryByTestId('tarefas-v2-cliente-header-cliente_projeto_1')).toBeNull();
  });

  it('rolls a sub-project task up to its parent cliente', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa do sub-projeto', status: 'pending', projeto_id: 'cliente_projeto_1/subprojeto_1' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId="cliente_projeto_1" />);
    expect(screen.getByText('Tarefa do sub-projeto')).toBeTruthy();
  });

  it('shows a dedicated empty message when the selected cliente has no tasks (not the empty open/done pair, not the global message)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa de outro cliente', status: 'pending', projeto_id: 'podesubir' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId="cliente_projeto_1" />);

    expect(screen.getByTestId('tarefas-v2-empty-cliente').textContent).toBe('Nenhuma tarefa para Cliente 1.');
    expect(screen.queryByText('Nenhuma tarefa em aberto.')).toBeNull();
    expect(screen.queryByText(/Nenhuma tarefa pendente em nenhum projeto/)).toBeNull();
  });

  it('groups tasks from 2+ clientes under "Todos", each with its own header and no leaking between groups', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente 1', status: 'pending', projeto_id: 'cliente_projeto_1' }),
        fakeTask({ id: 2, titulo: 'Tarefa Pode Subir', status: 'pending', projeto_id: 'podesubir' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);

    const clienteGroup = screen.getByTestId('tarefas-v2-cliente-group-cliente_projeto_1');
    const podesubirGroup = screen.getByTestId('tarefas-v2-cliente-group-podesubir');
    expect(within(clienteGroup).getByText('Tarefa Cliente 1')).toBeTruthy();
    expect(within(clienteGroup).queryByText('Tarefa Pode Subir')).toBeNull();
    expect(within(podesubirGroup).getByText('Tarefa Pode Subir')).toBeTruthy();
    expect(within(podesubirGroup).queryByText('Tarefa Cliente 1')).toBeNull();
    expect(screen.getByTestId('tarefas-v2-cliente-header-cliente_projeto_1').textContent).toBe('Cliente 1');
    expect(screen.getByTestId('tarefas-v2-cliente-header-podesubir').textContent).toBe('Pode Subir');
  });

  it('still renders a cliente header under "Todos" when tasks belong to only 1 cliente (no regression to the old flat list)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa única', status: 'pending', projeto_id: 'cliente_projeto_1' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);
    expect(screen.getByTestId('tarefas-v2-cliente-header-cliente_projeto_1').textContent).toBe('Cliente 1');
    expect(screen.getByText('Tarefa única')).toBeTruthy();
  });

  it('keeps the unchanged global empty message under "Todos" when there are no tasks at all', () => {
    mockUseGlobalTasks.mockReturnValue({ tasks: [], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);
    expect(screen.getByText(/Nenhuma tarefa pendente em nenhum projeto\. Tudo em dia\./)).toBeTruthy();
  });

  it('sorts cliente groups alphabetically by nome under "Todos", regardless of raw task order', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Pode Subir', status: 'pending', projeto_id: 'podesubir' }),
        fakeTask({ id: 2, titulo: 'Tarefa Cliente 1', status: 'pending', projeto_id: 'cliente_projeto_1' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);
    const headers = screen.getAllByTestId(/tarefas-v2-cliente-header-/).map((el) => el.textContent);
    expect(headers).toEqual(['Cliente 1', 'Pode Subir']);
  });

  it('falls back to the raw clienteId as label when it is not found in projects, without crashing', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa órfã', status: 'pending', projeto_id: 'projeto-removido' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);
    expect(screen.getByTestId('tarefas-v2-cliente-header-projeto-removido').textContent).toBe('projeto-removido');
  });

  it('still calls completeTask/reopenTask with the right params regardless of which cliente group the task is in', () => {
    const completeTask = vi.fn();
    const reopenTask = vi.fn();
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente 1 aberta', status: 'pending', projeto_id: 'cliente_projeto_1', session_key: 'cliente_projeto_1::claude' }),
        fakeTask({ id: 2, titulo: 'Tarefa Pode Subir feita', status: 'done', projeto_id: 'podesubir', session_key: 'podesubir::claude' }),
      ],
      loading: false,
      completeTask,
      reopenTask,
    });
    render(<TarefasV2 projects={projects} selectedClienteId={null} />);

    fireEvent.click(screen.getByLabelText('Concluir "Tarefa Cliente 1 aberta"'));
    expect(completeTask).toHaveBeenCalledWith('cliente_projeto_1::claude', 1);

    fireEvent.click(screen.getByLabelText('Reabrir "Tarefa Pode Subir feita"'));
    expect(reopenTask).toHaveBeenCalledWith('podesubir::claude', 2);
  });

  it('does not break clienteIdFromProjetoId when projeto_id has no "/"', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa raiz', status: 'pending', projeto_id: 'projeto_2' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    expect(() => render(<TarefasV2 projects={projects} selectedClienteId={null} />)).not.toThrow();
    expect(screen.getByText('Tarefa raiz')).toBeTruthy();
  });
});
