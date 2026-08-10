// frontend/src/components/SystemSwitcherDropdown.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SystemSwitcherDropdown } from './SystemSwitcherDropdown.jsx';
import { SYSTEMS } from '../config/systems.js';

afterEach(() => {
  cleanup();
});

describe('SystemSwitcherDropdown — listing', () => {
  it('lists the 3 systems in the order defined by SYSTEMS (Tarefas, Board, Escritório)', () => {
    render(<SystemSwitcherDropdown currentPath="/" onNavigate={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining('Tarefas'),
      expect.stringContaining('Board'),
      expect.stringContaining('Escritório'),
    ]);
    expect(SYSTEMS.map((s) => s.nome)).toEqual(['Tarefas', 'Board', 'Escritório']);
  });
});

describe('SystemSwitcherDropdown — navigation', () => {
  it('calls onNavigate with the clicked item route, then onClose', () => {
    const calls = [];
    const onNavigate = vi.fn((rota) => calls.push(['onNavigate', rota]));
    const onClose = vi.fn(() => calls.push(['onClose']));

    render(<SystemSwitcherDropdown currentPath="/" onNavigate={onNavigate} onClose={onClose} />);
    fireEvent.click(screen.getByText('Board'));

    expect(onNavigate).toHaveBeenCalledWith('/board');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([['onNavigate', '/board'], ['onClose']]);
  });

  it('calls onNavigate with "/tarefas" and "/" for the other two items', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<SystemSwitcherDropdown currentPath="/board" onNavigate={onNavigate} onClose={onClose} />);

    fireEvent.click(screen.getByText('Tarefas'));
    expect(onNavigate).toHaveBeenCalledWith('/tarefas');

    fireEvent.click(screen.getByText('Escritório'));
    expect(onNavigate).toHaveBeenCalledWith('/');
  });
});

describe('SystemSwitcherDropdown — current route highlight', () => {
  it('marks the item matching currentPath with a check, others with a chevron', () => {
    render(<SystemSwitcherDropdown currentPath="/board" onNavigate={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');

    const boardItem = items.find((el) => el.textContent.includes('Board'));
    const tarefasItem = items.find((el) => el.textContent.includes('Tarefas'));
    const escritorioItem = items.find((el) => el.textContent.includes('Escritório'));

    expect(boardItem.textContent).toContain('✓');
    expect(tarefasItem.textContent).toContain('›');
    expect(escritorioItem.textContent).toContain('›');
  });
});
