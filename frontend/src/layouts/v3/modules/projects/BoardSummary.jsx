import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'

// "Board · resumo": read-only count of top-level cards per column, in the scope
// of the workspace filter. `summary` is null when the board has no columns; the
// screen passes `unavailable` when the cards could not be read. "Abrir board"
// asks the screen to go to the Board tab (onOpenBoard).
export default function BoardSummary({ summary, scopeLabel, unavailable = false, onOpenBoard }) {
  const max = summary ? Math.max(1, ...summary.columns.map((column) => column.count), summary.other) : 1
  return (
    <Panel as="section" aria-label="Board, resumo" className="v3-board-summary">
      <div className="v3-board-summary__head">
        <h2 className="v3-type-body v3-board-summary__title">Board · resumo</h2>
        <span className="v3-type-caption v3-board-summary__scope">{scopeLabel}</span>
      </div>

      {unavailable && <p className="v3-type-body-sm v3-board-summary__empty">Não consegui ler os cards agora.</p>}
      {!unavailable && !summary && <p className="v3-type-body-sm v3-board-summary__empty">O board ainda não tem colunas.</p>}
      {summary && (
        <div className="v3-board-summary__rows">
          {summary.columns.map((column) => (
            <BoardRow key={column.slug} label={column.label} count={column.count} max={max} />
          ))}
          {summary.other > 0 && <BoardRow label="Outras" count={summary.other} max={max} />}
        </div>
      )}

      <div className="v3-board-summary__foot">
        <Button size="sm" variant="secondary" onClick={onOpenBoard}>Abrir board</Button>
      </div>
    </Panel>
  )
}

function BoardRow({ label, count, max }) {
  return (
    <div className="v3-board-summary__row">
      <span className="v3-board-summary__label v3-type-body-sm">{label}</span>
      <div className="v3-board-summary__bar" aria-hidden="true">
        <i style={{ width: `${Math.round((count / max) * 100)}%` }} />
      </div>
      <span className="v3-board-summary__value v3-type-mono">{count}</span>
    </div>
  )
}
