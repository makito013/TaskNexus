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

  it('shows project tag and a colored status badge', () => {
    const projects = [fakeProject({ id: 'projA', nome: 'Projeto A' })];
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending', agent_id: 'claude', session_display_name: 'Bugfix urgente', projeto_id: 'projA' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} />);
    expect(screen.getByText('Tarefa aberta')).toBeTruthy();
    expect(screen.getByText('Em aberto', { selector: 'span' })).toBeTruthy();
  });
});

describe('TarefasV2 — agrupamento por cliente (selectedClienteId/projects)', () => {
  const projects = [
    fakeProject({ id: 'cliente_projeto_1', nome: 'Cliente 1' }),
    fakeProject({ id: 'cliente_projeto_1/subprojeto_1', nome: 'Subprojeto 1' }),
    fakeProject({ id: 'podesubir', nome: 'Pode Subir' }),
  ];

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

  // QA: closes a coverage gap on the 2nd documented raw-id-fallback exception
  // (TarefasV2.jsx comment above this empty-state message). The "Todos"
  // cliente-header exception already has a dedicated test below
  // ("falls back to the raw clienteId as label..."); this one had none,
  // despite being the same deliberate exception applied to a different
  // structural label.
  it('falls back to the raw clienteId in the dedicated empty message when the selected cliente is not found in projects', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa de outro cliente', status: 'pending', projeto_id: 'podesubir' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projects} selectedClienteId="cliente-desconhecido" />);

    expect(screen.getByTestId('tarefas-v2-empty-cliente').textContent).toBe('Nenhuma tarefa para cliente-desconhecido.');
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

// Fase 2: cascata de filtro local (`useClienteProjetoFilter`/
// `ClienteProjetoFilterBar`, mesmos que BoardV2.jsx já usa) integrada em
// TarefasV2. Fixtures espelham BoardV2.test.jsx: cada descendente precisa de
// uma entrada REAL em `projects` (a agregação de `selectedProjectIds` é por
// prefixo de id sobre a lista de `projects`, não por `sub_projetos`, que só
// lista filhos diretos) — declarar só `sub_projetos` no pai não basta.
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
const otherCliente = fakeProject({ id: 'clienteZ', nome: 'Cliente Z', sub_projetos: [] });

// Hierarquia de 3 níveis: cliente -> projeto -> neto, cada um com sua própria
// entrada de Project, como o backend realmente devolve.
const deepProjects = [
  { id: 'clienteC', nome: 'Cliente C', path: '/tmp/c', agentes: [], sub_projetos: ['clienteC/proj'] },
  { id: 'clienteC/proj', nome: 'Projeto C', path: '/tmp/c/p', agentes: [], sub_projetos: ['clienteC/proj/neto'] },
  { id: 'clienteC/proj/neto', nome: 'Neto C', path: '/tmp/c/p/n', agentes: [], sub_projetos: [] },
];

describe('TarefasV2 — cascata de filtro local (Cliente/Projeto)', () => {
  it('shows both selects as soon as Tarefas opens in "Todos", project select disabled until a client is picked', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa qualquer', status: 'pending', projeto_id: 'clienteB' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente')).toBeTruthy();
    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(true);
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os projetos']);
  });

  it('hides the local client select when the sidebar already fixed a client, showing only the project select', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa qualquer', status: 'pending', projeto_id: 'clienteB' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={clienteWithSubsProjects} selectedClienteId="clienteB" />);

    expect(screen.queryByLabelText('Filtrar por cliente')).toBeNull();
    expect(screen.getByLabelText('Filtrar por projeto')).toBeTruthy();
  });

  it('picking a client in the local select switches from the "Todos" grouped view to the single-client view, same as a sidebar-provided selectedClienteId would render', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente B', status: 'pending', projeto_id: 'clienteB' }),
        fakeTask({ id: 2, titulo: 'Tarefa Cliente Z', status: 'pending', projeto_id: 'clienteZ' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={[...clienteWithSubsProjects, otherCliente]} selectedClienteId={null} />);

    // Antes da seleção: modo "Todos", os dois grupos aparecem.
    expect(screen.getByTestId('tarefas-v2-cliente-group-clienteB')).toBeTruthy();
    expect(screen.getByTestId('tarefas-v2-cliente-group-clienteZ')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });

    // Depois: modo "cliente específico" — sem header, sem o outro cliente.
    expect(screen.queryByTestId('tarefas-v2-cliente-header-clienteB')).toBeNull();
    expect(screen.getByText('Tarefa Cliente B')).toBeTruthy();
    expect(screen.queryByText('Tarefa Cliente Z')).toBeNull();
  });

  it('cascades to the project select: once a client with subprojects is picked locally, the project select gets enabled and lists its direct children', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa qualquer', status: 'pending', projeto_id: 'clienteB' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    expect(projetoSelect.disabled).toBe(false);
    expect(within(projetoSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos os projetos',
      'Sub 1',
      'Sub 2',
    ]);
  });

  it('filtering by a sub-project via the local select narrows the tasks shown to that subtree', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Sub 1', status: 'pending', projeto_id: 'clienteB/sub1' }),
        fakeTask({ id: 2, titulo: 'Tarefa Sub 2', status: 'pending', projeto_id: 'clienteB/sub2' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={clienteWithSubsProjects} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });
    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteB/sub1' } });

    expect(screen.getByText('Tarefa Sub 1')).toBeTruthy();
    expect(screen.queryByText('Tarefa Sub 2')).toBeNull();
  });

  it('going back to "Todos os clientes" in the local select flips the render back to the grouped-with-headers view', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente B', status: 'pending', projeto_id: 'clienteB' }),
        fakeTask({ id: 2, titulo: 'Tarefa Cliente Z', status: 'pending', projeto_id: 'clienteZ' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={[...clienteWithSubsProjects, otherCliente]} selectedClienteId={null} />);

    const clienteSelect = screen.getByLabelText('Filtrar por cliente');
    fireEvent.change(clienteSelect, { target: { value: 'clienteB' } });
    // Single-client view: sem header, sem a tarefa do outro cliente.
    expect(screen.queryByTestId('tarefas-v2-cliente-header-clienteB')).toBeNull();
    expect(screen.queryByText('Tarefa Cliente Z')).toBeNull();

    fireEvent.change(clienteSelect, { target: { value: '' } });

    // Volta pra "Todos": os dois grupos, cada um com seu header, reaparecem.
    expect(screen.getByTestId('tarefas-v2-cliente-header-clienteB').textContent).toBe('Cliente B');
    expect(screen.getByTestId('tarefas-v2-cliente-header-clienteZ').textContent).toBe('Cliente Z');
    expect(screen.getByText('Tarefa Cliente Z')).toBeTruthy();
  });

  it('resets the local client pick when the sidebar leaves "Todos"', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa Cliente B', status: 'pending', projeto_id: 'clienteB' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    const allProjects = [...clienteWithSubsProjects, otherCliente];
    const { rerender } = render(<TarefasV2 projects={allProjects} selectedClienteId={null} />);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });
    rerender(<TarefasV2 projects={allProjects} selectedClienteId="clienteZ" />);
    // Sidebar volta pra "Todos": a escolha local anterior não pode ressuscitar.
    rerender(<TarefasV2 projects={allProjects} selectedClienteId={null} />);

    expect(screen.getByLabelText('Filtrar por cliente').value).toBe('');
    expect(screen.getByTestId('tarefas-v2-cliente-group-clienteB')).toBeTruthy();
  });
});

