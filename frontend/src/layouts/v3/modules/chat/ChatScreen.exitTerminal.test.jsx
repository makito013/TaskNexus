import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { ChatApiError, chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen, { visionOf } from './ChatScreen.jsx'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import ViewerShell from '../viewer/ViewerShell.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, resetSockets } from './chatTestKit.js'

// C6: the screen picks ONE view per key (the conversation or the terminal), and a switch never has both mounted.
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
const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
]
const meta = (extra = {}) => ({
  session_key: CLAUDE_KEY, project_ref: PROJECT, agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000, ...extra,
})
const registry = (folders) => ({
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{ id: 1, key: PROJECT, name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: false, folders }],
  }],
})
const PRIMARY = { id: 1, path: 'D:\\p\\tn-sandbox', is_primary: true, position: 0, exists: true }
const EXTRA = { id: 2, path: 'D:\\p\\docs', is_primary: false, position: 1, exists: true }

beforeEach(() => {
  resetSockets()
  onConstruct = () => {}
  vi.stubGlobal('WebSocket', DualSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(registry([PRIMARY]))
  vi.spyOn(chatApi, 'fetchSessionCommands').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchModels').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ agent_id: 'claude', allowlist: [], known: [], probed_at: 1 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen({ key = CLAUDE_KEY, chats = [meta()], liveByKey = {} } = {}) {
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const value = { ...INERT_SESSIONS, chats, liveByKey, graceKeys: [], loaded: true, liveAvailable: true, ...spies }
  const tree = (k) => (
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ToastHost><ViewerShell activeSessionKey={k}><ChatSessionHost activeKey={k}>
          <ChatScreen sessionKey={k} />
        </ChatSessionHost></ViewerShell></ToastHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>
  )
  const view = render(tree(key))
  await act(async () => {})
  return { ...spies, rerenderKey: (k) => view.rerender(tree(k)) }
}
const openChatSocket = () => {
  const socket = chatSockets().at(-1)
  act(() => socket.open())
  act(() => socket.receive(frames(CLAUDE_KEY)('replay.complete', null, { last_seq: 0 })))
}
const composer = () => screen.queryByRole('combobox', { name: 'Mensagem para o agente' })
const terminalGroup = (agent) => screen.queryByRole('group', { name: `Terminal de ${agent}` })


describe('"Sair do terminal" on a terminal view', () => {
  it('with the list visible (1440, no dock) the focus goes to the list title', async () => {
    window.innerWidth = 1440
    await renderScreen({ key: CODEX_KEY, chats: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Sair do terminal' }))
    expect(document.activeElement).toBe(document.querySelector('.v3-chat-list__title'))
    expect(screen.queryByRole('dialog', { name: 'Conversas' })).toBeNull()
  })

  it('with the list folded by the dock (1280) it opens the "Conversas" dialog and moves the focus into it', async () => {
    window.innerWidth = 1280
    await renderScreen({ key: CODEX_KEY, chats: [] })
    fireEvent.click(screen.getByRole('button', { name: /^Visualizador de arquivos/ }))
    await act(async () => {})
    expect(document.querySelector('.v3-chat').hasAttribute('data-list-collapsed')).toBe(true)
    expect(document.querySelector('.v3-chat-list__title')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Conversas' })).toBeNull()
    const exit = screen.getByRole('button', { name: 'Sair do terminal' })
    exit.focus()
    fireEvent.click(exit)
    await act(async () => {})
    const dialog = screen.getByRole('dialog', { name: 'Conversas' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
