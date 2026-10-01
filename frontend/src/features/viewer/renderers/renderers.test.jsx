// frontend/src/features/viewer/renderers/renderers.test.jsx
// Fase V-2 (6.7, "Frontend"): MarkdownView (links, âncoras, imagens, blocos de
// código com Copiar), CodeView (números de linha, linha destacada, quebra) e
// BinaryView (Baixar). O Shiki é trocado por um dublê: aqui importa o
// comportamento da tela, não as cores — e o destaque é progressivo (o texto
// puro sempre aparece primeiro).
import { StrictMode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MarkdownView } from './MarkdownView.jsx';
import { CodeView } from './CodeView.jsx';
import { BinaryView } from './BinaryView.jsx';

const mockHighlight = vi.fn(() => Promise.resolve(null));
vi.mock('../highlight.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, highlightToTokens: (...args) => mockHighlight(...args) };
});

const mockCopy = vi.fn(() => Promise.resolve(true));
vi.mock('../../../utils/clipboard.js', () => ({
  copyTextToClipboard: (...args) => mockCopy(...args),
}));

const ITEM = { id: 'vw_1', item_id: 'vw_1', source: 'viewer', path: 'docs/relatorio.md', kind: 'markdown', updated_at: 1 };

afterEach(() => {
  cleanup();
  mockHighlight.mockClear();
  mockCopy.mockClear();
});

