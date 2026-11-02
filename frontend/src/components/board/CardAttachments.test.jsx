// frontend/src/components/board/CardAttachments.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CardAttachments, MAX_ATTACHMENTS, isPreviewable } from './CardAttachments.jsx';
import { cardAttachmentItem, contentUrl, fileUrl } from '../../features/viewer/viewerApi.js';

afterEach(() => cleanup());

function attachment(id, filename, size = 2048) {
  return { id, card_id: 1, filename, mime_type: 'application/octet-stream', size_bytes: size, created_at: 1700000000.5 };
}

function renderList(attachments, overrides = {}) {
  const props = {
    cardId: 1,
    attachments,
    onUpload: vi.fn().mockResolvedValue({}),
    onDelete: vi.fn(),
    onView: vi.fn(),
    ...overrides,
  };
  render(<CardAttachments {...props} />);
  return props;
}

describe('cardAttachmentItem', () => {
  it('maps an attachment to a viewer item served by /api/card-attachments', () => {
    const item = cardAttachmentItem(attachment(7, 'relatório final.md'));
    expect(item).toMatchObject({ id: 7, source: 'card_attachment', path: 'relatório final.md', updated_at: 1700000000.5 });
    expect(contentUrl(item)).toBe('/api/card-attachments/7/content');
    expect(fileUrl(item, item.path, { download: true }))
      .toBe('/api/card-attachments/7/f/relat%C3%B3rio%20final.md?download=1');
  });
});

describe('isPreviewable', () => {
  it('accepts md, pdf and html, rejects archives and office files', () => {
    expect(isPreviewable('a.md')).toBe(true);
    expect(isPreviewable('a.PDF')).toBe(true);
    expect(isPreviewable('a.html')).toBe(true);
    expect(isPreviewable('a.htm')).toBe(true);
    expect(isPreviewable('a.zip')).toBe(false);
    expect(isPreviewable('a.docx')).toBe(false);
  });
});

describe('CardAttachments', () => {
  it('shows Ver and Baixar for a previewable file; Ver and the name call onView', () => {
    const md = attachment(1, 'plano.md');
    const props = renderList([md]);

    fireEvent.click(screen.getByRole('button', { name: 'Ver plano.md' }));
    fireEvent.click(screen.getByTitle('Abrir plano.md no visualizador'));
    expect(props.onView).toHaveBeenCalledTimes(2);
    expect(props.onView).toHaveBeenCalledWith(md);

    const download = screen.getByRole('link', { name: 'Baixar plano.md' });
    expect(download.getAttribute('href')).toBe('/api/card-attachments/1/f/plano.md?download=1');
    expect(download.hasAttribute('download')).toBe(true);
  });

  it('offers only Baixar for a file without preview', () => {
    renderList([attachment(2, 'dados.zip')]);
    expect(screen.queryByRole('button', { name: 'Ver dados.zip' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Baixar dados.zip' })).not.toBeNull();
  });

  it('calls onDelete with the attachment id', () => {
    const props = renderList([attachment(3, 'a.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remover a.pdf' }));
    expect(props.onDelete).toHaveBeenCalledWith(3);
  });

  it('uploads the picked file and shows the error state when it fails', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('boom'));
    renderList([], { onUpload });
    const file = new File(['# oi'], 'nota.md', { type: 'text/markdown' });

    fireEvent.change(screen.getByTestId('card-attachments-input-1'), { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Falha ao enviar'));
  });

  it('hides the add button at the limit', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => attachment(i + 1, `f${i}.md`));
    renderList(many);
    expect(screen.queryByTestId('card-attachments-add')).toBeNull();
    expect(screen.getByTestId('card-attachments-limit-note')).not.toBeNull();
  });
});
