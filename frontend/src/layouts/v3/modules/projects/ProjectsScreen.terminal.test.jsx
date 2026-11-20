import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ProjectsScreen from './ProjectsScreen.jsx'

// C6: every agent that has a session opens it on the chat route; the route picks the view (the conversation for a
// Claude chat, the terminal view for the rest).
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
  { id: 'terminal', nome: 'Terminal', ia: 'terminal' },
]
const CODEX_KEY = 'Pessoal/tn-sandbox::codex'
const SHELL_KEY = 'Pessoal/tn-sandbox::terminal::q1w2e3'
const live = (needs = false) => ({ status: 'idle', connected: true, needs_attention: needs, display_name: null })

beforeEach(() => {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({ [CODEX_KEY]: live(true), [SHELL_KEY]: live() })
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({
    [CODEX_KEY]: { display_name: 'Refatorar', needs_attention: true },
    [SHELL_KEY]: { display_name: 'bash', needs_attention: false },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderScreen() {
  const openChat = vi.fn()
  render(
    <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, openChat }}>
      <IslandProvider value={() => {}}>
        <ProjectsScreen />
      </IslandProvider>
    </ProjectsSessionsContext.Provider>,
  )
  await screen.findByRole('region', { name: 'Workspace Pessoal' })
  return { openChat }
}

describe('Projetos open the terminal view too (C6)', () => {
  it('"Abrir sessão" of the Codex card is enabled and opens its session; it has no "ainda não disponível" note', async () => {
    const { openChat } = await renderScreen()
    const card = screen.getByRole('article', { name: /^Codex em/ })
    const button = within(card).getByRole('button', { name: 'Abrir sessão' })
    expect(button.getAttribute('aria-disabled')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBeNull()
    fireEvent.click(button)
    expect(openChat).toHaveBeenCalledWith(CODEX_KEY)
    expect(within(card).queryByText('Ainda não disponível para este agente')).toBeNull()
  })

  it('the strip "Esperando você" opens the session of a Codex that needs the user', async () => {
    const { openChat } = await renderScreen()
    const strip = screen.getByRole('region', { name: 'Esperando você' })
    fireEvent.click(within(strip).getByRole('button', { name: 'Abrir sessão' }))
    expect(openChat).toHaveBeenCalledWith(CODEX_KEY)
  })

  it('in the Sessões tab the title of a terminal session is a link to the chat route, like a Claude one', async () => {
    const { openChat } = await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    const link = screen.getByRole('link', { name: 'bash' })
    expect(link.getAttribute('href')).toBe(`/projects/chat/${encodeURIComponent(SHELL_KEY)}`)
    expect(fireEvent.click(link)).toBe(false) // preventDefault: no reload of the page
    expect(openChat).toHaveBeenCalledWith(SHELL_KEY)
  })

  it('a modified click on that link is left to the browser (new tab)', async () => {
    const { openChat } = await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    fireEvent.click(screen.getByRole('link', { name: 'bash' }), { ctrlKey: true })
    expect(openChat).not.toHaveBeenCalled()
  })
})
