import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { useViewerActions } from '../../../../hooks/viewerState.jsx'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import ViewerShell from '../viewer/ViewerShell.jsx'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, resetSockets } from './chatTestKit.js'

// "Ver" of the toast on a phone: the conversation was showing the LIST of chats (view 'list'), and the person is
// taken back to the conversation. A wide screen has no such view, and a plain change of route keeps the view.
vi.mock('shiki', () => ({ codeToTokens: vi.fn(async () => ({ tokens: [] })) }))
installDialogElementStub()

const PROJECT = 'Pessoal/tn-sandbox'
const KEY = `${PROJECT}::claude::k3x9q2`
const OTHER = `${PROJECT}::claude::z9z9z9`
const meta = (key, extra = {}) => ({
  session_key: key, project_ref: PROJECT, agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000, ...extra,
})
const registry = {
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{ id: 1, key: PROJECT, name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: false,
      folders: [{ id: 1, path: 'D:\\p\\tn-sandbox', is_primary: true, position: 0, exists: true }] }],
  }],
}

// Stands for what the live feed does: an agent opens a file in ANOTHER conversation.
function OtherConversationOpens() {
  const actions = useViewerActions()
  return (
    <button
      type="button"
      onClick={() => actions.receiveOpen(OTHER, { item_id: 'i1', session_key: OTHER, path: 'docs/plan.md', title: 'plan.md', kind: 'markdown', opened_by: 'agent', updated_at: 1 }, false, [])}
    >
      Simular abertura
    </button>
  )
}

// The screen reads "phone" from a media query (max-width: 767px), not from innerWidth.
let originalMatchMedia
function stubMatchMedia(width) {
  window.matchMedia = vi.fn((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    return {
      media: query,
      matches: Boolean(max) && width <= Number(max[1]),
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }
  })
}

beforeEach(() => {
  originalMatchMedia = window.matchMedia
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(registry)
  vi.spyOn(chatApi, 'fetchSessionCommands').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchModels').mockResolvedValue([])
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ agent_id: 'claude', allowlist: [], known: [], probed_at: 1 })
})
afterEach(() => {
  cleanup()
  if (originalMatchMedia) window.matchMedia = originalMatchMedia
  else delete window.matchMedia
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen(width) {
  window.innerWidth = width
  stubMatchMedia(width)
  const value = {
    ...INERT_SESSIONS, chats: [meta(KEY), meta(OTHER)], liveByKey: {}, graceKeys: [], loaded: true, liveAvailable: true,
    openChat: vi.fn(), setFocusedKey: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(),
  }
  render(
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ToastHost>
          <ViewerShell activeSessionKey={KEY}>
            <ChatSessionHost activeKey={KEY}>
              <ChatScreen sessionKey={KEY} />
            </ChatSessionHost>
            <OtherConversationOpens />
          </ViewerShell>
        </ToastHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>,
  )
  await act(async () => {})
  return value
}
const viewOfScreen = () => document.querySelector('.v3-chat').getAttribute('data-view')
const seeToast = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Simular abertura' }))
  await act(async () => {})
  return screen.getByRole('button', { name: 'Ver' })
}

describe('ChatScreen and the "Ver" of a toast', () => {
  it('on a phone that was showing the list, "Ver" brings the conversation back', async () => {
    const value = await renderScreen(390)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de chats' }))
    expect(viewOfScreen()).toBe('list')

    fireEvent.click(await seeToast())
    await act(async () => {})

    expect(value.openChat).toHaveBeenCalledWith(OTHER)
    expect(viewOfScreen()).toBe('chat')
  })

  it('on a phone already on the conversation, "Ver" leaves it there', async () => {
    await renderScreen(390)
    expect(viewOfScreen()).toBe('chat')

    fireEvent.click(await seeToast())
    await act(async () => {})

    expect(viewOfScreen()).toBe('chat')
  })

  it('the list stays when the toast merely appears (no click on "Ver")', async () => {
    await renderScreen(390)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de chats' }))

    await seeToast()
    await act(async () => {})

    expect(viewOfScreen()).toBe('list')
  })
})
