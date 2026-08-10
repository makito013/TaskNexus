// frontend/src/layouts/v2/TerminalShortcutsBar.test.jsx
// Mirrors the contract-testing style of ResetLayoutButton.test.jsx: mocks
// useIsTouchDevice directly (instead of matchMedia) to control the hard
// gate, and a plain { current: { sendControlByte: vi.fn() } } object to
// stand in for the TerminalPanel ref — no real TerminalPanel/xterm.js here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TerminalShortcutsBar } from './TerminalShortcutsBar.jsx';

const mockUseIsTouchDevice = vi.fn();
vi.mock('../../hooks/useIsTouchDevice.js', () => ({
  useIsTouchDevice: () => mockUseIsTouchDevice(),
}));

afterEach(() => {
  cleanup();
  mockUseIsTouchDevice.mockReset();
});

const BUTTONS = [
  { ariaLabel: 'Esc', payload: new Uint8Array([0x1b]) },
  { ariaLabel: 'Shift+Tab', payload: '\x1b[Z' },
  { ariaLabel: 'Tab', payload: '\t' },
  { ariaLabel: 'Seta para cima', payload: '\x1b[A' },
  { ariaLabel: 'Seta para baixo', payload: '\x1b[B' },
  { ariaLabel: 'Enter', payload: '\r' },
  { ariaLabel: 'Nova linha (Alt+Enter)', payload: '\x1b\r' },
  { ariaLabel: 'Ctrl+C', payload: new Uint8Array([0x03]) },
];

describe('TerminalShortcutsBar — hard gate on non-touch devices', () => {
  it('renders nothing when the device is not touch', () => {
    mockUseIsTouchDevice.mockReturnValue(false);
    const { container } = render(<TerminalShortcutsBar panelRef={{ current: null }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TerminalShortcutsBar — buttons on touch devices', () => {
  it('renders all 8 expected buttons', () => {
    mockUseIsTouchDevice.mockReturnValue(true);
    render(<TerminalShortcutsBar panelRef={{ current: { sendControlByte: vi.fn() } }} />);
    BUTTONS.forEach(({ ariaLabel }) => {
      expect(screen.getByLabelText(ariaLabel)).toBeTruthy();
    });
  });

  it.each(BUTTONS)('$ariaLabel calls sendControlByte with the right payload on a tap (down+up, no movement)', ({ ariaLabel, payload }) => {
    mockUseIsTouchDevice.mockReturnValue(true);
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsBar panelRef={{ current: { sendControlByte } }} />);
    const button = screen.getByLabelText(ariaLabel);
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(payload);
  });

  it('does not call sendControlByte when the pointer moves past the tap threshold before going up (a scroll drag)', () => {
    mockUseIsTouchDevice.mockReturnValue(true);
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsBar panelRef={{ current: { sendControlByte } }} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 40, clientY: 10 }); // 30px, past TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 40, clientY: 10 });
    expect(sendControlByte).not.toHaveBeenCalled();
  });

  it('still calls sendControlByte when movement stays within the tap threshold', () => {
    mockUseIsTouchDevice.mockReturnValue(true);
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsBar panelRef={{ current: { sendControlByte } }} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 14, clientY: 10 }); // 4px, within TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 14, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(new Uint8Array([0x1b]));
  });

  it('does not throw when panelRef.current is null', () => {
    mockUseIsTouchDevice.mockReturnValue(true);
    render(<TerminalShortcutsBar panelRef={{ current: null }} />);
    const button = screen.getByLabelText('Esc');
    expect(() => {
      fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    }).not.toThrow();
  });

  it('does not throw when panelRef itself is not passed', () => {
    mockUseIsTouchDevice.mockReturnValue(true);
    expect(() => render(<TerminalShortcutsBar />)).not.toThrow();
  });
});
