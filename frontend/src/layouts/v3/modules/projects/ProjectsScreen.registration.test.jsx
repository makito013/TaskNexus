// The registration side of the "Projetos e agentes" screen: the buttons, the dialogs
// they open, the focus they give back, the quick archive and the empty states that
// tell "no projects" from "only archived ones". The read side is covered by
// ProjectsScreen.test.jsx and ProjectsScreen.qa.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { IslandProvider } from '../../IslandContext.jsx'
import ProjectsScreen from './ProjectsScreen.jsx'

installDialogElementStub()
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const folder = (id, path, extra = {}) => ({ id, path, is_primary: true, position: 0, exists: true, ...extra })
const project = (id, key, name, extra = {}) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: key.indexOf('.p') === -1,
  folders: [folder(id, `D:\\projetos\\${key}`)], ...extra,
})
const workspace = (id, key, name, projects = [], extra = {}) => ({ id, key, name, origin: 'seed', archived: false, projects, ...extra })

const REGISTRY = {
  seeded: null,
  workspaces: [
    workspace(1, 'Pessoal', 'Pessoal', [
      project(1, 'Pessoal/tn-sandbox', 'tn-sandbox'),
      project(2, 'Pessoal/silent-a', 'silent-a'),
      project(4, 'Pessoal/old', 'old', { archived: true }),
    ]),
    workspace(3, '.w3', 'Estudos', []),
  ],
}
const AGENTS = [{ id: 'claude', nome: 'Claude', ia: 'claude' }]
const PERSISTED = {
  'Pessoal/tn-sandbox::claude': { display_name: 'Aprovar', needs_attention: false },
  'Pessoal/lab-voz::claude': { display_name: 'Explorar voz', needs_attention: false },
  'NewCo/api::claude': { display_name: 'Mapear API', needs_attention: false },
}
const DISCOVER = {
  root: 'D:\\projetos',
  scanned_in_ms: 2000,
  entries: [{
    legacy_key: 'Pessoal/lab-voz', name: 'lab-voz', path: 'D:\\projetos\\Pessoal\\lab-voz', client_key: 'Pessoal',
    used_by: [], adoptable_into_workspace_id: 1,
  }],
}

function mockData({ registry = REGISTRY, persisted = PERSISTED } = {}) {
  const fetchWorkspaces = vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(registry)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue(persisted)
  vi.spyOn(workspacesApi, 'discoverFolders').mockResolvedValue(DISCOVER)
  vi.spyOn(workspacesApi, 'inspectFolders').mockImplementation(async ({ paths }) => ({
    results: paths.map((path) => ({ input: path, path, ok: true, problems: [], used_by: [], in_this_project: false, nested_in: [], has_marker: false })),
  }))
  return { fetchWorkspaces }
}

async function renderLoaded(options = {}) {
  const spies = mockData(options)
  const reports = []
  const utils = render(
    <IslandProvider value={(report) => reports.push(report)}>
      <ProjectsScreen />
    </IslandProvider>,
  )
  await screen.findByRole('heading', { level: 1, name: 'Projetos e agentes' })
  await waitFor(() => expect(screen.queryByText('Carregando projetos…')).toBeNull())
  return { ...utils, ...spies, reports, lastReport: () => reports.filter(Boolean).at(-1) }
}

const dialogs = () => [...document.querySelectorAll('dialog[open]')]
const headerButton = (name) => within(screen.getByRole('heading', { level: 1 }).closest('header')).getByRole('button', { name })
const esc = () => fireEvent.keyDown(document.activeElement, { key: 'Escape' })

