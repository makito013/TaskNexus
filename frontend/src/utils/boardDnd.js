// Drag-and-drop rules of the V3 board: sensors, collision, drop target and the pt-BR
// announcements. The V2 board (layouts/v2/BoardV2.jsx) keeps its own copy of the first
// two because extracting them would touch the V2; boardDnd.parity.test.js pins this file
// to it (decisions and constants), so a change on one side without the other goes red.
//
// Only @dnd-kit/core and the id helpers are imported here: the gesture itself cannot be
// driven in jsdom, so everything that DECIDES something lives in functions the tests can call.
import {
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { isCardDndId, isColumnDropzoneId, slugFromColumnDropzoneId, cardIdFromDndId } from './boardDndIds.js'

// How long a finger must rest, and how far it may wander meanwhile, before a touch becomes
// a drag. A swipe that clears the tolerance cancels the pickup and scrolls the board.
export const BOARD_DRAG_LONG_PRESS_MS = 500
export const BOARD_DRAG_TOLERANCE_PX = 8
// Travel of the mouse before a press becomes a drag: a plain click on a control inside the
// drag surface (the column menu, the "Mover" select) never reaches it.
export const BOARD_MOUSE_DISTANCE_PX = 6
// A click that lands this soon after a drop belongs to the drag, not to the card.
export const CLICK_AFTER_DROP_MS = 300

export const BOARD_SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Para reordenar, arraste o cabeçalho da coluna. Para reposicionar um card, arraste o card. '
    + 'Sem arrastar, use o seletor "Mover" no pé do card.',
}

// MouseSensor and TouchSensor, never PointerSensor: the pointer sensor accepts a finger as
// well, wins the gesture before the touch sensor is born and arms on 6 px of travel, so a
// swipe to scroll dragged the card along (the bug the V2 documents at boardDragSensors).
const MOUSE_OPTIONS = { activationConstraint: { distance: BOARD_MOUSE_DISTANCE_PX } }
const TOUCH_OPTIONS = {
  activationConstraint: { delay: BOARD_DRAG_LONG_PRESS_MS, tolerance: BOARD_DRAG_TOLERANCE_PX },
}

export function useBoardSensors() {
  return useSensors(useSensor(MouseSensor, MOUSE_OPTIONS), useSensor(TouchSensor, TOUCH_OPTIONS))
}

// One context holds both drags, so collisions are filtered by KIND: a card sees cards and
// column dropzones, a column sees columns. For a card the pointer decides (a card under it
// beats the dropzone that covers the whole body) and there is NO distance fallback: a pointer
// over nothing means "never mind", not "the nearest card anywhere".
export function buildBoardCollisionDetection(args) {
  const draggingCard = isCardDndId(args.active?.id)
  const candidates = args.droppableContainers.filter((container) => {
    const isCardTarget = isCardDndId(container.id) || isColumnDropzoneId(container.id)
    return draggingCard ? isCardTarget : !isCardTarget
  })
  const filtered = { ...args, droppableContainers: candidates }

  if (!draggingCard) return closestCenter(filtered)

  const under = pointerWithin(filtered)
  if (!under.length) return []
  const onACard = under.find((collision) => isCardDndId(collision.id))
  return onACard ? [onACard] : under
}

// Resolves the `over` of a card drag to { status, overCardId } (overCardId null = the empty
// area of the column). null when the card was released somewhere that is not a destination
// (outside the board, over a column or a card that has since disappeared): the caller cancels
// without a request.
export function resolveCardDropTarget(overId, { columns, cards }) {
  if (overId == null) return null
  if (isColumnDropzoneId(overId)) {
    const status = slugFromColumnDropzoneId(overId)
    return columns.some((column) => column.slug === status) ? { status, overCardId: null } : null
  }
  if (isCardDndId(overId)) {
    const overCardId = cardIdFromDndId(overId)
    const overCard = cards.find((card) => card.id === overCardId)
    return overCard ? { status: overCard.status, overCardId } : null
  }
  // A bare column id says nothing about WHERE in the column the card should land.
  return null
}

export function isClickAfterDrop(lastDropAt, now = Date.now()) {
  return lastDropAt > 0 && now - lastDropAt < CLICK_AFTER_DROP_MS
}

// dnd-kit speaks English and announces during pointer drags too, so the board gives it
// pt-BR texts (design 2.7).
//   cardTitle(cardId)   the title of a card
//   columnLabel(slug)   the name of a column
//   positionOf(dndId, activeDndId)
//                       { position, total, slug } of a card (slug = its column), of a column
//                       dropzone (the slot after its last card) or of a column; null if gone.
//                       The active id lets a drop on the dropzone of the card's own column
//                       count the slot it leaves
export function buildAnnouncements({ cardTitle, columnLabel, positionOf }) {
  const isCard = (id) => isCardDndId(id)
  const titleOf = (id) => cardTitle(cardIdFromDndId(id))
  const placeOf = (id, activeId) => positionOf(id, activeId)

  return {
    onDragStart: ({ active }) => {
      const place = placeOf(active.id)
      if (isCard(active.id)) {
        const head = `Você pegou o card ${titleOf(active.id)}.`
        return place ? `${head} Posição ${place.position} de ${place.total} na coluna ${columnLabel(place.slug)}.` : head
      }
      const head = `Você pegou a coluna ${columnLabel(active.id)}.`
      return place ? `${head} Posição ${place.position} de ${place.total}.` : head
    },
    onDragOver: ({ active, over }) => {
      const subject = isCard(active.id) ? `O card ${titleOf(active.id)}` : `A coluna ${columnLabel(active.id)}`
      if (!over) return `${subject} está fora de qualquer posição válida.`
      const place = placeOf(over.id, active.id)
      if (!place) return `${subject} está sobre outra posição.`
      return isCard(active.id)
        ? `${subject} está sobre a posição ${place.position} da coluna ${columnLabel(place.slug)}.`
        : `${subject} está sobre a posição ${place.position}.`
    },
    onDragEnd: ({ active, over }) => {
      const card = isCard(active.id)
      const subject = card ? `O card ${titleOf(active.id)}` : `A coluna ${columnLabel(active.id)}`
      const dropped = card ? 'foi solto' : 'foi solta'
      if (!over) return `${subject} ${dropped} fora do board. Nada mudou.`
      const place = placeOf(over.id, active.id)
      if (!place) return `${subject} ${dropped}.`
      return card
        ? `${subject} ${dropped} na posição ${place.position} da coluna ${columnLabel(place.slug)}.`
        : `${subject} ${dropped} na posição ${place.position}.`
    },
    onDragCancel: ({ active }) => (isCard(active.id)
      ? `Movimento do card ${titleOf(active.id)} cancelado.`
      : `Movimento da coluna ${columnLabel(active.id)} cancelado.`),
  }
}
