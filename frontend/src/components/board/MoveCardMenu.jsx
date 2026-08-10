// frontend/src/components/board/MoveCardMenu.jsx
// Bottom sheet "mover para..." (Designer 05-DESIGNER.md seção 8; spec visual
// e comportamental em 05-mockup.html — classes .sheet-backdrop/.sheet/
// .sheet-option/.sheet-cancel e funções openSheet/closeSheet).
//
// Reaproveitado 1:1 por card de topo e subcard — sem variante (seção 6.3 do
// Designer): "um subcard é movido de status exatamente da mesma forma que um
// card de topo". Bottom sheet, não dropdown, não long-press (long-press já é
// "renomear chat" em outro lugar do app) e não drag-and-drop.
//
// Decisão: quando `open === false` o componente retorna `null` (não renderiza
// nada, nem o backdrop) em vez de montar sempre e alternar via CSS
// `display: none` — mantém o DOM limpo quando fechado e simplifica os testes
// (queryBy* já garante ausência total), ao custo de perder a transição CSS de
// "subir do rodapé" que o mockup faz via classe `.open` — aceitável pois o
// Designer não especifica uma animação obrigatória, só a posição final.

const STATUS_LABELS = {
  a_fazer: 'A Fazer',
  em_andamento: 'Em Andamento',
  em_revisao: 'Em Revisão',
  feito: 'Feito',
};

const STATUS_DOT_COLOR = {
  a_fazer: 'var(--border-strong)',
  em_andamento: 'var(--accent-claude)',
  em_revisao: 'var(--state-attention)',
  feito: 'var(--accent-green)',
};

const STATUS_ORDER = ['a_fazer', 'em_andamento', 'em_revisao', 'feito'];

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 400,
  },
  sheet: {
    position: 'fixed',
    left: '50%',
    bottom: 0,
    transform: 'translateX(-50%)',
    width: '420px',
    maxWidth: '92vw',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-strong)',
    borderBottom: 'none',
    borderTopLeftRadius: 'var(--radius-lg)',
    borderTopRightRadius: 'var(--radius-lg)',
    zIndex: 401,
    overflow: 'hidden',
  },
  title: {
    padding: '6px 16px 12px',
    fontSize: '12px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  option: (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 16px',
    minHeight: 'var(--touch-target)',
    borderTop: '1px solid var(--border)',
    fontSize: '14px',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    background: 'transparent',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    cursor: disabled ? 'default' : 'pointer',
  }),
  dot: (status) => ({
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    flexShrink: 0,
    background: STATUS_DOT_COLOR[status],
  }),
  check: {
    marginLeft: 'auto',
    color: 'var(--accent-green)',
  },
  cancel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'var(--touch-target)',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
};

export function MoveCardMenu({ open, currentStatus, onMove, onClose }) {
  if (!open) return null;

  const handleSelect = (status) => {
    if (status === currentStatus) return;
    onMove(status);
    onClose();
  };

  return (
    <>
      <div
        data-testid="move-card-menu-backdrop"
        style={styles.backdrop}
        onClick={onClose}
      />
      <div style={styles.sheet} role="dialog" aria-label="Mover para...">
        <div style={styles.title}>Mover para...</div>
        <div>
          {STATUS_ORDER.map((status) => {
            const isCurrent = status === currentStatus;
            return (
              <button
                key={status}
                type="button"
                style={styles.option(isCurrent)}
                disabled={isCurrent}
                onClick={() => handleSelect(status)}
              >
                <span style={styles.dot(status)} />
                <span>{STATUS_LABELS[status]}</span>
                {isCurrent && <span style={styles.check}>✓</span>}
              </button>
            );
          })}
        </div>
        <button type="button" style={styles.cancel} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </>
  );
}
