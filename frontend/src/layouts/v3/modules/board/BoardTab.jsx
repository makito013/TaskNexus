import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { computeCardDrop } from '../../../../utils/boardCardOrder.js'
import { reorderColumns as reorderSlugs } from '../../../../utils/boardColumnOrder.js'
import {
  BOARD_SCREEN_READER_INSTRUCTIONS,
  buildAnnouncements,
  buildBoardCollisionDetection,
  resolveCardDropTarget,
  useBoardSensors,
} from '../../../../utils/boardDnd.js'
import { cardIdFromDndId, isCardDndId, isColumnDropzoneId, slugFromColumnDropzoneId } from '../../../../utils/boardDndIds.js'
import { vibrateDragPickup } from '../../../../utils/haptics.js'
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
import { useToast } from '../../components/Toast/toastContext.js'
import { useProjectsView } from '../../ProjectsViewContext.jsx'
import BoardColumn from './BoardColumn.jsx'
import BoardControls from './BoardControls.jsx'
import BoardOverlay from './BoardOverlay.jsx'
import CardDialog from './CardDialog.jsx'
import ClearFinishedDialog from './ClearFinishedDialog.jsx'
import DeleteColumnDialog from './DeleteColumnDialog.jsx'
import MoveBanner from './MoveBanner.jsx'
import NewColumn from './NewColumn.jsx'
import RenameColumnDialog from './RenameColumnDialog.jsx'
import SortableColumn from './SortableColumn.jsx'
import { ALL_PROJECTS, DO_WORKSPACE, buildScope, isUnassignedKey, placeOf } from './boardScope.js'
import { resolveCreateDefaults } from './cardForm.js'
import { useBoardData } from './useBoardData.js'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import './Board.css'

const SKELETON_COLUMNS = 3
// The border flash of a column that was just moved (the stylesheet fades it back).
const FLASH_MS = 700
const NO_CARDS = []
// A press this soon after a card drop belongs to the drag, not to the card.
const DROP_CLICK_GUARD_MS = 300

function findCardById(cards, id) {
  for (const entry of cards) {
    if (entry.id === id) return entry
    const sub = (entry.subcards || []).find((candidate) => candidate.id === id)
    if (sub) return sub
  }
  return null
}
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

