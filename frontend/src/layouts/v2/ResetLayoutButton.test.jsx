// frontend/src/layouts/v2/ResetLayoutButton.test.jsx
// Botão "Ajustar layout" (Chat, Layout v2): cobre o contrato isolado do
// componente — chama activePanelRef.current.forceFit() ao clicar, mostra
// feedback visual por ~900ms, respeita `disabled`, é defensivo contra
// activePanelRef.current === null, e limpa seu timer no unmount (sem
// warning de "act" depois do teste). TerminalPanel real não entra aqui —
// activePanelRef é um mock simples, mesmo padrão sugerido pelo TL.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ResetLayoutButton } from './ResetLayoutButton.jsx';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ResetLayoutButton', () => {
  it('clicking calls forceFit() on the current active panel ref', () => {
    const activePanelRef = { current: { forceFit: vi.fn() } };
    render(<ResetLayoutButton activePanelRef={activePanelRef} disabled={false} />);

    fireEvent.click(screen.getByText('↺ Ajustar layout'));

    expect(activePanelRef.current.forceFit).toHaveBeenCalledTimes(1);
  });

  it('shows "✓ Ajustado" feedback after clicking, then reverts to the original label after ~900ms', () => {
    const activePanelRef = { current: { forceFit: vi.fn() } };
    render(<ResetLayoutButton activePanelRef={activePanelRef} disabled={false} />);

    fireEvent.click(screen.getByText('↺ Ajustar layout'));
    expect(screen.getByText('✓ Ajustado')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByText('↺ Ajustar layout')).toBeTruthy();
    expect(screen.queryByText('✓ Ajustado')).toBeNull();
  });

  it('disabled: clicking does not call forceFit()', () => {
    const activePanelRef = { current: { forceFit: vi.fn() } };
    render(<ResetLayoutButton activePanelRef={activePanelRef} disabled={true} />);

    const button = screen.getByText('↺ Ajustar layout');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    expect(activePanelRef.current.forceFit).not.toHaveBeenCalled();
  });

  it('does not throw when activePanelRef.current is null', () => {
    const activePanelRef = { current: null };
    render(<ResetLayoutButton activePanelRef={activePanelRef} disabled={false} />);

    expect(() => {
      fireEvent.click(screen.getByText('↺ Ajustar layout'));
    }).not.toThrow();
  });

  it('clears its feedback timer on unmount (no pending act warning)', () => {
    const activePanelRef = { current: { forceFit: vi.fn() } };
    const { unmount } = render(<ResetLayoutButton activePanelRef={activePanelRef} disabled={false} />);

    fireEvent.click(screen.getByText('↺ Ajustar layout'));
    expect(screen.getByText('✓ Ajustado')).toBeTruthy();

    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(900);
      });
    }).not.toThrow();
  });
});
