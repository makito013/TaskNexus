// frontend/src/layouts/v2/CenteredModal.test.jsx
// Isolated coverage of the CenteredModal primitive (feature Novo Chat em
// modal): open/close, ESC, the pressStartedOnOverlay scrim guard (the real
// guard — mousedown inside + mouseup/click outside must NOT close), initial
// focus (initialFocusRef, with fallback to the panel), and the dialog a11y
// attributes. Also confirms `screen` finds the portalized node without any
// extra setup — RTL queries document.body by default.

import { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CenteredModal } from './CenteredModal.jsx';

afterEach(() => cleanup());

describe('CenteredModal — visibility', () => {
  it('renders nothing (not even the scrim) when open=false', () => {
    render(
      <CenteredModal open={false} onClose={vi.fn()} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    expect(screen.queryByTestId('centered-modal-scrim')).toBeNull();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('renders the scrim, the panel and the children when open=true', () => {
    render(
      <CenteredModal open onClose={vi.fn()} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    expect(screen.getByTestId('centered-modal-scrim')).not.toBeNull();
    expect(screen.getByTestId('centered-modal-panel')).not.toBeNull();
    expect(screen.getByText('content')).not.toBeNull();
  });

  it('is portalized to document.body — the panel is found via `screen` with no extra container setup', () => {
    render(
      <CenteredModal open onClose={vi.fn()} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    const panel = screen.getByTestId('centered-modal-panel');
    expect(document.body.contains(panel)).toBe(true);
  });
});

describe('CenteredModal — dialog a11y attributes', () => {
  it('sets role="dialog", aria-modal="true" and aria-label from the ariaLabel prop', () => {
    render(
      <CenteredModal open onClose={vi.fn()} ariaLabel="Novo chat em podesubir">
        <div>content</div>
      </CenteredModal>
    );
    const panel = screen.getByRole('dialog', { name: 'Novo chat em podesubir' });
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });
});

describe('CenteredModal — ESC closes', () => {
  it('ESC calls onClose while open', () => {
    const onClose = vi.fn();
    render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('other keys do not call onClose', () => {
    const onClose = vi.fn();
    render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the keydown listener does not leak when closed: ESC after open->closed no longer calls onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    rerender(
      <CenteredModal open={false} onClose={onClose} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CenteredModal — scrim guard (pressStartedOnOverlay)', () => {
  it('a plain click on the scrim (mousedown + click both on the overlay) calls onClose', () => {
    const onClose = vi.fn();
    render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <div>content</div>
      </CenteredModal>
    );
    const scrim = screen.getByTestId('centered-modal-scrim');
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mousedown inside the panel followed by a click landing on the overlay does NOT close (real guard)', () => {
    const onClose = vi.fn();
    render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <button type="button">Inner action</button>
      </CenteredModal>
    );
    const scrim = screen.getByTestId('centered-modal-scrim');
    const innerButton = screen.getByText('Inner action');
    // The press STARTS inside the panel (e.g. dragging a <select> open and
    // releasing outside) — pressStartedOnOverlay must stay false even
    // though the click event itself later resolves to the overlay.
    fireEvent.mouseDown(innerButton);
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking inside the panel content does not close', () => {
    const onClose = vi.fn();
    render(
      <CenteredModal open onClose={onClose} ariaLabel="Test modal">
        <button type="button">Inner action</button>
      </CenteredModal>
    );
    const innerButton = screen.getByText('Inner action');
    fireEvent.mouseDown(innerButton);
    fireEvent.click(innerButton);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CenteredModal — initial focus', () => {
  function Fixture({ open, useInitialFocusRef }) {
    const selectRef = useRef(null);
    return (
      <CenteredModal
        open={open}
        onClose={vi.fn()}
        ariaLabel="Test modal"
        initialFocusRef={useInitialFocusRef ? selectRef : undefined}
      >
        <select ref={selectRef} aria-label="Projeto">
          <option value="">Raiz</option>
        </select>
      </CenteredModal>
    );
  }

  it('focuses initialFocusRef.current when provided', () => {
    render(<Fixture open useInitialFocusRef />);
    const select = screen.getByLabelText('Projeto');
    expect(document.activeElement).toBe(select);
  });

  it('falls back to focusing the panel when initialFocusRef is not provided', () => {
    render(<Fixture open useInitialFocusRef={false} />);
    const panel = screen.getByTestId('centered-modal-panel');
    expect(document.activeElement).toBe(panel);
  });
});
