// frontend/src/components/board/SubcardRow.jsx
// Linha compacta de subcard dentro do CardItem de topo expandido (Tarefa 21,
// 05-TL.md; espec visual em 05-DESIGNER.md seção 6.3; estrutura exata em
// 05-mockup.html — classe `.subcard-row`).
//
// Reaproveita 1:1 o `MoveCardMenu` do card de topo (Designer, seção 6.3:
// "um subcard é movido de status exatamente da mesma forma que um card de
// topo") — mesmo esquema de cores de pill (Designer/MoveCardMenu):
// a_fazer -> --border-strong, em_andamento -> --accent-claude,
// em_revisao -> --state-attention, feito -> --accent-green.
//
// Deliberadamente SEM tira de imagem inline e SEM badge de origem/timestamp
// (Designer seção 6.3 e 9) — mais compacto que CardItem (Tarefa 23), que
// embute ImageAttachments e o badge de origem no card de topo. Imagem de
// subcard continua suportada, só que via CardFormModal em modo editar
// (aberto pelo toque no título, callback onOpenEdit).

import { useState } from 'react';
import { MoveCardMenu } from './MoveCardMenu.jsx';

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

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '36px',
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    fontSize: '12px',
    color: 'var(--text-primary)',
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '22px',
    width: '22px',
    padding: 0,
    flexShrink: 0,
    borderRadius: '999px',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    cursor: 'pointer',
  },
  dot: (status) => ({
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    background: STATUS_DOT_COLOR[status],
  }),
  title: {
    flex: 1,
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: 0,
    color: 'var(--text-primary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
};

export function SubcardRow({ subcard, onMove, onOpenEdit }) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);

  return (
    <div className="subcard-row" style={styles.row}>
      <button
        type="button"
        style={styles.pill}
        aria-label={`Mover: ${STATUS_LABELS[subcard.status]}`}
        onClick={() => setMoveMenuOpen(true)}
      >
        <span style={styles.dot(subcard.status)} />
      </button>
      <button
        type="button"
        style={styles.title}
        onClick={() => onOpenEdit(subcard.id)}
      >
        {subcard.titulo}
      </button>

      <MoveCardMenu
        open={moveMenuOpen}
        currentStatus={subcard.status}
        onMove={(novo) => {
          onMove(subcard.id, novo);
          setMoveMenuOpen(false);
        }}
        onClose={() => setMoveMenuOpen(false)}
      />
    </div>
  );
}
