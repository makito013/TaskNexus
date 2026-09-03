// frontend/src/components/SystemSwitcherDropdown.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SystemSwitcherDropdown } from './SystemSwitcherDropdown.jsx';
import { SYSTEMS } from '../config/systems.js';

afterEach(() => {
  cleanup();
});

describe('SystemSwitcherDropdown — listing', () => {
  it('lists the 2 systems in the order defined by SYSTEMS (Tarefas, Escritório)', () => {
    render(<SystemSwitcherDropdown currentPath="/" onNavigate={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining('Tarefas'),
      expect.stringContaining('Escritório'),
    ]);
    expect(SYSTEMS.map((s) => s.nome)).toEqual(['Tarefas', 'Escritório']);
    // The retired v1 board must not come back as a launcher entry.
    expect(screen.queryByText('Board')).toBeNull();
  });
});

describe('SystemSwitcherDropdown — navigation', () => {
  it('calls onNavigate with the clicked item route, then onClose', () => {
    const calls = [];
    const onNavigate = vi.fn((rota) => calls.push(['onNavigate', rota]));
    const onClose = vi.fn(() => calls.push(['onClose']));

    render(<SystemSwitcherDropdown currentPath="/" onNavigate={onNavigate} onClose={onClose} />);
    fireEvent.click(screen.getByText('Tarefas'));

    expect(onNavigate).toHaveBeenCalledWith('/tarefas');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([['onNavigate', '/tarefas'], ['onClose']]);
  });

  it('calls onNavigate with "/" for the Escritório item', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<SystemSwitcherDropdown currentPath="/tarefas" onNavigate={onNavigate} onClose={onClose} />);

    fireEvent.click(screen.getByText('Escritório'));
    expect(onNavigate).toHaveBeenCalledWith('/');
  });
});

describe('SystemSwitcherDropdown — current route highlight', () => {
  it('marks the item matching currentPath with a check, others with a chevron', () => {
    render(<SystemSwitcherDropdown currentPath="/tarefas" onNavigate={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');

    const tarefasItem = items.find((el) => el.textContent.includes('Tarefas'));
    const escritorioItem = items.find((el) => el.textContent.includes('Escritório'));

    expect(tarefasItem.textContent).toContain('✓');
    expect(escritorioItem.textContent).toContain('›');
  });
});
