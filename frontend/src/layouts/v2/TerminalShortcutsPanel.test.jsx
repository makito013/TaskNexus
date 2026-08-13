// frontend/src/layouts/v2/TerminalShortcutsPanel.test.jsx
// Usa um objeto simples { current: { sendControlByte: vi.fn() } } no lugar do
// ref do TerminalPanel — nenhum TerminalPanel/xterm.js real aqui.
//
// Fase 1 do FAB: o hard gate de useIsTouchDevice saiu deste componente e subiu
// pro TerminalShortcutsFab, então o mock do hook e o describe do gate saíram
// junto (o teste do gate reaparece em TerminalShortcutsFab.test.jsx). O que
// resta aqui é o contrato que este componente ainda é dono: os 8 payloads, o
// slop de tap-vs-arrasto e a null-safety do ref.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TerminalShortcutsPanel } from './TerminalShortcutsPanel.jsx';

afterEach(() => {
  cleanup();
});

// left/top/transformOrigin são calculados pelo FAB (utils/fabGeometry.js
// getPanelPlacement) e chegam prontos como prop; para este arquivo qualquer
// valor serve, o posicionamento não é o que está sob teste aqui.
const PLACEMENT = { left: 100, top: 200, transformOrigin: 'left top' };

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

describe('TerminalShortcutsPanel — buttons', () => {
  it('renders all 8 expected buttons', () => {
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte: vi.fn() } }} {...PLACEMENT} />);
    BUTTONS.forEach(({ ariaLabel }) => {
      expect(screen.getByLabelText(ariaLabel)).toBeTruthy();
    });
  });

  it.each(BUTTONS)('$ariaLabel calls sendControlByte with the right payload on a tap (down+up, no movement)', ({ ariaLabel, payload }) => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText(ariaLabel);
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(payload);
  });

  it('does not call sendControlByte when the pointer moves past the tap threshold before going up (not a tap)', () => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 40, clientY: 10 }); // 30px, past TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 40, clientY: 10 });
    expect(sendControlByte).not.toHaveBeenCalled();
  });

  it('still calls sendControlByte when movement stays within the tap threshold', () => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 14, clientY: 10 }); // 4px, within TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 14, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(new Uint8Array([0x1b]));
  });

  it('does not throw when terminalRef.current is null', () => {
    render(<TerminalShortcutsPanel terminalRef={{ current: null }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    expect(() => {
      fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    }).not.toThrow();
  });

  it('does not throw when terminalRef itself is not passed', () => {
    expect(() => render(<TerminalShortcutsPanel {...PLACEMENT} />)).not.toThrow();
  });
});
