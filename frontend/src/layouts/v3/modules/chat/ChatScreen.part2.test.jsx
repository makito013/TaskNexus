import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'

// Part 2 of the screen: question / plan cards, the model card, the "/" menu, the R-AV dialog of a
// conversation that lives in the terminal and the connectors entry points.
vi.mock('shiki', () => ({ codeToTokens: vi.fn(async () => ({ tokens: [] })) }))
installDialogElementStub()

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const f = frames(KEY)
const META = {
  session_key: KEY, project_ref: 'Pessoal/tn-sandbox', agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000,
}
const COMMANDS = [
  { name: 'model', description: 'Trocar o modelo da conversa', argument_hint: '', source: 'builtin', handling: 'ui' },
  { name: 'compact', description: 'Resumir', argument_hint: '', source: 'builtin', handling: 'dispatch' },
]
const MODELS = [
  { value: 'fable', display_name: 'Fable', description: '', enabled: true },
  { value: 'haiku', display_name: 'Haiku', description: '', enabled: true },
]

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'decidePermission').mockResolvedValue({})
  vi.spyOn(chatApi, 'fetchSessionCommands').mockResolvedValue(COMMANDS)
  vi.spyOn(chatApi, 'fetchModels').mockResolvedValue(MODELS)
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ agent_id: 'claude', allowlist: [], known: [{ name: 'Gmail', allowed: false }], probed_at: 1 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen({ chats = [META], liveByKey = {} } = {}) {
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const value = { ...INERT_SESSIONS, chats, liveByKey, graceKeys: [], loaded: true, liveAvailable: true, ...spies }
  render(
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ChatSessionHost activeKey={KEY}>
          <ChatScreen sessionKey={KEY} />
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>,
  )
  await act(async () => {})
  return spies
}
const play = (...events) => act(() => events.forEach((event) => lastSocket().receive(event)))
async function ready(options) {
  const spies = await renderScreen(options)
  act(() => lastSocket().open())
  play(f('replay.complete', null, { last_seq: 0 }))
  return spies
}
const box = () => screen.getByRole('combobox', { name: 'Mensagem para o agente' })
const type = (text) => fireEvent.change(box(), { target: { value: text } })
const sentTypes = () => lastSocket().sent.map((frame) => frame.type)
let seq = 200
const nextSeq = () => (seq += 1)

describe('ChatScreen "/" menu and the model card', () => {
  it('reads the commands only when the menu is first wanted', async () => {
    await ready()
    expect(chatApi.fetchSessionCommands).not.toHaveBeenCalled()
    type('/')
    await act(async () => {})
    expect(chatApi.fetchSessionCommands).toHaveBeenCalledWith(KEY)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('reads them again when the server says the list changed', async () => {
    await ready()
    type('/')
    await act(async () => {})
    play(f('commands.changed', null))
    await act(async () => {})
    expect(chatApi.fetchSessionCommands).toHaveBeenCalledTimes(2)
  })

  it('a menu that failed to load says so and the text can still be sent', async () => {
    chatApi.fetchSessionCommands.mockRejectedValue(new Error('x'))
    await ready()
    type('/')
    await act(async () => {})
    expect(screen.getByText('Não foi possível carregar os comandos. Você ainda pode enviar a mensagem como texto.')).toBeTruthy()
  })

  it('/model opens the model card, sends nothing as a message, and picking a model sends set_model', async () => {
    await ready()
    type('/mod')
    await act(async () => {})
    fireEvent.keyDown(box(), { key: 'Enter' })
    await act(async () => {})
    expect(sentTypes()).not.toContain('send')
    expect(box().value).toBe('')
    expect(screen.getByRole('group', { name: 'Modelo desta conversa' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Fable/ }))
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'set_model', model: 'fable' })
    play(f('model.changed', nextSeq(), { model: 'fable' }))
    expect(screen.getByText('Modelo trocado para Fable. Vale a partir da próxima resposta.')).toBeTruthy()
  })

  it('the model chip of the header opens the same card, and Fechar returns the focus to the composer', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Modelo atual: haiku/ }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('group', { name: 'Modelo desta conversa' })).toBeNull()
    expect(document.activeElement).toBe(box())
  })

  it('Esc closes the "/" menu and does NOT interrupt a running turn; a second Esc does', async () => {
    await ready()
    play(f('message.user', nextSeq(), { client_msg_id: 'c1', text: 'oi', origin: 'ui' }))
    type('/')
    await act(async () => {})
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(sentTypes()).not.toContain('interrupt')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(sentTypes()).toContain('interrupt')
  })
})