describe('header buttons and the workspace dialog', () => {
  it('shows "Novo workspace" (secondary) and "Adicionar projeto" (primary) once the registry is loaded', async () => {
    await renderLoaded()
    expect(headerButton('Novo workspace').className).toContain('v3-button--secondary')
    expect(headerButton('Adicionar projeto').className).toContain('v3-button--primary')
    expect(document.querySelector('.v3-button--module-kan')).toBeNull()
  })

  it('shows neither of them while the registry failed to load', async () => {
    vi.spyOn(workspacesApi, 'fetchWorkspaces').mockRejectedValue(Object.assign(new Error('x'), { status: 500 }))
    vi.spyOn(api, 'fetchAgents').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
    vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
    render(<ProjectsScreen />)
    await screen.findByText('Não foi possível carregar o cadastro de projetos')
    expect(screen.queryByRole('button', { name: 'Novo workspace' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar projeto' })).toBeNull()
  })

  it('"Novo workspace" opens the dialog and Escape gives the focus back to the button', async () => {
    await renderLoaded()
    const trigger = headerButton('Novo workspace')
    trigger.focus()
    fireEvent.click(trigger)
    expect(dialogs()).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Novo workspace', level: 2 })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Nome do workspace'))
    esc()
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(document.activeElement).toBe(trigger)
  })

  it('creating a workspace calls the API, refetches the registry, closes and shows it', async () => {
    const created = workspace(7, '.w7', 'QA B', [])
    const { fetchWorkspaces } = await renderLoaded()
    vi.spyOn(workspacesApi, 'createWorkspace').mockImplementation(async () => {
      fetchWorkspaces.mockResolvedValue({ ...REGISTRY, workspaces: [...REGISTRY.workspaces, created] })
      return { workspace: created }
    })
    const before = fetchWorkspaces.mock.calls.length
    const trigger = headerButton('Novo workspace')
    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('Nome do workspace'), { target: { value: 'QA B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    await screen.findByRole('region', { name: 'Workspace QA B' })
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith({ name: 'QA B', adoptLegacyKey: null })
    expect(fetchWorkspaces.mock.calls.length).toBeGreaterThan(before)
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(document.activeElement).toBe(trigger)
  })

  it('"Adicionar projeto" opens the project dialog; Escape gives the focus back', async () => {
    await renderLoaded()
    const trigger = headerButton('Adicionar projeto')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('heading', { name: 'Adicionar projeto', level: 2 })).toBeTruthy()
    esc()
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(document.activeElement).toBe(trigger)
  })

  it('creating a project through the screen posts the folders and refetches', async () => {
    const { fetchWorkspaces } = await renderLoaded()
    vi.spyOn(workspacesApi, 'createProject').mockResolvedValue({ project: { id: 99 }, warnings: [] })
    const before = fetchWorkspaces.mock.calls.length
    fireEvent.click(headerButton('Adicionar projeto'))
    fireEvent.change(screen.getByLabelText('Nome do projeto'), { target: { value: 'qa-a' } })
    fireEvent.change(screen.getByLabelText('Adicionar pasta'), { target: { value: 'C:\\tmp\\a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await screen.findByText('C:\\tmp\\a', { selector: '.v3-folder__path' })
    fireEvent.click(within(document.querySelector('dialog')).getByRole('button', { name: 'Adicionar projeto' }))
    await waitFor(() => expect(workspacesApi.createProject).toHaveBeenCalledWith(1, {
      name: 'qa-a', folders: [{ path: 'C:\\tmp\\a', isPrimary: true }],
    }))
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(fetchWorkspaces.mock.calls.length).toBeGreaterThan(before)
  })
})

describe('workspace filter and the header "Adicionar projeto"', () => {
  it('preselects the workspace chosen in the filter, and the first active one when the filter is "all"', async () => {
    await renderLoaded()
    fireEvent.click(headerButton('Adicionar projeto'))
    expect(within(document.querySelector('dialog')).getByLabelText('Workspace').value).toBe('1')
    esc()
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '.w3' } })
    fireEvent.click(headerButton('Adicionar projeto'))
    expect(within(document.querySelector('dialog')).getByLabelText('Workspace').value).toBe('3')
  })
})

describe('per-project actions', () => {
  it('"Editar" opens the dialog for that project, also from the "Sem sessões" list', async () => {
    await renderLoaded()
    const sandbox = screen.getByRole('region', { name: 'tn-sandbox' })
    const trigger = within(sandbox).getByRole('button', { name: 'Editar' })
    expect(trigger.getAttribute('aria-describedby')).toBe(within(sandbox).getByRole('heading', { name: 'tn-sandbox' }).id)
    fireEvent.click(trigger)
    expect(screen.getByRole('heading', { name: 'Editar projeto', level: 2 })).toBeTruthy()
    expect(screen.getByLabelText('Nome do projeto').value).toBe('tn-sandbox')
    expect(document.getElementById('lock-note')).not.toBeNull()
    esc()
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(document.activeElement).toBe(trigger)

    const silent = screen.getByText('Sem sessões (1)').closest('details')
    silent.open = true
    fireEvent.click(within(silent).getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nome do projeto').value).toBe('silent-a')
  })

  it('"Arquivar" archives right away with only { archived: true }, refetches and moves the focus to the h1 when the row is gone', async () => {
    const { fetchWorkspaces } = await renderLoaded()
    const update = vi.spyOn(workspacesApi, 'updateProject').mockImplementation(async () => {
      fetchWorkspaces.mockResolvedValue({
        ...REGISTRY,
        workspaces: [
          workspace(1, 'Pessoal', 'Pessoal', [
            project(1, 'Pessoal/tn-sandbox', 'tn-sandbox', { archived: true }),
            project(2, 'Pessoal/silent-a', 'silent-a'),
            project(4, 'Pessoal/old', 'old', { archived: true }),
          ]),
          REGISTRY.workspaces[1],
        ],
      })
      return { project: { id: 1 }, warnings: [] }
    })
    const before = fetchWorkspaces.mock.calls.length
    const button = screen.getByRole('button', { name: 'Arquivar tn-sandbox' })
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { archived: true }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'tn-sandbox' })).toBeNull())
    expect(fetchWorkspaces.mock.calls.length).toBeGreaterThan(before)
    expect(dialogs()).toHaveLength(0)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })))
  })

  it('a failing quick archive says so, changes nothing and keeps the button', async () => {
    await renderLoaded()
    vi.spyOn(workspacesApi, 'updateProject').mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar tn-sandbox' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não foi possível arquivar tn-sandbox.')
    expect(alert.textContent).toContain('Não foi possível concluir agora. Nada foi alterado.')
    expect(screen.getByRole('button', { name: 'Arquivar tn-sandbox' }).hasAttribute('aria-busy')).toBe(false)
  })

  it('the archive button is busy and inert while the request runs', async () => {
    await renderLoaded()
    let finish
    const update = vi.spyOn(workspacesApi, 'updateProject').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const button = screen.getByRole('button', { name: 'Arquivar tn-sandbox' })
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'))
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(update).toHaveBeenCalledTimes(1)
    finish({ project: { id: 1 } })
    await waitFor(() => expect(button.hasAttribute('aria-busy')).toBe(false))
  })

  it('an archived project (shown with "Mostrar arquivados") has "Desarquivar", which sends { archived: false }', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    const update = vi.spyOn(workspacesApi, 'updateProject').mockResolvedValue({ project: { id: 4 }, warnings: [] })
    const silent = screen.getByText(/Sem sessões \(\d+\)/).closest('details')
    silent.open = true
    const row = within(silent).getByText('old').closest('li')
    expect(within(row).queryByRole('button', { name: /Arquivar/ })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Desarquivar projeto old' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(4, { archived: false }))
  })
})

