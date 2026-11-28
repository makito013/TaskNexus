import { useId, useState } from 'react'

// A press on a control of a card must not reach the sensors of the drag that wraps the card.
const stopPress = (event) => event.stopPropagation()

// The "Mover" select in the foot of a card: the way to move a card to another column by keyboard
// (and the only one without a drag). The card lands at the end of the column picked.
//   card         { id, titulo, status }
//   columns      [{ slug, label, is_done }] in board order
//   onChange     (cardId, slug) => Promise<boolean>; false = the move was refused
// While the request is out the choice stays on screen (busy); when it settles the select goes
// back to following the card, so a refused move shows the column the card is really in.
export default function MoveSelect({ card, columns, onChange }) {
  const [pending, setPending] = useState(null)
  const hintId = useId()

  const handleChange = async (event) => {
    const slug = event.target.value
    if (slug === card.status) return
    setPending(slug)
    try {
      await onChange(card.id, slug)
    } finally {
      setPending(null)
    }
  }

  return (
    <span className="v3-board-card__move" data-card-control onMouseDown={stopPress} onTouchStart={stopPress}>
      <select
        className="v3-board-select v3-board-select--compact"
        value={pending ?? card.status}
        aria-label={`Mover "${card.titulo}"`}
        aria-describedby={hintId}
        aria-busy={pending ? 'true' : undefined}
        onChange={handleChange}
      >
        {columns.map((column) => (
          <option key={column.slug} value={column.slug}>
            {column.is_done ? `${column.label} (concluída)` : column.label}
          </option>
        ))}
      </select>
      <span id={hintId} className="v3-projects__sr-only">Mover para outra coluna</span>
    </span>
  )
}
