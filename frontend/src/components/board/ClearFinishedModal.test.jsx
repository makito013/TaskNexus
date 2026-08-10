// frontend/src/components/board/ClearFinishedModal.test.jsx
// Covers 05-DESIGNER.md seção 11.3 / 05-mockup.html openConfirmSheet /
// executeClearFinished: bottom sheet that previews on open, shows the exact
// copy with N/M from the preview, never renders `imagens_com_falha`, runs
// the destructive action through onExecute -> onSuccess -> onClose, handles
// the "nothing to clear" and error paths without getting stuck.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ClearFinishedModal } from './ClearFinishedModal.jsx';

afterEach(() => cleanup());

const baseProps = {
  open: true,
  projetoId: 'escritorio-agentes',
  projetoNome: 'escritorio-agentes',
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('ClearFinishedModal — open=false', () => {
  it('renders nothing and does not call onPreview', () => {
    const onPreview = vi.fn();
    render(
      <ClearFinishedModal
        {...baseProps}
        open={false}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    expect(screen.queryByTestId('clear-finished-backdrop')).toBeNull();
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe('ClearFinishedModal — abrindo', () => {
  it('calls onPreview(projetoId) automatically when open becomes true', () => {
    const onPreview = vi.fn().mockResolvedValue({ cards: 8, imagens: 3, imagens_com_falha: 0 });
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    expect(onPreview).toHaveBeenCalledWith('escritorio-agentes');
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state before the preview resolves', () => {
    const onPreview = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    expect(screen.getByText('Carregando…')).not.toBeNull();
  });
});

describe('ClearFinishedModal — preview resolvido com cards > 0', () => {
  it('shows the exact copy with N/M from the preview and never shows imagens_com_falha', async () => {
    const onPreview = vi.fn().mockResolvedValue({ cards: 8, imagens: 5, imagens_com_falha: 3 });
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Isso vai apagar permanentemente/)).not.toBeNull();
    });

    expect(screen.getByText('8 cards')).not.toBeNull();
    expect(screen.getByText('5 imagens')).not.toBeNull();
    expect(screen.getAllByText('escritorio-agentes').length).toBeGreaterThan(0);
    expect(screen.getByText(/Essa ação não pode ser desfeita/)).not.toBeNull();

    // imagens_com_falha (3, deliberately distinct from N=8/M=5 above) must
    // never surface anywhere in the rendered sheet.
    expect(screen.queryByText(/imagens_com_falha/)).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
    expect(screen.queryByText(/3 imagens? com falha/i)).toBeNull();
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).not.toMatch(/\bfalha/i);
  });

  it('shows "Apagar permanentemente" and "Cancelar" buttons', async () => {
    const onPreview = vi.fn().mockResolvedValue({ cards: 8, imagens: 3, imagens_com_falha: 0 });
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    expect(await screen.findByText('Apagar permanentemente')).not.toBeNull();
    expect(screen.getByText('Cancelar')).not.toBeNull();
  });
});

describe('ClearFinishedModal — executando a exclusão', () => {
  it('clicking "Apagar permanentemente" calls onExecute, then onSuccess, then onClose, in that order', async () => {
    const callOrder = [];
    const executeResult = { cards: 8, imagens: 5, imagens_com_falha: 0 };
    const onPreview = vi.fn().mockResolvedValue({ cards: 8, imagens: 5, imagens_com_falha: 0 });
    const onExecute = vi.fn().mockImplementation(async (projetoId) => {
      callOrder.push(['onExecute', projetoId]);
      return executeResult;
    });
    const onSuccess = vi.fn().mockImplementation((result) => {
      callOrder.push(['onSuccess', result]);
    });
    const onClose = vi.fn().mockImplementation(() => {
      callOrder.push(['onClose']);
    });

    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={onExecute}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    const executeButton = await screen.findByText('Apagar permanentemente');
    fireEvent.click(executeButton);

    // Disables buttons and shows "Apagando…" immediately.
    expect(await screen.findByText('Apagando…')).not.toBeNull();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(onExecute).toHaveBeenCalledWith('escritorio-agentes');
    expect(onSuccess).toHaveBeenCalledWith(executeResult);
    expect(callOrder.map((c) => c[0])).toEqual(['onExecute', 'onSuccess', 'onClose']);
  });
});

describe('ClearFinishedModal — preview com cards: 0', () => {
  it('shows the alternative message and no destructive button, only "Fechar"', async () => {
    const onPreview = vi.fn().mockResolvedValue({ cards: 0, imagens: 0, imagens_com_falha: 0 });
    const onClose = vi.fn();
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
        onClose={onClose}
      />
    );

    expect(await screen.findByText('Nenhum card concluído neste projeto ainda.')).not.toBeNull();
    expect(screen.queryByText('Apagar permanentemente')).toBeNull();
    expect(screen.queryByText('Cancelar')).toBeNull();

    const closeButton = screen.getByText('Fechar');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ClearFinishedModal — falha no preview', () => {
  it('shows an error instead of staying stuck on "Carregando…"', async () => {
    const onPreview = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />
    );

    expect(screen.getByText('Carregando…')).not.toBeNull();

    await waitFor(() => {
      expect(screen.queryByText('Carregando…')).toBeNull();
    });

    expect(screen.getByText(/não foi possível/i)).not.toBeNull();
    // Still allows closing instead of being stuck.
    expect(screen.getByText('Fechar')).not.toBeNull();
  });
});

describe('ClearFinishedModal — falha na execução', () => {
  it('shows an error instead of staying stuck on "Apagando…" and does not call onSuccess', async () => {
    const onPreview = vi.fn().mockResolvedValue({ cards: 8, imagens: 3, imagens_com_falha: 0 });
    const onExecute = vi.fn().mockRejectedValue(new Error('server error'));
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ClearFinishedModal
        {...baseProps}
        onPreview={onPreview}
        onExecute={onExecute}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    const executeButton = await screen.findByText('Apagar permanentemente');
    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(screen.queryByText('Apagando…')).toBeNull();
    });

    expect(screen.getByText(/não foi possível/i)).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
