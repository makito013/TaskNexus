// Keyboard, ARIA and state coverage of the Projetos e agentes screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import ProjectsScreen from './ProjectsScreen.jsx'

const folder = (id, path, exists = true) => ({ id, path, is_primary: true, position: 0, exists })
const project = (id, key, name, extra = {}) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: false, folders: [folder(id, `D:\\projetos\\${key}`)], ...extra,
})

const REGISTRY = {
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        project(1, 'Pessoal/tn-sandbox', 'tn-sandbox'),
        project(2, 'Pessoal/silent-a', 'silent-a'),
        project(3, 'Pessoal/ghost', 'ghost', { folders: [folder(3, 'D:\\projetos\\Pessoal\\ghost', false)] }),
        project(4, 'Pessoal/old', 'old', { archived: true }),
      ],
    },
    { id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, projects: [project(5, 'podesubir/ymci', 'ymci')] },
    { id: 3, key: '.w3', name: 'Estudos', origin: 'user', archived: false, projects: [] },
  ],
}
const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
  { id: 'terminal', nome: 'Terminal', ia: 'terminal' },
]
const live = (status, needs = false) => ({ status, connected: true, needs_attention: needs, display_name: null })
const saved = (needs = false, name = null) => ({ display_name: name, needs_attention: needs })

const ACTIVE = {
  'Pessoal/tn-sandbox::claude': live('idle', true),
  'Pessoal/tn-sandbox::terminal': live('idle'),
  'podesubir/ymci::codex': live('running'),
}
const PERSISTED = {
  'Pessoal/tn-sandbox::claude': saved(true, 'Aprovar migração'),
  'Pessoal/tn-sandbox::terminal': saved(false, 'bash'),
  'podesubir/ymci::codex': saved(false, 'Refatorar webhooks'),
  'Pessoal/old::claude': saved(false, 'Sessão antiga'),
  'Pessoal/lab-voz::claude': saved(false, 'Explorar voz'),
  'NewCo/api::claude': saved(false, 'Mapear API'),
}

