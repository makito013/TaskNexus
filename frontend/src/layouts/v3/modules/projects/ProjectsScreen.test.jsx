// Layer 2 of the read-only proof: the screen is mounted over a stubbed `fetch`
// and EVERY request it makes - on mount, on poll ticks, switching tabs and
// filters, retrying - must be a GET to one of the six read endpoints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react'
import ProjectsScreen from './ProjectsScreen.jsx'
import { POLL_INTERVAL_MS } from './useProjectsOverview.js'

const ALLOWED_URLS = new Set([
  '/api/workspaces?include_archived=1',
  '/api/agents',
  '/api/cards',
  '/api/board/columns',
  '/api/sessions/active',
  '/api/sessions/persisted',
])

const KEY = 'Pessoal/tn-sandbox'

const registry = {
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [{
        id: 1, key: KEY, name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: true,
        folders: [{ id: 1, path: 'D:\\projetos\\Pessoal\\tn-sandbox', is_primary: true, position: 0, exists: true }],
      }],
    },
    { id: 2, key: '.w2', name: 'Estudos', origin: 'user', archived: false, projects: [] },
  ],
}

let responses
let fetchSpy

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

function stubNetwork(overrides = {}) {
  responses = {
    '/api/workspaces?include_archived=1': () => jsonResponse(registry),
    '/api/agents': () => jsonResponse([{ id: 'claude', nome: 'Claude', ia: 'claude' }]),
    '/api/cards': () => jsonResponse([]),
    '/api/board/columns': () => jsonResponse([{ slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false }]),
    '/api/sessions/active': () => jsonResponse({ [`${KEY}::claude`]: { status: 'running', connected: true, needs_attention: true } }),
    '/api/sessions/persisted': () => jsonResponse({ [`${KEY}::claude`]: { display_name: 'Aprovar migração', needs_attention: true } }),
    ...overrides,
  }
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const handler = responses[url]
    if (!handler) throw new Error(`unexpected request: ${url}`)
    return handler()
  })
}

const tick = async () => {
  await act(async () => { vi.advanceTimersByTime(POLL_INTERVAL_MS) })
}

describe('ProjectsScreen over the network', () => {
  beforeEach(() => {
    // Only the poll interval is fake: findBy/waitFor keep using the real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    stubNetwork()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.title = ''
  })

  it('only ever sends GET requests to the six read endpoints, through mount, ticks, tabs, filters and retries', async () => {
    render(<ProjectsScreen />)
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    await tick()
    await tick()

    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Agentes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Só quem espera você' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'Pessoal' } })
    for (const name of ['Abrir sessão', 'Abrir board']) {
      for (const button of screen.getAllByRole('button', { name })) fireEvent.click(button)
    }
    await tick()

    // Positive control: the poll really ran, so the assertions below mean something.
    const calls = fetchSpy.mock.calls
    expect(calls.filter(([url]) => url === '/api/sessions/active').length).toBeGreaterThanOrEqual(4)
    expect(calls.filter(([url]) => url === '/api/sessions/persisted').length).toBeGreaterThanOrEqual(4)
    expect(calls.length).toBeGreaterThan(8)
    for (const [url, init] of calls) {
      expect(ALLOWED_URLS.has(url), `unexpected URL ${url}`).toBe(true)
      expect(init === undefined || init.method === undefined || init.method === 'GET', `non-GET to ${url}`).toBe(true)
    }
  })

  it('renders the single h1 and the title while loading, with a busy status and no filters', async () => {
    responses['/api/workspaces?include_archived=1'] = () => new Promise(() => {})
    render(<ProjectsScreen />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Projetos e agentes' }).getAttribute('tabindex')).toBe('-1')
    expect(document.title).toBe('Projetos · TaskNexus')
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toContain('Carregando projetos e agentes…')
    expect(screen.getByText('Carregando projetos…')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Filtros' })).toBeNull()
  })

  it('shows the total error with the status line and recovers with "Tentar de novo"', async () => {
    let failing = true
    responses['/api/workspaces?include_archived=1'] = () => (failing ? jsonResponse({ detail: 'down' }, 503) : jsonResponse(registry))
    render(<ProjectsScreen />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não foi possível carregar o cadastro de projetos')
    expect(alert.textContent).toContain('Sem o cadastro não dá para agrupar os agentes por workspace e projeto. Nada foi alterado.')
    expect(alert.textContent).toContain('GET /api/workspaces → 503')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    failing = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('region', { name: 'Workspace Pessoal' })).toBeTruthy()
    expect(screen.queryByText('Não foi possível carregar o cadastro de projetos')).toBeNull()
  })

  it('shows the partial banner when the active sessions cannot be read and never says "rodando"', async () => {
    responses['/api/sessions/active'] = () => jsonResponse({}, 500)
    render(<ProjectsScreen />)
    const banner = await screen.findByText('Estado ao vivo indisponível.')
    expect(banner.closest('[role="alert"]').textContent).toContain('Mostrando só o que está salvo')
    expect(screen.queryByText('rodando')).toBeNull()
    // the saved needs_attention still produces the resumable card
    expect(screen.getAllByText('precisa de você · retomável').length).toBeGreaterThan(0)
  })

  it('takes the card out of the waiting strip after an ack happens elsewhere (next tick)', async () => {
    render(<ProjectsScreen />)
    const strip = await screen.findByRole('region', { name: 'Esperando você' })
    expect(strip).toBeTruthy()

    responses['/api/sessions/persisted'] = () => jsonResponse({ [`${KEY}::claude`]: { display_name: 'Aprovar migração', needs_attention: false } })
    responses['/api/sessions/active'] = () => jsonResponse({ [`${KEY}::claude`]: { status: 'running', connected: true, needs_attention: false } })
    await tick()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Esperando você' })).toBeNull())
    expect(screen.getAllByText('rodando').length).toBeGreaterThan(0)
  })

  it('shows the empty-workspace state for a workspace with no projects', async () => {
    render(<ProjectsScreen />)
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    const studies = screen.getByRole('region', { name: 'Workspace Estudos' })
    expect(within(studies).getByText('Estudos ainda não tem projetos')).toBeTruthy()
    expect(within(studies).getByText('0 projetos')).toBeTruthy()
  })
})
