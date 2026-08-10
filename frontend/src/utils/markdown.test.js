// frontend/src/utils/markdown.test.js
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

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
