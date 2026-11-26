// Parity of the V3 drag rules (utils/boardDnd.js) with the V2 board (layouts/v2/BoardV2.jsx).
// The V3 keeps its own copy because extracting the V2 rules would edit the V2; this file is what
// keeps the copy honest. It lives outside layouts/v3 on purpose (the V3 never imports the V2) and
// goes away with the V2.
//
//  - the two numbers and the collision builder BoardV2 exports are compared by behaviour;
//  - the sensors and the mouse distance are not exported, so the V2 SOURCE is read (comments out),
//    with a positive control (the pattern matches the real file) and a negative one (a fixture
//    with the pointer sensor goes red).
// Announcements are not compared: the design changes the texts on purpose.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const v2 = await import('../layouts/v2/BoardV2.jsx')
const v3 = await import('./boardDnd.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const V2_SOURCE = readFileSync(path.resolve(HERE, '../layouts/v2/BoardV2.jsx'), 'utf8')

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// What the V2 board arms its drags with, read from its source.
export function readSensorSetup(source) {
  const code = stripComments(source)
  const sensors = [...code.matchAll(/useSensor\(\s*(\w+)/g)].map((match) => match[1])
  const distance = code.match(/const\s+BOARD_DRAG_POINTER_DISTANCE_PX\s*=\s*(\d+)/)
  const mouseUsesIt = /useSensor\(\s*MouseSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*BOARD_DRAG_POINTER_DISTANCE_PX/.test(code)
  const touchUsesHold = /useSensor\(\s*TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*BOARD_DRAG_LONG_PRESS_MS,\s*tolerance:\s*BOARD_DRAG_TOLERANCE_PX/.test(code)
  return { sensors, distance: distance ? Number(distance[1]) : null, mouseUsesIt, touchUsesHold }
}

const CONTAINERS = [
  { id: 'a_fazer' }, { id: 'feito' },
  { id: 'card:1' }, { id: 'card:2' },
  { id: 'dropzone:a_fazer' }, { id: 'dropzone:feito' },
]

beforeEach(() => {
  pointerWithin.mockReset()
  closestCenter.mockReset()
})

describe('V3 drag rules against the V2 board', () => {
  it('uses the same hold, tolerance and mouse distance', () => {
    expect(v3.BOARD_DRAG_LONG_PRESS_MS).toBe(v2.BOARD_DRAG_LONG_PRESS_MS)
    expect(v3.BOARD_DRAG_TOLERANCE_PX).toBe(v2.BOARD_DRAG_TOLERANCE_PX)
    expect(readSensorSetup(V2_SOURCE).distance).toBe(v3.BOARD_MOUSE_DISTANCE_PX)
  })

  it('arms the same sensors the same way (the V2 source says so)', () => {
    const setup = readSensorSetup(V2_SOURCE)
    expect(setup.sensors).toEqual(['MouseSensor', 'TouchSensor'])
    expect(setup.mouseUsesIt).toBe(true)
    expect(setup.touchUsesHold).toBe(true)
  })

  it('the source reader goes red for a board that brought the pointer sensor back', () => {
    const bad = V2_SOURCE.replace('useSensor(MouseSensor,', 'useSensor(PointerSensor,')
    expect(bad).not.toBe(V2_SOURCE)
    expect(readSensorSetup(bad).sensors).toEqual(['PointerSensor', 'TouchSensor'])
    expect(readSensorSetup(bad).mouseUsesIt).toBe(false)
    // a comment that mentions the pointer sensor is not a sensor
    expect(readSensorSetup('// useSensor(PointerSensor, {})\nuseSensor(MouseSensor, {})').sensors).toEqual(['MouseSensor'])
  })

  const cases = [
    ['a card over a card and the dropzone that covers it', 'card:1', [{ id: 'dropzone:a_fazer' }, { id: 'card:2' }]],
    ['a card over the empty area of a column', 'card:1', [{ id: 'dropzone:feito' }]],
    ['a card over nothing', 'card:1', []],
    ['a card over two cards', 'card:2', [{ id: 'card:1' }, { id: 'card:2' }]],
  ]
  it.each(cases)('collides like the V2 for %s', (_label, activeId, under) => {
    pointerWithin.mockReturnValue(under)
    const args = { active: { id: activeId }, droppableContainers: CONTAINERS }
    const fromV2 = v2.buildBoardCollisionDetection(args)
    const v2Candidates = pointerWithin.mock.calls[0][0].droppableContainers.map((container) => container.id)
    pointerWithin.mockClear()
    pointerWithin.mockReturnValue(under)
    const fromV3 = v3.buildBoardCollisionDetection(args)
    const v3Candidates = pointerWithin.mock.calls[0][0].droppableContainers.map((container) => container.id)
    expect(fromV3).toEqual(fromV2)
    expect(v3Candidates).toEqual(v2Candidates)
    expect(closestCenter).not.toHaveBeenCalled()
  })

  it('collides like the V2 for a column drag', () => {
    const nearest = [{ id: 'feito' }]
    closestCenter.mockReturnValue(nearest)
    const args = { active: { id: 'a_fazer' }, droppableContainers: CONTAINERS }
    const fromV2 = v2.buildBoardCollisionDetection(args)
    const v2Candidates = closestCenter.mock.calls[0][0].droppableContainers.map((container) => container.id)
    closestCenter.mockClear()
    closestCenter.mockReturnValue(nearest)
    const fromV3 = v3.buildBoardCollisionDetection(args)
    const v3Candidates = closestCenter.mock.calls[0][0].droppableContainers.map((container) => container.id)
    expect(fromV3).toEqual(fromV2)
    expect(v3Candidates).toEqual(v2Candidates)
    expect(v3Candidates).toEqual(['a_fazer', 'feito'])
    expect(pointerWithin).not.toHaveBeenCalled()
  })
})
