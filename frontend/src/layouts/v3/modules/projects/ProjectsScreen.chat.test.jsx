import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { buildProjectsLive } from '../../sessions/ProjectsSessionsProvider.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ProjectsScreen from './ProjectsScreen.jsx'

const folder = { id: 1, path: 'D:\\projetos\\Pessoal\\tn-sandbox', is_primary: true, position: 0, exists: true }
const REGISTRY = {
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{ id: 1, key: 'Pessoal/tn-sandbox', name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: true, folders: [folder] }],
  }],
}
const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
]
const CHAT_KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const PTY_KEY = 'Pessoal/tn-sandbox::codex'

function chat(extra = {}) {
  return {
    session_key: CHAT_KEY, project_ref: 'Pessoal/tn-sandbox', agent_id: 'claude', display_name: 'Revisar o deploy',
    status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, push_notified: false, ...extra,
  }
}

let fetchSpy
beforeEach(() => {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({ [PTY_KEY]: { status: 'idle', connected: true, needs_attention: false, display_name: null } })
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({ [PTY_KEY]: { display_name: 'bash', needs_attention: false } })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderScreen({ chats = [chat()], openChat = vi.fn(), provider = true } = {}) {
  const value = { ...INERT_SESSIONS, chats, projectsLive: buildProjectsLive(chats, {}), openChat }
  const tree = (
    <IslandProvider value={() => {}}>
      <ProjectsScreen />
    </IslandProvider>
  )
  render(provider ? <ProjectsSessionsContext.Provider value={value}>{tree}</ProjectsSessionsContext.Provider> : tree)
  await screen.findByRole('region', { name: 'Workspace Pessoal' })
  return { openChat }
}

describe('buildProjectsLive', () => {
  it('no chats: the shared empty constant', () => {
    expect(buildProjectsLive([], {})).toBe(INERT_SESSIONS.projectsLive)
  })

  it('a pending approval is "needs attention" in persisted even when the server flag is off', () => {
    const live = buildProjectsLive([chat({ live_status: 'awaiting_permission', pending_permissions: 1 })], { [CHAT_KEY]: { connected: true } })
    expect(live.persisted[CHAT_KEY]).toEqual({ display_name: 'Revisar o deploy', needs_attention: true, push_notified: false })
    expect(live.active[CHAT_KEY]).toEqual({ status: 'idle', connected: true, needs_attention: true, display_name: 'Revisar o deploy' })
  })

  it('a running chat is running; a stopped one is only saved; only chat keys come out', () => {
    const live = buildProjectsLive([chat({ live_status: 'running' }), chat({ session_key: 'p::claude::dead', live_status: null })], { [PTY_KEY]: { engine: 'pty' } })
    expect(live.active[CHAT_KEY].status).toBe('running')
    expect(Object.keys(live.active)).toEqual([CHAT_KEY])
    expect(Object.keys(live.persisted).sort()).toEqual([CHAT_KEY, 'p::claude::dead'].sort())
  })
})

describe('Projetos with chats', () => {
  it('"Abrir sessão" of the Claude agent calls openChat with the key of the session its card shows', async () => {
    const { openChat } = await renderScreen()
    const card = screen.getByRole('article', { name: /^Claude em/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenCalledWith(CHAT_KEY)
  })

  it('the card opens the session its title comes from: a live one wins over a saved chat', async () => {
    const livePty = 'Pessoal/tn-sandbox::claude'
    api.fetchActiveSessions.mockResolvedValue({ [livePty]: { status: 'idle', connected: true, needs_attention: false, display_name: null } })
    api.fetchPersistedSessions.mockResolvedValue({ [livePty]: { display_name: 'terminal', needs_attention: false } })
    const { openChat } = await renderScreen({ chats: [chat({ live_status: null })] })
    const card = screen.getByRole('article', { name: /^Claude em/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenCalledWith(livePty)
  })

  it('"Abrir sessão" of an agent that is not Claude opens its session too (the terminal view)', async () => {
    const { openChat } = await renderScreen()
    const card = screen.getByRole('article', { name: /^Codex em/ })
    const button = within(card).getByRole('button', { name: 'Abrir sessão' })
    expect(button.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(button)
    expect(openChat).toHaveBeenCalledWith(PTY_KEY)
  })

  it('a chat waiting for approval shows as "Precisa de você" in the card and in the "Esperando você" strip', async () => {
    const { openChat } = await renderScreen({ chats: [chat({ live_status: 'awaiting_permission', pending_permissions: 1 })] })
    const strip = screen.getByRole('region', { name: 'Esperando você' })
    expect(within(strip).getByText(/Claude · /)).toBeTruthy()
    expect(screen.getByRole('article', { name: /^Claude em .*precisa de você/ })).toBeTruthy()
    fireEvent.click(within(strip).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenCalledWith(CHAT_KEY)
  })

  it('with two live chats of one agent, the strip and the card open the one that needs the user', async () => {
    const quiet = 'Pessoal/tn-sandbox::claude::aaaaaa'
    const waiting = 'Pessoal/tn-sandbox::claude::bbbbbb'
    const { openChat } = await renderScreen({
      chats: [
        chat({ session_key: quiet, display_name: 'Quieta' }),
        chat({ session_key: waiting, display_name: 'Esperando', live_status: 'awaiting_permission', pending_permissions: 1 }),
      ],
    })
    const strip = screen.getByRole('region', { name: 'Esperando você' })
    fireEvent.click(within(strip).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenLastCalledWith(waiting)
    const card = screen.getByRole('article', { name: /^Claude em .*precisa de você/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenLastCalledWith(waiting)
  })

  it('a running chat shows as "rodando"', async () => {
    await renderScreen({ chats: [chat({ live_status: 'running' })] })
    expect(screen.getByRole('article', { name: /^Claude em .*rodando/ })).toBeTruthy()
  })

  it('the Sessões tab lists the chat and its title is a link that opens it without reloading', async () => {
    const { openChat } = await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    const link = screen.getByRole('link', { name: 'Revisar o deploy' })
    expect(link.getAttribute('href')).toBe(`/projects/chat/${encodeURIComponent(CHAT_KEY)}`)
    expect(fireEvent.click(link)).toBe(false) // preventDefault: no navigation of the page
    expect(openChat).toHaveBeenCalledWith(CHAT_KEY)
    // the title of a terminal session (not Claude) is a link to the chat route too (the terminal view)
    expect(screen.getByRole('link', { name: 'bash' }).getAttribute('href')).toBe(`/projects/chat/${encodeURIComponent(PTY_KEY)}`)
  })

  it('a modified click on the link is left to the browser (new tab)', async () => {
    const { openChat } = await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    fireEvent.click(screen.getByRole('link', { name: 'Revisar o deploy' }), { ctrlKey: true })
    expect(openChat).not.toHaveBeenCalled()
  })

  it('without a sessions provider the chat is invisible and nothing new is requested', async () => {
    await renderScreen({ provider: false })
    expect(screen.getByRole('article', { name: /^Codex em/ })).toBeTruthy()
    expect(screen.queryByText('Revisar o deploy')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'Abrir sessão' })
    for (const button of buttons) fireEvent.click(button)
  })
})
