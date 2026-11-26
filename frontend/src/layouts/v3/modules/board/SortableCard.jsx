import { useSortable } from '@dnd-kit/sortable'
import { cardDndId } from '../../../../utils/boardDndIds.js'
import './BoardLeaf.css'

// Written by hand: @dnd-kit/utilities is a transitive dependency, not a declared one. The scale
// part of its helper cannot apply here (a card is never scaled while it moves).
function toTranslate(transform) {
  if (!transform) return undefined
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`
}

// The list item of one card of a column: sortable among the cards of its column and the
// activator of the drag (the whole face, minus the controls that stop their own press).
//
// A LEAF with respect to `position: fixed`: the translation of the sort lives only here, so
// nothing fixed may be rendered inside a card (fixedPositioningInvariantWorkspace.test.js).
//
// Only the listeners of dnd-kit are used. Its attributes (role="button", a tab stop, a
// description in English about a space-bar drag this board does not offer) would misreport the
// card, which contains controls of its own.
export default function SortableCard({ cardId, children }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardDndId(cardId) })
  return (
    <li
      ref={setNodeRef}
      className={`v3-board-sortable v3-board-sortable--card${isDragging ? ' v3-board-sortable--dragging' : ''}`}
      style={{ transform: toTranslate(transform), transition }}
      {...listeners}
    >
      {children}
    </li>
  )
}
