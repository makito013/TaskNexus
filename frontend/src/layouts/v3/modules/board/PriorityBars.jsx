import { CARD_PRIORIDADE_LABELS } from '../../../../utils/cardMeta.js'

// Bars filled and colour class per level. The count of bars and the text label
// say the level on their own; the colour only reinforces it (never alone).
const LEVELS = {
  muito_baixa: { bars: 1, tone: 'muted' },
  baixa: { bars: 1, tone: 'low' },
  media: { bars: 2, tone: 'mid' },
  alta: { bars: 3, tone: 'high' },
  muito_alta: { bars: 3, tone: 'high', urgent: true },
}

const BAR_X = [2, 6.5, 11]
const BAR_HEIGHT = [5, 8.5, 12]

// Three-bar priority glyph, 16x16. A card with no (or an unknown) priority gets
// nothing: no empty slot.
export default function PriorityBars({ prioridade }) {
  const level = LEVELS[prioridade]
  if (!level) return null
  const label = `Prioridade: ${CARD_PRIORIDADE_LABELS[prioridade]}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`v3-board-priority v3-board-priority--${level.tone}${level.urgent ? ' v3-board-priority--urgent' : ''}`}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        {BAR_X.map((x, index) => (
          <rect
            key={x}
            x={x}
            y={14 - BAR_HEIGHT[index]}
            width="3"
            height={BAR_HEIGHT[index]}
            rx="1"
            className={index < level.bars ? 'v3-board-priority__bar' : 'v3-board-priority__bar v3-board-priority__bar--empty'}
          />
        ))}
      </svg>
      {level.urgent && <span aria-hidden="true" className="v3-board-priority__mark">!</span>}
    </span>
  )
}
