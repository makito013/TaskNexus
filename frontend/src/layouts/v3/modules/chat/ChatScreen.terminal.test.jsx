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
        <ChatSessionHost activeKey={k}>
          <ChatScreen sessionKey={k} />
        </ChatSessionHost>
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

describe('visionOf', () => {
  const claude = { id: 'claude', ia: 'claude' }
  const codex = { id: 'codex', ia: 'codex' }
  it('an agent that is not Claude is a terminal; a Claude chat is a chat', () => {
    expect(visionOf({ override: null, meta: null, agent: codex, agentsLoaded: true })).toBe('terminal')
    expect(visionOf({ override: null, meta: { engine: 'chat' }, agent: claude, agentsLoaded: true })).toBe('chat')
  })
  it('a Claude chat row that says pty is a terminal', () => {
    expect(visionOf({ override: null, meta: { engine: 'pty' }, agent: claude, agentsLoaded: true })).toBe('terminal')
  })
  it('the answer of a switch beats the poll, in both directions', () => {
    expect(visionOf({ override: 'terminal', meta: { engine: 'chat' }, agent: claude, agentsLoaded: true })).toBe('terminal')
    expect(visionOf({ override: 'chat', meta: { engine: 'pty' }, agent: claude, agentsLoaded: true })).toBe('chat')
  })
  it('a V2 Claude key with no chat row stays on the chat path (the R-AV dialog)', () => {
    expect(visionOf({ override: null, meta: null, agent: claude, agentsLoaded: true })).toBe('chat')
  })
  it('with no chat row and the agents still loading it is pending; a chat row decides at once', () => {
    expect(visionOf({ override: null, meta: null, agent: null, agentsLoaded: false })).toBe('pending')
    expect(visionOf({ override: null, meta: { engine: 'chat' }, agent: null, agentsLoaded: false })).toBe('chat')
  })
  it('an agent that is not in the list (and a list that loaded) falls back to the chat path', () => {
    expect(visionOf({ override: null, meta: null, agent: null, agentsLoaded: true })).toBe('chat')
  })
})

