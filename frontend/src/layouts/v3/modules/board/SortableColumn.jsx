import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { columnDropzoneId } from '../../../../utils/boardDndIds.js'
import './BoardLeaf.css'

function toTranslate(transform) {
  if (!transform) return undefined
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`
}

// One column of the board, sortable among the others and a drop target for cards. A LEAF with
// respect to `position: fixed`: the translation of the sort lives only here (menus inside are
// `absolute`, dialogs and the overlay are siblings of the drag context).
//
// `children` is a function: the drag is armed by listeners born HERE, but they belong on the
// column header, whose markup lives in BoardColumn.
//   handleProps  ref + listeners for the header (the whole header is the grip)
//   dropzoneRef  the body of the column, the target of a card dropped on its empty area
//   cardOver     a card is over that target
//   isDragging   this column is the one being dragged
export default function SortableColumn({ slug, children }) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slug })
  const { setNodeRef: setDropzoneRef, isOver } = useDroppable({ id: columnDropzoneId(slug) })
  return (
    <div
      ref={setNodeRef}
      className={`v3-board-sortable v3-board-sortable--column${isDragging ? ' v3-board-sortable--dragging' : ''}`}
      style={{ transform: toTranslate(transform), transition }}
    >
      {children({
        handleProps: { ref: setActivatorNodeRef, ...listeners },
        dropzoneRef: setDropzoneRef,
        cardOver: isOver,
        isDragging,
      })}
    </div>
  )
}