describe('TarefasV2 — hierarquia de 3+ níveis (Cliente > Projeto > Neto)', () => {
  it('rolls a grandchild task up to the top-level cliente group under "Todos", regardless of depth', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa do neto', status: 'pending', projeto_id: 'clienteC/proj/neto' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={deepProjects} selectedClienteId={null} />);

    const group = screen.getByTestId('tarefas-v2-cliente-group-clienteC');
    expect(within(group).getByText('Tarefa do neto')).toBeTruthy();
    expect(screen.getByTestId('tarefas-v2-cliente-header-clienteC').textContent).toBe('Cliente C');
  });

  it('the project select lists only the direct child, but picking it still reaches the grandchild task (shallow dropdown, deep filter)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa do neto', status: 'pending', projeto_id: 'clienteC/proj/neto' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={deepProjects} selectedClienteId="clienteC" />);

    const projetoSelect = screen.getByLabelText('Filtrar por projeto');
    // Só o filho direto aparece no dropdown — o neto não.
    expect(within(projetoSelect).getByText('Projeto C')).toBeTruthy();
    expect(within(projetoSelect).queryByText('Neto C')).toBeNull();

    fireEvent.change(projetoSelect, { target: { value: 'clienteC/proj' } });

    // ...mas o filtro por trás traz o neto junto, com a tag do SEU PRÓPRIO
    // projeto (Neto C), não a do intermediário selecionado.
    expect(screen.getByText('Tarefa do neto')).toBeTruthy();
    expect(screen.getByTestId('tarefas-v2-row-1').textContent).toContain('Neto C');
  });

  it('drops a client-only task when a specific intermediate project is selected, keeping the grandchild (mirrors BoardV2)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa cliente-only', status: 'pending', projeto_id: 'clienteC' }),
        fakeTask({ id: 2, titulo: 'Tarefa do neto', status: 'pending', projeto_id: 'clienteC/proj/neto' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={deepProjects} selectedClienteId="clienteC" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    // A tarefa presa direto ao cliente, sem projeto específico, sai de cena; a
    // do neto (dentro da subárvore do projeto escolhido) fica.
    expect(screen.queryByText('Tarefa cliente-only')).toBeNull();
    expect(screen.getByText('Tarefa do neto')).toBeTruthy();
  });

  it('resets the selected project when the effective client changes, without leaking the previous client\'s filtered tasks', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa do neto', status: 'pending', projeto_id: 'clienteC/proj/neto' }),
        fakeTask({ id: 2, titulo: 'Tarefa Sub 1', status: 'pending', projeto_id: 'clienteB/sub1' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    const allProjects = [...deepProjects, ...clienteWithSubsProjects];
    const { rerender } = render(<TarefasV2 projects={allProjects} selectedClienteId="clienteC" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteC/proj' } });

    rerender(<TarefasV2 projects={allProjects} selectedClienteId="clienteB" />);

    expect(screen.getByLabelText('Filtrar por projeto').value).toBe('');
    expect(screen.getByText('Tarefa Sub 1')).toBeTruthy();
    expect(screen.queryByText('Tarefa do neto')).toBeNull();
  });
});

