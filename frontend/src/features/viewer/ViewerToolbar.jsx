// frontend/src/features/viewer/ViewerToolbar.jsx
// Fase V-2 (6.2/6.5.1): a barra do arquivo — caminho, tamanho, quem abriu e
// quando, e as ações ⤓ Baixar, ⧉ Copiar, ↗ Abrir no navegador e ⋯ (Copiar
// caminho, Fechar todas). O ⤢ Tela cheia e o ✕ ficam no cabeçalho, ao lado das
// abas (mockup 13): no painel encaixado de 420px a barra não teria espaço para
// o caminho com mais um botão largo.
//
// Baixar e Abrir no navegador são <a href> de verdade, não botões com
// window.open: no Safari do iPad só um link tocado pelo usuário com
// `Content-Disposition: attachment` (o `?download=1` do backend) dispara o
// "Baixar" nativo para Arquivos › Downloads, e o PWA instalado abre o <a
// target=_blank> no Safari sem ser barrado como pop-up.
//
// Fase A (07-planejamento-artefatos.md, 7.5.1): "☆ Salvar" (em Artefatos) para
// uma aba do CHAT com .md/.html/.pdf que ainda não é artefato — normalmente o
// que você mesmo abriu, já que o que o agente abre desses tipos vira artefato
// sozinho. A regra e a consulta moram em features/artifacts/useSaveToArtifacts.
import { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { fileUrl } from './viewerApi.js';
import { basenameOf, formatBytes, formatRelativeSeconds } from './viewerPaths.js';
import { openerLabel, useViewerActions } from './ViewerContext.jsx';
import { useSaveToArtifacts } from '../artifacts/useSaveToArtifacts.js';

const FEEDBACK_MS = 1200;

function useFeedback() {
  const [value, setValue] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (next) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setValue(null), FEEDBACK_MS);
  };
  return [value, show];
}

export function ViewerToolbar({ item, content, onCloseAll }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, showCopied] = useFeedback();
  const [justSaved, showJustSaved] = useFeedback();
  const menuRef = useRef(null);
  const actions = useViewerActions();
  const saver = useSaveToArtifacts(item);

  // Menu ⋯ fecha com toque fora e com Esc (padrão dos popovers do v2).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  if (!item) return null;

  const hasText = typeof content?.text === 'string';
  const size = Number.isFinite(content?.size) ? formatBytes(content.size) : null;
  const opener = openerLabel(item, item.session_key);
  const when = formatRelativeSeconds(item.updated_at);
  const openedBy = item.source === 'artifact'
    ? null
    : `aberto ${item.opened_by === 'user' ? 'por você' : `pelo ${opener}`}${when ? ` ${when}` : ''}`;

  const copy = async () => {
    // Texto: copia o conteúdo (o que se quer colar no Notas). Imagem/PDF/
    // binário não têm texto: copia o caminho, que é o que dá para colar.
    const ok = await copyTextToClipboard(hasText ? content.text : item.path);
    showCopied(ok ? 'ok' : 'fail');
  };

  const saveToArtifacts = async () => {
    const result = await saver.save();
    if (result.ok) {
      showJustSaved(true);
      actions?.showToast(result.created ? 'Salvo em Artefatos' : 'Já estava em Artefatos');
    } else if (result.error) {
      actions?.showToast(result.error, 'error');
    }
  };
  const showSave = saver.status === 'available' || saver.status === 'saving' || !!justSaved;

  const copyPath = async () => {
    setMenuOpen(false);
    const ok = await copyTextToClipboard(item.path);
    showCopied(ok ? 'ok' : 'fail');
  };

  return (
    <div className="vw-toolbar">
      <div className="vw-meta" title={item.path}>
        <strong>{item.path}</strong>
        {size ? ` · ${size}` : ''}
        {openedBy ? ` · ${openedBy}` : ''}
      </div>
      <div className="vw-toolbar-actions" ref={menuRef}>
        {showSave && (
          <button
            type="button"
            className={`vw-btn${justSaved ? ' vw-btn--active' : ''}`}
            onClick={saveToArtifacts}
            disabled={saver.status === 'saving' || !!justSaved}
            aria-label="Salvar em Artefatos"
            title="Salvar em Artefatos"
            data-testid="viewer-save-artifact"
          >
            {justSaved ? '★ Salvo' : '☆ Salvar'}
          </button>
        )}
        <a
          className="vw-btn vw-btn--icon"
          href={fileUrl(item, item.path, { download: true })}
          download={content?.name || basenameOf(item.path)}
          aria-label="Baixar"
          title="Baixar"
        >
          ⤓
        </a>
        <button
          type="button"
          className="vw-btn vw-btn--icon"
          onClick={copy}
          aria-label={hasText ? 'Copiar conteúdo' : 'Copiar caminho'}
          title={hasText ? 'Copiar conteúdo' : 'Copiar caminho'}
        >
          {copied === 'ok' ? '✓' : copied === 'fail' ? '!' : '⧉'}
        </button>
        <a
          className="vw-btn vw-btn--icon"
          href={fileUrl(item)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir no navegador"
          title="Abrir no navegador"
        >
          ↗
        </a>
        <button
          type="button"
          className="vw-btn vw-btn--icon"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Mais ações"
          title="Mais ações"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="vw-menu" role="menu">
            <button type="button" role="menuitem" onClick={copyPath}>Copiar caminho</button>
            <button
              type="button"
              role="menuitem"
              className="vw-danger"
              onClick={() => {
                setMenuOpen(false);
                onCloseAll?.();
              }}
            >
              Fechar todas as abas
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
