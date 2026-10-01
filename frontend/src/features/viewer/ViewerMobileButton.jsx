// frontend/src/features/viewer/ViewerMobileButton.jsx
// Fase V-2 (6.1 "Celular" e 6.5.3): no celular (≤ 640px) não há topbar com
// botões nem espaço para painel — um botão flutuante abre o visualizador
// DIRETO EM TELA CHEIA.
//
// Fica no canto SUPERIOR DIREITO, na mesma faixa do "☰ Menu" (que está no
// esquerdo): a topbar do celular fica vazia (o título some, ver AppV2), então
// os dois flutuantes dividem essa faixa sem cobrir o terminal; e em cima, pelo
// mesmo motivo do Menu — embaixo, o teclado do iOS o cobriria.
import { useViewer, SURFACE_CHAT } from './ViewerContext.jsx';

const styles = {
  button: (highlight) => ({
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top) + 12px)',
    right: '12px',
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    height: '44px',
    padding: '0 14px',
    borderRadius: '999px',
    border: `1px solid ${highlight ? 'var(--v2-danger)' : 'var(--v2-border)'}`,
    background: 'var(--v2-surface)',
    color: 'var(--v2-text)',
    boxShadow: 'var(--v2-shadow)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  }),
  count: (highlight) => ({
    minWidth: '18px',
    height: '18px',
    padding: '0 4px',
    borderRadius: '9px',
    background: highlight ? 'var(--v2-danger)' : 'var(--v2-accent)',
    color: 'var(--v2-surface)',
    fontSize: '11px',
    fontWeight: 700,
    lineHeight: '18px',
    textAlign: 'center',
    boxSizing: 'border-box',
  }),
};

export function ViewerMobileButton({ scope }) {
  const viewer = useViewer();
  if (!viewer || !scope) return null;
  const count = viewer.getScope(scope).items.length;
  const unseen = viewer.unseen[scope] || 0;
  return (
    <button
      type="button"
      style={styles.button(unseen > 0)}
      data-testid="viewer-mobile-button"
      aria-label={`Visualizador${count ? `, ${count} ${count === 1 ? 'arquivo' : 'arquivos'}` : ''}`}
      onClick={() => {
        // setOpen primeiro: zera o contador de não vistos da conversa.
        viewer.setOpen(SURFACE_CHAT, true);
        viewer.setFullscreen(SURFACE_CHAT, true);
      }}
    >
      <span aria-hidden="true">📄</span>
      Arquivos
      {count > 0 && <span style={styles.count(unseen > 0)}>{count}</span>}
    </button>
  );
}
