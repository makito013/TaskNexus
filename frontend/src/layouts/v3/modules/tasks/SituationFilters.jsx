const FILTERS = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'today', label: 'Hoje' },
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'done', label: 'Concluídas' },
]

// Exclusive situation filter: a group of toggle buttons (aria-pressed) with the
// count of each situation. `counts` is null while loading ("–" is shown).
export default function SituationFilters({ situation, counts, onSelect }) {
  return (
    <div className="v3-tasks__filters">
      <span className="v3-type-eyebrow v3-tasks__group-label" aria-hidden="true">Situação</span>
      <div role="group" aria-label="Situação" className="v3-tasks__filter-list">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className="v3-tasks__filter"
            aria-pressed={situation === filter.id}
            onClick={() => onSelect(filter.id)}
          >
            <span>{filter.label}</span>
            <span className="v3-type-mono-sm v3-tasks__filter-count">{counts ? counts[filter.id] : '–'}</span>
          </button>
        ))}
      </div>
      <p className="v3-type-caption v3-tasks__hint">Hoje e Atrasadas contam só cards com prazo.</p>
    </div>
  )
}
