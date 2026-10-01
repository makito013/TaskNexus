// frontend/src/utils/markdown.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderMarkdown, renderViewerMarkdown, slugifyHeading } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders headings, lists and bold text as expected HTML', () => {
    const md = '# Título\n\n- item um\n- item dois\n\nAlgum **texto**.';
    const html = renderMarkdown(md);

    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<li>item um</li>');
    expect(html).toContain('<li>item dois</li>');
    expect(html).toContain('<strong>texto</strong>');
  });

  it('treats a null/undefined markdown value as empty string', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('sanitizes embedded <script> tags via DOMPurify', () => {
    const md = '# Título\n\n<script>alert(1)</script>\n\nTexto normal.';
    const html = renderMarkdown(md);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<h1>Título</h1>');
  });

  it('strips dangerous inline event handlers from raw HTML in the markdown', () => {
    const md = '<img src="x" onerror="alert(1)">';
    const html = renderMarkdown(md);

    expect(html).not.toContain('onerror');
  });
});

// Fase V-2 (06-planejamento-fase-v.md, 6.5.4 e 6.7): o markdown do visualizador.
describe('renderViewerMarkdown', () => {
  it('link externo abre em nova aba com rel="noopener noreferrer" (também no renderMarkdown)', () => {
    for (const html of [
      renderViewerMarkdown('[site](https://exemplo.com)'),
      renderMarkdown('[site](https://exemplo.com)'),
    ]) {
      const a = toDom(html).querySelector('a');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('link relativo vira data-viewer-path; âncora vira data-viewer-anchor', () => {
    const dom = toDom(renderViewerMarkdown('[plano](../plano.md) e [seção](#riscos)'));
    const [rel, anchor] = dom.querySelectorAll('a');
    expect(rel.getAttribute('data-viewer-path')).toBe('../plano.md');
    expect(rel.hasAttribute('target')).toBe(false);
    expect(anchor.getAttribute('data-viewer-anchor')).toBe('riscos');
  });

  it('títulos ganham id no estilo do GitHub, com prefixo e sem repetir', () => {
    const dom = toDom(renderViewerMarkdown('# Plano de release\n\n## Riscos\n\n## Riscos'));
    expect(dom.querySelector('h1').id).toBe('user-content-plano-de-release');
    const h2 = dom.querySelectorAll('h2');
    expect(h2[0].id).toBe('user-content-riscos');
    expect(h2[1].id).toBe('user-content-riscos-1');
    expect(slugifyHeading('Ação: já!')).toBe('ação-já');
  });

  it('reescreve o src de imagem relativa pela função recebida', () => {
    const resolveAssetUrl = vi.fn((src) => (src.startsWith('http') ? null : `/api/viewer/vw_1/f/docs/${src}`));
    const dom = toDom(renderViewerMarkdown('![g](img/g.png) ![x](https://x.com/a.png)', { resolveAssetUrl }));
    const [local, remote] = dom.querySelectorAll('img');
    expect(local.getAttribute('src')).toBe('/api/viewer/vw_1/f/docs/img/g.png');
    expect(remote.getAttribute('src')).toBe('https://x.com/a.png');
  });

  it('GFM: tabela, checklist e bloco de código com a classe da linguagem; DOMPurify mantido', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] feito\n- [ ] falta\n\n```python\nprint(1)\n```\n\n<script>alert(1)</script>';
    const dom = toDom(renderViewerMarkdown(md));
    expect(dom.querySelector('table td').textContent).toBe('1');
    expect(dom.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(dom.querySelector('pre code').className).toContain('language-python');
    expect(dom.querySelector('script')).toBeNull();
  });
});

function toDom(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}
