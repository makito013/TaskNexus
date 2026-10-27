// React 18 no longer warns about a state update on an unmounted component, so
// "the hook honours mountedRef" cannot be seen through the rendered result. This
// file wraps useState to count the setter calls and asserts that nothing is set
// once the hook is unmounted, whichever write is still in flight. (Its own file:
// the vi.mock of 'react' applies to the whole file.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { workspacesApi } from '../../../../services/workspacesApi.js'

const tracker = vi.hoisted(() => ({ calls: 0 }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useState: (initial) => {
      const [value, set] = actual.useState(initial)
      const setRef = actual.useRef(set)
      setRef.current = set
      const counted = actual.useRef(null)
      if (!counted.current) {
        counted.current = (...args) => {
          tracker.calls += 1
          return setRef.current(...args)
        }
      }
      return [value, counted.current]
    },
  }
})

const { useRegistryMutations } = await import('./useRegistryMutations.js')

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('useRegistryMutations after unmount', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sets no state when a write succeeds or fails after the unmount', async () => {
    const ok = deferred()
    const bad = deferred()
    vi.spyOn(workspacesApi, 'createWorkspace').mockReturnValue(ok.promise)
    vi.spyOn(workspacesApi, 'updateProject').mockReturnValue(bad.promise)
    const { result, unmount } = renderHook(() => useRegistryMutations({ onDone: () => {} }))

    let first
    let second
    act(() => {
      first = result.current.createWorkspace({ name: 'x' })
      second = result.current.updateProject(1, { archived: true }).catch(() => {})
    })
    tracker.calls = 0 // the control below proves the counter works

    unmount()
    ok.resolve({ workspace: { id: 1 } })
    bad.reject(new Error('late'))
    await act(async () => { await first; await second })
    await settle()
    expect(tracker.calls).toBe(0)
  })

  it('positive control: the same settle while mounted does set state', async () => {
    const ok = deferred()
    vi.spyOn(workspacesApi, 'createWorkspace').mockReturnValue(ok.promise)
    const { result, unmount } = renderHook(() => useRegistryMutations({ onDone: () => {} }))

    let call
    act(() => { call = result.current.createWorkspace({ name: 'x' }) })
    tracker.calls = 0
    ok.resolve({ workspace: { id: 1 } })
    await act(async () => { await call })
    expect(tracker.calls).toBeGreaterThan(0)
    unmount()
  })
})
