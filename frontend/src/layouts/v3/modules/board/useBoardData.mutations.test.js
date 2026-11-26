import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { buildScope } from './boardScope.js'
import { card, COLUMNS, registry } from './boardFixtures.js'
import { useBoardData } from './useBoardData.js'

const CARDS = [
  card(1, 'Pessoal/tn-sandbox', { board_position: 1 }),
  card(2, 'Pessoal/tn-sandbox', { board_position: 2 }),
  card(3, 'Pessoal/tn-sandbox', { board_position: 3, status: 'feito' }),
]
const scope = buildScope({ registry: registry() })

const moved = (id, extra = {}) => ({ ...card(id, 'Pessoal/tn-sandbox'), ...extra })
const failure = (message, extra = {}) => Object.assign(new Error(message), extra)

async function setup({ cards = CARDS, columns = COLUMNS } = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  const view = renderHook(() => useBoardData({ scope }))
  await waitFor(() => expect(view.result.current.cardsLoaded).toBe(true))
  return view
}

const order = (result, slug) => result.current.cards.filter((entry) => entry.status === slug).map((entry) => entry.id)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBoardData: column mutations', () => {
  it('creates a column and shows it at the end', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'createBoardColumn').mockResolvedValue({ slug: 'novo', label: 'Novo', position: 4, is_done: false })
    let created
    await act(async () => { created = await result.current.createColumn('Novo') })
    expect(api.createBoardColumn).toHaveBeenCalledWith('Novo')
    expect(created.slug).toBe('novo')
    expect(result.current.columns.map((column) => column.slug)).toEqual(['a_fazer', 'em_andamento', 'feito', 'novo'])
  })

  it('lets the message of the server reach the caller when creating is refused', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'createBoardColumn').mockRejectedValue(failure('Já existe uma coluna com esse nome.'))
    await expect(act(() => result.current.createColumn('A fazer'))).rejects.toThrow('Já existe uma coluna com esse nome.')
    expect(result.current.columns).toHaveLength(3)
    expect(result.current.moveNotice).toBeNull()
  })

  it('renames a column and refuses nothing silently', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateBoardColumn').mockResolvedValue({ slug: 'a_fazer', label: 'Backlog', position: 1, is_done: false })
    await act(async () => { await result.current.renameColumn('a_fazer', 'Backlog') })
    expect(api.updateBoardColumn).toHaveBeenCalledWith('a_fazer', 'Backlog')
    expect(result.current.columns[0].label).toBe('Backlog')
    api.updateBoardColumn.mockRejectedValue(failure('Nome vazio.'))
    await expect(act(() => result.current.renameColumn('a_fazer', ''))).rejects.toThrow('Nome vazio.')
    expect(result.current.columns[0].label).toBe('Backlog')
  })

  it('marks another column as done and the board answers with the whole list', async () => {
    const { result } = await setup()
    const next = COLUMNS.map((column) => ({ ...column, is_done: column.slug === 'em_andamento' }))
    vi.spyOn(api, 'setDoneColumn').mockResolvedValue(next)
    await act(async () => { await result.current.setDoneColumn('em_andamento') })
    expect(api.setDoneColumn).toHaveBeenCalledWith('em_andamento')
    expect(result.current.doneSlug).toBe('em_andamento')
    expect(result.current.moveNotice).toBeNull()
  })

  it('says so, without an alert, when marking the done column fails', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'setDoneColumn').mockRejectedValue(failure('boom'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await act(async () => { await result.current.setDoneColumn('em_andamento') })
    expect(result.current.moveNotice).toEqual({ kind: 'done' })
    expect(result.current.doneSlug).toBe('feito')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('deletes a column and hands the refusal reason to the caller untouched', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteBoardColumn').mockResolvedValue({})
    await act(async () => { await result.current.deleteColumn('em_andamento') })
    expect(result.current.columns.map((column) => column.slug)).toEqual(['a_fazer', 'feito'])

    api.deleteBoardColumn.mockRejectedValue(failure('x', { reason: 'coluna_com_cards', cards: 2 }))
    let thrown
    await act(async () => { try { await result.current.deleteColumn('a_fazer') } catch (error) { thrown = error } })
    expect(thrown.reason).toBe('coluna_com_cards')
    expect(result.current.columnDeleteRefusal(thrown)).toBe('coluna_com_cards')
    expect(result.current.columns).toHaveLength(2)
  })
})