// Teste nomeado (referenciado pelo comentário em TarefasV2.jsx): uma tarefa
// órfã (projeto removido/desconhecido do disco, sem entrada em `projects`)
// deve continuar visível sob um cliente específico ENQUANTO o Tier 2 estiver
// em "Todos os projetos" — só some quando o usuário escolhe explicitamente um
// projeto real no Tier 2 (aí sim ela não tem como casar com o subtree
// filtrado, decisão de produto aceita).
describe('TarefasV2 — tarefa órfã sob um cliente específico', () => {
  const projectsWithOrphanSibling = [
    { id: 'clienteB', nome: 'Cliente B', path: '/tmp/b', agentes: [], sub_projetos: ['clienteB/sub1'] },
    { id: 'clienteB/sub1', nome: 'Sub 1', path: '/tmp/b/sub1', agentes: [], sub_projetos: [] },
  ];

  it('keeps an orphan sub-project task visible under a specific client while Tier 2 is on "Todos os projetos"', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa órfã', status: 'pending', projeto_id: 'clienteB/removido' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projectsWithOrphanSibling} selectedClienteId="clienteB" />);
    expect(screen.getByText('Tarefa órfã')).toBeTruthy();
  });

  it('drops the orphan task only once Tier 2 narrows to a specific real project', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa órfã', status: 'pending', projeto_id: 'clienteB/removido' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={projectsWithOrphanSibling} selectedClienteId="clienteB" />);

    fireEvent.change(screen.getByLabelText('Filtrar por projeto'), { target: { value: 'clienteB/sub1' } });

    expect(screen.queryByText('Tarefa órfã')).toBeNull();
  });
});

