// "Filtrar" + "Ordenar" controls of the board, rendered as children of the
// ClienteProjetoFilterBar so they share its row and its select styling.
// Stateless: the view object lives in BoardV2 and the rules in
// utils/boardView.js.
import {
  CARD_PRIORIDADE_LABELS,
  CARD_PRIORIDADES,
  CARD_TIPO_LABELS,
  CARD_TIPOS,
} from '../../utils/cardMeta.js';
import {
  BOARD_SORT_OPTIONS,
  DEFAULT_BOARD_VIEW,
  FILTER_NONE,
  PRAZO_FILTER_OPTIONS,
  isBoardViewFiltered,
  isBoardViewSorted,
} from '../../utils/boardView.js';

const styles = {
  // Same look as the filter bar's own selects; an active one gets the accent
  // border so a filtered board never looks like the whole board.
  select: (active) => ({
    fontSize: '12px',
    color: active ? 'var(--v2-text)' : 'var(--v2-text-dim)',
    background: active ? 'var(--v2-accent-soft)' : 'var(--v2-surface-3)',
    border: `1px solid ${active ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    borderRadius: '6px',
    padding: '5px 6px',
    maxWidth: '220px',
    cursor: 'pointer',
  }),
  clearBtn: {
    background: 'none',
    border: 'none',
    padding: '4px 2px',
    fontSize: '12px',
    color: 'var(--v2-accent)',
    cursor: 'pointer',
  },
  hint: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
  },
};

export function BoardViewControls({ view, onChange }) {
  const set = (key) => (e) => onChange({ ...view, [key]: e.target.value });
  const filtered = isBoardViewFiltered(view);
  const sorted = isBoardViewSorted(view);

  return (
    <>
      <select
        style={styles.select(!!view.prioridade)}
        aria-label="Filtrar por prioridade"
        value={view.prioridade}
        onChange={set('prioridade')}
      >
        <option value="">Todas as prioridades</option>
        {[...CARD_PRIORIDADES].reverse().map((p) => (
          <option key={p} value={p}>{CARD_PRIORIDADE_LABELS[p]}</option>
        ))}
        <option value={FILTER_NONE}>Sem prioridade</option>
      </select>

      <select
        style={styles.select(!!view.tipo)}
        aria-label="Filtrar por tipo"
        value={view.tipo}
        onChange={set('tipo')}
      >
        <option value="">Todos os tipos</option>
        {CARD_TIPOS.map((t) => (
          <option key={t} value={t}>{CARD_TIPO_LABELS[t]}</option>
        ))}
        <option value={FILTER_NONE}>Sem tipo</option>
      </select>

      <select
        style={styles.select(!!view.prazo)}
        aria-label="Filtrar por prazo"
        value={view.prazo}
        onChange={set('prazo')}
      >
        <option value="">Qualquer prazo</option>
        {PRAZO_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        style={styles.select(sorted)}
        aria-label="Ordenar cards"
        value={view.sort}
        onChange={set('sort')}
      >
        {BOARD_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === 'manual' ? o.label : `Ordenar: ${o.label}`}
          </option>
        ))}
      </select>

      {(filtered || sorted) && (
        <button type="button" style={styles.clearBtn} onClick={() => onChange({ ...DEFAULT_BOARD_VIEW })}>
          Limpar filtros
        </button>
      )}
      {sorted && (
        <span style={styles.hint} data-testid="board-view-sort-hint">
          Com ordenação, arrastar muda só a coluna do card.
        </span>
      )}
    </>
  );
}
