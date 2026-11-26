import { createPortal } from 'react-dom'
import { DragOverlay } from '@dnd-kit/core'
import { CARD_TIPO_LABELS } from '../../../../utils/cardMeta.js'
import Chip from '../../components/Chip/Chip.jsx'
import { plainDescription } from './BoardCardFace.jsx'
import PriorityBars from './PriorityBars.jsx'
import './BoardLeaf.css'

const BADGE_KIND = { bug: 'bug', hotfix: 'hotfix', historia: 'story' }

const prefersLessMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// The copy that follows the pointer: the whole card, or only the header of a column. Inert on
// purpose (text and glyphs, no button, no select): the overlay sets no pointer-events of its
// own, so a live control could end up under the finger mid-drag.
//
// Mounted on the body, outside the board: the overlay is `position: fixed` (set by dnd-kit) and
// must not be inside anything that moves or clips.
export default function BoardOverlay({ card = null, column = null, count = 0 }) {
  let content = null
  if (card) {
    const description = plainDescription(card.descricao)
    content = (
      <div className="v3-board-overlay">
        {(card.prioridade || (card.tipo && CARD_TIPO_LABELS[card.tipo])) && (
          <div className="v3-board-card__meta">
            <PriorityBars prioridade={card.prioridade} />
            {card.tipo && CARD_TIPO_LABELS[card.tipo] && (
              <Chip tone="badge" kind={BADGE_KIND[card.tipo]}>{CARD_TIPO_LABELS[card.tipo]}</Chip>
            )}
          </div>
        )}
        <p className="v3-board-card__title v3-type-body">{card.titulo}</p>
        {description && <p className="v3-board-card__description v3-type-body-sm">{description}</p>}
      </div>
    )
  } else if (column) {
    content = (
      <div className="v3-board-overlay v3-board-overlay--column">
        <span className="v3-board-column__name v3-type-title-sm">{column.label}</span>
        <span className="v3-board-column__count v3-type-mono-sm">({count})</span>
        {column.is_done && <Chip tone="state" accent="navi">✓ Concluída</Chip>}
      </div>
    )
  }

  return createPortal(
    <DragOverlay dropAnimation={prefersLessMotion() ? null : undefined}>{content}</DragOverlay>,
    document.body,
  )
}
