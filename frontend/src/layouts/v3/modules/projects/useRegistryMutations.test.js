import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { useRegistryMutations } from './useRegistryMutations.js'

afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useRegistryMutations', () => {
  it.each([
    ['createWorkspace', [{ name: 'Estudos' }], 'createWorkspace'],
    ['updateWorkspace', [3, { archived: true }], 'updateWorkspace'],
    ['createProject', [4, { name: 'qa-a', folders: [] }], 'createProject'],
    ['updateProject', [9, { name: 'renamed' }], 'updateProject'],
  ])('%s calls the matching client function with the same arguments and then onDone', async (name, args, apiName) => {
    const order = []
    const spy = vi.spyOn(workspacesApi, apiName).mockImplementation(async () => { order.push('api'); return { ok: name } })
    const onDone = vi.fn(async () => { order.push('onDone') })
    const { result } = renderHook(() => useRegistryMutations({ onDone }))

    let returned
    await act(async () => { returned = await result.current[name](...args) })

    expect(spy).toHaveBeenCalledWith(...args)
    expect(returned).toEqual({ ok: name })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['api', 'onDone'])
  })

  it.each([
    ['inspectFolders', [{ paths: ['C:\\a'], excludeProjectId: 2 }], 'inspectFolders'],
    ['discoverFolders', [], 'discoverFolders'],
    ['browseFolder', [], 'browseFolder'],
  ])('%s only reads: it calls the client and never onDone, pending or error', async (name, args, apiName) => {
    const spy = vi.spyOn(workspacesApi, apiName).mockResolvedValue({ results: [] })
    const onDone = vi.fn()
    const { result } = renderHook(() => useRegistryMutations({ onDone }))

    await act(async () => { await result.current[name](...args) })
    expect(spy).toHaveBeenCalledWith(...args)
    expect(onDone).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('a failed write rethrows, keeps the error, never calls onDone and clears pending', async () => {
    const failure = Object.assign(new Error('boom'), { status: 409, code: 'adopt_conflict' })
    vi.spyOn(workspacesApi, 'createProject').mockRejectedValue(failure)
    const onDone = vi.fn()
    const { result } = renderHook(() => useRegistryMutations({ onDone }))

    let caught
    await act(async () => {
      try { await result.current.createProject(1, { name: 'x', folders: [] }) } catch (error) { caught = error }
    })
    expect(caught).toBe(failure)
    expect(result.current.error).toBe(failure)
    expect(result.current.pending).toBe(false)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('pending is true while a write runs (onDone included) and the next write clears the old error', async () => {
    const first = deferred()
    vi.spyOn(workspacesApi, 'updateProject')
      .mockRejectedValueOnce(new Error('first fails'))
      .mockReturnValueOnce(first.promise)
    const { result } = renderHook(() => useRegistryMutations({ onDone: async () => {} }))

    await act(async () => { await result.current.updateProject(1, { name: 'a' }).catch(() => {}) })
    expect(result.current.error).toBeInstanceOf(Error)

    let pendingCall
    act(() => { pendingCall = result.current.updateProject(1, { name: 'b' }) })
    expect(result.current.pending).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => { first.resolve({ project: {} }); await pendingCall })
    expect(result.current.pending).toBe(false)
  })

  it('stays pending until onDone settles, so the caller sees the refetched registry', async () => {
    vi.spyOn(workspacesApi, 'createWorkspace').mockResolvedValue({ workspace: { id: 1 } })
    const refetch = deferred()
    const { result } = renderHook(() => useRegistryMutations({ onDone: () => refetch.promise }))

    let call
    act(() => { call = result.current.createWorkspace({ name: 'x' }) })
    await waitFor(() => expect(workspacesApi.createWorkspace).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(result.current.pending).toBe(true)
    await act(async () => { refetch.resolve(); await call })
    expect(result.current.pending).toBe(false)
  })

  it('keeps the function identities stable across renders', () => {
    const { result, rerender } = renderHook(() => useRegistryMutations({ onDone: () => {} }))
    const before = { ...result.current }
    rerender()
    for (const name of ['createWorkspace', 'updateWorkspace', 'createProject', 'updateProject', 'inspectFolders', 'discoverFolders', 'browseFolder']) {
      expect(result.current[name]).toBe(before[name])
    }
  })

  it('uses the latest onDone without changing the function identities', async () => {
    vi.spyOn(workspacesApi, 'updateProject').mockResolvedValue({})
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ onDone }) => useRegistryMutations({ onDone }), { initialProps: { onDone: first } })
    rerender({ onDone: second })
    await act(async () => { await result.current.updateProject(1, { archived: true }) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