describe('B5: the labels of the archive buttons follow one pattern', () => {
  it('"Desarquivar" in the "Sem sessões" list names the project like "Arquivar" does', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    const silent = screen.getByText(/Sem sessões \(\d+\)/).closest('details')
    silent.open = true
    const row = within(silent).getByText('old').closest('li')
    expect(within(row).getByRole('button', { name: 'Desarquivar projeto old' }).textContent).toBe('Desarquivar')
    expect(within(silent).getByRole('button', { name: 'Arquivar silent-a' })).toBeTruthy()
  })
})

describe('unregistered folders and clients without a workspace', () => {
  it('"Cadastrar como projeto" opens the dialog pre-filled from the V2 map and keeps the history', async () => {
    await renderLoaded()
    const group = screen.getByRole('group', { name: 'Pasta ainda não cadastrada: Pessoal/lab-voz' })
    const trigger = within(group).getByRole('button', { name: 'Cadastrar como projeto' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByLabelText('Nome do projeto').value).toBe('lab-voz')
    await screen.findByText('D:\\projetos\\Pessoal\\lab-voz', { selector: '.v3-folder__path' })
    expect(screen.getByText('mantém o histórico da V2')).toBeTruthy()
    esc()
    await waitFor(() => expect(dialogs()).toHaveLength(0))
    expect(document.activeElement).toBe(trigger)
  })

  it('in an ARCHIVED workspace "Cadastrar como projeto" is inert and says why (no 409 round trip)', async () => {
    const registry = {
      ...REGISTRY,
      workspaces: [workspace(1, 'Pessoal', 'Pessoal', [project(1, 'Pessoal/tn-sandbox', 'tn-sandbox')], { archived: true }), REGISTRY.workspaces[1]],
    }
    await renderLoaded({ registry })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    const group = screen.getByRole('group', { name: 'Pasta ainda não cadastrada: Pessoal/lab-voz' })
    const button = within(group).getByRole('button', { name: 'Cadastrar como projeto' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-describedby')).textContent)
      .toBe('Este workspace está arquivado. Desarquive-o antes de adicionar projetos.')
    fireEvent.click(button)
    expect(dialogs()).toHaveLength(0)
  })

  it('"Criar workspace a partir de NewCo" opens the dialog filled with the client name and adopts its key', async () => {
    await renderLoaded()
    const group = screen.getByRole('group', { name: 'NewCo sem workspace' })
    const trigger = within(group).getByRole('button', { name: 'Criar workspace a partir de NewCo' })
    fireEvent.click(trigger)
    expect(screen.getByLabelText('Nome do workspace').value).toBe('NewCo')
    vi.spyOn(workspacesApi, 'createWorkspace').mockResolvedValue({ workspace: { id: 8, key: 'NewCo', name: 'NewCo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar workspace' }))
    await waitFor(() => expect(workspacesApi.createWorkspace).toHaveBeenCalledWith({ name: 'NewCo', adoptLegacyKey: 'NewCo' }))
  })
})

describe('empty states', () => {
  it('the empty workspace gets the "Adicionar projeto" CTA with that workspace preselected', async () => {
    await renderLoaded()
    const studies = screen.getByRole('region', { name: 'Workspace Estudos' })
    expect(within(studies).getByText('Estudos ainda não tem projetos')).toBeTruthy()
    fireEvent.click(within(studies).getByRole('button', { name: 'Adicionar projeto' }))
    expect(within(document.querySelector('dialog')).getByLabelText('Workspace').value).toBe('3')
  })

  it('a workspace whose projects are ALL archived does not say it has no projects', async () => {
    const registry = {
      ...REGISTRY,
      workspaces: [
        workspace(1, 'Pessoal', 'Pessoal', [project(1, 'Pessoal/tn-sandbox', 'tn-sandbox')]),
        workspace(3, '.w3', 'Estudos', [project(9, '.w3/.p9', 'velho', { archived: true })]),
      ],
    }
    const { lastReport } = await renderLoaded({ registry })
    const studies = screen.getByRole('region', { name: 'Workspace Estudos' })
    expect(within(studies).queryByText('Estudos ainda não tem projetos')).toBeNull()
    expect(within(studies).getByText('Estudos só tem projetos arquivados')).toBeTruthy()
    expect(within(studies).getByText('Marque "Mostrar arquivados" para vê-los ou adicione um projeto novo.')).toBeTruthy()
    expect(within(studies).getByRole('button', { name: 'Adicionar projeto' })).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '.w3' } })
    await waitFor(() => expect(lastReport().message).toBe(
      'O workspace Estudos só tem projetos arquivados. Marque "Mostrar arquivados" ou adicione um projeto novo.',
    ))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    expect(screen.queryByText('Estudos só tem projetos arquivados')).toBeNull()
    expect(screen.getByText('velho')).toBeTruthy()
  })

  it('a truly empty workspace keeps the plan copy in the island', async () => {
    const { lastReport } = await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '.w3' } })
    await waitFor(() => expect(lastReport().message).toBe(
      'O workspace Estudos ainda não tem projetos. Adicione o primeiro para eu mostrar os agentes dele.',
    ))
  })

  it('an ARCHIVED empty workspace (shown) offers no way to add a project to it', async () => {
    const registry = { ...REGISTRY, workspaces: [REGISTRY.workspaces[0], workspace(3, '.w3', 'Estudos', [], { archived: true })] }
    await renderLoaded({ registry })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    const studies = screen.getByRole('region', { name: 'Workspace Estudos' })
    expect(within(studies).getByText('Estudos ainda não tem projetos')).toBeTruthy()
    expect(within(studies).queryByRole('button', { name: 'Adicionar projeto' })).toBeNull()
  })

  it('with every workspace archived it says so instead of "Nenhum workspace cadastrado"', async () => {
    const registry = {
      seeded: null,
      workspaces: [workspace(1, 'Pessoal', 'Pessoal', [], { archived: true }), workspace(3, '.w3', 'Estudos', [], { archived: true })],
    }
    await renderLoaded({ registry, persisted: {} })
    expect(screen.queryByText('Nenhum workspace cadastrado')).toBeNull()
    expect(screen.getByText('Todos os workspaces estão arquivados')).toBeTruthy()
    expect(screen.getByText('Marque "Mostrar arquivados" para vê-los ou crie um workspace novo.')).toBeTruthy()
    const cta = within(screen.getByText('Todos os workspaces estão arquivados').closest('.v3-state-box')).getByRole('button', { name: 'Novo workspace' })
    fireEvent.click(cta)
    expect(screen.getByRole('heading', { name: 'Novo workspace', level: 2 })).toBeTruthy()
    esc()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    expect(screen.getByRole('region', { name: 'Workspace Pessoal' })).toBeTruthy()
  })

  it('with no workspace at all it keeps "Nenhum workspace cadastrado" and offers "Novo workspace"', async () => {
    await renderLoaded({ registry: { seeded: null, workspaces: [] }, persisted: {} })
    expect(screen.getByText('Nenhum workspace cadastrado')).toBeTruthy()
    expect(screen.getByText('Quando houver workspaces e projetos cadastrados, eles aparecem aqui.')).toBeTruthy()
    const box = screen.getByText('Nenhum workspace cadastrado').closest('.v3-state-box')
    fireEvent.click(within(box).getByRole('button', { name: 'Novo workspace' }))
    expect(screen.getByRole('heading', { name: 'Novo workspace', level: 2 })).toBeTruthy()
  })
})