// Task detail modal (view + complete/reopen). This file runs with no
// `window.matchMedia` stub, so `useMediaQuery` always returns `false` —
// every test here exercises the desktop branch (CenteredModal). The mobile
// branch (BottomSheet) has dedicated coverage in TaskDetailModalV2.test.jsx
// (describe "responsive container").
describe('TarefasV2 — task detail modal', () => {
  it('clicking the task title opens the detail modal, showing the task title', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Tarefa aberta')).toBeTruthy();
  });

  it('clicking anywhere else on the row (outside the circle and the title) also opens the modal', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    fireEvent.click(screen.getByTestId('tarefas-v2-row-1'));

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Guard the original request explicitly asks for: the circle only
  // completes/reopens, never opens the modal. Mutation proof: removing
  // `stopPropagation()` from the circle's onClick in TarefasV2.jsx turns
  // this test red (verified manually, see the Dev report).
  it('clicking the circle does NOT open the modal', () => {
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
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Real proof (not just "the function was called"): re-mock with the SAME
  // task now `status: 'done'` and rerender — the modal, still open with the
  // same `selectedTaskId`, must show the updated state, including the
  // completion date. `completed_at` here is an ISO STRING on purpose, not an
  // epoch number: that's the format useGlobalTasks.js actually writes on its
  // optimistic path (see the plan's "completed_at in two formats" risk) —
  // this is the regression that would show "Invalid Date" if formatDateTime
  // only accepted numbers. This test is ALSO the mutation proof for
  // "selection by id, not by object": if TarefasV2 stored the whole `task`
  // object instead of the `id`, this test goes red (the modal would show the
  // stale `pending` snapshot forever).
  //
  // Finally, closing with Escape at this point returns focus to the title
  // button while the ROW HAS MOVED SECTIONS (Em aberto -> Concluídas) — the
  // exact case the "look up the button by id at close time, not by a saved
  // ref" design exists for (see handleCloseDetail in TarefasV2.jsx).
  it('toggling inside the modal reflects in the list without reload, and Escape still returns focus after the row moves sections', () => {
    const completeTask = vi.fn();
    const pendingTask = fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' });
    mockUseGlobalTasks.mockReturnValue({
      tasks: [pendingTask],
      loading: false,
      completeTask,
      reopenTask: vi.fn(),
    });
    const { rerender } = render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));
    fireEvent.click(screen.getByText('Marcar concluída'));
    expect(completeTask).toHaveBeenCalledWith('projA::claude', 1);

    const doneTask = {
      ...pendingTask,
      status: 'done',
      completed_at: new Date(2026, 8, 22, 15, 0).toISOString(),
    };
    mockUseGlobalTasks.mockReturnValue({
      tasks: [doneTask],
      loading: false,
      completeTask,
      reopenTask: vi.fn(),
    });
    rerender(<TarefasV2 />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Concluída')).toBeTruthy();
    expect(within(dialog).getByText('Reabrir')).toBeTruthy();
    expect(within(dialog).getByText('22/09/2026 15:00')).toBeTruthy();

    // QA addition: the requirement is "reflects in the list AND the modal" —
    // the assertions above only covered the modal side. The row behind the
    // (portalized) dialog must also show the new status and have moved into
    // the "Concluídas" count.
    expect(within(screen.getByTestId('tarefas-v2-row-1')).getByText('Concluída')).toBeTruthy();
    expect(screen.getByTestId('tarefas-v2-group-header-done').textContent).toContain('(1)');

    // Portalized via createPortal (CenteredModal) — query with `screen`, not
    // `within(row)`, or the dialog would never be found.
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement.id).toBe('task-detail-title-1');
  });

  it('closing by clicking the backdrop closes the modal', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));
    const scrim = screen.getByTestId('centered-modal-scrim');
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing via the × button closes the modal', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));
    fireEvent.click(screen.getByLabelText('Fechar'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the title control is a real <button type="button">, not a styled div — Enter/Space work by native browser behavior, and this guards the regression the plan explicitly warns about (role="button" on the row swallowing the nested circle control)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 />);

    const titleBtn = screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' });
    expect(titleBtn.tagName).toBe('BUTTON');
    expect(titleBtn.getAttribute('type')).toBe('button');
  });

  it('reopening from inside the modal reflects on the list and in the modal, mirroring the optimistic completed_at:null that useGlobalTasks.reopenTask actually writes', () => {
    const reopenTask = vi.fn();
    const doneTask = fakeTask({
      id: 1,
      titulo: 'Tarefa feita',
      status: 'done',
      // Explicit created_at so "Criada em" resolves to a real date, not '—'
      // — otherwise BOTH rail rows show '—' before the reopen (fakeTask
      // leaves created_at undefined) and getByText('—') below is ambiguous.
      created_at: new Date(2026, 8, 19, 8, 0).getTime() / 1000,
      completed_at: new Date(2026, 8, 20, 10, 0).toISOString(),
    });
    mockUseGlobalTasks.mockReturnValue({ tasks: [doneTask], loading: false, completeTask: vi.fn(), reopenTask });
    const { rerender } = render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa feita"' }));
    fireEvent.click(screen.getByText('Reabrir'));
    expect(reopenTask).toHaveBeenCalledWith('projA::claude', 1);

    const reopenedTask = { ...doneTask, status: 'pending', completed_at: null };
    mockUseGlobalTasks.mockReturnValue({ tasks: [reopenedTask], loading: false, completeTask: vi.fn(), reopenTask });
    rerender(<TarefasV2 />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Em aberto')).toBeTruthy();
    expect(within(dialog).getByText('Marcar concluída')).toBeTruthy();
    expect(within(dialog).getByText('—')).toBeTruthy(); // "Concluída em" back to empty

    expect(within(screen.getByTestId('tarefas-v2-row-1')).getByText('Em aberto')).toBeTruthy();
    expect(screen.getByTestId('tarefas-v2-group-header-open').textContent).toContain('(1)');
  });
});

