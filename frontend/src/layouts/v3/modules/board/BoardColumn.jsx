import Chip from '../../components/Chip/Chip.jsx'
import BoardCardFace from './BoardCardFace.jsx'

const SKELETON_CARDS = 2

// One column of the board: header (name, count, "done" mark) and its cards.
// Before the cards arrive the count is three fixed dots and the body shows still
// placeholders; an empty column says so. Reading only in this phase: no menu, no
// "+ Adicionar card", no dragging.
export default function BoardColumn({ column, cards, cardsLoaded, registry, doneSlug, hideProject }) {
  return (
    <section
      role="group"
      aria-label={`Coluna ${column.label}`}
      className={`v3-board-column${column.is_done ? ' v3-board-column--done' : ''}`}
    >
      <header className="v3-board-column__head">
        <h3 className="v3-board-column__name v3-type-title-sm">{column.label}</h3>
        <span className="v3-board-column__count v3-type-mono-sm" aria-label={cardsLoaded ? `${cards.length} cards` : 'Carregando cards'}>
          ({cardsLoaded ? cards.length : '…'})
        </span>
        {column.is_done && <Chip tone="state" accent="navi">✓ Concluída</Chip>}
      </header>

      <div className="v3-board-column__body">
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
          <p className="v3-board-column__empty v3-type-body-sm">Nenhum card aqui.</p>
        )}
        {cardsLoaded && cards.length > 0 && (
          <ul role="list" className="v3-board-column__cards">
            {cards.map((card) => (
              <li key={card.id} className="v3-board-column__item">
                <BoardCardFace card={card} registry={registry} doneSlug={doneSlug} hideProject={hideProject} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
