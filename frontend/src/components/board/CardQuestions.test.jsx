import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CardQuestions, countPendingQuestions } from './CardQuestions.jsx';

function question(id, overrides = {}) {
  return {
    id,
    card_id: 7,
    question: `Pergunta ${id}?`,
    answer: null,
    asked_by: 'agente:claude',
    created_at: 1_760_000_000,
    answered_at: null,
    ...overrides,
  };
}

function renderQuestions(questions, handlers = {}) {
  const onAnswer = handlers.onAnswer ?? vi.fn().mockResolvedValue({});
  const onDelete = handlers.onDelete ?? vi.fn();
  const utils = render(
    <CardQuestions cardId={7} questions={questions} onAnswer={onAnswer} onDelete={onDelete} />
  );
  return { ...utils, onAnswer, onDelete };
}

describe('CardQuestions', () => {
  it('counts only unanswered questions as pending', () => {
    expect(countPendingQuestions([question(1), question(2, { answer: 'sim' })])).toBe(1);
    expect(countPendingQuestions(undefined)).toBe(0);
  });

  it('renders nothing without questions', () => {
    const { container } = renderQuestions([]);
    expect(container.innerHTML).toBe('');
  });

  it('shows each question with its status and the saved answer', () => {
    renderQuestions([question(1), question(2, { answer: 'Postgres' })]);
    expect(screen.getByText('Aguardando resposta')).toBeTruthy();
    expect(screen.getByText('Respondida')).toBeTruthy();
    expect(screen.getByLabelText('Pergunta 2?').value).toBe('Postgres');
  });

  it('saves the trimmed answer on blur, once', async () => {
    const { onAnswer } = renderQuestions([question(1)]);
    const input = screen.getByLabelText('Pergunta 1?');
    fireEvent.change(input, { target: { value: '  Sim, pode.  ' } });
    await act(async () => { fireEvent.blur(input); });
    await act(async () => { fireEvent.blur(input); });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(1, 'Sim, pode.');
  });

  it('does not save when the answer did not change', async () => {
    const { onAnswer } = renderQuestions([question(1, { answer: 'sim' })]);
    const input = screen.getByLabelText('Pergunta 1?');
    fireEvent.change(input, { target: { value: 'sim ' } });
    await act(async () => { fireEvent.blur(input); });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('saves with Ctrl+Enter and with the "Salvar resposta" button', async () => {
    const { onAnswer } = renderQuestions([question(1), question(2)]);
    const first = screen.getByLabelText('Pergunta 1?');
    fireEvent.change(first, { target: { value: 'a' } });
    await act(async () => { fireEvent.keyDown(first, { key: 'Enter', ctrlKey: true }); });
    expect(onAnswer).toHaveBeenLastCalledWith(1, 'a');

    fireEvent.change(screen.getByLabelText('Pergunta 2?'), { target: { value: 'b' } });
    await act(async () => { fireEvent.click(screen.getByText('Salvar resposta')); });
    expect(onAnswer).toHaveBeenLastCalledWith(2, 'b');
  });

  it('shows an inline error when saving fails and keeps the draft', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('x'));
    renderQuestions([question(1)], { onAnswer });
    const input = screen.getByLabelText('Pergunta 1?');
    fireEvent.change(input, { target: { value: 'resposta' } });
    await act(async () => { fireEvent.blur(input); });
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível salvar');
    expect(input.value).toBe('resposta');
  });

  it('flushes an unsaved answer when it unmounts (modal closed with Esc)', () => {
    const { onAnswer, unmount } = renderQuestions([question(1)]);
    fireEvent.change(screen.getByLabelText('Pergunta 1?'), { target: { value: 'tarde' } });
    unmount();
    expect(onAnswer).toHaveBeenCalledWith(1, 'tarde');
  });

  it('removes a question', () => {
    const { onDelete } = renderQuestions([question(1)]);
    fireEvent.click(screen.getByLabelText('Remover pergunta: Pergunta 1?'));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});
