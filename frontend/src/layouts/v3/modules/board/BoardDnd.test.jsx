// The drag wiring of the board. A real drag cannot be driven in jsdom (the sensors need pointer
// capture and real rectangles), so DndContext is replaced by a passthrough that records what it was
// given, and the tests hand the recorded callbacks synthetic events, exactly like the V2 board test.
// What is proved here is what the board DECIDES with them: which request a drop becomes, what is
// drawn while a card is held, what happens when the server refuses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MouseSensor, TouchSensor } from '@dnd-kit/core'
import { api } from '../../../../services/api.js'
import { BOARD_VIEW_STORAGE_KEY } from '../../../../utils/boardView.js'
import { buildBoardCollisionDetection } from '../../../../utils/boardDnd.js'

const dnd = {}
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal()),
  DndContext: ({ children, ...props }) => {
    Object.assign(dnd, props)
    return children
  },
  DragOverlay: ({ children }) => children ?? null,
}))

const { default: BoardTab } = await import('./BoardTab.jsx')
const { card, COLUMNS, registry } = await import('./boardFixtures.js')

const PLACE = 'Pessoal/tn-sandbox'
const CARDS = [
  card(1, PLACE, { board_position: 1 }),
  card(2, PLACE, { board_position: 2 }),
  card(3, PLACE, { board_position: 3 }),
  card(4, PLACE, { board_position: 4, status: 'em_andamento' }),
  card(5, PLACE, { board_position: 5, status: 'feito' }),
]
const index = registry()

const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const titlesIn = (name) => within(column(name)).queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
const dropLines = () => document.querySelectorAll('.v3-board-dropline')

const start = (id) => act(async () => { dnd.onDragStart({ active: { id } }) })
const over = (id, overId) => act(async () => { dnd.onDragOver({ active: { id }, over: overId == null ? null : { id: overId } }) })
const end = (id, overId) => act(async () => { await dnd.onDragEnd({ active: { id }, over: overId == null ? null : { id: overId } }) })
const cancel = (id) => act(async () => { dnd.onDragCancel({ active: { id } }) })

async function setup({ cards = CARDS, columns = COLUMNS } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  const view = render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
  await screen.findByRole('region', { name: 'Board' })
  await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(3))
  return view
}

beforeEach(() => {
  localStorage.clear()
  Object.keys(dnd).forEach((key) => delete dnd[key])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  delete navigator.vibrate
})

describe('what the board hands to the drag context', () => {
  it('arms with the mouse (distance) and the touch (still hold), never the pointer', async () => {
    await setup()
    expect(dnd.sensors.map((entry) => entry.sensor)).toEqual([MouseSensor, TouchSensor])
    expect(dnd.sensors[0].options.activationConstraint).toEqual({ distance: 6 })
    expect(dnd.sensors[1].options.activationConstraint).toEqual({ delay: 500, tolerance: 8 })
  })

  it('collides by kind with the board rules', async () => {
    await setup()
    expect(dnd.collisionDetection).toBe(buildBoardCollisionDetection)
  })

  it('speaks pt-BR with the real titles, columns and positions', async () => {
    await setup()
    const { announcements, screenReaderInstructions } = dnd.accessibility
    expect(announcements.onDragStart({ active: { id: 'card:2' } })).toBe('Você pegou o card Card 2. Posição 2 de 3 na coluna A fazer.')
    expect(announcements.onDragOver({ active: { id: 'card:2' }, over: { id: 'card:4' } })).toBe('O card Card 2 está sobre a posição 1 da coluna Em andamento.')
    expect(announcements.onDragOver({ active: { id: 'card:2' }, over: { id: 'dropzone:feito' } })).toBe('O card Card 2 está sobre a posição 2 da coluna Feito.')
    expect(announcements.onDragOver({ active: { id: 'card:3' }, over: { id: 'dropzone:a_fazer' } })).toBe('O card Card 3 está sobre a posição 3 da coluna A fazer.')
    expect(announcements.onDragEnd({ active: { id: 'card:2' }, over: { id: 'card:4' } })).toBe('O card Card 2 foi solto na posição 1 da coluna Em andamento.')
    expect(announcements.onDragCancel({ active: { id: 'card:2' } })).toBe('Movimento do card Card 2 cancelado.')
    expect(announcements.onDragStart({ active: { id: 'em_andamento' } })).toBe('Você pegou a coluna Em andamento. Posição 2 de 3.')
    expect(announcements.onDragEnd({ active: { id: 'em_andamento' }, over: { id: 'feito' } })).toBe('A coluna Em andamento foi solta na posição 3.')
    expect(screenReaderInstructions.draggable).toContain('arraste o cabeçalho da coluna')
  })
})