describe('routing by engine and ia (CA46)', () => {
  it('codex opens the terminal view on /ws/pty/<key>: no conversation, no composer', async () => {
    await renderScreen({ key: CODEX_KEY, chats: [] })
    expect(terminalGroup('Codex')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Codex' })).toBeTruthy()
    expect(composer()).toBeNull()
    expect(screen.getByRole('note').textContent).toContain('O Codex roda em terminal')
    expect(ptySockets().map((socket) => socket.url)).toEqual([`ws://${window.location.host}/ws/pty/${CODEX_KEY}`])
  })

  it('a new terminal key never flashes "not found" while the agents load, then becomes the terminal', async () => {
    let release
    api.fetchAgents.mockReturnValue(new Promise((resolve) => { release = resolve }))
    await renderScreen({ key: CODEX_KEY, chats: [] })
    await act(async () => {})
    expect(chatSockets()).toHaveLength(0) // the host asks nothing of the chat while the vision is undecided
    expect(screen.queryByText('Não encontramos esta conversa.')).toBeNull()
    expect(ptySockets()).toHaveLength(0)
    expect(terminalGroup('Codex')).toBeNull()

    await act(async () => { release(AGENTS) })
    expect(terminalGroup('Codex')).toBeTruthy()
    expect(ptySockets()).toHaveLength(1)
  })

  it('a Claude chat stays a chat and never opens a /ws/pty socket', async () => {
    await renderScreen()
    openChatSocket()
    expect(composer()).toBeTruthy()
    expect(terminalGroup('Claude')).toBeNull()
    expect(ptySockets()).toHaveLength(0)
  })

  it('a Claude conversation whose chat row says pty opens the terminal view with the Claude strip', async () => {
    await renderScreen({ chats: [meta({ engine: 'pty', status: 'switched_to_pty' })] })
    expect(terminalGroup('Claude')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Revisar o deploy' })).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('Esta conversa está no terminal. O chat fica fechado enquanto o terminal estiver aberto.')
    expect(composer()).toBeNull()
    expect(ptySockets()).toHaveLength(1)
  })

  it('a conversation of the V2 terminal (no chat row) keeps the C4 path: the R-AV dialog, no terminal mounted', async () => {
    api.fetchPersistedSessions.mockResolvedValue({ [CLAUDE_KEY]: {} })
    await renderScreen({ chats: [] })
    act(() => chatSockets().at(-1).drop(4404))
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
    expect(terminalGroup('Claude')).toBeNull()
    expect(ptySockets()).toHaveLength(0)
  })

  it('the header of a terminal view has no mode chip, no rename and no connectors', async () => {
    await renderScreen({ key: CODEX_KEY, chats: [] })
    expect(document.querySelector('.v3-chat-header__chips').textContent).toBe('CoCodextn-sandbox') // avatar (Co), agent and project only: no mode chip, no model, no state
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Encerrar chat'])
  })

  it('"Sair do terminal" puts the focus on the list (desktop)', async () => {
    await renderScreen({ key: CODEX_KEY, chats: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Sair do terminal' }))
    expect(document.activeElement).toBe(document.querySelector('.v3-chat-list__title'))
  })
})

describe('chat -> terminal ("Abrir no terminal", Designer 8.2)', () => {
  const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir no terminal' }))
  const dialogText = () => document.querySelector('.v3-chat-switch').textContent

  it('the header button opens the dialog: text verbatim, the focus on the primary (it is reversible)', async () => {
    await renderScreen()
    openChatSocket()
    openDialog()
    expect(screen.getByRole('heading', { name: 'Abrir no terminal?' })).toBeTruthy()
    expect(dialogText()).toBe('O chat será fechado e a conversa continua no terminal.')
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abrir no terminal' }))
    expect(within(dialog).getByRole('button', { name: 'Abrir no terminal' }).className).toContain('v3-button--primary')
  })

  it('the same switch is in the "⋯" menu, between "Renomear chat" and "Conectores do agente…"', async () => {
    await renderScreen()
    openChatSocket()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Renomear chat', 'Abrir no terminal', 'Conectores do agente…', 'Encerrar chat',
    ])
  })

  it('a project with extra folders says they do not come along; one without says nothing about it', async () => {
    workspacesApi.fetchWorkspaces.mockResolvedValue(registry([PRIMARY, EXTRA]))
    await renderScreen()
    openChatSocket()
    openDialog()
    await act(async () => {})
    expect(dialogText()).toBe('O chat será fechado e a conversa continua no terminal. As pastas extras do projeto não acompanham o terminal.')
    cleanup()

    workspacesApi.fetchWorkspaces.mockResolvedValue(registry([PRIMARY]))
    resetSockets()
    await renderScreen()
    openChatSocket()
    openDialog()
    await act(async () => {})
    expect(dialogText()).not.toContain('pastas extras')
  })

  it('a running turn adds the sentence about the interruption', async () => {
    await renderScreen()
    openChatSocket()
    const f = frames(CLAUDE_KEY)
    act(() => chatSockets().at(-1).receive(f('message.user', 5, { client_msg_id: 'c1', text: 'oi', origin: 'ui' })))
    openDialog()
    expect(dialogText()).toBe('O chat será fechado e a conversa continua no terminal. O turno em andamento será interrompido.')
  })

  it('confirming switches to pty and ONLY THEN mounts the terminal: until the answer the conversation stays and no /ws/pty exists', async () => {
    let answer
    vi.spyOn(chatApi, 'switchEngine').mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const composersAtPtyConstruction = []
    await renderScreen()
    openChatSocket()
    onConstruct = (url) => {
      if (url.includes('/ws/pty/')) composersAtPtyConstruction.push(Boolean(composer()))
    }
    openDialog()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' }))
    expect(chatApi.switchEngine).toHaveBeenCalledWith(CLAUDE_KEY, { engine: 'pty' })
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrindo…' }).getAttribute('aria-busy')).toBe('true')
    expect(ptySockets()).toHaveLength(0)
    expect(composer()).toBeTruthy()

    await act(async () => { answer({ engine: 'pty', history: null }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(composer()).toBeNull() // the conversation view is gone...
    expect(terminalGroup('Claude')).toBeTruthy() // ...and the terminal is the only view
    expect(ptySockets()).toHaveLength(1)
    expect(composersAtPtyConstruction).toEqual([false]) // at the moment the PTY socket was built, no chat view was mounted
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('a refused switch keeps the chat, says so and never opens a PTY socket', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockRejectedValue(new ChatApiError({ status: 503, code: 'engine_unavailable', message: 'x' }))
    await renderScreen()
    openChatSocket()
    openDialog()
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('Não foi possível abrir no terminal. A conversa continua no chat.')
    expect(composer()).toBeTruthy()
    expect(ptySockets()).toHaveLength(0)
    // and it can be tried again
    chatApi.switchEngine.mockResolvedValue({ engine: 'pty', history: null })
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(terminalGroup('Claude')).toBeTruthy()
  })

  it('"already in the terminal" (engine_conflict) counts as success', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockRejectedValue(new ChatApiError({ status: 409, code: 'engine_conflict', message: 'not a chat' }))
    await renderScreen()
    openChatSocket()
    openDialog()
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(terminalGroup('Claude')).toBeTruthy()
  })

  it('Cancelar touches nothing', async () => {
    const spy = vi.spyOn(chatApi, 'switchEngine')
    await renderScreen()
    openChatSocket()
    openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(composer()).toBeTruthy()
  })

  it('engine_unavailable and resume_failed offer "Abrir no terminal" in the banner; spawn_failed does not', async () => {
    await renderScreen()
    openChatSocket()
    const f = frames(CLAUDE_KEY)
    act(() => chatSockets().at(-1).receive(f('status', 1, { code: 'engine_unavailable', detail: 'sdk missing' })))
    const banner = screen.getByRole('alert')
    fireEvent.click(within(banner).getByRole('button', { name: 'Abrir no terminal' }))
    expect(screen.getByRole('heading', { name: 'Abrir no terminal?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    act(() => chatSockets().at(-1).receive(f('status', 2, { code: 'resume_failed', detail: 'x' })))
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Abrir no terminal' })).toBeTruthy()
    act(() => chatSockets().at(-1).receive(f('status', 3, { code: 'spawn_failed', reason: 'cli_not_found', detail: 'x' })))
    expect(screen.queryByRole('button', { name: /Abrir no terminal/ })).toBeNull()
  })
})

describe('terminal -> chat ("Abrir no chat", the R-AV)', () => {
  const chatInTerminal = () => [meta({ engine: 'pty', status: 'switched_to_pty' })]

  it('"Abrir no chat" of the strip opens the R-AV with the focus on Cancelar and no PTY socket is touched by it', async () => {
    await renderScreen({ chats: chatInTerminal() })
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'Abrir no chat' }))
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    expect(terminalGroup('Claude')).toBeTruthy()
  })

  it('the terminal is unmounted (its socket closed) BEFORE a chat socket is built, and the chat comes back', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'chat', history: { imported: 3 } })
    await renderScreen({ chats: chatInTerminal() })
    expect(chatSockets()).toHaveLength(0) // a terminal key has no chat reader
    const livePtyAtChatConstruction = []
    onConstruct = (url) => {
      if (url.includes('/ws/chat/')) livePtyAtChatConstruction.push(alive(ptySockets()).length)
    }
    const pty = ptySockets()[0]
    const chatsBefore = chatSockets().length

    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'Abrir no chat' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no chat' })) })
    expect(chatApi.switchEngine).toHaveBeenCalledWith(CLAUDE_KEY, { engine: 'chat', confirm: true })
    expect(terminalGroup('Claude')).toBeNull()
    expect(pty.closeCalls).toBeGreaterThan(0)
    expect(chatSockets().length).toBe(chatsBefore + 1)
    expect(livePtyAtChatConstruction).toEqual([0])
    expect(ptySockets()).toHaveLength(1) // no second PTY socket either
  })

  it('a failed R-AV keeps the terminal', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockRejectedValue(new ChatApiError({ status: 500, code: 'x', message: 'x' }))
    await renderScreen({ chats: chatInTerminal() })
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'Abrir no chat' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no chat' })) })
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('Não foi possível abrir no chat. A conversa continua onde estava.')
    expect(terminalGroup('Claude')).toBeTruthy()
  })
})

describe('the list of chats offers the switch of each row', () => {
  const OTHER = `${PROJECT}::claude::other1`

  it('a chat row offers "Abrir no terminal", a row in the terminal offers "Abrir no chat"', async () => {
    await renderScreen({ chats: [meta(), meta({ session_key: OTHER, display_name: 'Outro', engine: 'pty' })] })
    openChatSocket()
    fireEvent.click(screen.getByRole('button', { name: 'Ações do chat Revisar o deploy' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Abrir', 'Renomear', 'Abrir no terminal', 'Encerrar'])
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Ações do chat Outro' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Abrir', 'Renomear', 'Abrir no chat', 'Encerrar'])
  })

  it('"Abrir no terminal" on ANOTHER row switches THAT key and then opens it', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'pty', history: null })
    const { openChat } = await renderScreen({ chats: [meta(), meta({ session_key: OTHER, display_name: 'Outro' })] })
    openChatSocket()
    fireEvent.click(screen.getByRole('button', { name: 'Ações do chat Outro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir no terminal' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir no terminal' })) })
    expect(chatApi.switchEngine).toHaveBeenCalledWith(OTHER, { engine: 'pty' })
    expect(openChat).toHaveBeenCalledWith(OTHER)
    // the open conversation is untouched
    expect(composer()).toBeTruthy()
    expect(ptySockets()).toHaveLength(0)
  })
})
