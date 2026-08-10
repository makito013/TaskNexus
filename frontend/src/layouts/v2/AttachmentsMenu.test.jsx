// frontend/src/layouts/v2/AttachmentsMenu.test.jsx
// Menu de anexos por projeto (Chat, Layout v2): cobre o contrato isolado do
// componente — trigger com badge/disabled, abrir/fechar do popover (×/scrim/
// ESC/troca de sessão), upload com sucesso parcial (lote com erro e retry por
// linha), "usar no chat" (feedback "✓ Inserido" sem fechar o painel) e
// remoção com confirmação inline de 2 toques. `api.js` é mockado — este teste
// não bate em rede nem em filesystem real, mesmo espírito de
// TaskQuickCreatePopover.test.jsx/ResetLayoutButton.test.jsx.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentsMenu } from './AttachmentsMenu.jsx';
import { api } from '../../services/api.js';

vi.mock('../../services/api.js', () => ({
  api: {
    listAttachments: vi.fn(),
    uploadAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    pasteToSession: vi.fn(),
  },
}));

// Timers reais em todo o arquivo, de propósito: quase todo teste aqui espera
// uma chamada de api.js resolver via `waitFor` (que faz polling com
// setTimeout real) — com fake timers globais, esse polling nunca avança e
// todo teste com `waitFor` trava até o timeout do vitest. Os 2 testes que
// realmente precisam observar o `setTimeout` interno do componente (feedback
// de "usar no chat" e confirmação de remoção) esperam o tempo de parede real
// em vez de fake timers, para não misturar os dois mundos no mesmo teste.
const ATTACHMENT = {
  id: '1780512345-a1b2c3d4',
  original_name: 'print-bug.png',
  size_bytes: 2048,
  uploaded_at: new Date().toISOString(),
  content_type: 'image/png',
  path: 'D:\\projetos\\Pessoal\\escritorio-agentes\\.escritorio\\attachments\\1780512345-a1b2c3d4\\print-bug.png',
};

beforeEach(() => {
  api.listAttachments.mockResolvedValue({ attachments: [] });
  api.uploadAttachments.mockResolvedValue({ attachments: [], errors: [] });
  api.deleteAttachment.mockResolvedValue({ status: 'deleted' });
  api.pasteToSession.mockResolvedValue({ status: 'sent' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openPanel() {
  fireEvent.click(screen.getByTestId('attachments-menu-trigger'));
}

describe('AttachmentsMenu — trigger', () => {
  it('disabled quando não há sessão ativa', () => {
    render(<AttachmentsMenu activeSessionKey={null} />);
    expect(screen.getByTestId('attachments-menu-trigger').disabled).toBe(true);
  });

  it('sem badge quando não há anexos', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('mostra badge com a contagem total de anexos, com cap "9+"', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...ATTACHMENT, id: `a-${i}` }));
    api.listAttachments.mockResolvedValue({ attachments: many });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);

    openPanel();
    await waitFor(() => expect(screen.getByText('9+')).toBeTruthy());
  });
});

describe('AttachmentsMenu — abrir/fechar do painel', () => {
  it('clicar no trigger abre o painel e busca os anexos do PROJETO (1º segmento da session key)', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    expect(screen.getByTestId('attachments-menu-panel')).toBeTruthy();
    expect(api.listAttachments).toHaveBeenCalledWith('meu-projeto');
  });

  it('clicar no "×" fecha o painel', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(screen.queryByTestId('attachments-menu-panel')).toBeNull();
  });

  it('clicar no scrim (fora do painel) fecha', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    fireEvent.click(screen.getByTestId('attachments-menu-scrim'));
    expect(screen.queryByTestId('attachments-menu-panel')).toBeNull();
  });

  it('clicar DENTRO do painel não fecha (stopPropagation)', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    fireEvent.click(screen.getByTestId('attachments-menu-panel'));
    expect(screen.getByTestId('attachments-menu-panel')).toBeTruthy();
  });

  it('ESC fecha', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('attachments-menu-panel')).toBeNull();
  });

  it('fecha sozinho quando a sessão ativa muda enquanto está aberto', async () => {
    const { rerender } = render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    expect(screen.getByTestId('attachments-menu-panel')).toBeTruthy();

    rerender(<AttachmentsMenu activeSessionKey="outro-projeto::claude" />);
    expect(screen.queryByTestId('attachments-menu-panel')).toBeNull();
  });
});

describe('AttachmentsMenu — listagem', () => {
  it('mostra "Nenhum anexo ainda." quando a lista vem vazia', async () => {
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Nenhum anexo ainda.')).toBeTruthy());
  });

  it('lista os anexos retornados, com nome/tamanho/ações', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    await waitFor(() => expect(screen.getByText('print-bug.png')).toBeTruthy());
    expect(screen.getByText('Usar no chat')).toBeTruthy();
    expect(screen.getByText('Remover')).toBeTruthy();
  });

  it('falha ao listar mostra erro com botão de retry', async () => {
    api.listAttachments.mockRejectedValueOnce(new Error('boom'));
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    await waitFor(() => expect(screen.getByText('Falha ao carregar anexos.')).toBeTruthy());

    api.listAttachments.mockResolvedValueOnce({ attachments: [ATTACHMENT] });
    fireEvent.click(screen.getByText('Tentar novamente'));
    await waitFor(() => expect(screen.getByText('print-bug.png')).toBeTruthy());
  });
});

