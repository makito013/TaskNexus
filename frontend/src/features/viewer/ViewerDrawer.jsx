// frontend/src/features/viewer/ViewerDrawer.jsx
// Fase V-2 + Fase N (8.2.2): o MESMO painel por cima do conteúdo, encostado à
// direita, em 641–1099px (iPad em pé, Split View). Padrão do TasksDrawer.jsx
// (faixa escura + painel fixo à direita, fecha com Esc, ✕ ou toque fora), com
// os tokens do v2 e a largura da especificação: min(560px, 92vw).
//
// Portal para document.body pelo mesmo contrato do CenteredModal.jsx: o AppV2
// aplica `inert` no wrapper do conteúdo enquanto o modal "Novo chat" está
// aberto, e o painel não pode herdar isso; e nada aqui fica sob um ancestral
// com transform (fixedPositioningInvariant.test.js).
//
// Nada recolhe nesta faixa de largura (8.2.4, regra 4): o terminal continua do
// mesmo tamanho por baixo, então também não há refit a disparar.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewer, surfaceForScope } from './ViewerContext.jsx';
import { ViewerPanel } from './ViewerPanel.jsx';
import { isPlainEscape } from './escape.js';

const styles = {
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 46,
    background: 'var(--v2-scrim)',
    // "Faixa leve" (6.5.3): o terminal continua legível atrás — dá para
    // conferir o que o agente escreveu sem fechar o painel.
    opacity: 0.45,
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 47,
    width: 'min(560px, 92vw)',
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 'var(--v2-safe-top, 0px)',
    paddingBottom: 'var(--v2-safe-bottom, 0px)',
    paddingRight: 'var(--v2-safe-right, 0px)',
    boxSizing: 'border-box',
    background: 'var(--v2-surface)',
    borderLeft: '1px solid var(--v2-border)',
    boxShadow: 'var(--v2-shadow-lg)',
  },
};

export function ViewerDrawer({ scope, surface, open, emptyHint, onOpenPath }) {
  const viewer = useViewer();
  const panelRef = useRef(null);
  const target = surface || surfaceForScope(scope);

  useEffect(() => {
    if (!open || !viewer) return undefined;
    const onKeyDown = (event) => {
      if (isPlainEscape(event)) viewer.setOpen(target, false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, viewer, target]);

  // Foco no painel ao abrir: o terminal fica coberto, e o Esc/Tab do teclado
  // externo do iPad passam a valer para o painel.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open || !viewer) return null;

  return createPortal(
    <>
      <div
        style={styles.scrim}
        data-testid="viewer-drawer-scrim"
        className="vw-fade-enter"
        onClick={() => viewer.setOpen(target, false)}
      />
      <div style={styles.panel} className="vw-drawer-enter" data-testid="viewer-drawer" role="dialog" aria-label="Visualizador de arquivos">
        <ViewerPanel
          panelRef={panelRef}
          scope={scope}
          variant="drawer"
          emptyHint={emptyHint}
          onOpenPath={onOpenPath}
          onClose={() => viewer.setOpen(target, false)}
          onFullscreen={() => viewer.setFullscreen(target, true)}
        />
      </div>
    </>,
    document.body,
  );
}