describe('useBoardData: reordering the columns', () => {
  it('applies the order the server answers with', async () => {
    const { result } = await setup()
    const next = [COLUMNS[2], COLUMNS[0], COLUMNS[1]].map((column, index) => ({ ...column, position: index + 1 }))
    vi.spyOn(api, 'reorderBoardColumns').mockResolvedValue(next)
    let ok
    await act(async () => { ok = await result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']) })
    expect(ok).toBe(true)
    expect(api.reorderBoardColumns).toHaveBeenCalledWith(['feito', 'a_fazer', 'em_andamento'])
    expect(result.current.columns.map((column) => column.slug)).toEqual(['feito', 'a_fazer', 'em_andamento'])
    expect(result.current.moveNotice).toBeNull()
  })

  it('shows the new order at once, before the server answers', async () => {
    const { result } = await setup()
    let finish
    vi.spyOn(api, 'reorderBoardColumns').mockReturnValue(new Promise((done) => { finish = done }))
    let pending
    act(() => { pending = result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']) })
    expect(result.current.columns.map((column) => column.slug)).toEqual(['feito', 'a_fazer', 'em_andamento'])
    await act(async () => { finish(COLUMNS); await pending })
  })

  it('any failure puts the columns back, reads them again and warns about the column (C5)', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'reorderBoardColumns').mockRejectedValue(failure('Falha ao reordenar colunas'))
    let ok
    await act(async () => { ok = await result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']) })
    expect(ok).toBe(false)
    expect(result.current.columns.map((column) => column.slug)).toEqual(['a_fazer', 'em_andamento', 'feito'])
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(2)
    expect(result.current.moveNotice).toEqual({ kind: 'column' })
  })

  it('a failure with a conflict status is still the column notice: the client has no status for it', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'reorderBoardColumns').mockRejectedValue(failure('x', { conflict: true }))
    await act(async () => { await result.current.reorderColumns(['feito', 'a_fazer', 'em_andamento']) })
    expect(result.current.moveNotice).toEqual({ kind: 'column' })
  })
})

describe('useBoardData: moving a card', () => {
  it('sends the neighbours with the API names and shows the move before the answer', async () => {
    const { result } = await setup()
    let finish
    vi.spyOn(api, 'moveCard').mockReturnValue(new Promise((done) => { finish = done }))
    let pending
    act(() => { pending = result.current.moveCard(1, { status: 'em_andamento', afterId: null, beforeId: null }) })
    expect(api.moveCard).toHaveBeenCalledWith(1, { status: 'em_andamento', after_id: null, before_id: null })
    expect(order(result, 'em_andamento')).toEqual([1])
    await act(async () => { finish(moved(1, { status: 'em_andamento', board_position: 5 })); await pending })
    expect(result.current.moveNotice).toBeNull()
  })

  it('places the card between the neighbours it was dropped on', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'moveCard').mockResolvedValue(moved(2, { board_position: 0.5 }))
    await act(async () => { await result.current.moveCard(2, { status: 'a_fazer', afterId: null, beforeId: 1 }) })
    expect(api.moveCard).toHaveBeenCalledWith(2, { status: 'a_fazer', after_id: null, before_id: 1 })
    expect(order(result, 'a_fazer')).toEqual([2, 1])
  })

  it('puts the card back and says so when the move fails (no refetch of the columns)', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'moveCard').mockRejectedValue(failure('Falha ao mover card'))
    let ok
    await act(async () => { ok = await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(ok).toBe(false)
    expect(order(result, 'a_fazer')).toEqual([1, 2])
    expect(order(result, 'feito')).toEqual([3])
    expect(result.current.moveNotice).toEqual({ kind: 'card' })
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 409', { conflict: true }],
    ['a 400 coluna_inexistente', { conflict: true, reason: 'coluna_inexistente' }],
  ])('%s means the board changed: it reads the columns again and says so', async (_label, extra) => {
    const { result } = await setup()
    vi.spyOn(api, 'moveCard').mockRejectedValue(failure('Conflito', extra))
    await act(async () => { await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(result.current.moveNotice).toEqual({ kind: 'board_changed' })
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(2)
    expect(order(result, 'a_fazer')).toEqual([1, 2])
  })

  it('decides by the conflict flag, never by the words of the message', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'moveCard').mockRejectedValue(failure('Conflito: o board mudou'))
    await act(async () => { await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(result.current.moveNotice).toEqual({ kind: 'card' })
  })

  it('the notice stays until it is dismissed or the next move works', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'moveCard').mockRejectedValueOnce(failure('x')).mockResolvedValue(moved(1, { status: 'feito' }))
    await act(async () => { await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(result.current.moveNotice).toEqual({ kind: 'card' })
    act(() => result.current.dismissMoveNotice())
    expect(result.current.moveNotice).toBeNull()

    api.moveCard.mockRejectedValueOnce(failure('x'))
    await act(async () => { await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(result.current.moveNotice).not.toBeNull()
    await act(async () => { await result.current.moveCard(1, { status: 'feito', afterId: 3, beforeId: null }) })
    expect(result.current.moveNotice).toBeNull()
  })
})

describe('useBoardData: moving a card by the select', () => {
  it('asks for the status change only, which lands the card at the end of the column', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateCard').mockResolvedValue(moved(1, { status: 'feito', board_position: 9 }))
    await act(async () => { await result.current.changeColumn(1, 'feito') })
    expect(api.updateCard).toHaveBeenCalledWith(1, { status: 'feito' })
    expect(result.current.cards.find((entry) => entry.id === 1).status).toBe('feito')
    expect(result.current.moveNotice).toBeNull()
  })

  it('a failure is the card notice only: no second message, no alert', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateCard').mockRejectedValue(failure('Falha ao atualizar card'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    let ok
    await act(async () => { ok = await result.current.changeColumn(1, 'feito') })
    expect(ok).toBe(false)
    expect(result.current.moveNotice).toEqual({ kind: 'card' })
    expect(result.current.mutationError).toBeNull()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(result.current.cards.find((entry) => entry.id === 1).status).toBe('a_fazer')
  })
})

describe('useBoardData: the poll while a card is dragged', () => {
  it('a poll that answers during the drag is dropped, and the next one after it applies', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
      const fetchCards = vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
      const { result } = renderHook(() => useBoardData({ scope }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(result.current.cards).toHaveLength(3)

      act(() => result.current.setCardDragActive(true))
      fetchCards.mockResolvedValue([...CARDS, card(4, 'Pessoal/tn-sandbox')])
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(result.current.cards).toHaveLength(3)

      act(() => result.current.setCardDragActive(false))
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(result.current.cards).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
