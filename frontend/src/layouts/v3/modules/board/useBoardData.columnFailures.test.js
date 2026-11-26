// What the board does after a column request fails: the notice of "done" that goes away on a
// success, and the columns read again (a column that is gone elsewhere stops being shown).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { buildScope } from './boardScope.js'
import { card, COLUMNS, registry } from './boardFixtures.js'
import { useBoardData } from './useBoardData.js'

const scope = buildScope({ registry: registry() })
const failure = (message, extra = {}) => Object.assign(new Error(message), extra)
const slugs = (result) => result.current.columns.map((column) => column.slug)

async function setup() {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue([card(1, 'Pessoal/tn-sandbox')])
  const view = renderHook(() => useBoardData({ scope }))
  await waitFor(() => expect(view.result.current.cardsLoaded).toBe(true))
  api.fetchBoardColumns.mockClear()
  return view
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBoardData: the notice of a failed "concluída"', () => {
  it('goes away when the next try works', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'setDoneColumn').mockRejectedValueOnce(failure('boom'))
    await act(async () => { await result.current.setDoneColumn('em_andamento') })
    expect(result.current.moveNotice).toEqual({ kind: 'done' })
    api.setDoneColumn.mockResolvedValue(COLUMNS.map((column) => ({ ...column, is_done: column.slug === 'em_andamento' })))
    let ok
    await act(async () => { ok = await result.current.setDoneColumn('em_andamento') })
    expect(ok).toBe(true)
    expect(result.current.moveNotice).toBeNull()
    expect(result.current.doneSlug).toBe('em_andamento')
  })
})

describe('useBoardData: a column request that fails reads the columns again', () => {
  // The column went away in another tab: the list on screen still has it.
  const GONE = COLUMNS.filter((column) => column.slug !== 'em_andamento')

  it('after a delete that fails, the column that is gone stops being shown, and the error still reaches the caller', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteBoardColumn').mockRejectedValue(failure('Coluna não encontrada'))
    api.fetchBoardColumns.mockResolvedValue(GONE)
    let thrown
    await act(async () => { try { await result.current.deleteColumn('em_andamento') } catch (error) { thrown = error } })
    expect(thrown.message).toBe('Coluna não encontrada')
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(slugs(result)).toEqual(['a_fazer', 'feito']))
  })

  it('a delete refused by a known reason (cards in it) reads nothing: the column is there, and the reason survives', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteBoardColumn').mockRejectedValue(failure('x', { reason: 'coluna_com_cards', cards: 2 }))
    let thrown
    await act(async () => { try { await result.current.deleteColumn('a_fazer') } catch (error) { thrown = error } })
    expect(thrown.reason).toBe('coluna_com_cards')
    expect(api.fetchBoardColumns).not.toHaveBeenCalled()
  })

  it('after a rename that fails', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'updateBoardColumn').mockRejectedValue(failure('Coluna não encontrada'))
    api.fetchBoardColumns.mockResolvedValue(GONE)
    let thrown
    await act(async () => { try { await result.current.renameColumn('em_andamento', 'Outro') } catch (error) { thrown = error } })
    expect(thrown.message).toBe('Coluna não encontrada')
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(slugs(result)).toEqual(['a_fazer', 'feito']))
  })

  it('after a "concluída" that fails', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'setDoneColumn').mockRejectedValue(failure('Coluna não encontrada'))
    api.fetchBoardColumns.mockResolvedValue(GONE)
    await act(async () => { await result.current.setDoneColumn('em_andamento') })
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(slugs(result)).toEqual(['a_fazer', 'feito']))
  })

  it('and reads nothing when the request works', async () => {
    const { result } = await setup()
    vi.spyOn(api, 'deleteBoardColumn').mockResolvedValue({})
    vi.spyOn(api, 'updateBoardColumn').mockResolvedValue({ slug: 'a_fazer', label: 'Backlog', position: 1, is_done: false })
    vi.spyOn(api, 'setDoneColumn').mockResolvedValue(COLUMNS)
    await act(async () => {
      await result.current.deleteColumn('em_andamento')
      await result.current.renameColumn('a_fazer', 'Backlog')
      await result.current.setDoneColumn('feito')
    })
    expect(api.fetchBoardColumns).not.toHaveBeenCalled()
  })
})
