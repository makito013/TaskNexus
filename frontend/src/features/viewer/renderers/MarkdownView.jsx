// frontend/src/features/viewer/renderers/MarkdownView.jsx
// Fase V-2 (6.5.4): markdown "como no GitHub" dentro do painel.
//
// O HTML vem de utils/markdown.js (GFM + DOMPurify). Depois de montado, este
// componente:
//  - transforma cada <pre><code class="language-x"> num bloco com cabeçalho
//    (linguagem + Copiar) e aplica o destaque do Shiki sob demanda;
//  - intercepta cliques: link relativo → OUTRA ABA do visualizador
//    (`openByPath` com `relativoA` = este arquivo); âncora → rola dentro do
//    painel; link externo segue o `target=_blank` que o markdown.js já pôs.
// Imagens relativas já saem com `src` apontando para /api/viewer/{id}/f/…
// (resolvidas a partir da pasta deste arquivo).
import { useEffect, useMemo, useRef } from 'react';
import { renderViewerMarkdown, HEADING_ID_PREFIX } from '../../../utils/markdown.js';
import { copyTextToClipboard } from '../../../utils/clipboard.js';
import { fileUrl } from '../viewerApi.js';
import { resolveRelativeTo, splitHref } from '../viewerPaths.js';
import { fillCodeElement, highlightToTokens } from '../highlight.js';

const COPY_FEEDBACK_MS = 1200;

function languageOf(codeEl) {
  const match = /(?:^|\s)language-([\w#+.-]+)/.exec(codeEl.className || '');
  return match ? match[1] : '';
}

/** Monta o cabeçalho de cada bloco de código e dispara o destaque. DOM direto
 * (o HTML do markdown não é árvore React); só `textContent`, nunca innerHTML.
 *
 * Idempotente, e por isso em duas partes: o efeito pode rodar de novo sobre o
 * MESMO DOM (o StrictMode do React roda montar → limpar → montar em dev). O
 * cabeçalho só é criado uma vez (bloco já embrulhado é pulado), mas o destaque
 * é disparado de novo para todo bloco ainda sem cor — senão a limpeza da 1ª
 * passada cancelaria o destaque e a 2ª não o refaria. */
function enhanceCodeBlocks(root) {
  const cleanups = [];
  root.querySelectorAll('pre > code').forEach((codeEl) => {
    const pre = codeEl.parentElement;
    const lang = languageOf(codeEl);
    // Texto ORIGINAL do bloco, guardado antes do destaque trocar os filhos.
    if (codeEl.dataset.source === undefined) codeEl.dataset.source = codeEl.textContent || '';
    const source = codeEl.dataset.source;

    if (!pre.parentElement?.classList.contains('vw-codeblock')) {
      const doc = root.ownerDocument;
      const wrapper = doc.createElement('div');
      wrapper.className = 'vw-codeblock';
      const head = doc.createElement('div');
      head.className = 'vw-codeblock-head';
      const label = doc.createElement('span');
      label.textContent = lang || 'texto';
      const copy = doc.createElement('button');
      copy.type = 'button';
      copy.className = 'vw-codeblock-copy';
      copy.textContent = 'Copiar';
      copy.setAttribute('aria-label', `Copiar código${lang ? ` (${lang})` : ''}`);
      let timer = null;
      copy.addEventListener('click', async (event) => {
        event.preventDefault();
        const ok = await copyTextToClipboard(source);
        copy.textContent = ok ? 'Copiado ✓' : 'Não copiou';
        clearTimeout(timer);
        timer = setTimeout(() => { copy.textContent = 'Copiar'; }, COPY_FEEDBACK_MS);
      });
      head.append(label, copy);
      pre.replaceWith(wrapper);
      wrapper.append(head, pre);
    }

    if (lang && codeEl.dataset.highlighted !== '1') {
      let cancelled = false;
      highlightToTokens(source.replace(/\n$/, ''), lang).then((lines) => {
        if (cancelled || !lines || !codeEl.isConnected) return;
        fillCodeElement(codeEl, lines);
        codeEl.dataset.highlighted = '1';
      });
      cleanups.push(() => { cancelled = true; });
    }
  });
  return () => cleanups.forEach((fn) => fn());
}

export function MarkdownView({ item, text, onOpenPath }) {
  const containerRef = useRef(null);

  const html = useMemo(() => renderViewerMarkdown(text, {
    resolveAssetUrl: (src) => {
      const resolved = resolveRelativeTo(item.path, src);
      return resolved ? fileUrl(item, resolved) : null;
    },
  }), [text, item]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    return enhanceCodeBlocks(containerRef.current);
  }, [html]);

  const handleClick = (event) => {
    const anchor = event.target.closest?.('a');
    if (!anchor || !containerRef.current?.contains(anchor)) return;
    const anchorId = anchor.getAttribute('data-viewer-anchor');
    if (anchorId !== null) {
      event.preventDefault();
      let decoded = anchorId;
      try { decoded = decodeURIComponent(anchorId); } catch { /* fica cru */ }
      // Comparação direta de `id` em vez de seletor: o id vem do texto do
      // título e escapá-lo para CSS é uma fonte de erro desnecessária.
      const wanted = [HEADING_ID_PREFIX + decoded, decoded];
      const target = Array.from(containerRef.current.querySelectorAll('[id]'))
        .find((el) => wanted.includes(el.id));
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
      return;
    }
    const href = anchor.getAttribute('data-viewer-path');
    if (href !== null) {
      event.preventDefault();
      if (!onOpenPath) return;
      // `/docs/x.md` num markdown é a raiz do PROJETO (como no GitHub), não do
      // disco: vai sem a barra e sem `relativoA`. O resto é relativo a este
      // arquivo e o backend resolve (inclusive `#L10` → linha 10).
      const { path, hash } = splitHref(href);
      let caminho = path;
      try { caminho = decodeURI(path); } catch { /* fica cru */ }
      const full = hash ? `${caminho}#${hash}` : caminho;
      if (caminho.startsWith('/')) onOpenPath(full.replace(/^\/+/, ''), {});
      else onOpenPath(full, { relativoA: item.path });
    }
  };

  return (
    <div
      ref={containerRef}
      className="vw-markdown"
      data-testid="viewer-markdown"
      onClick={handleClick}
      // HTML já sanitizado pelo DOMPurify em utils/markdown.js.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
