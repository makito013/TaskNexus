// frontend/src/components/board/SubcardRow.test.jsx
// Covers Tarefa 21 (05-TL.md) / 05-DESIGNER.md seção 6.3: linha compacta de
// subcard — pill de status (abre MoveCardMenu reaproveitado) + título (abre
// onOpenEdit) — sem tira de imagem inline, sem badge de origem/timestamp.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SubcardRow } from './SubcardRow.jsx';

afterEach(() => cleanup());

const subcard = {
  id: 'sub-1',
  titulo: 'Testar em Safari 17 (iPad físico)',
  status: 'em_andamento',
};

describe('SubcardRow — renderização básica', () => {
  it('renders the title and the status pill for the current status', () => {
    render(<SubcardRow subcard={subcard} onMove={vi.fn()} onOpenEdit={vi.fn()} />);

    expect(screen.getByText('Testar em Safari 17 (iPad físico)')).not.toBeNull();

    const pill = screen.getByLabelText('Mover: Em Andamento');
    expect(pill).not.toBeNull();
    expect(pill.tagName).toBe('BUTTON');
  });

  it('does not render any image strip or origin/timestamp badge', () => {
    const { container } = render(
      <SubcardRow subcard={subcard} onMove={vi.fn()} onOpenEdit={vi.fn()} />
    );

    // Sem tira de imagens (ImageAttachments usa <img>/thumbs).
    expect(container.querySelectorAll('img').length).toBe(0);

    // Sem badge de origem ("criado por", "Claude", "Bruno", timestamps).
    expect(screen.queryByText(/criado por/i)).toBeNull();
    expect(screen.queryByText(/há \d+/i)).toBeNull();

    // Estrutura mínima: só o pill de status + o botão de título (mais
    // compacto que CardItem, que ainda não existe nesta fase do plano).
    expect(container.querySelectorAll('button').length).toBe(2);
  });
});

describe('SubcardRow — abrir menu de mover', () => {
  it('tapping the status pill opens MoveCardMenu with all 4 options', () => {
    render(<SubcardRow subcard={subcard} onMove={vi.fn()} onOpenEdit={vi.fn()} />);

    expect(screen.queryByText('Mover para...')).toBeNull();

    fireEvent.click(screen.getByLabelText('Mover: Em Andamento'));

    expect(screen.getByText('Mover para...')).not.toBeNull();
    expect(screen.getByText('A Fazer')).not.toBeNull();
    expect(screen.getByText('Em Andamento')).not.toBeNull();
    expect(screen.getByText('Em Revisão')).not.toBeNull();
    expect(screen.getByText('Feito')).not.toBeNull();
  });

  it('picking an option calls onMove(subcard.id, novoStatus) and closes the menu', () => {
    const onMove = vi.fn();
    render(<SubcardRow subcard={subcard} onMove={onMove} onOpenEdit={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Mover: Em Andamento'));
    fireEvent.click(screen.getByText('Feito'));

    expect(onMove).toHaveBeenCalledWith('sub-1', 'feito');
    expect(screen.queryByText('Mover para...')).toBeNull();
  });

  it('closing via backdrop or Cancelar does not call onMove', () => {
    const onMove = vi.fn();
    render(<SubcardRow subcard={subcard} onMove={onMove} onOpenEdit={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Mover: Em Andamento'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByText('Mover para...')).toBeNull();
  });
});

describe('SubcardRow — abrir edição pelo título', () => {
  it('tapping the title calls onOpenEdit(subcard.id) without opening the move menu', () => {
    const onOpenEdit = vi.fn();
    render(<SubcardRow subcard={subcard} onMove={vi.fn()} onOpenEdit={onOpenEdit} />);

    fireEvent.click(screen.getByText('Testar em Safari 17 (iPad físico)'));

    expect(onOpenEdit).toHaveBeenCalledWith('sub-1');
    expect(screen.queryByText('Mover para...')).toBeNull();
  });
});
