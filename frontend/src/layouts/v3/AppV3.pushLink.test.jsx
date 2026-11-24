import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { api } from '../../services/api.js'
import { chatApi } from '../../services/chatApi.js'
import { workspacesApi } from '../../services/workspacesApi.js'
import AppV3 from './AppV3.jsx'
import { pushSessionKey } from './modules.js'

class FakeWebSocket {
  constructor() {
    this.readyState = 0
  }

  send() {}

  close() {
    this.readyState = 3
  }
}

const CHAT_KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const PTY_KEY = 'Pessoal/tn-sandbox::codex'

function startAt(url) {
  window.history.replaceState({}, '', url)
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchNotificationSettings').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue({ seeded: null, workspaces: [] })
  vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'listSessions').mockResolvedValue([{ session_key: CHAT_KEY }])
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  startAt('/')
})

describe('pushSessionKey', () => {
  it('reads the key only from the root path', () => {
    expect(pushSessionKey('/', `?session=${encodeURIComponent(CHAT_KEY)}`)).toBe(CHAT_KEY)
    expect(pushSessionKey('/tasks', `?session=${encodeURIComponent(CHAT_KEY)}`)).toBeNull()
    expect(pushSessionKey('/', '')).toBeNull()
    expect(pushSessionKey('/', '?session=')).toBeNull()
  })
})

describe('AppV3 push link (CA49)', () => {
  it('/?session=<chat key> goes to the conversation by replace', async () => {
    startAt(`/?session=${encodeURIComponent(CHAT_KEY)}`)
    const push = vi.spyOn(window.history, 'pushState')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(window.location.pathname).toBe(`/projects/chat/${encodeURIComponent(CHAT_KEY)}`))
    expect(window.location.search).toBe('')
    expect(push).not.toHaveBeenCalled()
  })

  it('/?session=<unknown key> goes to Projects', async () => {
    startAt(`/?session=${encodeURIComponent(PTY_KEY)}`)
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(window.location.pathname).toBe('/projects'))
    expect(window.location.search).toBe('')
  })

  it('does not fall to the default module before the first poll answered', async () => {
    startAt(`/?session=${encodeURIComponent(CHAT_KEY)}`)
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<AppV3 initialTheme="light" />)
    expect(replace).not.toHaveBeenCalledWith({}, '', '/tasks')
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/projects\/chat\//))
    expect(replace).not.toHaveBeenCalledWith({}, '', '/tasks')
  })

  it('/ without the parameter still goes to /tasks', async () => {
    startAt('/')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(window.location.pathname).toBe('/tasks'))
  })

  it('/?session= (empty) still goes to /tasks', async () => {
    startAt('/?session=')
    render(<AppV3 initialTheme="light" />)
    await waitFor(() => expect(window.location.pathname).toBe('/tasks'))
  })
})
