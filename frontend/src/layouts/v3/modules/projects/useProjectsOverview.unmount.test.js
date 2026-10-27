// React 18 no longer warns about a state update on an unmounted component, so
// "the hook honours mountedRef" cannot be seen through the rendered result. This
// file wraps useState to count the setter calls and asserts that nothing is set
// once the hook is unmounted, whichever request is still in flight.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { api } from '../../../../services/api.js'
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

const { useProjectsOverview } = await import('./useProjectsOverview.js')

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('useProjectsOverview after unmount', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sets no state when the static and the live answers arrive after the unmount', async () => {
    const registry = deferred()
    const active = deferred()
    vi.spyOn(workspacesApi, 'fetchWorkspaces').mockReturnValue(registry.promise)
    vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchActiveSessions').mockReturnValue(active.promise)
    vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})

    const { unmount } = renderHook(() => useProjectsOverview())
    await act(async () => { await Promise.resolve() })
    tracker.calls = 0 // control below proves the counter works

    unmount()
    registry.resolve({ seeded: null, workspaces: [] })
    active.resolve({})
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(tracker.calls).toBe(0)
  })

  it('positive control: the same answers while mounted do set state', async () => {
    const registry = deferred()
    vi.spyOn(workspacesApi, 'fetchWorkspaces').mockReturnValue(registry.promise)
    vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
    vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})

    const { unmount } = renderHook(() => useProjectsOverview())
    await act(async () => { await Promise.resolve() })
    tracker.calls = 0
    registry.resolve({ seeded: null, workspaces: [] })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(tracker.calls).toBeGreaterThan(0)
    unmount()
  })
})
