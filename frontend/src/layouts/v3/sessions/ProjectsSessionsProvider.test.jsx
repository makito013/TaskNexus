import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { chatApi } from '../../../services/chatApi.js'
import ProjectsSessionsProvider from './ProjectsSessionsProvider.jsx'
import { INERT_SESSIONS, useProjectsSessions } from './useProjectsSessions.js'

let latest
function Probe() {
  latest = useProjectsSessions()
  return <output data-testid="count">{latest.chats.length}</output>
}

const CHAT = { session_key: 'p::claude::k3x9q2', status: 'idle' }

let hidden
function mount({ navigate = vi.fn(), strict = false } = {}) {
  const tree = (
    <ProjectsSessionsProvider navigate={navigate}>
      <Probe />
    </ProjectsSessionsProvider>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return navigate
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({ 'p::claude::k3x9q2': { engine: 'chat', status: 'running' } })
  vi.spyOn(chatApi, 'listSessions').mockResolvedValue([CHAT])
  vi.spyOn(chatApi, 'health').mockResolvedValue({ sdk: { available: true } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ProjectsSessionsProvider polling (CA38)', () => {
  it('reads the three URLs at mount and exposes the data', async () => {
    mount()
    await flush()
    expect(chatApi.listLiveSessions).toHaveBeenCalledTimes(1)
    expect(chatApi.listSessions).toHaveBeenCalledTimes(1)
    expect(chatApi.health).toHaveBeenCalledTimes(1)
    expect(latest.chats).toEqual([CHAT])
    expect(latest.liveByKey['p::claude::k3x9q2']).toMatchObject({ engine: 'chat' })
    expect(latest.health).toEqual({ sdk: { available: true } })
    expect(latest.liveAvailable).toBe(true)
    expect(latest.loaded).toBe(true)
  })

  it('polls sessions every 7 s and health only once in that window', async () => {
    mount()
    await flush()
    await advance(7000)
    await advance(7000)
    expect(chatApi.listSessions).toHaveBeenCalledTimes(3)
    expect(chatApi.listLiveSessions).toHaveBeenCalledTimes(3)
    expect(chatApi.health).toHaveBeenCalledTimes(1)
  })

  it('asks for health again after 5 minutes', async () => {
    mount()
    await flush()
    await advance(5 * 60 * 1000 + 7000)
    expect(chatApi.health.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps polling while the tab is hidden and ticks at once when it is visible again', async () => {
    mount()
    await flush()
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(60000)
    expect(chatApi.listSessions.mock.calls.length).toBeGreaterThanOrEqual(9)
    const before = chatApi.listSessions.mock.calls.length
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(chatApi.listSessions).toHaveBeenCalledTimes(before + 1)
  })

  it('swallows every failure into liveAvailable=false and keeps the last known data', async () => {
    mount()
    await flush()
    expect(latest.liveAvailable).toBe(true)
    chatApi.listLiveSessions.mockRejectedValue(new Error('down'))
    chatApi.listSessions.mockRejectedValue(new Error('down'))
    chatApi.health.mockRejectedValue(new Error('down'))
    await advance(7000)
    expect(latest.liveAvailable).toBe(false)
    expect(latest.chats).toEqual([CHAT])
    expect(latest.health).toEqual({ sdk: { available: true } })
    chatApi.listLiveSessions.mockResolvedValue({})
    chatApi.listSessions.mockResolvedValue([])
    await advance(7000)
    expect(latest.liveAvailable).toBe(true)
    expect(latest.chats).toEqual([])
  })

  it('does not throw when the backend is not there at all (first tick fails)', async () => {
    chatApi.listLiveSessions.mockRejectedValue(new Error('down'))
    chatApi.listSessions.mockRejectedValue(new Error('down'))
    chatApi.health.mockRejectedValue(new Error('down'))
    mount()
    await flush()
    expect(latest.liveAvailable).toBe(false)
    expect(latest.loaded).toBe(true)
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('leaves no timer pending after unmount and makes no further request', async () => {
    mount()
    await flush()
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
    await advance(60000)
    expect(chatApi.listSessions).toHaveBeenCalledTimes(1)
  })

  it('does not set state when a tick resolves after unmount', async () => {
    let release
    chatApi.listSessions.mockImplementation(() => new Promise((resolve) => { release = () => resolve([CHAT]) }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    await flush()
    cleanup()
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
    expect(errors).not.toHaveBeenCalled()
  })

  it('works under StrictMode: one live poll chain after the double mount', async () => {
    mount({ strict: true })
    await flush()
    const before = chatApi.listSessions.mock.calls.length
    await advance(7000)
    expect(chatApi.listSessions.mock.calls.length - before).toBe(1)
  })

  it('never writes and never opens a WebSocket', async () => {
    const socket = vi.fn()
    vi.stubGlobal('WebSocket', socket)
    const writers = ['createSession', 'openSession', 'closeSession', 'switchEngine', 'decidePermission', 'renameSession', 'terminateSession', 'resetSession']
    const spies = writers.map((name) => vi.spyOn(chatApi, name))
    mount()
    await flush()
    await advance(14000)
    expect(socket).not.toHaveBeenCalled()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('ProjectsSessionsProvider actions', () => {
  it('openChat navigates with the encoded key and focuses it', async () => {
    const navigate = mount()
    await flush()
    act(() => latest.openChat('Pessoal/tn::claude::abc123'))
    expect(navigate).toHaveBeenCalledWith('/projects/chat/Pessoal%2Ftn%3A%3Aclaude%3A%3Aabc123')
    expect(latest.focusedKey).toBe('Pessoal/tn::claude::abc123')
    act(() => latest.openChat(''))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('registerCreated keeps the key in grace for 15 s and refreshes at once', async () => {
    mount()
    await flush()
    const before = chatApi.listSessions.mock.calls.length
    act(() => latest.registerCreated('p::claude::new111'))
    expect(latest.graceKeys).toEqual(['p::claude::new111'])
    await flush()
    expect(chatApi.listSessions.mock.calls.length).toBe(before + 1)
    await advance(14999)
    expect(latest.graceKeys).toEqual(['p::claude::new111'])
    await advance(1)
    expect(latest.graceKeys).toEqual([])
  })

  it('the grace timer is cleared on unmount', async () => {
    mount()
    await flush()
    act(() => latest.registerCreated('p::claude::new111'))
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refresh triggers a poll tick', async () => {
    mount()
    await flush()
    act(() => latest.refresh())
    await flush()
    expect(chatApi.listSessions).toHaveBeenCalledTimes(2)
  })
})

describe('inert default context', () => {
  it('has empty lists, no-op actions and does no network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({})
    function Alone() {
      const value = useProjectsSessions()
      expect(value).toBe(INERT_SESSIONS)
      value.openChat('x')
      value.registerCreated('x')
      value.refresh()
      value.setFocusedKey('x')
      return <output data-testid="alone">{value.chats.length}</output>
    }
    render(<Alone />)
    expect(screen.getByTestId('alone').textContent).toBe('0')
    expect(INERT_SESSIONS.liveAvailable).toBe(false)
    expect(INERT_SESSIONS.liveByKey).toEqual({})
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(chatApi.listSessions).not.toHaveBeenCalled()
  })
})
