// The Board and Artefatos tabs of the Projetos screen: the narrow-window notice, the keyboard,
// "Abrir board" and the focus, the "Sem workspace" option that only cards can create (C1) and the
// board request that must not steal the focus on a later mount (C2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { ProjectsViewProvider } from '../../ProjectsViewContext.jsx'
import { NARROW_WINDOW_QUERY } from '../../components/NarrowNotice/NarrowNotice.jsx'
import ProjectsScreen from './ProjectsScreen.jsx'

installDialogElementStub()

const folder = (id, path) => ({ id, path, is_primary: true, position: 0, exists: true })
const project = (id, key, name) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: false, folders: [folder(id, `D:\\projetos\\${key}`)],
})
const REGISTRY = {
  seeded: null,
  workspaces: [
    { id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false, projects: [project(1, 'Pessoal/tn-sandbox', 'tn-sandbox')] },
    { id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, projects: [project(5, 'podesubir/ymci', 'ymci')] },
  ],
}
const COLUMNS = [
  { slug: 'a_fazer', label: 'A fazer', position: 1, is_done: false },
  { slug: 'feito', label: 'Feito', position: 2, is_done: true },
]
const card = (id, projeto_id, extra = {}) => ({
  id, titulo: `Card ${id}`, projeto_id, parent_id: null, status: 'a_fazer', ultima_atualizacao_por: 'bruno',
  prioridade: null, tipo: null, prazo: null, descricao: null, questions: [], subcards: [], imagens: [], ...extra,
})

function mockData({ cards = [card(1, 'Pessoal/tn-sandbox')], active = {}, persisted = {} } = {}) {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue(active)
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue(persisted)
}

function installMatchMedia(narrow) {
  const state = { narrow, listeners: new Set() }
  window.matchMedia = (query) => ({
    media: query,
    get matches() { return query === NARROW_WINDOW_QUERY ? state.narrow : false },
    addEventListener: (_type, listener) => state.listeners.add(listener),
    removeEventListener: (_type, listener) => state.listeners.delete(listener),
  })
  return {
    set(value) {
      state.narrow = value
      for (const listener of [...state.listeners]) listener({ matches: value })
    },
  }
}

function Screen() {
  return (
    <IslandProvider value={() => {}}>
      <ProjectsScreen />
    </IslandProvider>
  )
}

async function renderLoaded() {
  const view = render(<Screen />)
  await screen.findByRole('region', { name: 'Workspace Pessoal' })
  return view
}

const tab = (name) => screen.getByRole('tab', { name })
const filters = () => screen.getByRole('group', { name: 'Filtros' })

beforeEach(() => {
  resetDialogElementStubState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete window.matchMedia
  localStorage.clear()
})

