// frontend/src/features/viewer/ViewerFullscreen.jsx
// Fase V-2 (6.1 R3 e 6.5.3): o painel em TELA CHEIA — um modal na própria
// página, com as mesmas abas no topo e ✕ Fechar à direita (44px).
//
// Mesmo contrato do CenteredModal.jsx: portal para document.body (fora do
// wrapper que recebe `inert` e de qualquer ancestral com transform —
// fixedPositioningInvariant.test.js), `position: fixed; inset: 0`, Esc fecha,
// foco no painel ao abrir. Respeita as áreas seguras do iPad/iPhone
// (--v2-safe-*, ponte de env() em theme.css).
//
// Fechar: no iPad/PC volta ao painel à direita (a tela cheia é o mesmo painel
// ampliado); no celular não existe painel, então fecha tudo (`closeAll` do
// contêiner, não das abas — as abas continuam guardadas).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewer, surfaceForScope } from './ViewerContext.jsx';
import { ViewerPanel } from './ViewerPanel.jsx';
import { isPlainEscape } from './escape.js';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 58,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 'var(--v2-safe-top, 0px)',
    paddingRight: 'var(--v2-safe-right, 0px)',
    paddingBottom: 'var(--v2-safe-bottom, 0px)',
    paddingLeft: 'var(--v2-safe-left, 0px)',
    boxSizing: 'border-box',
    background: 'var(--v2-surface)',
  },
};

/**
 * @param {object} props
 * @param {string|null} props.scope
 * @param {boolean} props.open
 * @param {boolean} [props.closeEverything]  celular: ✕/Esc fecham o
 *   visualizador em vez de voltar ao painel
 * @param {string} [props.surface]
 * @param {string} [props.emptyHint]
 * @param {Function} [props.onOpenPath]  links relativos (ver ViewerPanel)
 */
export function ViewerFullscreen({ scope, open, closeEverything = false, surface, emptyHint, onOpenPath }) {
  const viewer = useViewer();
  const panelRef = useRef(null);
  const target = surface || surfaceForScope(scope);

  const close = () => {
    if (!viewer) return;
    if (closeEverything) viewer.setOpen(target, false);
    else viewer.setFullscreen(target, false);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (isPlainEscape(event)) closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // A tela cheia cobre tudo, inclusive o terminal: o foco sai do xterm (o que,
  // no iPad, também baixa o teclado de tela — quem abriu quer ler).
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open || !viewer) return null;

  return createPortal(
    <div
      style={styles.overlay}
      className="vw-fade-enter"
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador em tela cheia"
      data-testid="viewer-fullscreen"
    >
      <ViewerPanel
        panelRef={panelRef}
        scope={scope}
        variant="fullscreen"
        emptyHint={emptyHint}
          onOpenPath={onOpenPath}
        onClose={close}
      />
    </div>,
    document.body,
  );
}
