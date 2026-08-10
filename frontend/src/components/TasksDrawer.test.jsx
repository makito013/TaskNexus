// frontend/src/components/TasksDrawer.test.jsx

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TasksDrawer } from './TasksDrawer.jsx';

afterEach(() => cleanup());

describe('TasksDrawer — empty list', () => {
  it('renders without error, showing the empty-state message and the "+ Nova Tarefa" CTA', () => {
    render(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={[]}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('Nenhuma tarefa nesta sessão')).not.toBeNull();
    expect(screen.getAllByText('+ Nova Tarefa').length).toBeGreaterThan(0);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <TasksDrawer
        open={false}
        sessionKey="projA::claude"
        tasks={[]}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('TasksDrawer — with tasks', () => {
  const tasks = [
    { id: 1, session_key: 'projA::claude', titulo: 'Pendente 1', descricao_markdown: '', descricao_html: null, status: 'pending', created_at: 't', completed_at: null },
    { id: 2, session_key: 'projA::claude', titulo: 'Feita 1', descricao_markdown: '', descricao_html: null, status: 'done', created_at: 't', completed_at: 't2' },
  ];

  it('shows pending tasks and a collapsed "Concluídas" section for done tasks', () => {
    render(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={tasks}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('Pendente 1')).not.toBeNull();
    expect(screen.queryByText('Feita 1')).toBeNull(); // collapsed by default
    expect(screen.getByText('▸ Concluídas (1)')).not.toBeNull();
  });

  it('tapping the completion circle calls onCompleteTask with the session key and task id', () => {
    const onCompleteTask = vi.fn();
    render(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={tasks}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={onCompleteTask}
        onUncompleteTask={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Marcar "Pendente 1" como concluída'));
    expect(onCompleteTask).toHaveBeenCalledWith('projA::claude', 1);
  });

  it('tapping the circle of a completed task calls onUncompleteTask and moves it back to pending', () => {
    const onUncompleteTask = vi.fn();
    const { rerender } = render(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={tasks}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={onUncompleteTask}
        onContinue={vi.fn()}
      />
    );

    // Expand "Concluídas" to reveal the completed task's circle.
    fireEvent.click(screen.getByText('▸ Concluídas (1)'));
    fireEvent.click(screen.getByLabelText('Reabrir "Feita 1" (marcar como pendente)'));
    expect(onUncompleteTask).toHaveBeenCalledWith('projA::claude', 2);

    // Simulate the optimistic update: parent flips task 2 back to pending.
    const updatedTasks = tasks.map((t) => (t.id === 2 ? { ...t, status: 'pending', completed_at: null } : t));
    rerender(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={updatedTasks}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={onUncompleteTask}
        onContinue={vi.fn()}
      />
    );

    expect(screen.getByText('Feita 1')).not.toBeNull(); // now in the pending list
    expect(screen.queryByText('▸ Concluídas (1)')).toBeNull(); // completed section gone
  });

  it('"Continuar" is always enabled regardless of pending count', () => {
    const onContinue = vi.fn();
    render(
      <TasksDrawer
        open
        sessionKey="projA::claude"
        tasks={tasks}
        onClose={vi.fn()}
        onCreateTask={vi.fn()}
        onCompleteTask={vi.fn()}
        onUncompleteTask={vi.fn()}
        onContinue={onContinue}
      />
    );

    const btn = screen.getByText('Continuar');
    expect(btn.disabled).toBeFalsy();
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalledWith('projA::claude');
  });
});
