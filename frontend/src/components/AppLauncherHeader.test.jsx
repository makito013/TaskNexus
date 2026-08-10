// frontend/src/components/AppLauncherHeader.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppLauncherHeader } from './AppLauncherHeader.jsx';

afterEach(() => {
  cleanup();
});

describe('AppLauncherHeader — current system label', () => {
  it('shows "Escritório" for currentPath="/"', () => {
    render(<AppLauncherHeader currentPath="/" onNavigate={vi.fn()} />);
    expect(screen.getByText('Escritório')).not.toBeNull();
  });

  it('shows "Board" for currentPath="/board"', () => {
    render(<AppLauncherHeader currentPath="/board" onNavigate={vi.fn()} />);
    expect(screen.getByText('Board')).not.toBeNull();
  });

  it('shows "Tarefas" for currentPath="/tarefas"', () => {
    render(<AppLauncherHeader currentPath="/tarefas" onNavigate={vi.fn()} />);
    expect(screen.getByText('Tarefas')).not.toBeNull();
  });
});

describe('AppLauncherHeader — dropdown open/close', () => {
  it('opens the dropdown when the strip is clicked, and closes on a second click', () => {
    render(<AppLauncherHeader currentPath="/" onNavigate={vi.fn()} />);
    const trigger = screen.getByRole('button');

    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the dropdown when clicking outside of it', () => {
    render(
      <div>
        <AppLauncherHeader currentPath="/" onNavigate={vi.fn()} />
        <div data-testid="outside">conteúdo fora do header</div>
      </div>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the dropdown when Escape is pressed', () => {
    render(<AppLauncherHeader currentPath="/" onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('AppLauncherHeader — navigation via dropdown', () => {
  it('forwards a click on a dropdown item to onNavigate', () => {
    const onNavigate = vi.fn();
    render(<AppLauncherHeader currentPath="/" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Board'));

    expect(onNavigate).toHaveBeenCalledWith('/board');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
