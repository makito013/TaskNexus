// frontend/src/features/viewer/renderers/media.test.jsx
// Fase V-2, passo 7 (6.5.4 e 6.7): HTML no iframe isolado, imagem, PDF e o
// download — e a escolha do renderer pelo `kind`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HtmlView, HTML_SANDBOX } from './HtmlView.jsx';
import { ImageView } from './ImageView.jsx';
import { PdfView } from './PdfView.jsx';
import { renderBody } from './index.jsx';

vi.mock('../highlight.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, highlightToTokens: () => Promise.resolve(null) };
});

const base = { id: 'vw_9', item_id: 'vw_9', source: 'viewer', updated_at: 7 };

afterEach(() => cleanup());

describe('HtmlView', () => {
  const item = { ...base, path: 'docs/relatório.html', kind: 'html' };

  it('iframe sandbox SEM allow-same-origin, apontando para a rota f/ com a versão', () => {
    render(<HtmlView item={item} text="<h1>oi</h1>" />);
    const iframe = screen.getByTestId('viewer-html-iframe');
    const sandbox = iframe.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(HTML_SANDBOX).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('src')).toBe('/api/viewer/vw_9/f/docs/relat%C3%B3rio.html?v=7');
  });

  it('alterna para Código (fonte com números de linha) e volta', () => {
    render(<HtmlView item={item} text={'<h1>oi</h1>\n<p>x</p>'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Código' }));
    expect(screen.queryByTestId('viewer-html-iframe')).toBeNull();
    expect(screen.getByTestId('viewer-code')).toBeTruthy();
    expect(screen.getByText('<h1>oi</h1>')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('viewer-html-iframe')).toBeTruthy();
  });
});

describe('ImageView', () => {
  it('mostra a imagem pela rota f/ e alterna caber/tamanho real ao tocar', () => {
    render(<ImageView item={{ ...base, path: 'img/g.png', kind: 'image', title: 'g.png' }} />);
    const img = screen.getByAltText('g.png');
    expect(img.getAttribute('src')).toBe('/api/viewer/vw_9/f/img/g.png?v=7');
    fireEvent.click(img);
    expect(screen.getByTestId('viewer-image').className).toContain('vw-image-wrap--actual');
  });

  it('falha ao carregar: mensagem com Baixar', () => {
    render(<ImageView item={{ ...base, path: 'img/g.png', kind: 'image' }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Não consegui carregar a imagem')).toBeTruthy();
  });
});

describe('PdfView', () => {
  it('↗ Abrir e ⤓ Baixar sempre visíveis, e o PDF no iframe', () => {
    render(<PdfView item={{ ...base, path: 'docs/manual.pdf', kind: 'pdf' }} />);
    const open = screen.getByRole('link', { name: '↗ Abrir' });
    expect(open.getAttribute('href')).toBe('/api/viewer/vw_9/f/docs/manual.pdf');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    const download = screen.getByRole('link', { name: '⤓ Baixar' });
    expect(download.getAttribute('href')).toBe('/api/viewer/vw_9/f/docs/manual.pdf?download=1');
    expect(download.getAttribute('download')).toBe('manual.pdf');
    expect(screen.getByTestId('viewer-pdf-iframe').getAttribute('src')).toBe('/api/viewer/vw_9/f/docs/manual.pdf?v=7');
  });
});

describe('renderBody', () => {
  const pick = (kind, content = {}) => {
    const { node } = renderBody({ item: { ...base, path: `a.${kind}`, kind }, content: { kind, ...content } });
    render(<>{node}</>);
  };

  it('html → iframe; image → img; pdf → iframe; video e binário → cartão de download', () => {
    pick('html', { text: '<p>x</p>' });
    expect(screen.getByTestId('viewer-html-iframe')).toBeTruthy();
    cleanup();
    pick('image');
    expect(screen.getByTestId('viewer-image')).toBeTruthy();
    cleanup();
    pick('pdf');
    expect(screen.getByTestId('viewer-pdf-iframe')).toBeTruthy();
    cleanup();
    pick('video');
    expect(screen.getByText(/ainda não toca vídeo/)).toBeTruthy();
    cleanup();
    pick('binary');
    expect(screen.getByTestId('viewer-binary')).toBeTruthy();
  });

  it('HTML > 1 MB continua no iframe (ele carrega o arquivo inteiro)', () => {
    pick('html', { text: '<p>começo</p>', truncated: true });
    expect(screen.getByTestId('viewer-html-iframe')).toBeTruthy();
  });
});
