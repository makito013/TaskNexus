import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { useCards } from '../../../../hooks/useCards.js'
import { buildScope } from './boardScope.js'
import { CARDS, COLUMNS, registry } from './boardFixtures.js'
import { useBoardData } from './useBoardData.js'

// The real hook, wrapped so the tests can read how it was called.
vi.mock('../../../../hooks/useCards.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useCards: vi.fn(actual.useCards) }
})

const scopeFor = (options = {}) => buildScope({ registry: registry(), ...options })

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(CARDS)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  useCards.mockClear()
})

describe('useBoardData: reading', () => {
  it('loads the global columns and the cards of the scope', async () => {
    const scope = scopeFor({ workspaceKey: 'Pessoal' })
    const { result } = renderHook(() => useBoardData({ scope }))
    expect(result.current.loading).toBe(true)
    expect(result.current.cardsLoaded).toBe(false)
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.columns).toEqual(COLUMNS)
    expect(result.current.doneSlug).toBe('feito')
    expect(result.current.cards.map((card) => card.id)).toEqual([1, 2, 3])
    expect(result.current.fetchedCards).toHaveLength(CARDS.length)
  })

  it('asks the server for every card when no project is chosen, and for the exact key when one is', async () => {
    const { result, rerender } = renderHook(({ scope }) => useBoardData({ scope }), {
      initialProps: { scope: scopeFor({ workspaceKey: 'Pessoal' }) },
    })
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    expect(api.fetchCards).toHaveBeenLastCalledWith([])
    rerender({ scope: scopeFor({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' }) })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith(['Pessoal/tn-sandbox']))
  })

  it('does not hand out cards of the previous request as current', async () => {
    const { result, rerender } = renderHook(({ scope }) => useBoardData({ scope }), {
      initialProps: { scope: scopeFor() },
    })
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    rerender({ scope: scopeFor({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' }) })
    expect(result.current.cardsLoaded).toBe(false)
  })

  it('reports the columns error only when there is nothing to show, and recovers on refetch', async () => {
    api.fetchBoardColumns.mockRejectedValueOnce(new Error('down'))
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.columnsError).toBeInstanceOf(Error))
    expect(result.current.loading).toBe(false)
    await act(async () => { await result.current.refetchColumns() })
    expect(result.current.columnsError).toBeNull()
    expect(result.current.columns).toEqual(COLUMNS)
  })

  it('marks the cards stale when a later poll fails and keeps the data', async () => {
    vi.useFakeTimers()
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.cardsLoaded).toBe(true)
    expect(result.current.cardsStale).toBe(false)

    api.fetchCards.mockRejectedValueOnce(new Error('500'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.cardsStale).toBe(true)
    expect(result.current.cards.length).toBeGreaterThan(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.cardsStale).toBe(false)
  })

  it('a first read that fails is an error, not "stale" and not an endless loading', async () => {
    api.fetchCards.mockRejectedValue(new Error('500'))
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.cardsError).toBeInstanceOf(Error))
    expect(result.current.cardsLoaded).toBe(false)
    expect(result.current.cardsStale).toBe(false)
  })

  it('the error goes away only when a read works (poll or refetchCards)', async () => {
    api.fetchCards.mockRejectedValueOnce(new Error('500'))
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.cardsError).not.toBeNull())
    await act(async () => { await result.current.refetchCards() })
    expect(result.current.cardsError).toBeNull()
    expect(result.current.cardsLoaded).toBe(true)
  })

  it('a change of project during an outage is an error again once the new read fails, never a loading', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ scope }) => useBoardData({ scope }), {
      initialProps: { scope: scopeFor({ workspaceKey: 'Pessoal' }) },
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.cardsLoaded).toBe(true)
    api.fetchCards.mockRejectedValue(new Error('down'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.cardsStale).toBe(true)
    expect(result.current.cardsError).toBeNull()

    rerender({ scope: scopeFor({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.cardsLoaded).toBe(false)
    expect(result.current.cardsError).toBeInstanceOf(Error)
    expect(result.current.cardsStale).toBe(false)
  })
})

describe('useBoardData: how it uses the shared hooks', () => {
  it('passes quiet options: the poll pauses with the tab and read state is tracked', async () => {
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    const options = useCards.mock.calls.at(-1)[2]
    expect(options.pauseWhenHidden).toBe(true)
    expect(options.trackReadState).toBe(true)
  })

  it('turns a failed mutation into mutationError, never an alert, and clears it on request', async () => {
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    const scope = scopeFor()
    const { result } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    expect(result.current.mutationError).toBeNull()

    const { onMutationError } = useCards.mock.calls.at(-1)[2]
    act(() => { onMutationError('Falha ao criar card. Tente novamente.', new Error('x')) })
    expect(result.current.mutationError).toEqual({ message: 'Falha ao criar card. Tente novamente.' })
    expect(alertSpy).not.toHaveBeenCalled()

    act(() => { result.current.clearMutationError() })
    expect(result.current.mutationError).toBeNull()
    vi.unstubAllGlobals()
  })

  it('the error handler keeps its identity across renders', async () => {
    const scope = scopeFor()
    const { result, rerender } = renderHook(() => useBoardData({ scope }))
    await waitFor(() => expect(result.current.cardsLoaded).toBe(true))
    const first = useCards.mock.calls.at(-1)[2].onMutationError
    rerender()
    expect(useCards.mock.calls.at(-1)[2].onMutationError).toBe(first)
  })
})