describe('archiving a workspace from its header', () => {
  const head = (name) => screen.getByRole('region', { name: `Workspace ${name}` }).querySelector('.v3-workspace__head')

  it('an active workspace has "Arquivar"; it asks inline first and sends only { archived: true }, then refetches', async () => {
    const { fetchWorkspaces } = await renderLoaded()
    const update = vi.spyOn(workspacesApi, 'updateWorkspace').mockImplementation(async () => {
      fetchWorkspaces.mockResolvedValue({ ...REGISTRY, workspaces: [REGISTRY.workspaces[0], { ...REGISTRY.workspaces[1], archived: true }] })
      return { workspace: { id: 3 } }
    })
    const before = fetchWorkspaces.mock.calls.length
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' }))
    expect(update).not.toHaveBeenCalled()
    expect(within(head('Estudos')).getByText(/Arquivar o workspace "Estudos"\?/)).toBeTruthy()
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Voltar' }))
    expect(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' })).toBeTruthy()
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' }))
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Sim, arquivar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(3, { archived: true }))
    expect(update).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Workspace Estudos' })).toBeNull())
    expect(fetchWorkspaces.mock.calls.length).toBeGreaterThan(before)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })))
  })

  it('an archived workspace (shown) has "Desarquivar", which sends { archived: false } and refetches', async () => {
    const registry = { ...REGISTRY, workspaces: [REGISTRY.workspaces[0], workspace(3, '.w3', 'Estudos', [], { archived: true })] }
    const { fetchWorkspaces } = await renderLoaded({ registry })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar arquivados' }))
    expect(within(head('Estudos')).queryByRole('button', { name: /^Arquivar/ })).toBeNull()
    const update = vi.spyOn(workspacesApi, 'updateWorkspace').mockResolvedValue({ workspace: { id: 3 } })
    const before = fetchWorkspaces.mock.calls.length
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Desarquivar workspace Estudos' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(3, { archived: false }))
    await waitFor(() => expect(fetchWorkspaces.mock.calls.length).toBeGreaterThan(before))
  })

  it('a failing archive shows the banner, changes nothing and keeps the button', async () => {
    await renderLoaded()
    vi.spyOn(workspacesApi, 'updateWorkspace').mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' }))
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Sim, arquivar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não foi possível arquivar Estudos.')
    expect(screen.getByRole('region', { name: 'Workspace Estudos' })).toBeTruthy()
    expect(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' })).toBeTruthy()
  })

  it('moves the focus to "Sim, arquivar" when the confirmation opens and back to "Arquivar" on "Voltar"', async () => {
    await renderLoaded()
    const ask = within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' })
    ask.focus()
    fireEvent.click(ask)
    const yes = within(head('Estudos')).getByRole('button', { name: 'Sim, arquivar' })
    expect(document.activeElement).toBe(yes)
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Voltar' }))
    expect(document.activeElement).toBe(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' }))
  })

  it('never uses a kan module button', async () => {
    await renderLoaded()
    fireEvent.click(within(head('Estudos')).getByRole('button', { name: 'Arquivar workspace Estudos' }))
    expect(document.querySelector('.v3-button--module-kan')).toBeNull()
    expect(within(head('Estudos')).getByRole('button', { name: 'Voltar' }).className).toContain('v3-button--secondary')
  })
})

describe('registration never leaks into the read-only parts', () => {
  it('opens no dialog by itself and every dialog is unmounted when closed', async () => {
    await renderLoaded()
    expect(document.querySelector('dialog')).toBeNull()
    fireEvent.click(headerButton('Novo workspace'))
    expect(document.querySelector('dialog')).not.toBeNull()
    esc()
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  })
})