describe('holding a card', () => {
  it('lifts the card (the haptic tick), copies it into the overlay and suspends the poll', async () => {
    navigator.vibrate = vi.fn()
    await setup()
    await start('card:2')
    expect(navigator.vibrate).toHaveBeenCalledWith(10)
    expect(document.body.querySelector('.v3-board-overlay').textContent).toContain('Card 2')
  })

  it('drops the overlay when the drag ends or is cancelled', async () => {
    await setup()
    await start('card:2')
    await cancel('card:2')
    expect(document.body.querySelector('.v3-board-overlay')).toBeNull()
    await start('card:2')
    await end('card:2', null)
    expect(document.body.querySelector('.v3-board-overlay')).toBeNull()
  })

  it('a poll that answers while the card is held does not move cards under the finger', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(titlesIn('A fazer')).toHaveLength(3)

    await start('card:2')
    fetchCards.mockResolvedValue([...CARDS, card(6, PLACE, { board_position: 6 })])
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(titlesIn('A fazer')).toHaveLength(3)

    await cancel('card:2')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(titlesIn('A fazer')).toHaveLength(4)
  })
})

describe('a poll that was out before the drop', () => {
  it('answering after the move with the old order does not undo it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
    vi.spyOn(api, 'moveCard').mockResolvedValue({ ...CARDS[0], board_position: 9 })
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    await start('card:1')
    let late
    fetchCards.mockReturnValue(new Promise((done) => { late = done }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await end('card:1', 'card:3')
    expect(titlesIn('A fazer')).toEqual(['Card 2', 'Card 3', 'Card 1'])

    await act(async () => { late(CARDS) })
    expect(titlesIn('A fazer')).toEqual(['Card 2', 'Card 3', 'Card 1'])
  })
})

describe('the line that shows where the card will land', () => {
  it('is drawn above the card it would go before, and only there', async () => {
    await setup()
    await start('card:1')
    await over('card:1', 'card:3')
    // dropped on a card below it the card lands after it: the end of the column
    expect(dropLines()).toHaveLength(1)
    const list = column('A fazer').querySelector('ul')
    expect(list.lastElementChild.classList.contains('v3-board-dropline')).toBe(true)

    await over('card:3', 'card:1')
    const upwards = column('A fazer').querySelector('ul')
    expect(upwards.firstElementChild.classList.contains('v3-board-dropline')).toBe(true)
  })

  it('is drawn above the card of another column it is held over, and at the end over an empty area', async () => {
    await setup()
    await start('card:1')
    await over('card:1', 'card:4')
    expect(column('Em andamento').querySelector('ul').firstElementChild.classList.contains('v3-board-dropline')).toBe(true)
    await over('card:1', 'dropzone:feito')
    expect(dropLines()).toHaveLength(1)
    expect(column('Feito').querySelector('ul').lastElementChild.classList.contains('v3-board-dropline')).toBe(true)
  })

  it('is not drawn when the drop would change nothing (the card held over its own place)', async () => {
    await setup()
    await start('card:2')
    await over('card:2', 'card:2')
    expect(dropLines()).toHaveLength(0)
  })

  it('goes away over nothing and when the drag ends', async () => {
    await setup()
    await start('card:1')
    await over('card:1', 'card:4')
    await over('card:1', null)
    expect(dropLines()).toHaveLength(0)
    await over('card:1', 'card:4')
    await end('card:1', null)
    expect(dropLines()).toHaveLength(0)
  })

  it('marks the column under the card, and nothing once the drag is over', async () => {
    await setup()
    await start('card:1')
    await over('card:1', 'card:4')
    expect(column('Em andamento').className).toContain('v3-board-column--target')
    expect(column('Feito').className).not.toContain('v3-board-column--target')
    await cancel('card:1')
    expect(column('Em andamento').className).not.toContain('v3-board-column--target')
  })

  it('with a sort on, draws no line but still marks the column that would receive the card', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ sort: 'titulo' }))
    await setup()
    await start('card:1')
    await over('card:1', 'card:4')
    expect(dropLines()).toHaveLength(0)
    expect(column('Em andamento').className).toContain('v3-board-column--target')
  })
})

