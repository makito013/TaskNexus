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

// C6 review (L3): the engine of a key follows the switch answer, then the poll; never two motors at once, judged
// on the SOCKETS at the moment the second one is built; the phone way out; the header menu item.
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

// jsdom has no Font Loading API; Chrome does, and the terminal surface is mounted only after the fonts are ready.
// The order "chat closed before the PTY is built" is only meaningful with the gate Chrome has, so it is installed.
let originalFonts
function stubChromeFonts() {
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve(), load: vi.fn(() => Promise.resolve([])) } })
}
let originalMatchMedia
function stubPhone() {
  originalMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query) => ({
    media: query,
    matches: /max-width:\s*767px/.test(query),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))
}

beforeEach(() => {
  resetSockets()
  onConstruct = () => {}
  stubChromeFonts()
  vi.stubGlobal('WebSocket', DualSocket)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
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
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else delete document.fonts
  if (originalMatchMedia !== undefined) {
    window.matchMedia = originalMatchMedia
    originalMatchMedia = undefined
  }
})

async function renderScreen({ key = CLAUDE_KEY, chats = [meta()] } = {}) {
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const tree = (rows) => (
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, chats: rows, liveByKey: {}, graceKeys: [], loaded: true, liveAvailable: true, ...spies }}>
        <ChatSessionHost activeKey={key}>
          <ChatScreen sessionKey={key} />
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>
  )
  const view = render(tree(chats))
  await act(async () => {})
  return { poll: async (rows) => { view.rerender(tree(rows)); await act(async () => {}) } }
}
const composer = () => screen.queryByRole('combobox', { name: 'Mensagem para o agente' })
const terminalGroup = (agent) => screen.queryByRole('group', { name: `Terminal de ${agent}` })

describe('chat -> terminal: never two motors, judged on the sockets', () => {
  it('no /ws/chat is alive at the moment the /ws/pty is built, and the reader is closed afterwards', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'pty', history: null })
    await renderScreen()
    const reader = chatSockets().at(-1)
    expect(alive(chatSockets())).toHaveLength(1)
    const liveChatAtPtyConstruction = []
    onConstruct = (url) => {
      if (url.includes('/ws/pty/')) liveChatAtPtyConstruction.push(alive(chatSockets()).length)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no terminal' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    await act(async () => {})
    expect(terminalGroup('Claude')).toBeTruthy()
    expect(ptySockets()).toHaveLength(1)
    expect(liveChatAtPtyConstruction).toEqual([0])
    expect(reader.readyState).toBe(3)
  })
})

describe('the answer of a switch is dropped once the poll agrees, so a later change of engine is followed', () => {
  it('chat -> terminal (switch) -> poll says pty -> poll says chat again: the view is the chat', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'pty', history: null })
    const { poll } = await renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no terminal' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(terminalGroup('Claude')).toBeTruthy()

    await poll([meta({ engine: 'pty', status: 'switched_to_pty' })]) // the poll caught up: the override is released
    expect(terminalGroup('Claude')).toBeTruthy()

    await poll([meta({ engine: 'chat' })]) // another tab took the conversation back to the chat
    expect(terminalGroup('Claude')).toBeNull()
    expect(composer()).toBeTruthy()
  })
})

describe('"Sair do terminal" on a phone', () => {
  it('shows the list view (the terminal view is left)', async () => {
    stubPhone()
    await renderScreen({ key: CODEX_KEY, chats: [] })
    const screenElement = document.querySelector('section.v3-chat')
    expect(screenElement.getAttribute('data-view')).toBe('chat')
    fireEvent.click(screen.getByRole('button', { name: 'Sair do terminal' }))
    expect(screenElement.getAttribute('data-view')).toBe('list')
  })
})

describe('the header menu of a Claude conversation that lives in the terminal', () => {
  it('"Abrir no chat" opens the R-AV dialog', async () => {
    await renderScreen({ chats: [meta({ engine: 'pty', status: 'switched_to_pty' })] })
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir no chat' }))
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
  })
})
