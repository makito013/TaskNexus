import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import ViewerShell from '../viewer/ViewerShell.jsx'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'

// The whole chat screen with the viewer shell: a path in the agent's text, in a tool chip and in the plan of an
// approval card. What is checked is the request that goes out, to the conversation of THIS screen.
vi.mock('shiki', () => ({ codeToTokens: vi.fn(async () => ({ tokens: [] })) }))
installDialogElementStub()

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const f = frames(KEY)
const META = {
  session_key: KEY, project_ref: 'Pessoal/tn-sandbox', agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000,
}
let postBodies

beforeEach(() => {
  resetSockets()
  postBodies = []
  window.innerWidth = 1440
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      postBodies.push({ url: String(url), body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ success: true, item: { item_id: 'n1', session_key: KEY, path: 'src/app.py', kind: 'text' }, reused: false, evicted: [], delivered: false }) }
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) }
  }))
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
  vi.spyOn(chatApi, 'decidePermission').mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen({ withShell = true } = {}) {
  const value = { ...INERT_SESSIONS, chats: [META], graceKeys: [], loaded: true, liveAvailable: true, openChat: vi.fn(), setFocusedKey: vi.fn(), refresh: vi.fn() }
  const screenTree = (
    <ChatSessionHost activeKey={KEY}>
      <ChatScreen sessionKey={KEY} />
    </ChatSessionHost>
  )
  render(
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ToastHost>{withShell ? <ViewerShell activeSessionKey={KEY}>{screenTree}</ViewerShell> : screenTree}</ToastHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>,
  )
  await act(async () => {})
  act(() => lastSocket().open())
  act(() => lastSocket().receive(f('replay.complete', null, { last_seq: 0 })))
}
const play = (...events) => act(() => events.forEach((event) => lastSocket().receive(event)))
const assistant = (seq, messageId, blocks) => f('message.assistant', seq, { message_id: messageId, blocks })
const userTurn = f('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' })
const pathButtons = () => screen.queryAllByRole('button', { name: /no visualizador/ })

describe('ChatScreen: file links in the thread', () => {
  it('a path in the agent text opens in the viewer of THIS conversation, at the line', async () => {
    await renderScreen()
    play(userTurn, assistant(2, 'm1', [{ type: 'text', text: 'Corrigi o erro em src/app.py:42 e atualizei `docs/plano.md`.' }]))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir src/app.py:42 no visualizador' }))

    await waitFor(() => expect(postBodies).toHaveLength(1))
    expect(postBodies[0]).toEqual({ url: `/api/sessions/${KEY}/viewer`, body: { caminho: 'src/app.py', linha: 42 } })
  })

  it('a Read chip opens its file from the detail, and a Bash chip has no button', async () => {
    await renderScreen()
    play(
      userTurn,
      assistant(2, 'm1', [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/app.py' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cat src/app.py' } },
      ]),
    )

    const buttons = screen.getAllByRole('button', { name: /^Abrir .+ no visualizador$/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('[data-tool-id="t1"]')).not.toBeNull()
    fireEvent.click(buttons[0])

    await waitFor(() => expect(postBodies).toHaveLength(1))
    expect(postBodies[0].body).toEqual({ caminho: 'src/app.py' })
    expect(within(document.querySelector('[data-tool-id="t2"]')).queryByRole('button', { name: /^Abrir .+ no visualizador$/ })).toBeNull()
  })

  it('the plan of an approval card gets no path buttons, even with the viewer shell on', async () => {
    await renderScreen()
    play(
      userTurn,
      f('permission.request', 101, { id: 'p1', kind: 'plan', tool_name: 'ExitPlanMode', tool_use_id: 'tp1', input: { plan: '1. Editar src/app.py:42' }, allow_session: false, connector: null }),
    )

    expect(screen.getByRole('region', { name: 'Plano proposto' }).textContent).toContain('src/app.py:42')
    expect(pathButtons()).toHaveLength(0)
  })

  it('without the viewer shell the thread is what it was: text, no buttons', async () => {
    await renderScreen({ withShell: false })
    play(
      userTurn,
      assistant(2, 'm1', [
        { type: 'text', text: 'Veja src/app.py:42' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/app.py' } },
      ]),
    )

    expect(pathButtons()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Abrir .+ no visualizador$/ })).toBeNull()
    expect(screen.getByText(/Veja src\/app\.py:42/)).toBeTruthy()
  })
})
