// frontend/src/utils/markdown.js
// Extracted from TaskDetailModal.jsx (Tarefa 13, 05-TL.md) so the
// markdown-to-safe-HTML conversion can be unit tested in isolation from the
// component. marked() renders the markdown, then DOMPurify sanitizes the
// resulting HTML before it's used with dangerouslySetInnerHTML.
//
// Fase V-2 (docs/melhorias-tablet/06-planejamento-fase-v.md, 6.5.4): o
// visualizador de arquivos usa `renderViewerMarkdown`, que acrescenta ao mesmo
// pipeline (GFM + DOMPurify) o que um .md do projeto precisa para ler "como no
// GitHub" dentro do painel:
//  - links externos abrem numa aba do navegador (`target=_blank` com
//    `rel=noopener noreferrer`) — vale também para o `renderMarkdown` simples,
//    porque no PWA do iPad um link que navega a própria janela tira o usuário
//    do app;
//  - links relativos ganham `data-viewer-path` (o MarkdownView intercepta o
//    clique e abre OUTRA ABA do visualizador) e âncoras `#secao` ganham
//    `data-viewer-anchor` (rola dentro do painel, sem mexer na URL do app);
//  - títulos ganham `id` no formato do GitHub (com prefixo `user-content-`,
//    como o próprio GitHub faz, para um título "location" não sombrear
//    `window.location`);
//  - `src` de imagem relativa é reescrito pela função `resolveAssetUrl` (o
//    visualizador aponta para /api/viewer/{item_id}/f/<caminho resolvido>).
//
// Todo pós-processamento acontece DEPOIS do DOMPurify e só acrescenta
// atributos de valor controlado (target/rel/data-*/id) ou troca um `src` por
// uma URL montada por nós — nunca reintroduz marcação vinda do arquivo.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export const HEADING_ID_PREFIX = 'user-content-';

/** Slug no estilo do GitHub: minúsculas, sem pontuação, espaços viram "-".
 * Mantém letras acentuadas (o GitHub também mantém). */
export function slugifyHeading(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]/gu, '')
    .replace(/ /g, '-');
}

function postProcess(html, { headingIds = false, resolveAssetUrl = null } = {}) {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;

  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href').trim();
    if (EXTERNAL_HREF.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else if (href.startsWith('#')) {
      a.setAttribute('data-viewer-anchor', href.slice(1));
    } else if (href) {
      a.setAttribute('data-viewer-path', href);
    }
  });

  if (resolveAssetUrl) {
    root.querySelectorAll('img[src]').forEach((img) => {
      const url = resolveAssetUrl(img.getAttribute('src'));
      if (url) img.setAttribute('src', url);
      // Imagem grande não pode empurrar o painel para os lados no iPad.
      img.setAttribute('loading', 'lazy');
    });
  }

  if (headingIds) {
    const seen = new Map();
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      const base = slugifyHeading(h.textContent);
      if (!base) return;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      h.setAttribute('id', `${HEADING_ID_PREFIX}${count ? `${base}-${count}` : base}`);
    });
  }

  return template.innerHTML;
}

export function renderMarkdown(md) {
  const raw = marked.parse(md || '');
  return postProcess(DOMPurify.sanitize(raw));
}

/**
 * Markdown do visualizador (GFM: tabelas, checklists, ~~riscado~~, autolinks).
 * @param {string} md
 * @param {{ resolveAssetUrl?: (src: string) => string|null }} [options]
 */
export function renderViewerMarkdown(md, { resolveAssetUrl = null } = {}) {
  const raw = marked.parse(md || '', { gfm: true });
  return postProcess(DOMPurify.sanitize(raw), { headingIds: true, resolveAssetUrl });
}