describe('MarkdownView', () => {
  it('link externo sai com target=_blank e rel="noopener noreferrer"', () => {
    render(<MarkdownView item={ITEM} text="[site](https://exemplo.com)" onOpenPath={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('link relativo chama openByPath com relativoA = este arquivo (outra aba)', () => {
    const onOpenPath = vi.fn();
    render(<MarkdownView item={ITEM} text="[plano](../plano.md) [código](../src/app.py#L10)" onOpenPath={onOpenPath} />);
    fireEvent.click(screen.getByRole('link', { name: 'plano' }));
    expect(onOpenPath).toHaveBeenCalledWith('../plano.md', { relativoA: 'docs/relatorio.md' });
    fireEvent.click(screen.getByRole('link', { name: 'código' }));
    expect(onOpenPath).toHaveBeenLastCalledWith('../src/app.py#L10', { relativoA: 'docs/relatorio.md' });
  });

  it('link começando com / é a raiz do projeto (sem relativoA)', () => {
    const onOpenPath = vi.fn();
    render(<MarkdownView item={ITEM} text="[raiz](/README.md)" onOpenPath={onOpenPath} />);
    fireEvent.click(screen.getByRole('link', { name: 'raiz' }));
    expect(onOpenPath).toHaveBeenCalledWith('README.md', {});
  });

  it('âncora rola até o título dentro do painel, sem abrir nada', () => {
    const onOpenPath = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<MarkdownView item={ITEM} text={'[ir](#riscos)\n\n## Riscos'} onOpenPath={onOpenPath} />);
    fireEvent.click(screen.getByRole('link', { name: 'ir' }));
    expect(onOpenPath).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts[0].id).toBe('user-content-riscos');
  });

  it('imagem relativa vira /api/viewer/{item_id}/f/<caminho resolvido>', () => {
    render(<MarkdownView item={ITEM} text="![grafico](img/g.png) ![logo](../logo.svg)" onOpenPath={vi.fn()} />);
    expect(screen.getByAltText('grafico').getAttribute('src')).toBe('/api/viewer/vw_1/f/docs/img/g.png');
    expect(screen.getByAltText('logo').getAttribute('src')).toBe('/api/viewer/vw_1/f/logo.svg');
  });

  it('bloco de código ganha cabeçalho com a linguagem e Copiar', async () => {
    render(<MarkdownView item={ITEM} text={'```python\nprint("oi")\n```'} onOpenPath={vi.fn()} />);
    expect(screen.getByText('python')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar código (python)' }));
    });
    expect(mockCopy).toHaveBeenCalledWith('print("oi")\n');
    expect(screen.getByText('Copiado ✓')).toBeTruthy();
    expect(mockHighlight).toHaveBeenCalledWith('print("oi")', 'python');
  });
});

describe('MarkdownView — destaque sob StrictMode', () => {
  // Regressão achada na verificação visual: o StrictMode roda o efeito duas
  // vezes; a limpeza da 1ª passada cancelava o destaque e a 2ª, vendo o bloco
  // já embrulhado, não o refazia — os blocos do markdown ficavam sem cor.
  it('o bloco recebe as cores mesmo com o efeito montado duas vezes', async () => {
    mockHighlight.mockImplementation(() => Promise.resolve([[{ content: 'x', color: '#6F42C1', fontStyle: 0 }]]));
    try {
      await act(async () => {
        render(
          <StrictMode>
            <MarkdownView item={ITEM} text={'```python\nx\n```'} onOpenPath={vi.fn()} />
          </StrictMode>,
        );
      });
      const code = document.querySelector('.vw-codeblock pre code');
      expect(code.dataset.highlighted).toBe('1');
      expect(code.querySelector('span').style.color).toBe('rgb(111, 66, 193)');
      expect(document.querySelectorAll('.vw-codeblock-head')).toHaveLength(1);
    } finally {
      mockHighlight.mockImplementation(() => Promise.resolve(null));
    }
  });
});

describe('CodeView', () => {
  it('numera as linhas, destaca a linha pedida e rola até ela', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const text = Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`).join('\n');
    const { container } = render(<CodeView text={text} language="python" line={42} flashKey={1} />);
    expect(container.querySelectorAll('.vw-line')).toHaveLength(60);
    const target = container.querySelector('[data-line="42"]');
    expect(target.className).toContain('vw-line--target');
    expect(target.className).toContain('vw-line--flash');
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target);
    expect(screen.getByText('60 linhas · python')).toBeTruthy();
  });

  it('o número da linha fica fora da seleção (aria-hidden + classe sem seleção)', () => {
    const { container } = render(<CodeView text="a\nb" language="text" />);
    const number = container.querySelector('.vw-line-no');
    expect(number.getAttribute('aria-hidden')).toBe('true');
    expect(number.textContent).toBe('1');
  });

  it('alterna quebra de linha', () => {
    const { container } = render(<CodeView text="x" language="text" />);
    fireEvent.click(screen.getByRole('button', { name: 'Quebrar linhas' }));
    expect(container.querySelector('.vw-code').className).toContain('vw-code--wrap');
  });

  it('aplica os tokens do destaque quando chegam', async () => {
    mockHighlight.mockImplementationOnce(() => Promise.resolve([[{ content: 'def', color: '#D73A49', fontStyle: 0 }]]));
    await act(async () => { render(<CodeView text="def" language="python" />); });
    const span = screen.getByText('def');
    expect(span.style.color).toBe('rgb(215, 58, 73)');
  });
});

describe('BinaryView', () => {
  it('mostra nome, tipo, tamanho e o Baixar com ?download=1', () => {
    render(
      <BinaryView
        item={{ ...ITEM, path: 'dist/app.zip', kind: 'binary' }}
        content={{ name: 'app.zip', mime: 'application/zip', size: 2048 }}
      />,
    );
    expect(screen.getByText('app.zip')).toBeTruthy();
    expect(screen.getByText('application/zip · 2,0 KB')).toBeTruthy();
    expect(screen.getByRole('link', { name: '⤓ Baixar' }).getAttribute('href'))
      .toBe('/api/viewer/vw_1/f/dist/app.zip?download=1');
  });

  it('vídeo explica que precisa baixar (sem Range no backend)', () => {
    render(<BinaryView item={{ ...ITEM, path: 'a.mp4', kind: 'video' }} content={null} reason="video" />);
    expect(screen.getByText(/ainda não toca vídeo/)).toBeTruthy();
  });
});
