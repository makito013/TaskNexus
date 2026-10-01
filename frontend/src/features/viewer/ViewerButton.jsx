// frontend/src/features/viewer/ViewerButton.jsx
// Fase V-2 (6.5.3): botão "Visualizador" na topbar do chat, ao lado de Anexos
// (mesma guarda `!isMobile && v2Screen === 'chat'` no AppV2 e mesma pílula de
// 28px do AttachmentsMenu). Abre/fecha o painel à direita; o selo mostra
// quantas abas a conversa tem e fica DESTACADO quando o agente abriu algo com
// a conversa fora de vista (contador de não vistos, 6.1).
import { useViewer, SURFACE_CHAT } from './ViewerContext.jsx';

const styles = {
  trigger: (disabled, active) => ({
    position: 'relative',
    flexShrink: 0,
    height: '28px',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '8px',
    border: `1px solid ${active ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    background: active ? 'var(--v2-accent-soft)' : 'transparent',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-text)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }),
  badge: (highlight) => ({
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    minWidth: '16px',
    height: '16px',
    padding: '0 3px',
    borderRadius: '8px',
    background: highlight ? 'var(--v2-danger)' : 'var(--v2-accent)',
    color: 'var(--v2-surface)',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: '16px',
    textAlign: 'center',
    boxSizing: 'border-box',
  }),
};

export function ViewerButton({ scope, disabled = false }) {
  const viewer = useViewer();
  if (!viewer) return null;
  const count = scope ? viewer.getScope(scope).items.length : 0;
  const unseen = scope ? viewer.unseen[scope] || 0 : 0;
  const open = viewer.getSurface(SURFACE_CHAT).open;
  const isDisabled = disabled || !scope;

  const label = [
    'Visualizador',
    count ? `${count} ${count === 1 ? 'arquivo aberto' : 'arquivos abertos'}` : null,
    unseen ? `${unseen} ${unseen === 1 ? 'novo' : 'novos'}` : null,
  ].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      style={styles.trigger(isDisabled, open && !isDisabled)}
      disabled={isDisabled}
      aria-pressed={open && !isDisabled}
      aria-label={label}
      title={label}
      data-testid="viewer-button"
      onClick={() => viewer.setOpen(SURFACE_CHAT, !open)}
    >
      Visualizador
      {count > 0 && (
        <span style={styles.badge(unseen > 0)} data-testid="viewer-button-badge" data-unseen={unseen > 0 ? 'true' : 'false'}>
          {count}
        </span>
      )}
    </button>
  );
}