// Selection lifetime vs. the underlying `tasks` list — the requirement asks
// explicitly: if the selected task drops out of the list (filter change or a
// reload without it), the modal must close or at least not break.
describe('TarefasV2 — task detail modal: selection lost mid-session', () => {
  it('closes the modal without crashing when the selected task drops out of the list entirely (e.g. a reload without it)', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' })],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    const { rerender } = render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    mockUseGlobalTasks.mockReturnValue({ tasks: [], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    expect(() => rerender(<TarefasV2 />)).not.toThrow();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Regression guard: `selectedTaskId` must be cleared when the selected task
  // disappears from `tasks`, not only on an explicit close. Otherwise, if the
  // SAME id comes back in a later poll (5s cadence, useGlobalTasks.js), the
  // modal would pop back open on its own with no user action in between.
  it('does NOT silently reopen when the same task id reappears in a later poll after disappearing', () => {
    const task = fakeTask({ id: 1, titulo: 'Tarefa aberta', status: 'pending' });
    mockUseGlobalTasks.mockReturnValue({ tasks: [task], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    const { rerender } = render(<TarefasV2 />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa aberta"' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    mockUseGlobalTasks.mockReturnValue({ tasks: [], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    rerender(<TarefasV2 />);
    expect(screen.queryByRole('dialog')).toBeNull();

    mockUseGlobalTasks.mockReturnValue({ tasks: [task], loading: false, completeTask: vi.fn(), reopenTask: vi.fn() });
    rerender(<TarefasV2 />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Not a bug — documented design behavior: selection is read from the RAW
  // `tasks` list (useGlobalTasks), not from the client-filtered view built in
  // this component. A local client-filter change that hides the row behind
  // the modal does not touch `tasks`, so the modal stays open. This satisfies
  // "does not break"; it just does not auto-close on a filter change.
  it('keeps the modal open when a local client-filter change hides the selected task from the visible list', () => {
    mockUseGlobalTasks.mockReturnValue({
      tasks: [
        fakeTask({ id: 1, titulo: 'Tarefa Cliente B', status: 'pending', projeto_id: 'clienteB' }),
        fakeTask({ id: 2, titulo: 'Tarefa Cliente Z', status: 'pending', projeto_id: 'clienteZ' }),
      ],
      loading: false,
      completeTask: vi.fn(),
      reopenTask: vi.fn(),
    });
    render(<TarefasV2 projects={[...clienteWithSubsProjects, otherCliente]} selectedClienteId={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de "Tarefa Cliente Z"' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'clienteB' } });

    expect(screen.queryByRole('button', { name: 'Ver detalhes de "Tarefa Cliente Z"' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