describe('ChatScreen question and plan cards', () => {
  const question = () => f('permission.request', nextSeq(), {
    id: 'q1', kind: 'question', tool_name: 'AskUserQuestion', tool_use_id: 't-q', allow_session: false,
    input: { questions: [{ question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Blue', description: '' }, { label: 'Red', description: '' }] }] },
  })

  it('answering a question sends allow with the answers, the card collapses and the focus goes to the composer', async () => {
    await ready()
    play(question())
    expect(screen.getByText('Pergunta pendente')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Blue/ }))
    screen.getByRole('button', { name: 'Responder' }).focus()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Responder' })) })
    expect(chatApi.decidePermission).toHaveBeenCalledWith('q1', { behavior: 'allow', scope: 'once', answers: { 'Qual cor?': 'Blue' } })
    play(f('permission.resolved', nextSeq(), { id: 'q1', status: 'allowed', by: 'rest' }))
    expect(screen.getByText('Você respondeu: Blue')).toBeTruthy()
    expect(document.activeElement).toBe(box())
  })

  it('a plan is approved with "Aprovar plano" and shows as one line afterwards', async () => {
    await ready()
    play(f('permission.request', nextSeq(), { id: 'p1', kind: 'plan', tool_name: 'ExitPlanMode', tool_use_id: 't-p', allow_session: false, input: { plan: 'Passo 1' } }))
    expect(screen.getByText('Plano para aprovar')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Aprovar plano' })) })
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'allow', scope: 'once' })
    play(f('permission.resolved', nextSeq(), { id: 'p1', status: 'allowed', by: 'rest' }))
    expect(screen.getByText('Você aprovou o plano.')).toBeTruthy()
  })
})

describe('ChatScreen conversation of the terminal (R-AV)', () => {
  const refuse = () => act(() => lastSocket().drop(4404))

  it('a key that is in the saved PTY sessions shows the R-AV dialog with the focus on Cancelar', async () => {
    api.fetchPersistedSessions.mockResolvedValue({ [KEY]: { display_name: 'bash', needs_attention: false } })
    await renderScreen({ chats: [] })
    refuse()
    await act(async () => {})
    expect(screen.getByRole('heading', { level: 1, name: 'Esta conversa está no terminal.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('Não encontramos esta conversa.')).toBeNull()
  })

  it('a live PTY of the sessions poll is recognised without asking for the saved ones', async () => {
    await renderScreen({ chats: [], liveByKey: { [KEY]: { engine: 'pty', status: 'idle' } } })
    refuse()
    await act(async () => {})
    expect(api.fetchPersistedSessions).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
  })

  it('Cancelar goes back to Projetos and touches nothing in the backend', async () => {
    api.fetchPersistedSessions.mockResolvedValue({ [KEY]: {} })
    const switchSpy = vi.spyOn(chatApi, 'switchEngine')
    const spies = await renderScreen({ chats: [] })
    refuse()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(spies.goTo).toHaveBeenCalledWith('/projects')
    expect(switchSpy).not.toHaveBeenCalled()
  })

  it('confirming switches the engine, asks for a fresh socket and the conversation opens (4404 -> switch -> replay)', async () => {
    api.fetchPersistedSessions.mockResolvedValue({ [KEY]: {} })
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'chat', history: { imported: 2 } })
    const spies = await renderScreen({ chats: [] })
    refuse()
    await act(async () => {})
    const before = FakeWebSocket.instances.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir no chat' })) })
    expect(chatApi.switchEngine).toHaveBeenCalledWith(KEY, { engine: 'chat', confirm: true })
    expect(spies.registerCreated).toHaveBeenCalledWith(KEY)
    expect(spies.refresh).toHaveBeenCalled()
    expect(FakeWebSocket.instances.length).toBe(before + 1)
    act(() => lastSocket().open())
    play(f('history.imported', nextSeq(), { count: 2 }), f('replay.complete', null, { last_seq: 0 }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeNull())
    expect(box().getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByText('Esta conversa está no terminal.')).toBeNull()
  })

  it('a key that is nowhere is "not found", with no R-AV dialog (L12)', async () => {
    await renderScreen({ chats: [] })
    refuse()
    await act(async () => {})
    expect(screen.getByRole('heading', { level: 1, name: 'Não encontramos esta conversa.' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeNull()
  })

  it('the R-AV never shows for a conversation that is a chat', async () => {
    await ready()
    expect(screen.queryByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeNull()
    expect(api.fetchPersistedSessions).not.toHaveBeenCalled()
  })

  it('if the saved sessions cannot be read the screen falls back to "not found"', async () => {
    api.fetchPersistedSessions.mockRejectedValue(new Error('down'))
    await renderScreen({ chats: [] })
    refuse()
    await act(async () => {})
    expect(screen.getByText('Não encontramos esta conversa.')).toBeTruthy()
  })
})

describe('ChatScreen connectors entry points', () => {
  it('the "⋯" menu opens the connectors dialog of the agent and the focus goes back to the menu button', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conectores do agente…' }))
    await act(async () => {})
    expect(chatApi.fetchConnectors).toHaveBeenCalledWith('claude')
    expect(screen.getByRole('heading', { name: 'Conectores no chat — Claude' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar' }).at(-1))
    expect(screen.queryByRole('heading', { name: 'Conectores no chat — Claude' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mais ações do chat' }))
  })

  it('the "connector exposed" banner offers "Conectores no chat", which opens the same dialog', async () => {
    await ready()
    play(f('status', nextSeq(), { code: 'spawn_failed', reason: 'connector_exposed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conectores no chat' }))
    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'Conectores no chat — Claude' })).toBeTruthy()
  })
})
