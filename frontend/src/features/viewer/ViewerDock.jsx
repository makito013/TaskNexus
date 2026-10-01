// frontend/src/features/viewer/ViewerDock.jsx
// Fase V-2 + Fase N (08-planejamento-navegacao-cliente-projeto.md, 8.2.2 e
// 8.3.4): o painel ENCAIXADO à direita (≥ 1100px, iPad deitado e desktop).
// É irmão flex do conteúdo (o terminal encolhe, nada fica por baixo). O
// recolhimento das colunas e o refit do xterm NÃO moram aqui: o AppV2 passa
// "painel aberto" ao useViewerDockCollapse, que recolhe sidebar e lista de
// chats e dispara `escritorio:sidebar-toggled` a cada troca de encaixe.
//
// `hidden`: em tela cheia o painel não renderiza (6.5.3, "um só painel por
// vez"), mas a COLUNA continua com a mesma largura. Assim entrar e sair da tela
// cheia não muda a largura do terminal — nada de refit nem de redesenho do
// claude por baixo do modal.
//
// Esc: só com o foco DENTRO do painel (onKeyDown), nunca por um listener
// global — o terminal está ao lado e o Esc dele é do agente (ver escape.js).
import { useViewer, surfaceForScope } from './ViewerContext.jsx';
import { ViewerPanel } from './ViewerPanel.jsx';
import { isPlainEscape } from './escape.js';

export const DOCK_WIDTH = 'clamp(420px, 42vw, 780px)';

const styles = {
  column: {
    width: DOCK_WIDTH,
    minWidth: DOCK_WIDTH,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    borderLeft: '1px solid var(--v2-border)',
    background: 'var(--v2-surface)',
  },
};

/**
 * @param {object} props
 * @param {string|null} props.scope   escopo das abas (`session:<sk>`; Fase A: `artefatos`)
 * @param {string} [props.surface]    padrão: surfaceForScope(scope)
 * @param {boolean} [props.hidden]    reserva a coluna sem desenhar o painel (tela cheia)
 * @param {string} [props.emptyHint]
 * @param {Function} [props.onOpenPath]  links relativos (ver ViewerPanel)
 */
export function ViewerDock({ scope, surface, hidden = false, emptyHint, onOpenPath }) {
  const viewer = useViewer();
  if (!viewer) return null;
  const target = surface || surfaceForScope(scope);
  return (
    <aside style={styles.column} data-testid="viewer-dock">
      {!hidden && (
        <ViewerPanel
          scope={scope}
          variant="dock"
          emptyHint={emptyHint}
          onOpenPath={onOpenPath}
          onClose={() => viewer.setOpen(target, false)}
          onFullscreen={() => viewer.setFullscreen(target, true)}
          onKeyDown={(event) => {
            if (isPlainEscape(event)) {
              event.preventDefault();
              viewer.setOpen(target, false);
            }
          }}
        />
      )}
    </aside>
  );
}
