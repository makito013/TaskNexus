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
  clearTarget = null,
  onClearFinished = null,
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
      {onClearFinished && (
        <>
          <Button
            variant="secondary"
            data-clear-finished
            aria-disabled={clearTarget ? undefined : 'true'}
            aria-describedby={clearTarget ? undefined : 'v3-board-clear-hint'}
            onClick={() => { if (clearTarget) onClearFinished() }}
          >
            Limpar concluídos
          </Button>
          {!clearTarget && (
            <span id="v3-board-clear-hint" className="v3-board-controls__hint v3-type-caption">
              Escolha um projeto ou "Do workspace".
            </span>
          )}
        </>
      )}
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
