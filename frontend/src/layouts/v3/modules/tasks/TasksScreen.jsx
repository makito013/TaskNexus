import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import Pet from '../../components/Pet/Pet.jsx'
import { useIslandReport } from '../../IslandContext.jsx'
import { summaryLine } from './dueLabels.js'
import SituationFilters from './SituationFilters.jsx'
import TaskDetail from './TaskDetail.jsx'
import { countSituations, filterItems, tasksIslandMessage } from './taskItems.js'
import TaskRow from './TaskRow.jsx'
import { useTaskItems } from './useTaskItems.js'
import '../../theme/prose.css'
import './TasksScreen.css'

const SKELETON_ROWS = 4

const EMPTY_COPY = {
  pending: {
    title: 'Tudo em dia.',
    text: 'Quando surgir uma tarefa de validação ou um card em aberto, ela aparece aqui.',
  },
  today: { title: 'Nada com prazo pra hoje.', text: 'Os cards com prazo de hoje aparecem aqui.' },
  overdue: { title: 'Nenhuma atrasada.', text: 'Bom sinal. Tô de olho nos prazos.' },
  done: { title: 'Nada concluído ainda.', text: 'As tarefas e cards concluídos aparecem aqui.' },
}

// Tarefas (Tiq): validation tasks (actionable) + board cards with prazo/tipo
// (read-only), filtered by situation, with a detail panel. Focus on the heading
// is moved by the shell (AppV3) when the module changes; this is the only h1.
export default function TasksScreen() {
  const {
    items, today, loading, errors, refetch, completeTask, reopenTask, savingId, mutationError,
    clearMutationError,
  } = useTaskItems()
  const [situation, setSituation] = useState('pending')
  const [selectedId, setSelectedId] = useState(null)
  const listColumnRef = useRef(null)

  useEffect(() => {
    document.title = 'Tarefas · TaskNexus'
  }, [])

  const totalFailure = !loading && Boolean(errors.tasks && errors.cards)
  const counts = useMemo(() => countSituations(items, today), [items, today])
  const rows = useMemo(() => filterItems(items, situation, today), [items, situation, today])

  // A selected item that left the filter drops back to the placeholder, except
  // while its own complete/reopen is in flight (the "Salvando…" button stays).
  const selectedItem = useMemo(() => {
    if (!selectedId) return null
    return rows.find((item) => item.id === selectedId)
      || (selectedId === savingId ? items.find((item) => item.id === selectedId) : null)
      || null
  }, [rows, items, selectedId, savingId])

  // A save failure belongs to the item it came from: moving to another item
  // (or another filter) dismisses it.
  const selectItem = useCallback((id) => {
    clearMutationError()
    setSelectedId(id)
  }, [clearMutationError])
  const selectSituation = useCallback((next) => {
    clearMutationError()
    setSituation(next)
  }, [clearMutationError])
  const showOverdue = useCallback(() => selectSituation('overdue'), [selectSituation])

  // Island: Tiq's phrase derived from the data. The "alert" about late items is
  // acknowledged (pet calms down) once the Atrasadas filter is open.
  const islandMessage = tasksIslandMessage({ loading, failed: totalFailure, counts })
  const petState = islandMessage.state === 'alert' && !totalFailure && situation === 'overdue'
    ? 'idle'
    : islandMessage.state
  const islandContent = useMemo(() => {
    let actions = []
    if (totalFailure) actions = [{ label: 'Tentar de novo', onClick: refetch }]
    else if (!loading && counts.overdue > 0) actions = [{ label: 'Ver atrasadas', onClick: showOverdue }]
    return { message: islandMessage.text, state: petState, actions }
  }, [islandMessage.text, petState, totalFailure, loading, counts.overdue, refetch, showOverdue])
  useIslandReport('tasks', islandContent)

  // After a complete/reopen the row usually leaves the list and takes the focus
  // with it: land on the row now in its place (or the list column when empty).
  const restoreFocus = (index) => {
    const active = document.activeElement
    if (active && active !== document.body) return
    const buttons = listColumnRef.current?.querySelectorAll('.v3-task-row__main') || []
    const target = buttons[Math.min(index, buttons.length - 1)] || listColumnRef.current
    target?.focus()
  }

  const toggle = async (item) => {
    if (savingId) return
    const index = rows.findIndex((row) => row.id === item.id)
    const ok = await (item.done ? reopenTask(item) : completeTask(item))
    if (ok) restoreFocus(Math.max(index, 0))
  }

  const partialNotices = []
  if (!loading && !totalFailure) {
    if (errors.tasks) {
      partialNotices.push('Não consegui carregar as tarefas de validação. Mostrando só os cards.')
    }
    if (errors.cards) {
      partialNotices.push('Não consegui carregar os cards. Mostrando só as tarefas de validação.')
    }
    if (errors.columns && !errors.cards) {
      partialNotices.push('Não sei quais cards já foram concluídos, então não marco atrasos.')
    }
  }

  const empty = EMPTY_COPY[situation]

  return (
    <div className="v3-screen v3-tasks">
      <header className="v3-tasks__header">
        <h1 tabIndex={-1} className="v3-type-title-lg v3-screen__title">Tarefas</h1>
        {!loading && !totalFailure && (
          <p className="v3-type-body-sm v3-tasks__summary">{summaryLine(counts)}</p>
        )}
      </header>

      {totalFailure ? (
        <Panel className="v3-tasks__error" role="alert">
          <p className="v3-type-title-sm v3-tasks__error-title">Não consegui buscar as tarefas.</p>
          <p className="v3-type-body-sm v3-tasks__error-text">Confira a conexão com o TaskNexus e tente de novo.</p>
          <Button variant="secondary" onClick={refetch}>Tentar de novo</Button>
        </Panel>
      ) : (
        <div className="v3-tasks__body">
          <SituationFilters situation={situation} counts={loading ? null : counts} onSelect={selectSituation} />

          <div className="v3-tasks__list-column" ref={listColumnRef} tabIndex={-1}>
            {partialNotices.map((text) => (
              <Panel key={text} notice="fin" role="status">{text}</Panel>
            ))}
            {mutationError && mutationError.id !== selectedItem?.id && (
              <Panel notice="fin" role="status">Não consegui salvar. Tenta de novo?</Panel>
            )}

            {loading && (
              <>
                <p role="status" className="v3-tasks__sr-only">Carregando tarefas…</p>
                <ul aria-label="Tarefas" aria-busy="true" className="v3-tasks__list">
                  {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <li key={index} className="v3-task-row v3-task-row--skeleton" aria-hidden="true" />
                  ))}
                </ul>
              </>
            )}

            {!loading && rows.length === 0 && (
              <Panel className="v3-tasks__empty">
                <Pet pet="tiq" state="idle" size="front" decorative />
                <p className="v3-type-title-sm v3-tasks__empty-title">{empty.title}</p>
                <p className="v3-type-body-sm v3-tasks__empty-text">{empty.text}</p>
              </Panel>
            )}

            {!loading && rows.length > 0 && (
              <ul aria-label="Tarefas" className="v3-tasks__list">
                {rows.map((item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    today={today}
                    selected={item.id === selectedId}
                    saving={item.id === savingId}
                    onSelect={selectItem}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            )}
          </div>

          <aside aria-label="Detalhe da tarefa" className="v3-tasks__detail">
            {selectedItem ? (
              <TaskDetail
                item={selectedItem}
                today={today}
                saving={selectedItem.id === savingId}
                mutationError={mutationError}
                onComplete={toggle}
                onReopen={toggle}
              />
            ) : (
              <Panel className="v3-tasks__placeholder">
                <p className="v3-type-body-sm">Escolha uma tarefa pra ver os detalhes.</p>
              </Panel>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
