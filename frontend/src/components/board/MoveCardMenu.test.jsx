// frontend/src/components/board/MoveCardMenu.test.jsx
// Covers Designer 05-DESIGNER.md seção 8 / 05-mockup.html openSheet/closeSheet:
// bottom sheet with 4 status options, current status disabled + checkmark,
// backdrop and "Cancelar" both close without moving.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MoveCardMenu } from './MoveCardMenu.jsx';

afterEach(() => cleanup());

describe('MoveCardMenu — open=false', () => {
  it('renders nothing, not even the backdrop', () => {
    render(
      <MoveCardMenu
        open={false}
        currentStatus="a_fazer"
        onMove={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText('Mover para...')).toBeNull();
    expect(screen.queryByTestId('move-card-menu-backdrop')).toBeNull();
    expect(screen.queryByText('A Fazer')).toBeNull();
  });
});

describe('MoveCardMenu — open=true', () => {
  it('renders all 4 status options with the current one disabled and checked', () => {
    render(
      <MoveCardMenu
        open={true}
        currentStatus="em_andamento"
        onMove={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Mover para...')).not.toBeNull();
    expect(screen.getByText('A Fazer')).not.toBeNull();
    expect(screen.getByText('Em Andamento')).not.toBeNull();
    expect(screen.getByText('Em Revisão')).not.toBeNull();
    expect(screen.getByText('Feito')).not.toBeNull();

    const currentOption = screen.getByText('Em Andamento').closest('button');
    expect(currentOption.disabled).toBe(true);
    expect(currentOption.textContent).toContain('✓');

    const otherOption = screen.getByText('A Fazer').closest('button');
    expect(otherOption.disabled).toBe(false);
    expect(otherOption.textContent).not.toContain('✓');
  });

  it('clicking a different option calls onMove with the new status and then onClose', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveCardMenu
        open={true}
        currentStatus="a_fazer"
        onMove={onMove}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('Feito'));

    expect(onMove).toHaveBeenCalledWith('feito');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the option that is already the current status does not call onMove', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveCardMenu
        open={true}
        currentStatus="em_revisao"
        onMove={onMove}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('Em Revisão'));

    expect(onMove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the backdrop calls onClose without calling onMove', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveCardMenu
        open={true}
        currentStatus="a_fazer"
        onMove={onMove}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByTestId('move-card-menu-backdrop'));

    expect(onClose).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clicking "Cancelar" calls onClose without calling onMove', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveCardMenu
        open={true}
        currentStatus="a_fazer"
        onMove={onMove}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('Cancelar'));

    expect(onClose).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