describe('AttachmentsMenu — upload', () => {
  it('seleção múltipla de arquivos envia um único lote multipart e refaz a listagem em sucesso', async () => {
    api.uploadAttachments.mockResolvedValue({ attachments: [ATTACHMENT], errors: [] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    const file = new File(['conteudo'], 'print-bug.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('attachments-menu-file-input'), {
      target: { files: [file] },
    });

    expect(api.uploadAttachments).toHaveBeenCalledWith('meu-projeto', [file]);
    await waitFor(() => expect(api.listAttachments).toHaveBeenCalledTimes(2)); // 1 ao abrir + 1 pós-upload
  });

  it('sucesso parcial: item com erro fica retry-ável sem re-selecionar o arquivo', async () => {
    const failingFile = new File(['x'], 'falha.bin', { type: 'application/octet-stream' });
    api.uploadAttachments.mockResolvedValueOnce({
      attachments: [],
      errors: [{ original_name: 'falha.bin', error: 'disco cheio' }],
    });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();

    fireEvent.change(screen.getByTestId('attachments-menu-file-input'), {
      target: { files: [failingFile] },
    });

    // Mensagem específica do backend (err.error) tem prioridade sobre o
    // fallback genérico — ver handleUseInChat/uploadBatch em AttachmentsMenu.jsx.
    await waitFor(() => expect(screen.getByText('disco cheio')).toBeTruthy());

    api.uploadAttachments.mockResolvedValueOnce({ attachments: [ATTACHMENT], errors: [] });
    fireEvent.click(screen.getByText('Tentar de novo'));
    await waitFor(() => expect(api.uploadAttachments).toHaveBeenCalledTimes(2));
  });
});

describe('AttachmentsMenu — usar no chat', () => {
  it('cola o caminho absoluto + espaço final, sem enviar (nunca inclui \\r)', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Usar no chat')).toBeTruthy());

    fireEvent.click(screen.getByText('Usar no chat'));
    await waitFor(() => expect(api.pasteToSession).toHaveBeenCalled());

    expect(api.pasteToSession).toHaveBeenCalledWith('meu-projeto::claude', `${ATTACHMENT.path} `);
    const [, textSent] = api.pasteToSession.mock.calls[0];
    expect(textSent).not.toContain('\r');
  });

  it('mostra "✓ Inserido" por ~900ms sem fechar o painel, depois volta ao normal', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Usar no chat')).toBeTruthy());

    fireEvent.click(screen.getByText('Usar no chat'));

    await waitFor(() => expect(screen.getByText('✓ Inserido')).toBeTruthy());
    expect(screen.getByTestId('attachments-menu-panel')).toBeTruthy(); // não fechou

    // Espera de parede real pelo setTimeout interno do componente (900ms) —
    // ver nota no topo do arquivo sobre por que este teste não usa fake timers.
    await waitFor(() => expect(screen.getByText('Usar no chat')).toBeTruthy(), { timeout: 2000 });
  }, 8000);
});

describe('AttachmentsMenu — remoção (confirmação inline de 2 toques)', () => {
  it('1º clique pede confirmação ("Remover?"), sem chamar a API ainda', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Remover')).toBeTruthy());

    fireEvent.click(screen.getByText('Remover'));
    expect(screen.getByText('Remover?')).toBeTruthy();
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it('2º clique (enquanto em confirmação) remove de fato', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Remover')).toBeTruthy());

    fireEvent.click(screen.getByText('Remover'));
    fireEvent.click(screen.getByText('Remover?'));

    await waitFor(() => expect(api.deleteAttachment).toHaveBeenCalledWith('meu-projeto', ATTACHMENT.id));
    await waitFor(() => expect(screen.queryByText('print-bug.png')).toBeNull());
  });

  it('sem 2º clique, a confirmação reverte sozinha após ~3s', async () => {
    api.listAttachments.mockResolvedValue({ attachments: [ATTACHMENT] });
    render(<AttachmentsMenu activeSessionKey="meu-projeto::claude" />);
    openPanel();
    await waitFor(() => expect(screen.getByText('Remover')).toBeTruthy());

    fireEvent.click(screen.getByText('Remover'));
    expect(screen.getByText('Remover?')).toBeTruthy();

    // Espera de parede real pelo setTimeout interno do componente (3000ms) —
    // ver nota no topo do arquivo sobre por que este teste não usa fake timers.
    await waitFor(() => expect(screen.getByText('Remover')).toBeTruthy(), { timeout: 4000 });
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  }, 8000);
});
