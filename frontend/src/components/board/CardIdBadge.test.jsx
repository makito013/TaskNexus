// frontend/src/components/board/CardIdBadge.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { CardIdBadge, formatCardId } from './CardIdBadge.jsx';

const mockCopy = vi.fn();
vi.mock('../../utils/clipboard.js', () => ({
  copyTextToClipboard: (...args) => mockCopy(...args),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('formatCardId', () => {
  it('prefixes the id with #', () => {
    expect(formatCardId(123)).toBe('#123');
  });
});

describe('CardIdBadge', () => {
  it('renders the id with a # and the client name when given one', () => {
    render(<CardIdBadge id={123} clienteNome="Cliente A" />);
    expect(screen.getByText('#123')).not.toBeNull();
    expect(screen.getByText('Cliente A')).not.toBeNull();
  });

  it('renders no client name when none is given', () => {
    render(<CardIdBadge id={123} />);
    expect(screen.queryByText('Cliente A')).toBeNull();
  });

  it('copies the BARE id, without the # prefix', async () => {
    mockCopy.mockResolvedValue(true);
    render(<CardIdBadge id={123} />);

    fireEvent.click(screen.getByLabelText('Copiar ID 123'));

    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('123'));
  });

  it('shows a success glyph after copying, then resets', async () => {
    vi.useFakeTimers();
    mockCopy.mockResolvedValue(true);
    render(<CardIdBadge id={123} />);
    const button = screen.getByLabelText('Copiar ID 123');

    await act(async () => { fireEvent.click(button); });
    expect(button.textContent).toBe('✓');

    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(button.textContent).toBe('⧉');
  });

  it('shows a failure glyph when the copy did not work', async () => {
    mockCopy.mockResolvedValue(false);
    render(<CardIdBadge id={123} />);
    const button = screen.getByLabelText('Copiar ID 123');

    fireEvent.click(button);

    await waitFor(() => expect(button.textContent).toBe('!'));
  });

  it('does NOT bubble the click to a clickable parent (the card face)', async () => {
    mockCopy.mockResolvedValue(true);
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <CardIdBadge id={123} />
      </div>
    );

    fireEvent.click(screen.getByLabelText('Copiar ID 123'));

    await waitFor(() => expect(mockCopy).toHaveBeenCalled());
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
