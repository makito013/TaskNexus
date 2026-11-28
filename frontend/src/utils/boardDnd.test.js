import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MouseSensor, PointerSensor, TouchSensor } from '@dnd-kit/core'

const pointerWithin = vi.fn()
const closestCenter = vi.fn()

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    pointerWithin: (...args) => pointerWithin(...args),
    closestCenter: (...args) => closestCenter(...args),
  }
})

const {
  BOARD_DRAG_LONG_PRESS_MS,
  BOARD_DRAG_TOLERANCE_PX,
  BOARD_MOUSE_DISTANCE_PX,
  CLICK_AFTER_DROP_MS,
  buildAnnouncements,
  buildBoardCollisionDetection,
  isClickAfterDrop,
  resolveCardDropTarget,
  useBoardSensors,
} = await import('./boardDnd.js')

const CONTAINERS = [
  { id: 'a_fazer' },
  { id: 'feito' },
  { id: 'card:1' },
  { id: 'card:2' },
  { id: 'dropzone:a_fazer' },
  { id: 'dropzone:feito' },
]

const idsOf = (call) => call.droppableContainers.map((container) => container.id)

beforeEach(() => {
  pointerWithin.mockReset()
  closestCenter.mockReset()
})

describe('drag constants', () => {
  it('keeps the numbers the V2 board was tuned with on a real tablet', () => {
    expect(BOARD_DRAG_LONG_PRESS_MS).toBe(500)
    expect(BOARD_DRAG_TOLERANCE_PX).toBe(8)
    expect(BOARD_MOUSE_DISTANCE_PX).toBe(6)
    expect(CLICK_AFTER_DROP_MS).toBe(300)
  })
})