describe('Board and Artefatos tabs: window width', () => {
  it('shows the board from 1024 px up (the query is false)', async () => {
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Board'))
    expect(await screen.findByRole('region', { name: 'Board' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Abra no computador' })).toBeNull()
  })

  it.each(['Board', 'Artefatos'])('%s shows only "Abra no computador" below 1024 px, with no button and no link', async (name) => {
    installMatchMedia(true)
    mockData()
    await renderLoaded()
    fireEvent.click(tab(name))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'Abra no computador' })).toBeTruthy()
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(within(panel).queryByRole('link')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull()
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1) // the overview's read only: the board never mounted
  })

  it('Agentes and Sessões keep working below 1024 px', async () => {
    installMatchMedia(true)
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Sessões'))
    expect(screen.getByText('Abra uma sessão para continuar no chat ou no terminal.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Abra no computador' })).toBeNull()
  })

  it('swaps notice and board when the window crosses 1024 px, without a reload', async () => {
    const media = installMatchMedia(false)
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    act(() => media.set(true))
    expect(screen.getByRole('heading', { name: 'Abra no computador' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull()
    act(() => media.set(false))
    expect(await screen.findByRole('region', { name: 'Board' })).toBeTruthy()
  })

  it('does not swap under an open dialog: it waits for the dialog to close', async () => {
    const media = installMatchMedia(false)
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    fireEvent.click(screen.getByRole('button', { name: 'Novo workspace' }))
    expect(document.querySelector('dialog')?.open).toBe(true)
    act(() => media.set(true))
    expect(screen.queryByRole('heading', { name: 'Abra no computador' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Board' })).toBeTruthy()
    const dialog = screen.getByRole('dialog', { hidden: true })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Abra no computador' })).toBeTruthy()
  })
})

describe('Board and Artefatos tabs: filters of the header', () => {
  it('hides "Só quem espera você" on both tabs and keeps it on Agentes and Sessões', async () => {
    mockData()
    await renderLoaded()
    expect(within(filters()).getByLabelText('Só quem espera você')).toBeTruthy()
    fireEvent.click(tab('Sessões'))
    expect(within(filters()).getByLabelText('Só quem espera você')).toBeTruthy()
    fireEvent.click(tab('Board'))
    expect(within(filters()).queryByLabelText('Só quem espera você')).toBeNull()
    expect(within(filters()).getByLabelText('Mostrar arquivados')).toBeTruthy()
    fireEvent.click(tab('Artefatos'))
    expect(within(filters()).queryByLabelText('Só quem espera você')).toBeNull()
    fireEvent.click(tab('Agentes'))
    expect(within(filters()).getByLabelText('Só quem espera você')).toBeTruthy()
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
  })

  it('the workspace chosen on Agentes scopes the board, and the notices of the sessions stay out of it', async () => {
    mockData({ cards: [card(1, 'Pessoal/tn-sandbox'), card(2, 'podesubir/ymci')], active: undefined })
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'podesubir' } })
    fireEvent.click(tab('Board'))
    const board = await screen.findByRole('region', { name: 'Board' })
    await within(board).findByText('Card 2')
    expect(within(board).queryByText('Card 1')).toBeNull()
    expect(screen.queryByText('Estado ao vivo indisponível.')).toBeNull()
  })

  it('"Abrir board" keeps the workspace and puts the focus on the "Board" heading', async () => {
    mockData()
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'Pessoal' } })
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Resumo' })).getByRole('button', { name: 'Abrir board' }))
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    const heading = await screen.findByRole('heading', { name: 'Board', level: 2 })
    await screen.findByRole('region', { name: 'Board' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByRole('combobox', { name: 'Workspace' }).value).toBe('Pessoal')
  })

  it('C2: mounting the board again later does not take the focus of the tab again', async () => {
    mockData()
    await renderLoaded()
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Resumo' })).getByRole('button', { name: 'Abrir board' }))
    await screen.findByRole('region', { name: 'Board' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Board', level: 2 }))

    fireEvent.click(tab('Agentes'))
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    tab('Board').focus()
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    expect(document.activeElement).toBe(tab('Board'))
  })

  it('"Abrir board" below 1024 px selects the tab with the notice and leaves the focus alone', async () => {
    const media = installMatchMedia(true)
    mockData()
    await renderLoaded()
    const button = within(screen.getByRole('complementary', { name: 'Resumo' })).getByRole('button', { name: 'Abrir board' })
    button.focus()
    fireEvent.click(button)
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Abra no computador' })).toBeTruthy()
    // widening later must not fire a request nobody is waiting for
    act(() => media.set(false))
    await screen.findByRole('region', { name: 'Board' })
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Board', level: 2 }))
  })
})

describe('"Sem workspace" that only cards create (C1)', () => {
  function Host() {
    const [show, setShow] = useState(true)
    return (
      <ProjectsViewProvider>
        <button onClick={() => setShow((value) => !value)}>to the chat and back</button>
        {show && <Screen />}
      </ProjectsViewProvider>
    )
  }

  it('lists "Sem workspace" once the board reports a stray card, and keeps it across a trip to the chat', async () => {
    mockData({ cards: [card(1, 'Pessoal/tn-sandbox'), card(2, 'NewCo/x')] })
    render(<Host />)
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    const options = () => within(screen.getByRole('combobox', { name: 'Workspace' })).getAllByRole('option').map((option) => option.textContent)
    expect(options()).not.toContain('Sem workspace')

    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    await vi.waitFor(() => expect(options()).toContain('Sem workspace'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '__none' } })
    const board = screen.getByRole('region', { name: 'Board' })
    await within(board).findByText('Card 2')
    expect(within(board).queryByText('Card 1')).toBeNull()

    // away and back: the screen mounts again while the registry reloads
    fireEvent.click(screen.getByText('to the chat and back'))
    expect(screen.queryByRole('tablist')).toBeNull()
    fireEvent.click(screen.getByText('to the chat and back'))
    await screen.findByRole('region', { name: 'Board' })
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Workspace' }).value).toBe('__none')
    expect(options()).toContain('Sem workspace')
    await within(screen.getByRole('region', { name: 'Board' })).findByText('Card 2')
  })

  it('has no such option when every card has a place', async () => {
    mockData({ cards: [card(1, 'Pessoal/tn-sandbox')] })
    render(<Host />)
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    await vi.waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(2))
    const labels = within(screen.getByRole('combobox', { name: 'Workspace' })).getAllByRole('option').map((option) => option.textContent)
    expect(labels).toEqual(['Todos os workspaces', 'Pessoal', 'podesubir'])
  })

  it('drops "Sem workspace" again when the last stray card is gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mockData({ cards: [card(2, 'NewCo/x')] })
      render(<Host />)
      await screen.findByRole('region', { name: 'Workspace Pessoal' })
      fireEvent.click(tab('Board'))
      await screen.findByRole('region', { name: 'Board' })
      const options = () => within(screen.getByRole('combobox', { name: 'Workspace' })).getAllByRole('option').map((option) => option.textContent)
      await vi.waitFor(() => expect(options()).toContain('Sem workspace'))
      fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '__none' } })
      api.fetchCards.mockResolvedValue([card(1, 'Pessoal/tn-sandbox')])
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      await vi.waitFor(() => expect(options()).not.toContain('Sem workspace'))
      expect(screen.getByRole('combobox', { name: 'Workspace' }).value).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the project refined on the board (kept across a trip to the chat)', () => {
  it('is still chosen when the screen mounts again, and the board is still narrowed to it', async () => {
    function Host() {
      const [show, setShow] = useState(true)
      return (
        <ProjectsViewProvider>
          <button onClick={() => setShow((value) => !value)}>to the chat and back</button>
          {show && <Screen />}
        </ProjectsViewProvider>
      )
    }
    mockData({ cards: [card(1, 'Pessoal/tn-sandbox'), card(2, 'Pessoal')] })
    render(<Host />)
    await screen.findByRole('region', { name: 'Workspace Pessoal' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'Pessoal' } })
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    await within(screen.getByRole('region', { name: 'Board' })).findByText('Card 1')

    fireEvent.click(screen.getByText('to the chat and back'))
    fireEvent.click(screen.getByText('to the chat and back'))
    const board = await screen.findByRole('region', { name: 'Board' })
    expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe('Pessoal/tn-sandbox')
    await within(board).findByText('Card 1')
    expect(within(board).queryByText('Card 2')).toBeNull()
  })
})
