// frontend/src/components/TaskDetailModal.test.jsx
// Covers Designer decisions 6 and 7: the Markdown/Visualização segmented
// control only appears (and defaults to Markdown) when descricao_html is
// present, and the HTML preview iframe is sandboxed with NO allow-* tokens.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TaskDetailModal } from './TaskDetailModal.jsx';

afterEach(() => cleanup());

const baseTask = {
  id: 1,
  session_key: 'projA::claude',
  titulo: 'Investigar bug X',
  descricao_markdown: '# Título\n\nAlgum **texto**.',
  descricao_html: null,
  status: 'pending',
  created_at: '2026-07-10T00:00:00Z',
  completed_at: null,
};

describe('TaskDetailModal — view mode, descricao_html absent', () => {
  it('does not render the segmented control and shows the markdown content directly', () => {
    render(<TaskDetailModal task={baseTask} onClose={vi.fn()} onComplete={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.queryByText('Markdown')).toBeNull();
    expect(screen.queryByText('Visualização')).toBeNull();
    // marked() renders the h1 — its sanitized text should be present in the DOM.
    expect(screen.getByText('Título')).not.toBeNull();
  });
});

describe('TaskDetailModal — view mode, descricao_html present', () => {
  const taskWithHtml = { ...baseTask, descricao_html: '<html><body><h1>Preview</h1></body></html>' };

  it('renders the segmented control with Markdown as the initial active tab', () => {
    render(<TaskDetailModal task={taskWithHtml} onClose={vi.fn()} onComplete={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.getByText('Markdown')).not.toBeNull();
    expect(screen.getByText('Visualização')).not.toBeNull();
    // Markdown tab active by default: markdown content visible, no iframe yet.
    expect(screen.getByText('Título')).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders the HTML preview inside a sandboxed iframe with no allow-* tokens, using srcDoc', () => {
    render(<TaskDetailModal task={taskWithHtml} onClose={vi.fn()} onComplete={vi.fn()} onCreate={vi.fn()} />);

    fireEvent.click(screen.getByText('Visualização'));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.srcdoc).toBe(taskWithHtml.descricao_html);
  });
});

describe('TaskDetailModal — create mode', () => {
  it('renders título input + markdown textarea and no segmented control', () => {
    render(<TaskDetailModal task={null} onClose={vi.fn()} onComplete={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.getByPlaceholderText('Título da tarefa')).not.toBeNull();
    expect(screen.getByPlaceholderText('Descreva a tarefa em markdown...')).not.toBeNull();
    expect(screen.queryByText('Markdown')).toBeNull();
    expect(screen.queryByText('Visualização')).toBeNull();
  });

  it('calls onCreate with the entered título and markdown, then closes', async () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    const onClose = vi.fn();
    render(<TaskDetailModal task={null} onClose={onClose} onComplete={vi.fn()} onCreate={onCreate} />);

    const titleInput = screen.getByPlaceholderText('Título da tarefa');
    titleInput.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(titleInput, 'Nova tarefa');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    fireEvent.click(screen.getByText('Criar tarefa'));

    await new Promise((r) => setTimeout(r, 0));

    expect(onCreate).toHaveBeenCalledWith({ titulo: 'Nova tarefa', descricao_markdown: '', descricao_html: null });
    expect(onClose).toHaveBeenCalled();
  });
});