describe('dropping a card', () => {
  it('between two cards of its column: neighbours by id, the card shown at once', async () => {
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({ ...CARDS[0], board_position: 9 })
    await setup()
    await start('card:1')
    await end('card:1', 'card:3')
    expect(move).toHaveBeenCalledWith(1, { status: 'a_fazer', after_id: 3, before_id: null })
    expect(titlesIn('A fazer')).toEqual(['Card 2', 'Card 3', 'Card 1'])
  })

  it('on a card of another column: before it, in that column', async () => {
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({ ...CARDS[0], status: 'em_andamento' })
    await setup()
    await start('card:1')
    await end('card:1', 'card:4')
    expect(move).toHaveBeenCalledWith(1, { status: 'em_andamento', after_id: null, before_id: 4 })
    expect(titlesIn('Em andamento')).toEqual(['Card 1', 'Card 4'])
    expect(titlesIn('A fazer')).toEqual(['Card 2', 'Card 3'])
  })

  it('on the empty area of a column: at its end', async () => {
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({ ...CARDS[0], status: 'feito' })
    await setup()
    await start('card:1')
    await end('card:1', 'dropzone:feito')
    expect(move).toHaveBeenCalledWith(1, { status: 'feito', after_id: 5, before_id: null })
  })

  it('the neighbours are the ones on screen, not the ones the filters hide', async () => {
    const hidden = [...CARDS.slice(0, 2), card(3, PLACE, { board_position: 3, tipo: 'bug' }), ...CARDS.slice(3)]
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ tipo: 'bug' }))
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({})
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
    vi.spyOn(api, 'fetchCards').mockResolvedValue(hidden)
    render(<BoardTab registry={index} workspaceKey="" showArchived={false} />)
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 3']))
    await start('card:3')
    await end('card:3', 'dropzone:feito')
    expect(move).toHaveBeenCalledWith(3, { status: 'feito', after_id: null, before_id: null })
  })

  it.each([
    ['onto itself', 'card:2', 'card:2'],
    ['on the empty area of the column it is already last in', 'card:3', 'dropzone:a_fazer'],
    ['outside every target', 'card:2', null],
    ['on a column that vanished mid-drag', 'card:2', 'dropzone:gone'],
    ['on a card that vanished mid-drag', 'card:2', 'card:99'],
  ])('%s asks for nothing', async (_label, active, target) => {
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({})
    const update = vi.spyOn(api, 'updateCard').mockResolvedValue({})
    await setup()
    await start(active)
    await end(active, target)
    expect(move).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3'])
  })

  it('with a sort on, another column only changes the status, the way the select does', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ sort: 'titulo' }))
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({})
    const update = vi.spyOn(api, 'updateCard').mockResolvedValue({ ...CARDS[0], status: 'em_andamento' })
    await setup()
    await start('card:1')
    await end('card:1', 'card:4')
    expect(update).toHaveBeenCalledWith(1, { status: 'em_andamento' })
    expect(move).not.toHaveBeenCalled()
  })

  it('with a sort on, a drop in its own column changes nothing', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ sort: 'titulo' }))
    const move = vi.spyOn(api, 'moveCard').mockResolvedValue({})
    const update = vi.spyOn(api, 'updateCard').mockResolvedValue({})
    await setup()
    await start('card:1')
    await end('card:1', 'card:3')
    expect(move).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('ends the hold before the request goes out, so the poll is free again', async () => {
    let finish
    vi.spyOn(api, 'moveCard').mockReturnValue(new Promise((done) => { finish = done }))
    await setup()
    await start('card:1')
    // the handler is not awaited: the request is still out when the hold must already be over
    act(() => { dnd.onDragEnd({ active: { id: 'card:1' }, over: { id: 'card:3' } }) })
    expect(document.body.querySelector('.v3-board-overlay')).toBeNull()
    expect(dropLines()).toHaveLength(0)
    await act(async () => { finish({ ...CARDS[0] }) })
  })

  it('a refusal puts the card back and says so, in an alert that does not take the focus', async () => {
    vi.spyOn(api, 'moveCard').mockRejectedValue(new Error('Falha ao mover card'))
    await setup()
    await start('card:1')
    await end('card:1', 'card:3')
    expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3'])
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Não consegui mover o card. Ele voltou para onde estava.')
    expect(banner.contains(document.activeElement)).toBe(false)
  })

  it('a conflict reads the columns again and says the board changed', async () => {
    vi.spyOn(api, 'moveCard').mockRejectedValue(Object.assign(new Error('Conflito'), { conflict: true }))
    await setup()
    await start('card:1')
    await end('card:1', 'card:4')
    expect(screen.getByRole('alert').textContent).toContain('O board mudou. Atualizei as colunas e o card voltou para onde estava.')
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(2)
    expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2', 'Card 3'])
  })

  it('the banner closes by itself when the next move works, and by its button', async () => {
    const move = vi.spyOn(api, 'moveCard').mockRejectedValueOnce(new Error('x')).mockResolvedValue({})
    await setup()
    await start('card:1')
    await end('card:1', 'card:3')
    expect(screen.getByRole('alert')).toBeTruthy()
    await start('card:1')
    await end('card:1', 'card:3')
    expect(move).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()

    move.mockRejectedValueOnce(new Error('x'))
    await start('card:2')
    await end('card:2', 'card:3')
    await act(async () => { screen.getByRole('button', { name: 'Fechar' }).click() })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('dragging a column', () => {
  const REORDERED = [COLUMNS[1], COLUMNS[2], COLUMNS[0]].map((entry, position) => ({ ...entry, position: position + 1 }))

  it('copies only the header of the column into the overlay', async () => {
    await setup()
    await start('em_andamento')
    const overlay = document.body.querySelector('.v3-board-overlay--column')
    expect(overlay.textContent).toContain('Em andamento')
    expect(overlay.textContent).toContain('(1)')
    await cancel('em_andamento')
    expect(document.body.querySelector('.v3-board-overlay')).toBeNull()
  })

  it('dropped on another column sends the whole new order and flashes the moved one', async () => {
    const reorder = vi.spyOn(api, 'reorderBoardColumns').mockResolvedValue(REORDERED)
    await setup()
    await start('a_fazer')
    await end('a_fazer', 'feito')
    expect(reorder).toHaveBeenCalledWith(['em_andamento', 'feito', 'a_fazer'])
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')).filter((label) => label.startsWith('Coluna ')))
      .toEqual(['Coluna Em andamento', 'Coluna Feito', 'Coluna A fazer'])
    await waitFor(() => expect(column('A fazer').className).toContain('v3-board-column--flash'))
  })

  it.each([
    ['onto itself', 'a_fazer', 'a_fazer'],
    ['outside every column', 'a_fazer', null],
  ])('%s asks for nothing', async (_label, active, target) => {
    const reorder = vi.spyOn(api, 'reorderBoardColumns').mockResolvedValue(COLUMNS)
    await setup()
    await start(active)
    await end(active, target)
    expect(reorder).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failure puts the order back, reads the columns again and says so', async () => {
    vi.spyOn(api, 'reorderBoardColumns').mockRejectedValue(new Error('Falha ao reordenar colunas'))
    await setup()
    await start('a_fazer')
    await end('a_fazer', 'feito')
    expect(screen.getByRole('alert').textContent).toContain('Não consegui mover a coluna. Ela voltou para onde estava.')
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')).filter((label) => label.startsWith('Coluna ')))
      .toEqual(['Coluna A fazer', 'Coluna Em andamento', 'Coluna Feito'])
  })
})
