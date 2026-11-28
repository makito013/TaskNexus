// The chat screen with the file viewer: the header button, the dock beside the conversation, the list of
// conversations folding into a dialog when the dock leaves no room, and the Esc that must not interrupt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ViewerShell from '../viewer/ViewerShell.jsx'
import { Probe, probe } from '../viewer/viewerTestKit.jsx'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'

installDialogElementStub()

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const OTHER = 'Pessoal/tn-sandbox::claude::zz9999'
const f = frames(KEY)
const META = {
  session_key: KEY, project_ref: 'Pessoal/tn-sandbox', agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat',
  origin: 'v3', status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku',
  permission_mode: 'default', last_error: null, updated_at: Date.now() / 1000,
}
const META_OTHER = { ...META, session_key: OTHER, display_name: 'Outro chat' }

beforeEach(() => {
  resetSockets()
  clearViewerContentCache()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })))
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderScreen({ width, withShell = true }) {
  window.innerWidth = width
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const sessions = { ...INERT_SESSIONS, chats: [META, META_OTHER], graceKeys: [], loaded: true, liveAvailable: true, ...spies }
  const screenTree = (
    <ChatSessionHost activeKey={KEY}>
      <ChatScreen sessionKey={KEY} />
    </ChatSessionHost>
  )
  const view = render(
    <IslandProvider value={() => {}}>
      <ToastHost>
        <ProjectsSessionsContext.Provider value={sessions}>
          {withShell ? <ViewerShell activeSessionKey={KEY}><Probe />{screenTree}</ViewerShell> : screenTree}
        </ProjectsSessionsContext.Provider>
      </ToastHost>
    </IslandProvider>,
  )
  await act(async () => {})
  act(() => lastSocket().open())
  act(() => lastSocket().receive(f('replay.complete', null, { last_seq: 0 })))
  return { ...view, ...spies }
}

const header = () => document.querySelector('.v3-chat-header')
const section = () => document.querySelector('.v3-chat')
const viewerButton = () => within(header()).getByRole('button', { name: /^Visualizador de arquivos/ })

describe('the chat screen with the viewer', () => {
  it('shows the "Visualizador" button in the header, and none without the viewer shell', async () => {
    await renderScreen({ width: 1440 })
    expect(viewerButton()).toBeTruthy()
    cleanup()
    resetSockets()
    await renderScreen({ width: 1440, withShell: false })
    expect(within(header()).queryByRole('button', { name: /^Visualizador de arquivos/ })).toBeNull()
  })

  it('the floating "Arquivos" is for the phone only', async () => {
    await renderScreen({ width: 1440 })
    expect(screen.queryByRole('button', { name: /^Arquivos/ })).toBeNull()
    expect(document.querySelector('.v3-viewer-floating')).toBeNull()
  })

  it('the button opens the dock beside the conversation without touching the socket', async () => {
    await renderScreen({ width: 1440 })
    const sockets = FakeWebSocket.instances.length
    fireEvent.click(viewerButton())
    expect(section().hasAttribute('data-viewer-dock')).toBe(true)
    expect(section().hasAttribute('data-list-collapsed')).toBe(false)
    expect(screen.getByRole('navigation', { name: 'Chats do projeto' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Visualizador de arquivos' })).toBeTruthy()
    expect(FakeWebSocket.instances.length).toBe(sockets)
    // The dock is a sibling of the panel: nothing of the viewer lives inside `.v3-chat-panel`.
    expect(document.querySelector('.v3-chat-panel').querySelector('[data-testid="viewer-dock"]')).toBeNull()
    fireEvent.click(viewerButton())
    expect(section().hasAttribute('data-viewer-dock')).toBe(false)
  })

  it('at 1280 the list folds into a "Conversas" dialog: one list at a time, and a choice closes the dialog', async () => {
    const view = await renderScreen({ width: 1280 })
    fireEvent.click(viewerButton())
    expect(section().hasAttribute('data-list-collapsed')).toBe(true)
    expect(document.querySelectorAll('.v3-chat-list')).toHaveLength(0)
    const open = within(header()).getByRole('button', { name: 'Conversas' })
    fireEvent.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'Conversas' })
    expect(document.querySelectorAll('.v3-chat-list')).toHaveLength(1)
    fireEvent.click(within(within(dialog).getByRole('navigation', { name: 'Chats do projeto' })).getByRole('link', { name: /Outro chat/ }))
    expect(view.openChat).toHaveBeenCalledWith(OTHER)
    expect(screen.queryByRole('dialog', { name: 'Conversas' })).toBeNull()
    expect(document.querySelectorAll('.v3-chat-list')).toHaveLength(0)
    // Closing the viewer brings the list back to the grid and the button away.
    fireEvent.click(viewerButton())
    expect(document.querySelectorAll('.v3-chat-list')).toHaveLength(1)
    expect(within(header()).queryByRole('button', { name: 'Conversas' })).toBeNull()
  })

  it('from 1300 the list stays beside the dock and there is no "Conversas" button', async () => {
    await renderScreen({ width: 1300 })
    fireEvent.click(viewerButton())
    expect(section().hasAttribute('data-list-collapsed')).toBe(false)
    expect(within(header()).queryByRole('button', { name: 'Conversas' })).toBeNull()
  })

  it('below 1280 the viewer is a drawer, and Esc inside it does not interrupt a running turn', async () => {
    await renderScreen({ width: 1100 })
    act(() => lastSocket().receive(f('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' })))
    const interrupts = () => lastSocket().sent.filter((frame) => frame.type === 'interrupt')
    fireEvent.click(viewerButton())
    const region = await screen.findByRole('complementary', { name: 'Visualizador de arquivos' })
    fireEvent.keyDown(region, { key: 'Escape' })
    expect(interrupts()).toHaveLength(0)
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    // Positive control: the same key in the composer DOES interrupt the running turn.
    fireEvent.keyDown(document.querySelector('.v3-chat-composer__input'), { key: 'Escape' })
    expect(interrupts()).toHaveLength(1)
  })

  it('on a phone the floating "Arquivos" opens the viewer in full screen', async () => {
    const original = window.matchMedia
    window.matchMedia = (query) => ({ media: query, matches: /max-width:\s*767px/.test(query), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      await renderScreen({ width: 390 })
      fireEvent.click(screen.getByRole('button', { name: /^Arquivos/ }))
      expect(document.querySelector('dialog.v3-viewer-fullscreen[open]')).not.toBeNull()
      expect(document.querySelector('.v3-chat-panel').querySelector('.v3-viewer-floating')).not.toBeNull()
    } finally {
      if (original) window.matchMedia = original
      else delete window.matchMedia
    }
  })

  it('the viewer opens a file by itself only while the conversation is on screen (the list view of a phone is not)', async () => {
    const original = window.matchMedia
    window.matchMedia = (query) => ({ media: query, matches: /max-width:\s*767px/.test(query), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      await renderScreen({ width: 390 })
      fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de chats' }))
      act(() => probe.actions.receiveOpen(KEY, { item_id: 'z', path: 'a.md', title: 'a.md', kind: 'markdown', updated_at: 1 }))
      expect(probe.viewer.getSurface('chat').open).toBe(false)
      expect(probe.viewer.unseen[`session:${KEY}`]).toBe(1)
    } finally {
      if (original) window.matchMedia = original
      else delete window.matchMedia
    }
  })
})