function mockData({ active = ACTIVE, persisted = PERSISTED, registry = REGISTRY, cards = [] } = {}) {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(registry)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([
    { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
    { slug: 'feito', label: 'Feito', position: 1, is_done: true },
  ])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue(active)
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue(persisted)
}

async function renderLoaded(options) {
  mockData(options)
  const reports = []
  const utils = render(
    <IslandProvider value={(report) => reports.push(report)}>
      <ProjectsScreen />
    </IslandProvider>,
  )
  await screen.findByRole('region', { name: 'Workspace Pessoal' })
  return { ...utils, reports, lastReport: () => reports.filter(Boolean).at(-1) }
}

describe('Projetos e agentes: tabs', () => {
  beforeEach(() => { document.title = '' })
  afterEach(() => vi.restoreAllMocks())

  it('exposes four tabs in a labelled tablist, Agentes selected, the panel labelled by it', async () => {
    await renderLoaded()
    const tablist = screen.getByRole('tablist', { name: 'Seções' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Agentes', 'Sessões', 'Boardem breve', 'Artefatosem breve'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id)
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id)
  })

  it('uses a roving tabindex: only the selected tab is a tab stop', async () => {
    await renderLoaded()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('the roving tab stop returns to the selected tab when focus leaves the tablist', async () => {
    await renderLoaded()
    const tabs = screen.getAllByRole('tab')
    const artifacts = tabs[3]
    act(() => { tabs[0].focus() })
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(document.activeElement).toBe(artifacts)
    // "em breve" took the focus but not the selection, so it is the tab stop for now.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, 0])

    act(() => { artifacts.blur() })
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('marks the waiting items of an archived project or workspace with the "arquivado" chip, and only those', async () => {
    const registry = {
      ...REGISTRY,
      workspaces: [
        ...REGISTRY.workspaces,
        { id: 4, key: 'Velho', name: 'Velho', origin: 'seed', archived: true, projects: [project(7, 'Velho/legacy', 'legacy')] },
      ],
    }
    const persisted = {
      ...PERSISTED,
      'Pessoal/old::claude': saved(true, 'Sessão antiga'),
      'Velho/legacy::claude': saved(true, 'Sessão do workspace arquivado'),
    }
    await renderLoaded({ registry, persisted })
    const strip = screen.getByRole('region', { name: 'Esperando você' })
    const items = within(strip).getAllByRole('listitem')
    const byText = (text) => items.find((item) => item.textContent.includes(text))
    expect(within(byText('Sessão antiga')).getByText('arquivado')).toBeTruthy()
    expect(within(byText('Sessão do workspace arquivado')).getByText('arquivado')).toBeTruthy()
    expect(within(byText('Aprovar migração')).queryByText('arquivado')).toBeNull()
    expect(within(strip).getAllByText('arquivado')).toHaveLength(2)

    // Same marker, for coherence, on the rows of the Sessões tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    const rows = screen.getAllByRole('row')
    const rowOf = (text) => rows.find((row) => row.textContent.includes(text))
    expect(within(rowOf('Sessão antiga')).getByText('arquivado')).toBeTruthy()
    expect(within(rowOf('Sessão do workspace arquivado')).getByText('arquivado')).toBeTruthy()
    expect(within(rowOf('Aprovar migração')).queryByText('arquivado')).toBeNull()
  })

  it('arrows walk all four tabs; "em breve" tabs take focus but selection stays on the enabled ones', async () => {
    await renderLoaded()
    const [agents, sessions, board, artifacts] = screen.getAllByRole('tab')
    agents.focus()

    fireEvent.keyDown(agents, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(sessions)
    expect(sessions.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(sessions.id)

    fireEvent.keyDown(sessions, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(board)
    expect(board.getAttribute('aria-selected')).toBe('false')
    expect(sessions.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(board, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(artifacts)
    fireEvent.keyDown(artifacts, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(agents)
    expect(agents.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(agents, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(artifacts)
    fireEvent.keyDown(artifacts, { key: 'Home' })
    expect(document.activeElement).toBe(agents)
    fireEvent.keyDown(agents, { key: 'End' })
    expect(document.activeElement).toBe(artifacts)
  })

  it('"em breve" tabs are aria-disabled, described by the note, and Enter/Space/click change nothing', async () => {
    await renderLoaded()
    const [, , board, artifacts] = screen.getAllByRole('tab')
    for (const tab of [board, artifacts]) {
      expect(tab.getAttribute('aria-disabled')).toBe('true')
      expect(document.getElementById(tab.getAttribute('aria-describedby')).textContent).toBe('Disponível em uma próxima versão.')
      fireEvent.click(tab)
      fireEvent.keyDown(tab, { key: 'Enter' })
      fireEvent.keyDown(tab, { key: ' ' })
      expect(tab.getAttribute('aria-selected')).toBe('false')
    }
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('the Sessões tab shows the info banner and the two tables', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    expect(screen.getByText('Abrir e retomar sessões chega com o chat da V3. Esta lista só mostra o estado.')).toBeTruthy()
    const active = screen.getByRole('table', { name: /Ativas/ })
    const savedTable = screen.getByRole('table', { name: /Salvas \(retomáveis\)/ })
    expect(within(active).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Sessão', 'Workspace › projeto', 'Agente', 'Estado', 'Origem',
    ])
    expect(within(active).getByText('Aprovar migração')).toBeTruthy()
    expect(within(active).getAllByText('ao vivo')).toHaveLength(3)
    expect(within(savedTable).getByText('Pessoal › lab-voz (não cadastrada)')).toBeTruthy()
    expect(within(savedTable).getByText('Sem workspace › NewCo/api')).toBeTruthy()
    expect(within(savedTable).getAllByText('salva').length).toBeGreaterThan(0)
    // Summary is only on the Agentes tab.
    expect(screen.queryByRole('complementary', { name: 'Resumo' })).toBeNull()
  })

  it('the Sessões tab says "Nenhuma sessão aqui." for an empty block', async () => {
    await renderLoaded({ active: {}, persisted: { 'Pessoal/tn-sandbox::claude': saved() } })
    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    expect(within(screen.getByRole('table', { name: /Ativas/ })).getByText('Nenhuma sessão aqui.')).toBeTruthy()
  })
})

describe('Projetos e agentes: Agentes tab', () => {
  afterEach(() => vi.restoreAllMocks())

  it('puts "Esperando você" first, before every workspace', async () => {
    const { container } = await renderLoaded()
    const strip = screen.getByRole('region', { name: 'Esperando você' })
    const firstWorkspace = screen.getByRole('region', { name: 'Workspace Pessoal' })
    expect(strip.compareDocumentPosition(firstWorkspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.tabIndex).toBe(-1)
    expect(within(strip).getByText('sessão viva')).toBeTruthy()
    expect(strip.textContent).toContain('Permitir e Negar chegam junto com o chat. Por enquanto esta faixa só avisa.')
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })

  it('"Abrir sessão" is aria-disabled, does nothing and points at the exact note', async () => {
    await renderLoaded()
    const buttons = screen.getAllByRole('button', { name: 'Abrir sessão' })
    expect(buttons.length).toBeGreaterThan(1)
    for (const button of buttons) {
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(document.getElementById(button.getAttribute('aria-describedby')).textContent)
        .toBe('Abrir sessão fica disponível quando o chat chegar à V3.')
      fireEvent.click(button)
    }
    expect(screen.getAllByText('Disponível quando o chat chegar à V3').length).toBeGreaterThan(0)
  })

  it('the board summary is read-only: "Abrir board" is aria-disabled and described by its note', async () => {
    await renderLoaded({ cards: [{ id: 1, projeto_id: 'Pessoal/tn-sandbox', status: 'a_fazer', parent_id: null }] })
    const aside = screen.getByRole('complementary', { name: 'Resumo' })
    expect(within(aside).getByRole('heading', { name: 'Board · resumo' })).toBeTruthy()
    expect(within(aside).getByText('todos os workspaces')).toBeTruthy()
    const button = within(aside).getByRole('button', { name: 'Abrir board' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-describedby')).textContent)
      .toBe('Disponível quando o board chegar à V3. Só leitura por enquanto.')
    expect(within(aside).getByText('A fazer')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'podesubir' } })
    expect(within(aside).getByText('podesubir')).toBeTruthy()
  })

  it('never renders a kan module button (contrast 4.23:1)', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.v3-button--module-kan')).toBeNull()
    expect(container.querySelector('.v3-button--module')).toBeNull()
  })

  it('shows the project with its path, the free line and the unregistered and unassigned buckets', async () => {
    await renderLoaded()
    const pessoal = screen.getByRole('region', { name: 'Workspace Pessoal' })
    const sandbox = within(pessoal).getByRole('region', { name: 'tn-sandbox' })
    expect(within(sandbox).getByText('D:\\projetos\\Pessoal/tn-sandbox')).toBeTruthy()
    expect(within(sandbox).getByText('livre:').parentElement.textContent).toBe('livre: Codex')
    expect(within(pessoal).getByRole('group', { name: 'Pasta ainda não cadastrada: Pessoal/lab-voz' })).toBeTruthy()
    expect(screen.getByText('A V2 descobriu esta pasta depois da migração. O histórico fica aqui até você cadastrar.')).toBeTruthy()
    const noWorkspace = screen.getByRole('region', { name: 'Sem workspace' })
    expect(within(noWorkspace).getByText('clientes que a V2 criou depois da migração')).toBeTruthy()
    expect(within(noWorkspace).getByRole('group', { name: 'NewCo sem workspace' })).toBeTruthy()
    expect(within(noWorkspace).getByText('Ainda não existe workspace com este nome.')).toBeTruthy()
    // Registration buttons arrive with the dialogs, not in this phase.
    expect(screen.queryByRole('button', { name: /Cadastrar como projeto|Criar workspace|Novo workspace|Adicionar projeto|Editar|Arquivar/ })).toBeNull()
  })

  it('collapses the projects without sessions in a <details> "Sem sessões (N)" with the missing-folder badge', async () => {
    await renderLoaded()
    const pessoal = screen.getByRole('region', { name: 'Workspace Pessoal' })
    const summary = within(pessoal).getByText('Sem sessões (2)')
    const details = summary.closest('details')
    expect(details.open).toBe(false)
    expect(within(details).getByText('silent-a')).toBeTruthy()
    expect(within(details).getByText('ghost')).toBeTruthy()
    expect(within(details).getByText('pasta não encontrada')).toBeTruthy()
    expect(within(details).queryByText('old')).toBeNull() // archived: hidden by default
  })

  it('"Mostrar arquivados" reveals the archived project with its chip', async () => {
    await renderLoaded()
    expect(screen.queryByRole('region', { name: 'old' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    const old = screen.getByRole('region', { name: 'old' })
    expect(within(old).getByText('arquivado')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    expect(screen.queryByRole('region', { name: 'old' })).toBeNull()
  })

  it('shows the "pasta não encontrada" badge on a project with sessions whose folder is gone', async () => {
    await renderLoaded({
      persisted: { ...PERSISTED, 'Pessoal/ghost::claude': saved() },
    })
    const ghost = screen.getByRole('region', { name: 'ghost' })
    expect(within(ghost).getByText('pasta não encontrada')).toBeTruthy()
  })

  it('lists the workspace select with all workspaces and "Sem workspace" only when something lives there', async () => {
    await renderLoaded()
    const select = screen.getByRole('combobox', { name: 'Workspace' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos os workspaces', 'Pessoal', 'podesubir', 'Estudos', 'Sem workspace',
    ])
  })

  it('the empty workspace explains itself and the island follows when it is the filter', async () => {
    const { lastReport } = await renderLoaded()
    const studies = screen.getByRole('region', { name: 'Workspace Estudos' })
    expect(within(studies).getByText('Um projeto junta uma ou mais pastas e aparece aqui com os agentes que já têm sessão.')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '.w3' } })
    expect(screen.queryByRole('region', { name: 'Workspace Pessoal' })).toBeNull()
    await waitFor(() => expect(lastReport().message).toBe(
      'O workspace Estudos ainda não tem projetos. Adicione o primeiro para eu mostrar os agentes dele.',
    ))
  })

  it('"Só quem espera você" with nobody waiting shows the filter-empty state and "Limpar filtros" restores it', async () => {
    await renderLoaded({ active: {}, persisted: { 'Pessoal/tn-sandbox::claude': saved() } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Só quem espera você' }))
    expect(screen.getByText('Nenhum agente espera você neste filtro')).toBeTruthy()
    expect(screen.getByText('Tire o filtro "Só quem espera você" ou troque de workspace para ver as outras mesas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.queryByText('Nenhum agente espera você neste filtro')).toBeNull()
    expect(screen.getByRole('region', { name: 'Workspace Pessoal' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Só quem espera você' }).checked).toBe(false)
  })

  it('"Só quem espera você" keeps only the groups with someone waiting', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Só quem espera você' }))
    expect(screen.getByRole('region', { name: 'Workspace Pessoal' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Workspace podesubir' })).toBeNull()
    expect(screen.queryByText(/Sem sessões/)).toBeNull()
  })

  it('falls back to "all" when the selected workspace stops being an option', async () => {
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'Pessoal' } })
    expect(screen.queryByRole('region', { name: 'Workspace podesubir' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '__none' } })
    expect(screen.getByRole('region', { name: 'Sem workspace' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Workspace Pessoal' })).toBeNull()
  })
})

describe('Projetos e agentes: island', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports the waiting agents and "Ver quem espera" lands on the strip even from another tab and filter', async () => {
    const { lastReport } = await renderLoaded()
    await waitFor(() => expect(lastReport().message).toMatch(/^1 agente espera você em tn-sandbox\./))
    expect(lastReport().state).toBe('alert')
    expect(lastReport().actions.map((action) => action.label)).toEqual(['Ver quem espera'])

    fireEvent.click(screen.getByRole('tab', { name: 'Sessões' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'podesubir' } })
    expect(screen.queryByRole('region', { name: 'Esperando você' })).toBeNull()

    act(() => lastReport().actions[0].onClick())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Esperando você' })))
    expect(screen.getByRole('tab', { name: 'Agentes' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Workspace' }).value).toBe('')
  })

  it('has no action when nobody waits, and says so', async () => {
    const { lastReport } = await renderLoaded({ active: {}, persisted: { 'Pessoal/tn-sandbox::claude': saved() } })
    await waitFor(() => expect(lastReport().message).toBe('Nada espera você agora.'))
    expect(lastReport().actions).toEqual([])
  })

  it('says it cannot see what is running when the live state is unavailable', async () => {
    mockData()
    vi.spyOn(api, 'fetchActiveSessions').mockRejectedValue(new Error('down'))
    const reports = []
    render(
      <IslandProvider value={(report) => reports.push(report)}>
        <ProjectsScreen />
      </IslandProvider>,
    )
    await screen.findByText('Estado ao vivo indisponível.')
    await waitFor(() => expect(reports.filter(Boolean).at(-1).message).toBe(
      'Não consigo ver o que está rodando agora. Mostro só as sessões salvas.',
    ))
  })

  it('reports the loading phrase first and the retry action on a total failure', async () => {
    mockData()
    const failure = Object.assign(new Error('HTTP 503'), { status: 503 })
    vi.spyOn(workspacesApi, 'fetchWorkspaces').mockRejectedValue(failure)
    const reports = []
    render(
      <IslandProvider value={(report) => reports.push(report)}>
        <ProjectsScreen />
      </IslandProvider>,
    )
    expect(reports[0].message).toBe('Estou olhando as mesas dos agentes. Um instante.')
    await screen.findByRole('alert')
    await waitFor(() => {
      const last = reports.filter(Boolean).at(-1)
      expect(last.message).toBe('Não consegui ler o cadastro de projetos, então não sei onde cada agente está.')
      expect(last.actions.map((action) => action.label)).toEqual(['Tentar de novo'])
    })
  })
})
