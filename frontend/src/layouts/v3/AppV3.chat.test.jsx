import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { api } from '../../services/api.js'
import { chatApi } from '../../services/chatApi.js'
import { workspacesApi } from '../../services/workspacesApi.js'
import AppV3 from './AppV3.jsx'

// The real chat screen, plus one button that uses the sessions context the way the list does.
vi.mock('./modules/chat/ChatScreen.jsx', async () => {
  const React = await import('react')
  const actual = await vi.importActual('./modules/chat/ChatScreen.jsx')
  const { useProjectsSessions } = await vi.importActual('./sessions/useProjectsSessions.js')
  function ChatScreenWithOpener(props) {
    const { openChat } = useProjectsSessions()
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(actual.default, props),
      React.createElement('button', { onClick: () => openChat('Pessoal/x::claude::other1') }, 'Abrir outro chat'),
    )
  }
  return { default: ChatScreenWithOpener }
})

// Counts every socket the shell opens: the conversation socket must be ONE across module switches.
class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    FakeWebSocket.instances.push(this)
  }

  send() {}

  close() {
    this.readyState = 3
  }
}

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const CHAT_PATH = `/projects/chat/${encodeURIComponent(KEY)}`

function startAt(pathname) {
  window.history.replaceState({}, '', pathname)
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue({ seeded: null, workspaces: [] })
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'listSessions').mockResolvedValue([])
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  startAt('/')
})

describe('AppV3 chat route', () => {
  it('renders the chat screen for /projects/chat/<key> without redirecting', () => {
    startAt(CHAT_PATH)
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<AppV3 initialTheme="light" />)
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe(CHAT_PATH)
    const screenElement = document.querySelector('[data-session-key]')
    expect(screenElement.getAttribute('data-session-key')).toBe(KEY)
    // The placeholder's "Chat" heading became the chat title (fallback "Nova conversa").
    expect(screen.getByRole('heading', { level: 1, name: 'Nova conversa' })).toBeTruthy()
  })

  it('keeps Projects as the active module and the Kan pet on the chat route', () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    expect(screen.getByRole('button', { name: 'Projetos e agentes' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('region', { name: 'Equipe' }).querySelector('.v3-pet--kan')).toBeTruthy()
  })

  it('redirects an empty chat key to the default module', () => {
    startAt('/projects/chat/')
    render(<AppV3 initialTheme="light" />)
    expect(window.location.pathname).toBe('/tasks')
  })

  it('the Projects entry of the rail leads from the chat back to the Projects screen', async () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Projetos e agentes' }))
    expect(window.location.pathname).toBe('/projects')
    await waitFor(() => expect(document.querySelector('[data-session-key]')).toBeNull())
  })

  it('switching to Tarefas and back does not remount the provider (one poll chain, state kept)', async () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(chatApi.listSessions).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    expect(window.location.pathname).toBe('/tasks')
    fireEvent.click(screen.getByRole('button', { name: 'Projetos e agentes' }))
    expect(window.location.pathname).toBe('/projects')
    await new Promise((resolve) => setTimeout(resolve, 20))
    // A remount of the provider would have fetched again at once.
    expect(chatApi.listSessions).toHaveBeenCalledTimes(1)
    expect(chatApi.health).toHaveBeenCalledTimes(1)
  })

  it('the provider wraps the screen area: openChat from inside the screen navigates the shell', async () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir outro chat' }))
    expect(window.location.pathname).toBe('/projects/chat/Pessoal%2Fx%3A%3Aclaude%3A%3Aother1')
    await waitFor(() =>
      expect(document.querySelector('[data-session-key]').getAttribute('data-session-key')).toBe('Pessoal/x::claude::other1'),
    )
  })
  it('opens exactly one conversation socket for the chat route', () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toContain('/ws/chat/Pessoal/tn-sandbox%3A%3Aclaude%3A%3Ak3x9q2')
  })

  it('opens no socket outside the chat route', async () => {
    startAt('/projects')
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('switching to Tarefas and back to the same chat keeps the SAME socket (one WebSocket, never closed)', async () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    expect(FakeWebSocket.instances).toHaveLength(1)
    const first = FakeWebSocket.instances[0]

    fireEvent.click(screen.getByRole('button', { name: 'Tarefas' }))
    expect(window.location.pathname).toBe('/tasks')
    await waitFor(() => expect(document.querySelector('[data-session-key]')).toBeNull())
    expect(first.readyState).not.toBe(3)

    // Back to the chat by the history (the shell listens to popstate).
    act(() => {
      window.history.pushState({}, '', CHAT_PATH)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(document.querySelector('[data-session-key]')).not.toBeNull())
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(first.readyState).not.toBe(3)
  })

  it('opening another chat closes the previous socket and opens exactly one more', async () => {
    startAt(CHAT_PATH)
    render(<AppV3 initialTheme="light" />)
    const first = FakeWebSocket.instances[0]
    fireEvent.click(screen.getByRole('button', { name: 'Abrir outro chat' }))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    expect(first.readyState).toBe(3)
    expect(FakeWebSocket.instances[1].url).toContain('/ws/chat/Pessoal/x%3A%3Aclaude%3A%3Aother1')
    expect(FakeWebSocket.instances[1].readyState).not.toBe(3)
  })

  it('closes the conversation socket when the shell unmounts', () => {
    startAt(CHAT_PATH)
    const { unmount } = render(<AppV3 initialTheme="light" />)
    const first = FakeWebSocket.instances[0]
    unmount()
    expect(first.readyState).toBe(3)
  })
})
