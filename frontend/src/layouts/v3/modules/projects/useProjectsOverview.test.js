import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { POLL_INTERVAL_MS, useProjectsOverview } from './useProjectsOverview.js'

const REGISTRY = {
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{
      id: 1, key: 'Pessoal/tn-sandbox', name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: true,
      folders: [{ id: 1, path: 'D:\\projetos\\Pessoal\\tn-sandbox', is_primary: true, position: 0, exists: true }],
    }],
  }],
}
const AGENTS = [{ id: 'claude', nome: 'Claude', ia: 'claude' }]
const COLUMNS = [{ slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false }]
const KEY_LIVE = 'Pessoal/tn-sandbox::claude'
const KEY_DEAD = 'Pessoal/tn-sandbox::claude::dead01'

const WRITE_AND_SIDE_EFFECT_CALLS = [
  'ackSession', 'terminateSession', 'renameSession', 'resetSession', 'continueSession', 'pasteToSession',
  'createCard', 'updateCard', 'moveCard', 'deleteCard', 'createSubcard', 'completeTask', 'reopenTask',
]

let spies

function mockSources({ active = { [KEY_LIVE]: { status: 'running', needs_attention: true } }, persisted } = {}) {
  const saved = persisted ?? {
    [KEY_LIVE]: { display_name: null, needs_attention: true },
    [KEY_DEAD]: { display_name: null, needs_attention: true },
  }
  spies = {
    workspaces: vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY),
    agents: vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS),
    cards: vi.spyOn(api, 'fetchCards').mockResolvedValue([]),
    columns: vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS),
    active: vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue(active),
    persisted: vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue(saved),
  }
  return spies
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (count = 1) => act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * count) })

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
}

async function mount(options) {
  const hook = renderHook(() => useProjectsOverview(options))
  await flush()
  return hook
}

