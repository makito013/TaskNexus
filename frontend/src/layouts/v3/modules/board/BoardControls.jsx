import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import BoardFilters from './BoardFilters.jsx'

// The toolbar above the columns: the filter selects, "Limpar filtros" when
// something is filtered or sorted, a hint about sorting and the quiet chip that
// says the last read failed (the board keeps showing the last good state).
export default function BoardControls({
  view,
  onViewChange,
  projectOptions,
  projectKey,
  onProjectChange,
  projectDisabled,
  sorted,
  clearable,
  onClear,
  stale,
}) {
  return (
    <div role="group" aria-label="Filtros do board" className="v3-board-controls">
      <BoardFilters
        view={view}
        onViewChange={onViewChange}
        projectOptions={projectOptions}
        projectKey={projectKey}
        onProjectChange={onProjectChange}
        projectDisabled={projectDisabled}
      />
      {clearable && <Button variant="text" onClick={onClear}>Limpar filtros</Button>}
      {sorted && (
        <span className="v3-board-controls__hint v3-type-caption">
          Com ordenação, arrastar muda só a coluna do card.
        </span>
      )}
      {stale && (
        <Chip tone="state" accent="fin" role="status" className="v3-board-controls__stale">Sem atualizar agora</Chip>
      )}
    </div>
  )
}