// Aba "Board" of Projetos: the global columns with the cards of the workspace chosen in the
// header, narrowed by the filters of the bar. Columns are created, renamed, marked as done,
// deleted and dragged here; cards are dragged between and inside columns (the V2 sensors,
// collisions and rollback) or moved by the select of their foot.
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
  // A press of "Tentar de novo" asks for the focus to follow the board once it is back.
  const [refocus, setRefocus] = useState(false)
  const scrollerRef = useRef(null)
  const scrollerHeight = useFillHeight(scrollerRef)

  // A project that left the options (an archived one, once "Mostrar arquivados" is off) no longer
  // narrows anything: the select would show "Todos os projetos" while the filter kept it.
  const offered = useMemo(
    () => buildScope({ registry, workspaceKey, projectKey: ALL_PROJECTS, showArchived }).projectOptions,
    [registry, workspaceKey, showArchived],
  )
  const projectKey = offered.some((option) => option.value === chosenProject) ? chosenProject : ALL_PROJECTS
  // The refinement of a project that left the options is dropped from the view state too (select and
  // state go back to "Todos os projetos"): it must not come back when "Mostrar arquivados" is turned on.
  useEffect(() => {
    if (chosenProject !== projectKey) setRefinement({ workspaceKey, projectKey: ALL_PROJECTS })
  }, [chosenProject, projectKey, workspaceKey, setRefinement])
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

  // The cards of each column as they are on screen (the neighbours of a drop are these).
  const cardsByColumn = useMemo(() => {
    const byColumn = new Map()
    for (const card of viewCards) {
      if (!byColumn.has(card.status)) byColumn.set(card.status, [])
      byColumn.get(card.status).push(card)
    }
    return byColumn
  }, [viewCards])
  const cardsOf = (slug) => cardsByColumn.get(slug) ?? NO_CARDS

  // -- drag and drop: the drag context is born here, the two kinds of drag are told apart by
  // the namespace of their ids (a column is its slug, a card is `card:{id}`).
  const sensors = useBoardSensors()
  const [dragCardId, setDragCardId] = useState(null)
  const [dragSlug, setDragSlug] = useState(null)
  // { status, beforeId }: where the line of the drop is drawn (null beforeId = after the last card).
  const [dropHint, setDropHint] = useState(null)
  const [overStatus, setOverStatus] = useState(null)
  const [flashedSlug, setFlashedSlug] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [focusSlug, setFocusSlug] = useState(null)
  // When the last card drop happened: a click right after it belongs to the drag, not to the
  // card (the face ignores a press for 300 ms after it).
  const lastDropRef = useRef(0)
  const isRecentDrop = () => Date.now() - lastDropRef.current < DROP_CLICK_GUARD_MS
  const toast = useToast()
  // The dialog that is open: { mode: 'create', slug } | { mode: 'edit', id }, plus the "Limpar concluídos" one.
  const [cardDialog, setCardDialog] = useState(null)
  // { key, label } of the place "Limpar concluídos" was opened for; fixed for the life of the dialog
  const [clearDialog, setClearDialog] = useState(null)
  // The last picture of the open card: a card that left the filtered list (or the hook) keeps its dialog.
  const openCardRef = useRef(null)

  const draggingCard = dragCardId != null ? viewCards.find((card) => card.id === dragCardId) ?? null : null
  const draggingColumn = dragSlug ? data.columns.find((column) => column.slug === dragSlug) ?? null : null

  const accessibility = useMemo(() => {
    const labelBySlug = new Map(data.columns.map((column) => [column.slug, column.label]))
    const titleById = new Map(viewCards.map((card) => [card.id, card.titulo]))
    const positionOf = (id, activeId) => {
      if (isCardDndId(id)) {
        const card = viewCards.find((entry) => entry.id === cardIdFromDndId(id))
        if (!card) return null
        const siblings = cardsOf(card.status)
        return { position: siblings.indexOf(card) + 1, total: siblings.length, slug: card.status }
      }
      if (isColumnDropzoneId(id)) {
        const slug = slugFromColumnDropzoneId(id)
        const siblings = cardsOf(slug)
        const heldHere = isCardDndId(activeId) && siblings.some((entry) => entry.id === cardIdFromDndId(activeId))
        const end = siblings.length + (heldHere ? 0 : 1)
        return { position: end, total: end, slug }
      }
      const index = data.columns.findIndex((column) => column.slug === id)
      return index === -1 ? null : { position: index + 1, total: data.columns.length, slug: id }
    }
    return {
      screenReaderInstructions: BOARD_SCREEN_READER_INSTRUCTIONS,
      announcements: buildAnnouncements({
        cardTitle: (cardId) => titleById.get(cardId) ?? cardId,
        columnLabel: (slug) => labelBySlug.get(slug) ?? slug,
        positionOf,
      }),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.columns, viewCards, cardsByColumn])

  const resolveTarget = (overId) => resolveCardDropTarget(overId, { columns: data.columns, cards: viewCards })

  const handleDragStart = (event) => {
    // The tick under the fingertip is the one cue a finger does not cover (a no-op without the API).
    vibrateDragPickup()
    if (isCardDndId(event.active.id)) {
      setDragCardId(cardIdFromDndId(event.active.id))
      setDropHint(null)
      setOverStatus(null)
      // The 5 s poll waits for as long as the card is held: a tick replacing the cards under the finger
      // makes them jump.
      data.setCardDragActive(true)
    } else {
      setDragSlug(event.active.id)
    }
  }

  const handleDragOver = (event) => {
    if (!isCardDndId(event.active.id)) return
    const activeId = cardIdFromDndId(event.active.id)
    const target = resolveTarget(event.over?.id)
    if (activeId == null || target == null) {
      setDropHint(null)
      setOverStatus(null)
      return
    }
    setOverStatus(target.status)
    // With a sort on the drop only changes the column, so there is no slot to promise.
    if (sorted) {
      setDropHint(null)
      return
    }
    const drop = computeCardDrop(cardsOf(target.status).map((card) => card.id), activeId, target.overCardId)
    // A drop that changes nothing promises nothing: no line.
    setDropHint(drop ? { status: target.status, beforeId: drop.before_id } : null)
  }

  const finishCardDrag = () => {
    setDragCardId(null)
    setDropHint(null)
    setOverStatus(null)
    data.setCardDragActive(false)
    lastDropRef.current = Date.now()
  }

  const handleCardDragEnd = async (event) => {
    const activeId = cardIdFromDndId(event.active.id)
    const target = resolveTarget(event.over?.id)
    finishCardDrag()
    // Released outside any valid column (or on one that vanished): cancelled, no request.
    if (activeId == null || target == null) return

    // With a sort on, the order on screen is the sort and not the stored one, so neighbours taken from
    // it would mean nothing (or a conflict): another column behaves like the select, the same one is a no-op.
    if (sorted) {
      const held = viewCards.find((card) => card.id === activeId)
      if (held && held.status !== target.status) await data.changeColumn(activeId, target.status)
      return
    }

    const drop = computeCardDrop(cardsOf(target.status).map((card) => card.id), activeId, target.overCardId)
    if (drop === null) return
    await data.moveCard(activeId, { status: target.status, afterId: drop.after_id, beforeId: drop.before_id })
  }

  const handleColumnDragEnd = async (event) => {
    setDragSlug(null)
    const current = data.columns.map((column) => column.slug)
    const next = reorderSlugs(current, event.active?.id, event.over?.id)
    // Identity, not equality: the helper returns what it was given when nothing changes.
    if (next === current) return
    if (await data.reorderColumns(next)) setFlashedSlug(event.active.id)
  }

  const handleDragEnd = (event) => (isCardDndId(event.active.id) ? handleCardDragEnd(event) : handleColumnDragEnd(event))
  const handleDragCancel = (event) => {
    if (isCardDndId(event?.active?.id)) finishCardDrag()
    else setDragSlug(null)
  }

  // The button that had the focus left with the error panel: the focus goes to the board. While the
  // read still fails the panel stays and so does the focus.
  useEffect(() => {
    if (!refocus) return
    scrollerRef.current?.focus()
    setRefocus(false)
  }, [refocus, data.columnsError, data.cardsError, data.loading])

  useEffect(() => {
    if (!flashedSlug) return undefined
    const timer = setTimeout(() => setFlashedSlug(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flashedSlug])

  // A column that was just created is scrolled into view and takes the focus on its header.
  useEffect(() => {
    if (!focusSlug) return
    const header = [...(scrollerRef.current?.querySelectorAll('[data-column-header]') ?? [])]
      .find((node) => node.dataset.columnHeader === focusSlug)
    if (!header) return
    header.focus({ preventScroll: true })
    header.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    setFocusSlug(null)
  }, [focusSlug, data.columns])

  // After a dialog of a column closes the focus goes back to the menu button of that column (or
  // to the board, when the column is gone).
  const returnToColumnMenu = (slug) => () => {
    const header = [...(scrollerRef.current?.querySelectorAll('[data-column-header]') ?? [])]
      .find((node) => node.dataset.columnHeader === slug)
    return header?.querySelector('.v3-board-menu__button') ?? scrollerRef.current
  }

  // -- the card dialog and "Limpar concluídos"
  const createPlace = useMemo(
    () => resolveCreateDefaults({ registry, workspaceKey, projectKey, columns: data.columns }),
    [registry, workspaceKey, projectKey, data.columns],
  )
  const editingId = cardDialog?.mode === 'edit' ? cardDialog.id : null
  const liveCard = editingId != null ? findCardById(data.fetchedCards, editingId) : null
  if (liveCard) openCardRef.current = liveCard
  const editingCard = editingId != null ? (liveCard ?? openCardRef.current) : null
  // Would a card in this place leave the list that is on screen?
  const leavesView = (key) => !scope.matches(key) || (scope.fetchIds.length > 0 && !scope.fetchIds.includes(key))

  // The exact place "Limpar concluídos" works on: the project refined, else the root of the chosen workspace.
  const realWorkspace = workspaceKey && workspaceKey !== NO_WORKSPACE_VALUE ? registry.workspaceByKey.get(workspaceKey) : null
  let clearTarget = null
  if (projectKey && projectKey !== DO_WORKSPACE) {
    const place = placeOf(projectKey, registry)
    clearTarget = { key: projectKey, label: place.project ?? place.workspace }
  } else if (realWorkspace) {
    clearTarget = { key: realWorkspace.key, label: `Do workspace ${realWorkspace.name}` }
  }

  const focusBoardFallback = () => headingRef.current
  const returnToCard = (id) => () => (
    [...(scrollerRef.current?.querySelectorAll('[data-card-open]') ?? [])].find((node) => node.dataset.cardOpen === String(id))
    ?? focusBoardFallback()
  )
  const returnToAdd = (slug) => () => (
    [...(scrollerRef.current?.querySelectorAll('[data-add-card]') ?? [])].find((node) => node.dataset.addCard === slug)
    ?? focusBoardFallback()
  )
  const returnToClear = () => document.querySelector('[data-clear-finished]') ?? focusBoardFallback()

  const openCard = (entry) => {
    openCardRef.current = entry
    setCardDialog({ mode: 'edit', id: entry.id })
  }
  const closeCardDialog = () => setCardDialog(null)
  const clearDone = (count) => toast.push({ text: count === 1 ? '1 card excluído.' : `${count} cards excluídos.` })

  const retry = async (read) => {
    setRetrying(true)
    try {
      await read()
    } finally {
      setRetrying(false)
      setRefocus(true)
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
    body = (
      <>
        <Panel notice="tiq">O board ainda não tem colunas.</Panel>
        <NewColumn first onCreate={data.createColumn} onCreated={() => {}} />
      </>
    )
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
    body = (
      <>
        {filtered && data.cardsLoaded && viewCards.length === 0 && (
          <Panel notice="tiq">
            Nenhum card com esses filtros.{' '}
            <Button variant="text" size="sm" onClick={clearFilters}>Limpar filtros</Button>
          </Panel>
        )}
        <MoveBanner notice={data.moveNotice} onDismiss={data.dismissMoveNotice} />
        <DndContext
          accessibility={accessibility}
          sensors={sensors}
          collisionDetection={buildBoardCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={data.columns.map((column) => column.slug)} strategy={horizontalListSortingStrategy}>
            <div
              ref={scrollerRef}
              className="v3-board__scroller"
              role="region"
              aria-label="Board"
              tabIndex={0}
              style={scrollerHeight ? { height: scrollerHeight } : undefined}
            >
              {data.columns.map((column) => (
                <SortableColumn key={column.slug} slug={column.slug}>
                  {({ handleProps, dropzoneRef, cardOver }) => (
                    <BoardColumn
                      column={column}
                      cards={cardsOf(column.slug)}
                      cardsLoaded={data.cardsLoaded}
                      registry={registry}
                      doneSlug={data.doneSlug}
                      hideProject={projectKey !== ALL_PROJECTS}
                      columns={data.columns}
                      onChangeColumn={data.changeColumn}
                      onRename={() => setRenameTarget(column)}
                      onMarkDone={data.setDoneColumn}
                      onDelete={() => setDeleteTarget(column)}
                      onOpenCard={openCard}
                      isRecentDrop={isRecentDrop}
                      onAddCard={(slug) => setCardDialog({ mode: 'create', slug })}
                      canAddCard={createPlace != null}
                      handleProps={handleProps}
                      dropzoneRef={dropzoneRef}
                      cardOver={cardOver}
                      dropHint={dropHint && dropHint.status === column.slug ? dropHint : null}
                      target={overStatus === column.slug}
                      flash={flashedSlug === column.slug}
                    />
                  )}
                </SortableColumn>
              ))}
              <NewColumn onCreate={data.createColumn} onCreated={(created) => setFocusSlug(created.slug)} />
            </div>
          </SortableContext>
          <BoardOverlay card={draggingCard} column={draggingColumn} count={draggingColumn ? cardsOf(draggingColumn.slug).length : 0} />
        </DndContext>
        {renameTarget && (
          <RenameColumnDialog
            column={renameTarget}
            onRename={data.renameColumn}
            onClose={() => setRenameTarget(null)}
            returnFocusTo={returnToColumnMenu(renameTarget.slug)}
          />
        )}
        {cardDialog && (cardDialog.mode === 'create' || editingCard) && (
          <CardDialog
            key={cardDialog.mode === 'edit' ? `edit-${cardDialog.id}` : `create-${cardDialog.slug}`}
            mode={cardDialog.mode}
            card={cardDialog.mode === 'edit' ? editingCard : null}
            createDefaults={cardDialog.mode === 'create'
              ? resolveCreateDefaults({ registry, workspaceKey, projectKey, columnSlug: cardDialog.slug, columns: data.columns })
              : null}
            columns={data.columns}
            doneSlug={data.doneSlug}
            registry={registry}
            leavesView={leavesView}
            onSave={cardDialog.mode === 'edit' ? (patch) => data.updateCard(cardDialog.id, patch) : data.createCard}
            onDelete={(entry) => data.deleteCard(entry.id)}
            onUploadImage={(file) => data.uploadImage(cardDialog.id, file)}
            onDeleteImage={(imageId) => data.deleteImage(cardDialog.id, imageId)}
            onAnswerQuestion={(questionId, text) => data.answerQuestion(cardDialog.id, questionId, text)}
            onDeleteQuestion={(questionId) => data.deleteQuestion(cardDialog.id, questionId)}
            onClose={closeCardDialog}
            returnFocusTo={cardDialog.mode === 'edit' ? returnToCard(cardDialog.id) : returnToAdd(cardDialog.slug)}
          />
        )}
        {clearDialog && (
          <ClearFinishedDialog
            targetLabel={clearDialog.label}
            onPreview={() => data.previewClear(clearDialog.key)}
            onExecute={() => data.executeClear(clearDialog.key)}
            onDone={clearDone}
            onClose={() => setClearDialog(null)}
            returnFocusTo={returnToClear}
          />
        )}
        {deleteTarget && (
          <DeleteColumnDialog
            column={deleteTarget}
            onDelete={data.deleteColumn}
            onClose={() => setDeleteTarget(null)}
            returnFocusTo={returnToColumnMenu(deleteTarget.slug)}
          />
        )}
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
          clearTarget={clearTarget}
          onClearFinished={data.columns.length > 0 ? () => setClearDialog(clearTarget) : null}
        />
      )}
      {body}
    </div>
  )
}
