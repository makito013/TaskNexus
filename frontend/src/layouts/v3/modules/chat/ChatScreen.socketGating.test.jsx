import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, resetSockets } from './chatTestKit.js'

// The host opens /ws/chat only for a key whose screen shows the chat: a terminal key has no chat reader.
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

class DualSocket extends FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  send(data) {
    if (typeof data === 'string') super.send(data)
  }
}
const chatSockets = () => FakeWebSocket.instances.filter((socket) => socket.url.includes('/ws/chat/'))
const liveChatSockets = () => chatSockets().filter((socket) => socket.readyState !== 3)

const PROJECT = 'Pessoal/tn-sandbox'
const CLAUDE_KEY = `${PROJECT}::claude::k3x9q2`
const CODEX_KEY = `${PROJECT}::codex::ab12cd`
const SHELL_KEY = `${PROJECT}::shell::zz99yy`
const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
  { id: 'shell', nome: 'Terminal', ia: 'shell' },
]
const row = (extra = {}) => ({
  session_key: CLAUDE_KEY, project_ref: PROJECT, agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000, ...extra,
})
const registry = {
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{
      id: 1, key: PROJECT, name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: false,
      folders: [{ id: 1, path: 'D:\\p\\tn-sandbox', is_primary: true, position: 0, exists: true }],
    }],
  }],
}

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', DualSocket)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(registry)
  vi.spyOn(chatApi, 'fetchSessionCommands').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchModels').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ agent_id: 'claude', allowlist: [], known: [], probed_at: 1 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderHost({ key, chats = [] }) {
  const value = {
    ...INERT_SESSIONS, chats, liveByKey: {}, graceKeys: [], loaded: true, liveAvailable: true,
    goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn(),
  }
  const tree = (activeKey, withScreen = true) => (
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ChatSessionHost activeKey={activeKey}>
          {withScreen && activeKey ? <ChatScreen sessionKey={activeKey} /> : null}
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>
  )
  const view = render(tree(key))
  await act(async () => {})
  return { leaveChatRoute: () => view.rerender(tree(null, false)) }
}

describe('the chat socket follows the vision of the key', () => {
  it('opens no /ws/chat for a codex key', async () => {
    await renderHost({ key: CODEX_KEY })
    expect(chatSockets()).toHaveLength(0)
  })

  it('opens no /ws/chat for the plain terminal key', async () => {
    await renderHost({ key: SHELL_KEY })
    expect(chatSockets()).toHaveLength(0)
  })

  it('opens exactly one /ws/chat for a Claude chat', async () => {
    await renderHost({ key: CLAUDE_KEY, chats: [row()] })
    expect(liveChatSockets()).toHaveLength(1)
  })

  it('closes the reader after chat -> terminal and builds none while the terminal is shown', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'pty', history: null })
    await renderHost({ key: CLAUDE_KEY, chats: [row()] })
    const reader = liveChatSockets()[0]
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no terminal' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(screen.getByRole('group', { name: 'Terminal de Claude' })).toBeTruthy()
    expect(reader.readyState).toBe(3)
    expect(liveChatSockets()).toHaveLength(0)
  })

  it('does not give a terminal key a reader when the chat route is left and the key is held', async () => {
    const { leaveChatRoute } = await renderHost({ key: CODEX_KEY })
    leaveChatRoute()
    await act(async () => {})
    expect(chatSockets()).toHaveLength(0)
  })

  it('keeps the reader of a chat key alive when the chat route is left (CA38)', async () => {
    const { leaveChatRoute } = await renderHost({ key: CLAUDE_KEY, chats: [row()] })
    leaveChatRoute()
    await act(async () => {})
    expect(liveChatSockets()).toHaveLength(1)
  })
})
