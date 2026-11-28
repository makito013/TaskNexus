import { Fragment } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { cardDndId } from '../../../../utils/boardDndIds.js'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import BoardCardFace from './BoardCardFace.jsx'
import ColumnMenu from './ColumnMenu.jsx'
import DropLine from './DropLine.jsx'
import MoveSelect from './MoveSelect.jsx'
import SortableCard from './SortableCard.jsx'

const SKELETON_CARDS = 2

// One column of the board: header (name, count, "done" mark, menu) and its cards. Before the
// cards arrive the count is three fixed dots and the body shows still placeholders; an empty
// column says so and still takes a dropped card.
//   column, cards, cardsLoaded, registry, doneSlug, hideProject   what is shown
//   columns          every column in order (the "Mover" select lists them, the menu asks if this is the last)
//   onChangeColumn   (cardId, slug) => Promise<boolean>, the "Mover" select
//   onRename, onMarkDone, onDelete   what the "⋯" menu asks for
//   handleProps      ref + press listeners of the drag, on the header (the whole header is the grip)
//   dropzoneRef      the body of the column, where a card can be dropped on the empty area
//   cardOver         a card is over that area
//   dropHint         { beforeId } while a card is held over this column: where its line goes
//                    (null beforeId = after the last card); null when the drop would change nothing
//   target           the column under the held card (also the whole signal when a sort is on)
//   flash            this column was just moved
//   onOpenCard(card, element)  isRecentDrop()  open a card; a press right after a drop is the drag's
//   onAddCard(slug, element)   canAddCard   "+ Adicionar card" (unavailable, with the reason, when there is no place to create in)
export default function BoardColumn({
  column,
  cards,
  cardsLoaded,
  registry,
  doneSlug,
  hideProject,
  columns,
  onChangeColumn,
  onRename,
  onMarkDone,
  onDelete,
  handleProps,
  dropzoneRef,
  cardOver,
  dropHint = null,
  target = false,
  flash = false,
  onOpenCard = null,
  isRecentDrop = undefined,
  onAddCard = null,
  canAddCard = true,
}) {
  const classes = [
    'v3-board-column',
    column.is_done ? 'v3-board-column--done' : '',
    target ? 'v3-board-column--target' : '',
    flash ? 'v3-board-column--flash' : '',
  ].filter(Boolean).join(' ')

  return (
    <section role="group" aria-label={`Coluna ${column.label}`} className={classes}>
      <header
        className="v3-board-column__head"
        tabIndex={-1}
        data-column-header={column.slug}
        {...handleProps}
      >
        <h3 className="v3-board-column__name v3-type-title-sm">{column.label}</h3>
        <span className="v3-board-column__count v3-type-mono-sm" aria-label={cardsLoaded ? `${cards.length} cards` : 'Carregando cards'}>
          ({cardsLoaded ? cards.length : '…'})
        </span>
        {column.is_done && <Chip tone="state" accent="navi">✓ Concluída</Chip>}
        <ColumnMenu
          column={column}
          isLastColumn={columns.length === 1}
          onRename={onRename}
          onMarkDone={onMarkDone}
          onDelete={onDelete}
        />
      </header>

      <div ref={dropzoneRef} className="v3-board-column__body">
        {!cardsLoaded && (
          <div className="v3-board-column__skeletons" aria-hidden="true">
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <div key={index} className="v3-board-skeleton">
                <i className="v3-board-skeleton__bar v3-board-skeleton__bar--wide" />
                <i className="v3-board-skeleton__bar" />
                <i className="v3-board-skeleton__bar v3-board-skeleton__bar--short" />
              </div>
            ))}
          </div>
        )}
        {cardsLoaded && cards.length === 0 && (
          <p className={`v3-board-column__empty v3-type-body-sm${cardOver || target ? ' v3-board-column__empty--over' : ''}`}>
            Nenhum card aqui.
          </p>
        )}
        {cardsLoaded && cards.length > 0 && (
          <SortableContext items={cards.map((card) => cardDndId(card.id))} strategy={verticalListSortingStrategy}>
            <ul role="list" className="v3-board-column__cards">
              {cards.map((card) => (
                <Fragment key={card.id}>
                  {dropHint && dropHint.beforeId === card.id && <DropLine />}
                  <SortableCard cardId={card.id}>
                    <BoardCardFace
                      card={card}
                      registry={registry}
                      doneSlug={doneSlug}
                      hideProject={hideProject}
                      onOpen={onOpenCard}
                      isRecentDrop={isRecentDrop}
                      moveSelect={<MoveSelect card={card} columns={columns} onChange={onChangeColumn} />}
                    />
                  </SortableCard>
                </Fragment>
              ))}
              {dropHint && dropHint.beforeId == null && <DropLine />}
            </ul>
          </SortableContext>
        )}
      </div>

      {onAddCard && (
        <Button
          variant="text"
          className="v3-board-column__add"
          data-add-card={column.slug}
          aria-label={`Adicionar card na coluna ${column.label}`}
          aria-disabled={canAddCard ? undefined : 'true'}
          title={canAddCard ? undefined : 'Crie um workspace para adicionar cards.'}
          onClick={(event) => { if (canAddCard) onAddCard(column.slug, event.currentTarget) }}
        >
          + Adicionar card
        </Button>
      )}
    </section>
  )
}
