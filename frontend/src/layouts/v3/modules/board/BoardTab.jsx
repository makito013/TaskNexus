import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_BOARD_VIEW,
  applyBoardView,
  isBoardViewFiltered,
  isBoardViewSorted,
  readBoardView,
  writeBoardView,
} from '../../../../utils/boardView.js'
import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { useProjectsView } from '../../ProjectsViewContext.jsx'
import BoardColumn from './BoardColumn.jsx'
import BoardControls from './BoardControls.jsx'
import { ALL_PROJECTS, buildScope, isUnassignedKey } from './boardScope.js'
import { useBoardData } from './useBoardData.js'
import './Board.css'

const SKELETON_COLUMNS = 3
// Space left under the scroller by the screen (its bottom padding, --v3-space-7).
const SCREEN_BOTTOM_GAP = 32
const MIN_SCROLLER_HEIGHT = 320

// The scroller takes what is left of the window below its own top edge, so the
// bottom of the board (and its horizontal scrollbar) sits on the fold at any
// width, with the toolbar wrapping to one line or two. The top is measured with
// the nearest scrolling ancestor at rest, so scrolling the page does not change it.
function useFillHeight(ref) {
  const [height, setHeight] = useState(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const measure = () => {
      let parent = node.parentElement
      while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
      const top = node.getBoundingClientRect().top + (parent ? parent.scrollTop : 0)
      const next = Math.max(MIN_SCROLLER_HEIGHT, Math.floor(window.innerHeight - top - SCREEN_BOTTOM_GAP))
      setHeight((current) => (current === next ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    // The toolbar above wraps to one line or two: its size moves the top of the scroller.
    const above = node.previousElementSibling
    if (observer && above) observer.observe(above)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  })
  return height
}

// Aba "Board" of Projetos (read only in this phase): the global columns with the
// cards of the workspace chosen in the header, narrowed by the filters of the bar.
//   registry         the registry index of the screen
//   workspaceKey     the header's workspace ('' = all, '__none' = outside any)
//   showArchived     the header's "Mostrar arquivados"
//   onHasUnassigned  true/false once the unfiltered cards say whether something
//                    lives outside every workspace (the filter needs that option)
//   focusRequest     > 0: move the focus to the "Board" heading once it exists
//   onFocusServed    told which request was served, so a remount does not repeat it
export default function BoardTab({ registry, workspaceKey, showArchived, onHasUnassigned, focusRequest = 0, onFocusServed }) {
  const headingRef = useRef(null)
  const [view, setView] = useState(() => readBoardView())
  // The project refinement belongs to the workspace it was chosen in: changing
  // the workspace drops it in the same render (no flash of a project of another
  // workspace). Priority, type, due and sort are kept (K8).
  // It lives in the Projetos view state, so a trip to a chat and back keeps it.
  const { boardProject: refinement, setBoardProject: setRefinement } = useProjectsView()
  const chosenProject = refinement.workspaceKey === workspaceKey ? refinement.projectKey : ALL_PROJECTS
  const [retrying, setRetrying] = useState(false)
  const scrollerRef = useRef(null)
  const scrollerHeight = useFillHeight(scrollerRef)

  // A project that left the options (an archived one, once "Mostrar arquivados" is off) no longer
  // narrows anything: the select would show "Todos os projetos" while the filter kept it.
  const offered = useMemo(
    () => buildScope({ registry, workspaceKey, projectKey: ALL_PROJECTS, showArchived }).projectOptions,
    [registry, workspaceKey, showArchived],
  )
  const projectKey = offered.some((option) => option.value === chosenProject) ? chosenProject : ALL_PROJECTS
  const scope = useMemo(
    () => buildScope({ registry, workspaceKey, projectKey, showArchived }),
    [registry, workspaceKey, projectKey, showArchived],
  )
  const data = useBoardData({ scope })

  useEffect(() => {
    if (focusRequest > 0) {
      headingRef.current?.focus()
      onFocusServed?.(focusRequest)
    }
  }, [focusRequest, onFocusServed])

  // Only an unfiltered request says what lives outside the workspaces; a request
  // for one project cannot, so it leaves the last answer standing.
  const { fetchedCards, cardsLoaded } = data
  useEffect(() => {
    if (!onHasUnassigned || !cardsLoaded || scope.fetchIds.length > 0) return
    onHasUnassigned(fetchedCards.some((card) => isUnassignedKey(card.projeto_id, registry)))
  }, [onHasUnassigned, cardsLoaded, scope.fetchIds.length, fetchedCards, registry])

  const handleViewChange = (next) => {
    setView(next)
    writeBoardView(next)
  }
  const clearFilters = () => {
    handleViewChange({ ...DEFAULT_BOARD_VIEW })
    setRefinement({ workspaceKey, projectKey: ALL_PROJECTS })
  }

  const viewCards = useMemo(
    () => applyBoardView(data.cards, view, data.doneSlug),
    [data.cards, view, data.doneSlug],
  )
  const filtered = isBoardViewFiltered(view) || projectKey !== ALL_PROJECTS
  const sorted = isBoardViewSorted(view)

  const retry = async (read) => {
    setRetrying(true)
    try {
      await read()
    } finally {
      setRetrying(false)
    }
  }

  let body
  if (data.loading) {
    body = (
      <div className="v3-board__scroller" aria-busy="true">
        <span className="v3-projects__sr-only">Carregando o board…</span>
        {Array.from({ length: SKELETON_COLUMNS }, (_, index) => (
          <div key={index} className="v3-board-column v3-board-column--skeleton" aria-hidden="true">
            <div className="v3-board-column__body">
              <i className="v3-board-skeleton__bar v3-board-skeleton__bar--wide" />
              {[0, 1, 2].map((block) => <div key={block} className="v3-board-skeleton"><i className="v3-board-skeleton__bar" /></div>)}
            </div>
          </div>
        ))}
      </div>
    )
  } else if (data.columnsError) {
    body = (
      <Panel notice="fin" role="alert">
        <b>Não consegui carregar o board.</b>{' '}
        <Button variant="secondary" size="sm" aria-busy={retrying || undefined} onClick={() => retry(data.refetchColumns)}>Tentar de novo</Button>
      </Panel>
    )
  } else if (data.columns.length === 0) {
    body = <Panel notice="tiq">O board ainda não tem colunas.</Panel>
  } else if (data.cardsError) {
    // The cards of this filter never arrived: say so instead of an endless "loading". It leaves
    // only when a read works (the poll keeps trying, "Tentar de novo" reads right now).
    body = (
      <Panel notice="fin" role="alert">
        <b>Não consegui carregar os cards.</b>{' '}
        <Button variant="secondary" size="sm" aria-busy={retrying || undefined} onClick={() => retry(data.refetchCards)}>
          Tentar de novo
        </Button>
      </Panel>
    )
  } else {
    const byColumn = (column) => viewCards.filter((card) => card.status === column.slug)
    body = (
      <>
        {filtered && data.cardsLoaded && viewCards.length === 0 && (
          <Panel notice="tiq">
            Nenhum card com esses filtros.{' '}
            <Button variant="text" size="sm" onClick={clearFilters}>Limpar filtros</Button>
          </Panel>
        )}
        <div
          ref={scrollerRef}
          className="v3-board__scroller"
          role="region"
          aria-label="Board"
          tabIndex={0}
          style={scrollerHeight ? { height: scrollerHeight } : undefined}
        >
          {data.columns.map((column) => (
            <BoardColumn
              key={column.slug}
              column={column}
              cards={byColumn(column)}
              cardsLoaded={data.cardsLoaded}
              registry={registry}
              doneSlug={data.doneSlug}
              hideProject={projectKey !== ALL_PROJECTS}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="v3-board">
      <h2 ref={headingRef} tabIndex={-1} className="v3-projects__sr-only">Board</h2>
      {!data.loading && !data.columnsError && (
        <BoardControls
          view={view}
          onViewChange={handleViewChange}
          projectOptions={scope.projectOptions}
          projectKey={projectKey}
          onProjectChange={(value) => setRefinement({ workspaceKey, projectKey: value })}
          projectDisabled={!scope.hasProjectChoice}
          sorted={sorted}
          clearable={filtered || sorted}
          onClear={clearFilters}
          stale={data.cardsStale}
        />
      )}
      {body}
    </div>
  )
}
