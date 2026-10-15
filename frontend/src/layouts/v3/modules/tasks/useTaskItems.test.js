import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { useTaskItems } from './useTaskItems.js'

const NOW = new Date(2026, 9, 15, 10, 0)

const validationTask = (overrides = {}) => ({
  id: 1,
  session_key: 'acme/site::claude',
  titulo: 'Validar login',
  descricao_markdown: 'Passos',
  status: 'pending',
  created_at: 1000,
  completed_at: null,
  projeto_id: 'acme/site',
  agent_id: 'claude',
  session_display_name: null,
  ...overrides,
})

const boardCard = (overrides = {}) => ({
  id: 10,
  titulo: 'Corrigir cadastro',
  projeto_id: 'acme/site',
  status: 'a_fazer',
  descricao: null,
  criado_em: 2000,
  tipo: 'bug',
  prazo: '2026-10-01',
  ...overrides,
})

const columns = [
  { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
  { slug: 'feito', label: 'Feito', position: 1, is_done: true },
]

function mockApi({ tasks = [validationTask()], cards = [boardCard()], cols = columns } = {}) {
  vi.spyOn(api, 'fetchGlobalTasks').mockImplementation(() => (
    tasks instanceof Error ? Promise.reject(tasks) : Promise.resolve(tasks)
  ))
  vi.spyOn(api, 'fetchCards').mockImplementation(() => (
    cards instanceof Error ? Promise.reject(cards) : Promise.resolve(cards)
  ))
  vi.spyOn(api, 'fetchBoardColumns').mockImplementation(() => (
    cols instanceof Error ? Promise.reject(cols) : Promise.resolve(cols)
  ))
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([{ id: 'acme/site', nome: 'Site' }])
}

const settled = (result) => waitFor(() => expect(result.current.loading).toBe(false))

describe('useTaskItems', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges tasks, cards and columns into items', async () => {
    mockApi()
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    expect(result.current.loading).toBe(true)
    await settled(result)

    expect(result.current.doneSlug).toBe('feito')
    expect(result.current.errors).toEqual({ tasks: null, cards: null, columns: null })
    // validation task first, then the overdue card
    expect(result.current.items.map((item) => item.id)).toEqual(['task:1', 'card:10'])
    expect(result.current.items[1]).toMatchObject({ overdue: true, kind: 'bug', due: '2026-10-01' })
    await waitFor(() => expect(result.current.items[0].projectName).toBe('Site'))
  })

  it('reports a cards error and still returns validation items', async () => {
    mockApi({ cards: new Error('cards down') })
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    expect(result.current.errors.cards).toBeInstanceOf(Error)
    expect(result.current.errors.tasks).toBeNull()
    expect(result.current.items.map((item) => item.id)).toEqual(['task:1'])
  })

  it('reports a columns error and keeps doneSlug null', async () => {
    mockApi({ cols: new Error('columns down') })
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    expect(result.current.errors.columns).toBeInstanceOf(Error)
    expect(result.current.errors.cards).toBeNull()
    expect(result.current.doneSlug).toBeNull()
    expect(result.current.items.find((item) => item.id === 'card:10').overdue).toBe(false)
  })

  it('reports a tasks error from useGlobalTasks', async () => {
    mockApi({ tasks: new Error('tasks down') })
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    expect(result.current.errors.tasks).toBeInstanceOf(Error)
    expect(result.current.items.map((item) => item.id)).toEqual(['card:10'])
  })

  it('refetch reloads cards and columns', async () => {
    mockApi()
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)
    expect(api.fetchCards).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.refetch() })
    expect(api.fetchCards).toHaveBeenCalledTimes(2)
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(2)
    expect(api.fetchGlobalTasks.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('completeTask delegates only for validation items', async () => {
    mockApi()
    const complete = vi.spyOn(api, 'completeTask').mockResolvedValue({ status: 'done' })
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    const card = result.current.items.find((item) => item.source === 'card')
    const validation = result.current.items.find((item) => item.source === 'validation')

    let outcome
    await act(async () => { outcome = await result.current.completeTask(card) })
    expect(outcome).toBe(false)
    expect(complete).not.toHaveBeenCalled()

    await act(async () => { outcome = await result.current.completeTask(validation) })
    expect(outcome).toBe(true)
    expect(complete).toHaveBeenCalledWith('acme/site::claude', 1)
    expect(result.current.items.find((item) => item.id === 'task:1').done).toBe(true)
    expect(result.current.savingId).toBeNull()
  })

  it('reopenTask delegates to the reopen endpoint', async () => {
    mockApi({ tasks: [validationTask({ status: 'done' })] })
    const reopen = vi.spyOn(api, 'reopenTask').mockResolvedValue({ status: 'pending' })
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    await act(async () => { await result.current.reopenTask(result.current.items.find((item) => item.id === 'task:1')) })
    expect(reopen).toHaveBeenCalledWith('acme/site::claude', 1)
    expect(result.current.items.find((item) => item.id === 'task:1').done).toBe(false)
  })

  it('exposes mutationError when completing fails, without a native alert', async () => {
    mockApi()
    vi.spyOn(api, 'completeTask').mockRejectedValue(new Error('boom'))
    global.alert = vi.fn()
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    let outcome
    await act(async () => {
      outcome = await result.current.completeTask(result.current.items.find((item) => item.id === 'task:1'))
    })
    expect(outcome).toBe(false)
    expect(result.current.mutationError).toMatchObject({ id: 'task:1', error: expect.any(Error) })
    expect(global.alert).not.toHaveBeenCalled()
    expect(result.current.items.find((item) => item.id === 'task:1').done).toBe(false)

    // the next attempt clears the previous notice
    vi.spyOn(api, 'completeTask').mockResolvedValue({ status: 'done' })
    await act(async () => {
      await result.current.completeTask(result.current.items.find((item) => item.id === 'task:1'))
    })
    expect(result.current.mutationError).toBeNull()
  })

  it('clearMutationError dismisses the failure', async () => {
    mockApi()
    vi.spyOn(api, 'completeTask').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskItems({ now: NOW }))
    await settled(result)

    await act(async () => {
      await result.current.completeTask(result.current.items.find((item) => item.id === 'task:1'))
    })
    expect(result.current.mutationError).not.toBeNull()
    act(() => { result.current.clearMutationError() })
    expect(result.current.mutationError).toBeNull()
  })
})
