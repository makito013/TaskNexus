// frontend/src/features/artifacts/ArtifactActionsMenu.jsx
// Fase A (07-planejamento-artefatos.md, 7.2 item 5): o menu de um cartão —
// Abrir · Baixar · Copiar caminho · Citar no chat · Renomear · Remover da lista.
//
// Popover ancorado no ⋯ (ou no cartão, no toque longo), no mesmo padrão do
// AttachmentsMenu/TaskQuickCreatePopover: faixa transparente que fecha ao tocar
// fora, Esc fecha. Em portal para document.body: o cartão fica dentro de uma
// lista que rola (overflow), e o menu não pode ser cortado por ela.
//
// "Citar no chat" usa o MESMO POST /api/sessions/{sk}/paste do "Usar no chat"
// dos Anexos: escreve o caminho no terminal da conversa ativa SEM enviar (sem
// \r) — o Bruno completa a frase e manda. Vai o caminho ABSOLUTO (o agente
// ativo pode estar em outro projeto; ver absolutePathFor).
//
// "Remover da lista" pede 2 toques, como a remoção nos Anexos: o 1º troca o
// texto para "Toque de novo para remover" por 3 s. Remover NÃO apaga o arquivo.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { fileUrl } from '../viewer/viewerApi.js';
import { basenameOf } from '../viewer/viewerPaths.js';
import { absolutePathFor } from './artifactModel.js';

const CONFIRM_REVERT_MS = 3000;
const MENU_WIDTH = 240;
const MARGIN = 8;

/** Posição do menu: abaixo e alinhado à direita da âncora; se não couber
 * embaixo, em cima; sempre dentro da janela. */
export function placeMenu(rect, menuHeight, viewport) {
  const width = Math.min(MENU_WIDTH, viewport.width - MARGIN * 2);
  let left = rect.right - width;
  left = Math.max(MARGIN, Math.min(left, viewport.width - width - MARGIN));
  let top = rect.bottom + 6;
  if (top + menuHeight > viewport.height - MARGIN) {
    top = Math.max(MARGIN, rect.top - menuHeight - 6);
  }
  return { left, top, width };
}

/**
 * @param {object} props
 * @param {object} props.artifact
 * @param {DOMRect|{top,bottom,left,right}} props.anchorRect
 * @param {object[]} props.projects
 * @param {string|null} props.activeSessionKey
 * @param {() => void} props.onClose
 * @param {(artifact) => void} props.onOpen
 * @param {(artifact) => void} props.onRename
 * @param {(artifact) => Promise<void>|void} props.onRemove
 * @param {(text: string, kind?: string) => void} props.onFeedback  aviso curto
 */
export function ArtifactActionsMenu({
  artifact,
  anchorRect,
  projects = [],
  activeSessionKey = null,
  onClose,
  onOpen,
  onRename,
  onRemove,
  onFeedback,
}) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(() => placeMenu(anchorRect, 0, {
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(null);
  const missing = artifact.exists === false;

  // Mede a altura real antes de pintar, para decidir entre abrir embaixo ou
  // em cima sem um quadro no lugar errado.
  useLayoutEffect(() => {
    const height = menuRef.current?.offsetHeight || 0;
    setPosition(placeMenu(anchorRect, height, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchorRect]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    // Foco no 1º item: o teclado externo do iPad navega pelo menu.
    menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const copyPath = async () => {
    const ok = await copyTextToClipboard(artifact.path);
    onFeedback(ok ? 'Caminho copiado.' : 'Não consegui copiar o caminho.', ok ? 'info' : 'error');
    onClose();
  };

  const cite = async () => {
    if (!activeSessionKey) return;
    try {
      await api.pasteToSession(activeSessionKey, absolutePathFor(artifact, projects));
      onFeedback('Caminho colado no chat ativo (sem enviar).');
    } catch {
      onFeedback('Não consegui colar no chat.', 'error');
    }
    onClose();
  };

  const remove = () => {
    if (!confirming) {
      setConfirming(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirming(false), CONFIRM_REVERT_MS);
      return;
    }
    clearTimeout(confirmTimer.current);
    onClose();
    onRemove(artifact);
  };

  // Teclas ↑/↓ entre os itens (padrão de menu).
  const onMenuKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const idx = items.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? idx + 1 : idx - 1;
    items[(next + items.length) % items.length]?.focus();
    event.preventDefault();
  };

  return createPortal(
    <>
      <div className="af-menu-scrim" data-testid="artifact-menu-scrim" onClick={onClose} />
      <div
        ref={menuRef}
        className="af-menu"
        role="menu"
        aria-label={`Ações de ${artifact.title}`}
        data-testid="artifact-menu"
        style={{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }}
        onKeyDown={onMenuKeyDown}
      >
        <div className="af-menu-title" title={artifact.path}>{artifact.title}</div>
        <button
          type="button"
          role="menuitem"
          className="af-menu-item"
          onClick={() => {
            onClose();
            onOpen(artifact);
          }}
        >
          <span className="af-menu-icon" aria-hidden="true">◧</span>Abrir
        </button>
        {!missing && (
          // <a> de verdade: no Safari do iPad só um link tocado pelo usuário com
          // `Content-Disposition: attachment` salva em Arquivos › Downloads
          // (mesmo motivo do ⤓ do ViewerToolbar).
          <a
            role="menuitem"
            className="af-menu-item"
            href={fileUrl({ ...artifact, source: 'artifact', id: artifact.artifact_id }, artifact.path, { download: true })}
            download={basenameOf(artifact.path)}
            onClick={() => setTimeout(onClose, 0)}
          >
            <span className="af-menu-icon" aria-hidden="true">⤓</span>Baixar
          </a>
        )}
        <button type="button" role="menuitem" className="af-menu-item" onClick={copyPath}>
          <span className="af-menu-icon" aria-hidden="true">⧉</span>Copiar caminho
        </button>
        {!missing && (
          <button
            type="button"
            role="menuitem"
            className="af-menu-item"
            aria-disabled={activeSessionKey ? undefined : 'true'}
            onClick={cite}
          >
            <span className="af-menu-icon" aria-hidden="true">❝</span>
            <span>
              Citar no chat
              <span className="af-menu-sub">
                {activeSessionKey ? 'Cola o caminho no chat ativo, sem enviar' : 'Abra um chat para citar'}
              </span>
            </span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="af-menu-item"
          onClick={() => {
            onClose();
            onRename(artifact);
          }}
        >
          <span className="af-menu-icon" aria-hidden="true">✎</span>Renomear…
        </button>
        <button
          type="button"
          role="menuitem"
          className={`af-menu-item ${confirming ? 'af-menu-item--confirm' : 'af-menu-item--danger'}`}
          onClick={remove}
        >
          <span className="af-menu-icon" aria-hidden="true">✕</span>
          {confirming ? 'Toque de novo para remover' : 'Remover da lista'}
        </button>
      </div>
    </>,
    document.body,
  );
}
