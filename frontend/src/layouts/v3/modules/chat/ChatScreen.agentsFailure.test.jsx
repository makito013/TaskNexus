import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { ChatApiError, chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen, { visionOf } from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, resetSockets } from './chatTestKit.js'

// C6 review B1: a failed GET /api/agents (or a sessions poll that has not answered) is never read as "no agent":
// a key with no chat row stays undecided, never opens /ws/chat, and "Tentar de novo" asks for the list again.
vi.mock('shiki', () => ({ codeToTokens: vi.fn(async () => ({ tokens: [] })) }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = { ...options }
      this.cols = 80
      this.rows = 24
      this.textarea = document.createElement('textarea')
      this.write = vi.fn()
      this.dispose = vi.fn()
      this.focus = vi.fn()
    }
    loadAddon() {}
    open(element) { if (element) element.appendChild(this.textarea) }
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
    attachCustomKeyEventHandler() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
installDialogElementStub()

// One double for both motors, told apart by URL. The `onConstruct` hook of a test sees the world at the moment a
// socket is BUILT (the only moment "never both at once" can be judged: counting at the end proves nothing).
let onConstruct = () => {}
class DualSocket extends FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  constructor(url) {
    onConstruct(url)
    super(url)
  }

  send(data) {
    if (typeof data === 'string') super.send(data)
  }
}
const isPty = (socket) => socket.url.includes('/ws/pty/')
const isChat = (socket) => socket.url.includes('/ws/chat/')
const ptySockets = () => FakeWebSocket.instances.filter(isPty)
const chatSockets = () => FakeWebSocket.instances.filter(isChat)
const alive = (sockets) => sockets.filter((socket) => socket.readyState !== 3)

const PROJECT = 'Pessoal/tn-sandbox'
const CLAUDE_KEY = `${PROJECT}::claude::k3x9q2`
const CODEX_KEY = `${PROJECT}::codex::ab12cd`
const TERMINAL_KEY = `${PROJECT}::terminal::t1x2y3`
const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
  { id: 'terminal', nome: 'Terminal', ia: 'terminal' },
]

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', DualSocket)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'fetchAgents').mockRejectedValue(new Error('network down'))
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue({ seeded: null, workspaces: [] })
  vi.spyOn(chatApi, 'fetchSessionCommands').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchModels').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ agent_id: 'claude', allowlist: [], known: [], probed_at: 1 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen({ key, chats = [], liveByKey = {}, loaded = true }) {
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const tree = (isLoaded) => (
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, chats, liveByKey, graceKeys: [], loaded: isLoaded, liveAvailable: true, ...spies }}>
        <ChatSessionHost activeKey={key}>
          <ChatScreen sessionKey={key} />
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>
  )
  const view = render(tree(loaded))
  await act(async () => {})
  return { setProviderLoaded: (isLoaded) => view.rerender(tree(isLoaded)) }
}
const terminalGroup = (agent) => screen.queryByRole('group', { name: `Terminal de ${agent}` })
const retryButton = () => screen.getByRole('button', { name: 'Tentar de novo' })

describe('visionOf with an unreliable input', () => {
  const codex = { id: 'codex', ia: 'codex' }
  it('a failed list with no chat row is pending, whatever the poll says', () => {
    expect(visionOf({ override: null, meta: null, agent: null, agentsLoaded: false, providerLoaded: true })).toBe('pending')
  })
  it('a chat row still decides at once, with or without the list', () => {
    expect(visionOf({ override: null, meta: { engine: 'chat' }, agent: null, agentsLoaded: false })).toBe('chat')
    expect(visionOf({ override: null, meta: { engine: 'pty' }, agent: null, agentsLoaded: false })).toBe('terminal')
  })
  it('with no chat row the chat needs the list AND the first poll', () => {
    expect(visionOf({ override: null, meta: null, agent: null, agentsLoaded: true, providerLoaded: false })).toBe('pending')
    expect(visionOf({ override: null, meta: null, agent: null, agentsLoaded: true, providerLoaded: true })).toBe('chat')
  })
  it('a switch answer beats a failed list; a loaded non-Claude agent is the terminal', () => {
    expect(visionOf({ override: 'terminal', meta: null, agent: null, agentsLoaded: false })).toBe('terminal')
    expect(visionOf({ override: null, meta: null, agent: codex, agentsLoaded: true, providerLoaded: false })).toBe('terminal')
  })
})

describe.each([
  ['codex with a live PTY', { key: CODEX_KEY, liveByKey: { [CODEX_KEY]: { engine: 'pty' } } }, 'Codex'],
  ['a codex key just created by "Novo chat"', { key: CODEX_KEY }, 'Codex'],
  ['the plain terminal agent', { key: TERMINAL_KEY }, 'Terminal'],
])('the agent list fails: %s', (_label, options, agentName) => {
  it('opens no /ws/chat, offers no R-AV dialog, never says "not found"; "Tentar de novo" asks again and opens the terminal', async () => {
    api.fetchPersistedSessions.mockResolvedValue({ [options.key]: {} })
    await renderScreen(options)
    await act(async () => {})

    expect(chatSockets()).toHaveLength(0)
    expect(ptySockets()).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Não encontramos esta conversa.')).toBeNull()
    expect(screen.queryByText('Esta conversa está no terminal.')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('lista de agentes')
    expect(terminalGroup(agentName)).toBeNull()

    api.fetchAgents.mockResolvedValue(AGENTS)
    fireEvent.click(retryButton())
    await act(async () => {})

    expect(api.fetchAgents).toHaveBeenCalledTimes(2)
    expect(terminalGroup(agentName)).toBeTruthy()
    expect(ptySockets().map((socket) => socket.url)).toEqual([`ws://${window.location.host}/ws/pty/${options.key}`])
    expect(chatSockets()).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('while the new request is out the error is gone (the opening skeleton shows) and no motor is chosen', async () => {
    await renderScreen(options)
    await act(async () => {})
    api.fetchAgents.mockReturnValue(new Promise(() => {}))
    fireEvent.click(retryButton())
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
    expect(chatSockets()).toHaveLength(0)
    expect(ptySockets()).toHaveLength(0)
  })

  it('a second failure keeps the same state and the retry keeps working', async () => {
    await renderScreen(options)
    await act(async () => {})
    fireEvent.click(retryButton())
    await act(async () => {})
    expect(api.fetchAgents).toHaveBeenCalledTimes(2)
    expect(retryButton()).toBeTruthy()
    expect(chatSockets()).toHaveLength(0)
    expect(ptySockets()).toHaveLength(0)
  })
})

describe('the sessions provider has not answered yet', () => {
  it('a Claude key with no chat row waits for the poll (no /ws/chat), then takes the chat path', async () => {
    api.fetchAgents.mockResolvedValue(AGENTS)
    const { setProviderLoaded } = await renderScreen({ key: CLAUDE_KEY, loaded: false })
    await act(async () => {})
    expect(chatSockets()).toHaveLength(0)
    expect(ptySockets()).toHaveLength(0)
    expect(screen.queryByText('Não encontramos esta conversa.')).toBeNull()

    setProviderLoaded(true)
    await act(async () => {})
    expect(chatSockets()).toHaveLength(1)
  })

  it('a non-Claude key is the terminal at once, without waiting for the poll', async () => {
    api.fetchAgents.mockResolvedValue(AGENTS)
    await renderScreen({ key: CODEX_KEY, loaded: false })
    await act(async () => {})
    expect(terminalGroup('Codex')).toBeTruthy()
    expect(chatSockets()).toHaveLength(0)
  })
})
