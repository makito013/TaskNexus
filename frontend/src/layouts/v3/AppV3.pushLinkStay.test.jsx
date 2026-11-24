import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { api } from '../../services/api.js'
import { chatApi } from '../../services/chatApi.js'
import { workspacesApi } from '../../services/workspacesApi.js'
import AppV3 from './AppV3.jsx'

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

beforeEach(() => {
  vi.useFakeTimers()
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
  // A new array on every poll, like the real fetch.
  vi.spyOn(chatApi, 'listSessions').mockImplementation(() => Promise.resolve([{ session_key: CHAT_KEY }]))
  vi.spyOn(chatApi, 'health').mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('AppV3 push link (CA49): the redirect happens once', () => {
  it('after the redirect the user can leave the conversation and the next polls do not pull them back', async () => {
    window.history.replaceState({}, '', `/?session=${encodeURIComponent(CHAT_KEY)}`)
    render(<AppV3 initialTheme="light" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(window.location.pathname).toBe(`/projects/chat/${encodeURIComponent(CHAT_KEY)}`)

    window.history.pushState({}, '', '/tasks')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
    expect(window.location.pathname).toBe('/tasks')
  })
})
