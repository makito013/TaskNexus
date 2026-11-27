import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../../services/api.js'
import { chatApi } from '../../services/chatApi.js'
import { workspacesApi } from '../../services/workspacesApi.js'
import AppV3 from './AppV3.jsx'

// The whole shell with the real viewer feed: what is mocked is the network (fetch, the sockets) and the polls.
class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closeCalls = 0
    FakeWebSocket.instances.push(this)
  }

  send() {}

  close() {
    this.closeCalls += 1
    this.readyState = 3
  }

  emit(frame) {
    act(() => {
      this.onmessage?.({ data: JSON.stringify(frame) })
    })
  }
}

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const OTHER = 'Pessoal/tn-sandbox::claude::z9z9z9'
const CHAT_PATH = (key) => `/projects/chat/${encodeURIComponent(key)}`
const feedSockets = () => FakeWebSocket.instances.filter((socket) => socket.url.endsWith('/ws/viewer'))
const liveFeedSockets = () => feedSockets().filter((socket) => socket.closeCalls === 0)
const frame = (key, overrides = {}) => ({
  type: 'viewer_open',
  session_key: key,
  item: { item_id: 'i1', session_key: key, path: 'docs/plan.md', title: 'plan.md', kind: 'markdown', opened_by: 'agent', updated_at: 1_700_000_000 },
  reused: false,
  evicted: [],
  ...overrides,
})

function startAt(pathname) {
  window.history.replaceState({}, '', pathname)
}

function mockNetwork({ live = {} } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })))
  vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue({ seeded: null, workspaces: [] })
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue(live)
  vi.spyOn(chatApi, 'listSessions').mockResolvedValue([])
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete document.documentElement.dataset.theme
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  startAt('/')
})

describe('AppV3 with the live viewer feed', () => {
  it('opens no feed socket while no session is alive', async () => {
    mockNetwork()
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(chatApi.listLiveSessions).toHaveBeenCalled())
    await act(async () => {})

    expect(feedSockets()).toHaveLength(0)
  })

  it('opens ONE feed socket once a session is alive, on any screen, and keeps it across screens', async () => {
    mockNetwork({ live: { [KEY]: { connected: true } } })
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)

    await waitFor(() => expect(feedSockets()).toHaveLength(1))
    expect(feedSockets()[0].url).toBe(`ws://${window.location.host}/ws/viewer`)
    fireEvent.click(screen.getByRole('button', { name: 'Projetos e agentes' }))
    await act(async () => {})

    expect(feedSockets()).toHaveLength(1)
    expect(feedSockets()[0].closeCalls).toBe(0)
  })

  it('in StrictMode (as the real boot) one socket stays alive and one toast shows', async () => {
    mockNetwork({ live: { [KEY]: { connected: true } } })
    startAt('/tasks')
    render(<StrictMode><AppV3 initialTheme="light" /></StrictMode>)

    await waitFor(() => expect(liveFeedSockets()).toHaveLength(1))
    liveFeedSockets()[0].emit(frame(KEY))

    expect(await screen.findByText('claude abriu plan.md.')).not.toBeNull()
    expect(document.querySelectorAll('.v3-toast')).toHaveLength(1)
  })

  it('an agent opening a file while the person is on another screen raises the toast, and "Ver" goes to that conversation', async () => {
    mockNetwork({ live: { [OTHER]: { connected: true } } })
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(feedSockets()).toHaveLength(1))

    feedSockets()[0].emit(frame(OTHER))

    expect(await screen.findByText('claude abriu plan.md.')).not.toBeNull()
    expect(window.location.pathname).toBe('/tasks')
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))

    expect(window.location.pathname).toBe(CHAT_PATH(OTHER))
    await waitFor(() => expect(document.querySelector('[data-session-key]')?.getAttribute('data-session-key')).toBe(OTHER))
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
  })

  it('a frame with an unsafe key changes nothing: no toast, no navigation', async () => {
    mockNetwork({ live: { [KEY]: { connected: true } } })
    startAt('/tasks')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(feedSockets()).toHaveLength(1))

    feedSockets()[0].emit(frame('P::a::x/%2e%2e/%2e%2e/P::a::victim'))
    feedSockets()[0].emit(frame('../chat/other::claude::x'))
    await act(async () => {})

    expect(document.querySelector('.v3-toast-region')).toBeNull()
    expect(window.location.pathname).toBe('/tasks')
  })

  it('on the chat route the conversation on screen is not toasted: the panel opens by itself', async () => {
    mockNetwork({ live: { [KEY]: { connected: true } } })
    startAt(CHAT_PATH(KEY))
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(feedSockets()).toHaveLength(1))

    feedSockets()[0].emit(frame(KEY))

    await waitFor(() => expect(document.querySelector('.v3-toast-region')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    // The polite line of the viewer (the shell has other status regions: the island, the thread skeleton).
    await waitFor(() => expect(document.querySelector('.v3-viewer-sr-only[role="status"]')?.textContent).toBe('claude abriu plan.md.'))
  })

  it('leaving the app closes the socket', async () => {
    mockNetwork({ live: { [KEY]: { connected: true } } })
    startAt('/tasks')
    const view = render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(feedSockets()).toHaveLength(1))

    view.unmount()

    expect(feedSockets()[0].closeCalls).toBe(1)
  })
})
