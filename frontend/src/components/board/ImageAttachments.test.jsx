// frontend/src/components/board/ImageAttachments.test.jsx
// Covers 05-DESIGNER.md seção 7 / 05-mockup.html .img-strip/.img-thumb/.img-add:
// tira de miniaturas, slot de upload (some com 5 imagens), upload/erro,
// visualização em tela cheia, exclusão.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ImageAttachments } from './ImageAttachments.jsx';

afterEach(() => cleanup());

function makeImagens(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    url: `/board_uploads/1/img-${i + 1}.png`,
    mime_type: 'image/png',
    size_bytes: 1024,
  }));
}

describe('ImageAttachments — renderização de miniaturas', () => {
  it('renders one thumbnail per item in imagens', () => {
    const imagens = makeImagens(3);
    render(
      <ImageAttachments cardId={1} imagens={imagens} onUpload={vi.fn()} onDelete={vi.fn()} />
    );

    expect(screen.getByTestId('image-thumb-1')).not.toBeNull();
    expect(screen.getByTestId('image-thumb-2')).not.toBeNull();
    expect(screen.getByTestId('image-thumb-3')).not.toBeNull();
  });

  it('renders nothing (no thumbnails) when imagens is empty', () => {
    render(<ImageAttachments cardId={1} imagens={[]} onUpload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTestId(/image-thumb-/)).toBeNull();
  });
});

describe('ImageAttachments — slot de upload e limite', () => {
  it('shows the "+" slot when imagens.length < 5', () => {
    render(
      <ImageAttachments cardId={1} imagens={makeImagens(4)} onUpload={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByLabelText('Escolher imagem')).not.toBeNull();
    expect(screen.queryByTestId('image-attachments-limit-note')).toBeNull();
  });

  it('hides the "+" slot and shows the limit note when imagens.length === 5', () => {
    render(
      <ImageAttachments cardId={1} imagens={makeImagens(5)} onUpload={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
    expect(screen.getByTestId('image-attachments-limit-note').textContent).toBe('5/5 imagens');
  });
});

describe('ImageAttachments — showAddButton={false} (listagem de cards)', () => {
  it('renders nothing when imagens is empty', () => {
    const { container } = render(
      <ImageAttachments
        cardId={1}
        imagens={[]}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        showAddButton={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows existing thumbnails but not the "+" slot', () => {
    render(
      <ImageAttachments
        cardId={1}
        imagens={makeImagens(2)}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        showAddButton={false}
      />
    );
    expect(screen.getByTestId('image-thumb-1')).not.toBeNull();
    expect(screen.getByTestId('image-thumb-2')).not.toBeNull();
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
  });
});

describe('ImageAttachments — upload', () => {
  it('calls onUpload with the selected file', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(
      <ImageAttachments cardId={7} imagens={[]} onUpload={onUpload} onDelete={vi.fn()} />
    );

    const file = new File(['conteudo'], 'print.png', { type: 'image/png' });
    const input = screen.getByTestId('image-attachments-input-7');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
  });

  it('shows a pulsing uploading state while onUpload is pending', async () => {
    let resolveUpload;
    const onUpload = vi.fn(() => new Promise((resolve) => { resolveUpload = resolve; }));
    render(
      <ImageAttachments cardId={7} imagens={[]} onUpload={onUpload} onDelete={vi.fn()} />
    );

    const file = new File(['conteudo'], 'print.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-attachments-input-7'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId('image-attachments-uploading')).not.toBeNull());
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();

    resolveUpload();
    await waitFor(() => expect(screen.queryByTestId('image-attachments-uploading')).toBeNull());
    expect(screen.getByLabelText('Escolher imagem')).not.toBeNull();
  });

  it('shows an error state if onUpload rejects, then recovers the "+" slot', async () => {
    vi.useFakeTimers();
    const onUpload = vi.fn().mockRejectedValue(new Error('falhou'));
    render(
      <ImageAttachments cardId={7} imagens={[]} onUpload={onUpload} onDelete={vi.fn()} />
    );

    const file = new File(['conteudo'], 'print.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-attachments-input-7'), { target: { files: [file] } });

    await vi.waitFor(() => expect(screen.getByTestId('image-attachments-error')).not.toBeNull());

    vi.advanceTimersByTime(3100);
    await vi.waitFor(() => expect(screen.queryByTestId('image-attachments-error')).toBeNull());
    expect(screen.getByLabelText('Escolher imagem')).not.toBeNull();

    vi.useRealTimers();
  });
});

describe('ImageAttachments — visualização em tela cheia', () => {
  it('opens a fullscreen overlay when a thumbnail is clicked, and closing works', () => {
    const imagens = makeImagens(1);
    render(
      <ImageAttachments cardId={1} imagens={imagens} onUpload={vi.fn()} onDelete={vi.fn()} />
    );

    expect(screen.queryByTestId('image-attachments-overlay')).toBeNull();

    fireEvent.click(screen.getByTestId('image-thumb-1'));
    expect(screen.getByTestId('image-attachments-overlay')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(screen.queryByTestId('image-attachments-overlay')).toBeNull();
  });

  it('closes the overlay when clicking the backdrop', () => {
    const imagens = makeImagens(1);
    render(
      <ImageAttachments cardId={1} imagens={imagens} onUpload={vi.fn()} onDelete={vi.fn()} />
    );

    fireEvent.click(screen.getByTestId('image-thumb-1'));
    expect(screen.getByTestId('image-attachments-overlay')).not.toBeNull();

    fireEvent.click(screen.getByTestId('image-attachments-overlay'));
    expect(screen.queryByTestId('image-attachments-overlay')).toBeNull();
  });
});

describe('ImageAttachments — exclusão', () => {
  it('calls onDelete with the correct image id', () => {
    const onDelete = vi.fn();
    const imagens = makeImagens(2);
    render(
      <ImageAttachments cardId={1} imagens={imagens} onUpload={vi.fn()} onDelete={onDelete} />
    );

    fireEvent.click(screen.getAllByLabelText('Excluir imagem')[1]);

    expect(onDelete).toHaveBeenCalledWith(2);
  });

  it('deleting does not also open the fullscreen overlay', () => {
    const onDelete = vi.fn();
    const imagens = makeImagens(1);
    render(
      <ImageAttachments cardId={1} imagens={imagens} onUpload={vi.fn()} onDelete={onDelete} />
    );

    fireEvent.click(screen.getAllByLabelText('Excluir imagem')[0]);

    expect(onDelete).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('image-attachments-overlay')).toBeNull();
  });
});