describe('useProjectsOverview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSources()
  })

  afterEach(() => {
    delete document.visibilityState
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.title = ''
  })

  it('loads the registry (archived included), agents, cards, columns and the live sources on mount', async () => {
    const { result } = await mount()
    expect(spies.workspaces).toHaveBeenCalledWith({ includeArchived: true })
    expect(spies.agents).toHaveBeenCalledTimes(1)
    expect(spies.cards).toHaveBeenCalledTimes(1)
    expect(spies.columns).toHaveBeenCalledTimes(1)
    expect(spies.active).toHaveBeenCalledTimes(1)
    expect(spies.persisted).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.registry.projects).toHaveLength(1)
    expect(result.current.board.waiting).toHaveLength(1)
    expect(result.current.sessions).toHaveLength(2)
    expect(result.current.liveAvailable).toBe(true)
    expect(result.current.errors).toMatchObject({ workspaces: null, active: null, persisted: null })
  })

  it('is loading until the first answers settle', async () => {
    spies.workspaces.mockReturnValue(new Promise(() => {}))
    const { result } = await mount()
    expect(result.current.loading).toBe(true)
    expect(result.current.registry).toBeNull()
    expect(result.current.board).toBeNull()
  })

  it('polls active and persisted every 7 s (positive control: at least 1 + N calls after N ticks)', async () => {
    await mount()
    expect(spies.active).toHaveBeenCalledTimes(1)
    await tick(3)
    expect(spies.active.mock.calls.length).toBeGreaterThanOrEqual(1 + 3)
    expect(spies.persisted.mock.calls.length).toBeGreaterThanOrEqual(1 + 3)
    // The registry, agents and cards are not polled.
    expect(spies.workspaces).toHaveBeenCalledTimes(1)
    expect(spies.cards).toHaveBeenCalledTimes(1)
  })

  it('does not tick while the tab is hidden and ticks right away when it becomes visible', async () => {
    await mount()
    await tick(1)
    const before = spies.active.mock.calls.length
    expect(before).toBeGreaterThanOrEqual(2) // control: the default jsdom state is visible

    setVisibility('hidden')
    await tick(3)
    expect(spies.active.mock.calls.length).toBe(before)

    setVisibility('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(spies.active.mock.calls.length).toBe(before + 1)
  })

  it('never calls a write, notifies, plays a sound or counts in the title, over several ticks', async () => {
    const writeSpies = WRITE_AND_SIDE_EFFECT_CALLS.map((name) => vi.spyOn(api, name).mockResolvedValue({}))
    const Notification = vi.fn()
    const AudioContext = vi.fn()
    vi.stubGlobal('Notification', Notification)
    vi.stubGlobal('AudioContext', AudioContext)
    const titles = []
    const titleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title')
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => titleDescriptor.get.call(document),
      set: (value) => { titles.push(value); titleDescriptor.set.call(document, value) },
    })
    try {
      await mount()
      await tick(3)
      expect(spies.active.mock.calls.length).toBeGreaterThanOrEqual(4) // control: the poll really ran
      for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled()
      expect(Notification).not.toHaveBeenCalled()
      expect(AudioContext).not.toHaveBeenCalled()
      expect(titles.filter((title) => /^\(\d+\)/.test(title))).toEqual([])
      expect(titles).toEqual([])
    } finally {
      delete document.title
      vi.unstubAllGlobals()
    }
  })

  it('goes back to normal after the ack: a changed persisted answer takes the card out of waiting', async () => {
    const { result } = await mount()
    expect(result.current.board.waiting).toHaveLength(1)

    spies.persisted.mockResolvedValue({
      [KEY_LIVE]: { display_name: null, needs_attention: false },
      [KEY_DEAD]: { display_name: null, needs_attention: false },
    })
    await tick(1)
    expect(result.current.board.waiting).toHaveLength(0)
    expect(result.current.board.counts.running).toBe(1)
  })

  it('keeps the last known active state when a tick fails, and reports the error', async () => {
    const { result } = await mount()
    spies.active.mockRejectedValue(new Error('boom'))
    await tick(1)
    expect(result.current.errors.active).toBeInstanceOf(Error)
    expect(result.current.liveAvailable).toBe(true)
    expect(result.current.board.waiting).toHaveLength(1)
    expect(result.current.board.counts.needs_you).toBe(1) // still the live+dead pair aggregated into one card
  })

  it('keeps the last known persisted state when a tick fails, and reports the error', async () => {
    // Persisted says "no attention" while the live answer says "attention": persisted wins.
    mockSources({
      persisted: {
        [KEY_LIVE]: { display_name: null, needs_attention: false },
        [KEY_DEAD]: { display_name: null, needs_attention: false },
      },
    })
    const { result } = await mount()
    expect(result.current.board.waiting).toHaveLength(0)
    expect(result.current.sessions).toHaveLength(2)

    spies.persisted.mockRejectedValue(new Error('boom'))
    await tick(1)
    expect(result.current.errors.persisted).toBeInstanceOf(Error)
    // Zeroing the source would let the live "attention" through and drop the saved session.
    expect(result.current.board.waiting).toHaveLength(0)
    expect(result.current.sessions).toHaveLength(2)

    spies.persisted.mockResolvedValue({
      [KEY_LIVE]: { display_name: null, needs_attention: true },
      [KEY_DEAD]: { display_name: null, needs_attention: false },
    })
    await tick(1)
    expect(result.current.errors.persisted).toBeNull()
    expect(result.current.board.waiting).toHaveLength(1)
  })

  it('is loading until the first live reading settles, even if the static sources are in', async () => {
    spies.active.mockReturnValue(new Promise(() => {}))
    const { result } = await mount()
    expect(result.current.registry).not.toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('refetch after a failed first load goes back to loading until the retry settles', async () => {
    spies.workspaces.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
    const { result } = await mount()
    expect(result.current.loading).toBe(false)
    expect(result.current.registry).toBeNull()

    let finish
    spies.workspaces.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    let pending
    act(() => { pending = result.current.refetch() })
    expect(result.current.loading).toBe(true)

    await act(async () => { finish(REGISTRY); await pending })
    expect(result.current.loading).toBe(false)
    expect(result.current.registry.projects).toHaveLength(1)
  })

  it('refetch with a registry already loaded keeps showing it (no loading flash)', async () => {
    const { result } = await mount()
    let finish
    spies.workspaces.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    let pending
    act(() => { pending = result.current.refetch() })
    expect(result.current.loading).toBe(false)
    expect(result.current.registry).not.toBeNull()
    await act(async () => { finish(REGISTRY); await pending })
  })

  it('without any active answer the live state is unavailable and nothing is shown as running', async () => {
    spies.active.mockRejectedValue(new Error('down'))
    const { result } = await mount()
    expect(result.current.liveAvailable).toBe(false)
    expect(result.current.board.liveAvailable).toBe(false)
    expect(result.current.board.counts.running).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('does not start a tick while the previous one is still pending', async () => {
    spies.active.mockReturnValue(new Promise(() => {}))
    await mount()
    await tick(3)
    expect(spies.active).toHaveBeenCalledTimes(1)
  })

  it('reports a registry failure as errors.workspaces and keeps the rest', async () => {
    const failure = Object.assign(new Error('HTTP 503'), { status: 503 })
    spies.workspaces.mockRejectedValue(failure)
    const { result } = await mount()
    expect(result.current.errors.workspaces).toBe(failure)
    expect(result.current.registry).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('refetch reloads the static sources and recovers from a failed first load', async () => {
    spies.workspaces.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
    const { result } = await mount()
    expect(result.current.registry).toBeNull()

    await act(async () => { await result.current.refetch() })
    expect(spies.workspaces).toHaveBeenCalledTimes(2)
    expect(result.current.registry.projects).toHaveLength(1)
    expect(result.current.errors.workspaces).toBeNull()
  })

  it('keeps the previous registry when a refetch fails', async () => {
    const { result } = await mount()
    spies.workspaces.mockRejectedValue(new Error('down'))
    await act(async () => { await result.current.refetch() })
    expect(result.current.registry.projects).toHaveLength(1)
    expect(result.current.errors.workspaces).toBeInstanceOf(Error)
  })

  it('builds the board summary in the scope of the workspace key, and drops it when cards failed', async () => {
    spies.cards.mockResolvedValue([
      { id: 1, projeto_id: 'Pessoal/tn-sandbox', status: 'a_fazer', parent_id: null },
      { id: 2, projeto_id: 'NewCo/x', status: 'a_fazer', parent_id: null },
    ])
    const { result, rerender } = renderHook((props) => useProjectsOverview(props), { initialProps: { workspaceKey: '' } })
    await flush()
    expect(result.current.boardSummary.total).toBe(2)
    rerender({ workspaceKey: 'Pessoal' })
    expect(result.current.boardSummary.total).toBe(1)

    spies.cards.mockRejectedValue(new Error('down'))
    await act(async () => { await result.current.refetch() })
    // the previous cards stay, but a failure is reported
    expect(result.current.errors.cards).toBeInstanceOf(Error)
    expect(result.current.boardSummary).toBeNull()
  })

  it('unmount clears the timer and the listener: no call after it', async () => {
    const { unmount } = await mount()
    const before = spies.active.mock.calls.length
    unmount()
    await tick(3)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(spies.active.mock.calls.length).toBe(before)
  })
})