describe('useBoardSensors', () => {
  it('is a mouse sensor armed by distance and a touch sensor armed by a still hold, nothing else', () => {
    const { result } = renderHook(() => useBoardSensors())
    expect(result.current).toHaveLength(2)
    const [mouse, touch] = result.current
    expect(mouse.sensor).toBe(MouseSensor)
    expect(mouse.options).toEqual({ activationConstraint: { distance: 6 } })
    expect(touch.sensor).toBe(TouchSensor)
    expect(touch.options).toEqual({ activationConstraint: { delay: 500, tolerance: 8 } })
  })

  it('never offers the pointer sensor (it would swallow every touch and drag on a swipe)', () => {
    const { result } = renderHook(() => useBoardSensors())
    expect(result.current.map((entry) => entry.sensor)).not.toContain(PointerSensor)
  })

  it('keeps the same descriptors across renders', () => {
    const { result, rerender } = renderHook(() => useBoardSensors())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('buildBoardCollisionDetection', () => {
  it('a card drag only sees cards and column dropzones, and a pointer over nothing stays nothing', () => {
    pointerWithin.mockReturnValue([])
    const result = buildBoardCollisionDetection({ active: { id: 'card:1' }, droppableContainers: CONTAINERS })
    expect(result).toEqual([])
    expect(idsOf(pointerWithin.mock.calls[0][0])).toEqual(['card:1', 'card:2', 'dropzone:a_fazer', 'dropzone:feito'])
    expect(closestCenter).not.toHaveBeenCalled()
  })

  it('a card under the pointer wins over the dropzone that covers it', () => {
    const onCard = { id: 'card:2' }
    pointerWithin.mockReturnValue([{ id: 'dropzone:a_fazer' }, onCard])
    expect(buildBoardCollisionDetection({ active: { id: 'card:1' }, droppableContainers: CONTAINERS })).toEqual([onCard])
  })

  it('with only the dropzone under the pointer the drop is "past the last card"', () => {
    const zone = [{ id: 'dropzone:feito' }]
    pointerWithin.mockReturnValue(zone)
    expect(buildBoardCollisionDetection({ active: { id: 'card:1' }, droppableContainers: CONTAINERS })).toEqual(zone)
  })

  it('a column drag only sees columns and ranks them by distance', () => {
    const nearest = [{ id: 'feito' }]
    closestCenter.mockReturnValue(nearest)
    expect(buildBoardCollisionDetection({ active: { id: 'a_fazer' }, droppableContainers: CONTAINERS })).toBe(nearest)
    expect(idsOf(closestCenter.mock.calls[0][0])).toEqual(['a_fazer', 'feito'])
    expect(pointerWithin).not.toHaveBeenCalled()
  })
})

describe('resolveCardDropTarget', () => {
  const columns = [{ slug: 'a_fazer' }, { slug: 'feito' }]
  const cards = [{ id: 1, status: 'a_fazer' }, { id: 2, status: 'feito' }]

  it('a drop on a card means that card, in its column', () => {
    expect(resolveCardDropTarget('card:2', { columns, cards })).toEqual({ status: 'feito', overCardId: 2 })
  })

  it('a drop on the empty area of a column means the end of that column', () => {
    expect(resolveCardDropTarget('dropzone:feito', { columns, cards })).toEqual({ status: 'feito', overCardId: null })
  })

  it.each([
    ['released outside every target', null],
    ['a column that vanished mid-drag', 'dropzone:gone'],
    ['a card that vanished mid-drag', 'card:99'],
    ['a bare column id (a card drag never collides with one)', 'feito'],
  ])('cancels for %s', (_label, overId) => {
    expect(resolveCardDropTarget(overId, { columns, cards })).toBeNull()
  })
})

describe('isClickAfterDrop', () => {
  it('ignores a click up to 300 ms after a drop and no later', () => {
    expect(isClickAfterDrop(1000, 1299)).toBe(true)
    expect(isClickAfterDrop(1000, 1300)).toBe(false)
  })

  it('never ignores a click when nothing was dropped', () => {
    expect(isClickAfterDrop(0, 50)).toBe(false)
  })
})

describe('buildAnnouncements (pt-BR, the texts of the design)', () => {
  const positions = {
    'card:1': { position: 1, total: 3, slug: 'a_fazer' },
    'card:2': { position: 2, total: 3, slug: 'a_fazer' },
    'dropzone:feito': { position: 1, total: 1, slug: 'feito' },
    a_fazer: { position: 1, total: 3, slug: 'a_fazer' },
    feito: { position: 3, total: 3, slug: 'feito' },
  }
  const speak = buildAnnouncements({
    cardTitle: (id) => `Título ${id}`,
    columnLabel: (slug) => ({ a_fazer: 'A fazer', feito: 'Feito' })[slug],
    positionOf: (id) => positions[id] ?? null,
  })

  it('says what was picked up, where it is hovering, where it landed and when it was cancelled', () => {
    expect(speak.onDragStart({ active: { id: 'card:1' } })).toBe('Você pegou o card Título 1. Posição 1 de 3 na coluna A fazer.')
    expect(speak.onDragOver({ active: { id: 'card:1' }, over: { id: 'card:2' } })).toBe('O card Título 1 está sobre a posição 2 da coluna A fazer.')
    expect(speak.onDragEnd({ active: { id: 'card:1' }, over: { id: 'dropzone:feito' } })).toBe('O card Título 1 foi solto na posição 1 da coluna Feito.')
    expect(speak.onDragCancel({ active: { id: 'card:1' } })).toBe('Movimento do card Título 1 cancelado.')
  })

  it('asks for the place of what it is over knowing which item is held', () => {
    const positionOf = vi.fn(() => ({ position: 1, total: 1, slug: 'a_fazer' }))
    const spy = buildAnnouncements({ cardTitle: () => 't', columnLabel: () => 'c', positionOf })
    spy.onDragOver({ active: { id: 'card:1' }, over: { id: 'dropzone:a_fazer' } })
    spy.onDragEnd({ active: { id: 'card:1' }, over: { id: 'dropzone:a_fazer' } })
    expect(positionOf).toHaveBeenNthCalledWith(1, 'dropzone:a_fazer', 'card:1')
    expect(positionOf).toHaveBeenNthCalledWith(2, 'dropzone:a_fazer', 'card:1')
  })

  it('says when the card is over nothing and when it was released outside', () => {
    expect(speak.onDragOver({ active: { id: 'card:1' }, over: null })).toBe('O card Título 1 está fora de qualquer posição válida.')
    expect(speak.onDragEnd({ active: { id: 'card:1' }, over: null })).toBe('O card Título 1 foi solto fora do board. Nada mudou.')
  })

  it('speaks about columns the same way', () => {
    expect(speak.onDragStart({ active: { id: 'a_fazer' } })).toBe('Você pegou a coluna A fazer. Posição 1 de 3.')
    expect(speak.onDragOver({ active: { id: 'a_fazer' }, over: { id: 'feito' } })).toBe('A coluna A fazer está sobre a posição 3.')
    expect(speak.onDragEnd({ active: { id: 'a_fazer' }, over: { id: 'feito' } })).toBe('A coluna A fazer foi solta na posição 3.')
    expect(speak.onDragEnd({ active: { id: 'a_fazer' }, over: null })).toBe('A coluna A fazer foi solta fora do board. Nada mudou.')
    expect(speak.onDragCancel({ active: { id: 'a_fazer' } })).toBe('Movimento da coluna A fazer cancelado.')
  })

  it('still speaks when the position of something is unknown (it vanished mid-drag)', () => {
    expect(speak.onDragStart({ active: { id: 'card:77' } })).toBe('Você pegou o card Título 77.')
    expect(speak.onDragOver({ active: { id: 'card:1' }, over: { id: 'card:77' } })).toBe('O card Título 1 está sobre outra posição.')
  })

  it('never speaks English', () => {
    const all = [
      speak.onDragStart({ active: { id: 'card:1' } }),
      speak.onDragOver({ active: { id: 'card:1' }, over: { id: 'card:2' } }),
      speak.onDragEnd({ active: { id: 'card:1' }, over: null }),
      speak.onDragCancel({ active: { id: 'card:1' } }),
    ].join(' ')
    expect(all).not.toMatch(/\b(Picked|Draggable|dropped|moved|over)\b/i)
  })
})
