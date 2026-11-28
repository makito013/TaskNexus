// The Artefatos tab inside the Projetos screen: what the screen hands it (the registry, the header's workspace,
// "Mostrar arquivados") and the "Sem workspace" option that an artifact alone can create (K12): the screen
// ORs what the Board tab and the Artefatos tab report, and keeps a saved "Sem workspace" while the tab on
// screen has not answered yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { ProjectsViewProvider } from '../../ProjectsViewContext.jsx'
import ProjectsScreen from '../projects/ProjectsScreen.jsx'
import { ARTIFACTS, REGISTRY_RESPONSE, artifact } from './artifactFixtures.js'

installDialogElementStub()

const json = (body) => ({ ok: true, status: 200, json: async () => body })

function mockData({ artifacts = ARTIFACTS, cards = [] } = {}) {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY_RESPONSE)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([{ slug: 'a_fazer', label: 'A fazer', position: 1, is_done: false }])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  const requests = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    requests.push(String(url))
    return json({ artifacts })
  }))
  return requests
}

function Host() {
  const [show, setShow] = useState(true)
  return (
    <ProjectsViewProvider>
      <button onClick={() => setShow((value) => !value)}>to the chat and back</button>
      {show && (
        <IslandProvider value={() => {}}>
          <ProjectsScreen />
        </IslandProvider>
      )}
    </ProjectsViewProvider>
  )
}

const tab = (name) => screen.getByRole('tab', { name })
const workspaceOptions = () => within(screen.getByRole('combobox', { name: 'Workspace' })).getAllByRole('option').map((option) => option.textContent)
const gallery = () => screen.findByRole('region', { name: 'Galeria de artefatos' })

beforeEach(() => {
  resetDialogElementStubState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

async function renderLoaded() {
  render(<Host />)
  await screen.findByRole('region', { name: 'Workspace Pessoal' })
}

describe('the Artefatos tab of the Projetos screen', () => {
  it('opens the gallery in the tab panel, with the registry names', async () => {
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Artefatos'))
    const region = await gallery()
    expect(await within(region).findByText('Relatório Q3')).toBeTruthy()
    expect(within(region).getByRole('heading', { name: /^Estudos \/ Lab/ })).toBeTruthy()
    expect(screen.getByRole('tabpanel').contains(region)).toBe(true)
    expect(screen.getByRole('heading', { name: 'Artefatos', level: 2 })).toBeTruthy()
  })

  it('the workspace chosen in the header scopes the gallery and the request', async () => {
    const requests = mockData()
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '.w12' } })
    fireEvent.click(tab('Artefatos'))
    const region = await gallery()
    await within(region).findByText('Lab notes')
    expect(within(region).queryByText('Relatório Q3')).toBeNull()
    expect(requests).toContain('/api/artifacts?cliente_id=.w12')
  })

  it('"Mostrar arquivados" is the one of the header', async () => {
    mockData()
    await renderLoaded()
    fireEvent.click(tab('Artefatos'))
    const region = await gallery()
    await within(region).findByText('Relatório Q3')
    expect(within(region).queryByText('Old thing')).toBeNull()
    fireEvent.click(screen.getByLabelText('Mostrar arquivados'))
    expect(await within(region).findByText('Old thing')).toBeTruthy()
  })
})

describe('"Sem workspace" that only an artifact creates (K12)', () => {
  it('is offered once the tab reports a stray artifact, selecting it shows the strays, and it survives a trip to the chat', async () => {
    mockData()
    await renderLoaded()
    expect(workspaceOptions()).not.toContain('Sem workspace')
    fireEvent.click(tab('Artefatos'))
    await within(await gallery()).findByText('Relatório Q3')
    await waitFor(() => expect(workspaceOptions()).toContain('Sem workspace'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: '__none' } })
    const region = await gallery()
    await within(region).findByText('Stray')
    expect(within(region).queryByText('Relatório Q3')).toBeNull()

    // away and back: the screen mounts again while the tab has not answered yet
    fireEvent.click(screen.getByText('to the chat and back'))
    expect(screen.queryByRole('tablist')).toBeNull()
    fireEvent.click(screen.getByText('to the chat and back'))
    await gallery()
    expect(tab('Artefatos').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Workspace' }).value).toBe('__none')
    expect(workspaceOptions()).toContain('Sem workspace')
    await within(await gallery()).findByText('Stray')
  })

  it('is not offered when every artifact has a place', async () => {
    mockData({ artifacts: ARTIFACTS.filter((entry) => !['a6', 'a7'].includes(entry.artifact_id)) })
    await renderLoaded()
    fireEvent.click(tab('Artefatos'))
    await within(await gallery()).findByText('Relatório Q3')
    await waitFor(() => expect(screen.queryByRole('status', { name: /Carregando/ })).toBeNull())
    expect(workspaceOptions()).not.toContain('Sem workspace')
  })

  it('a card alone still creates it (the answer of the Board tab is kept next to the artifacts one)', async () => {
    mockData({
      artifacts: [artifact(1, 'Pessoal/tn-sandbox', { title: 'Relatório Q3' })],
      cards: [{ id: 1, titulo: 'Stray card', projeto_id: 'NewCo/x', parent_id: null, status: 'a_fazer', questions: [], subcards: [], imagens: [] }],
    })
    await renderLoaded()
    fireEvent.click(tab('Board'))
    await screen.findByRole('region', { name: 'Board' })
    await waitFor(() => expect(workspaceOptions()).toContain('Sem workspace'))
    fireEvent.click(tab('Artefatos'))
    await within(await gallery()).findByText('Relatório Q3')
    // the artifacts answer is "nothing stray", the board's is "a stray card": the OR keeps the option
    expect(workspaceOptions()).toContain('Sem workspace')
  })
})

// A fetch that answers like the backend: `cliente_id` narrows the list. `hold` keeps the answer of a client
// pending ('pending'), or fails it ('fail').
function mockPerClient({ hold = {} } = {}) {
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY_RESPONSE)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([{ slug: 'a_fazer', label: 'A fazer', position: 1, is_done: false }])
  vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  const requests = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    requests.push(String(url))
    const client = new URL(String(url), 'http://x').searchParams.get('cliente_id')
    if (hold[client] === 'pending') return new Promise(() => {})
    if (hold[client] === 'fail') return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) }
    const rows = client ? ARTIFACTS.filter((entry) => entry.project_id === client || entry.project_id.startsWith(`${client}/`)) : ARTIFACTS
    return json({ artifacts: rows })
  }))
  return requests
}

async function openArtifactsTab() {
  await renderLoaded()
  fireEvent.click(tab('Artefatos'))
  await within(await gallery()).findByText('Relatório Q3')
  await waitFor(() => expect(workspaceOptions()).toContain('Sem workspace'))
}
const workspaceSelect = () => screen.getByRole('combobox', { name: 'Workspace' })

describe('changing the workspace on the Artefatos tab (the list belongs to the workspace it was read for)', () => {
  it('Pessoal -> "Sem workspace" keeps "Sem workspace" and shows the stray artifact', async () => {
    const requests = mockPerClient()
    await openArtifactsTab()
    fireEvent.change(workspaceSelect(), { target: { value: 'Pessoal' } })
    await waitFor(() => expect(requests).toContain('/api/artifacts?cliente_id=Pessoal'))
    await within(await gallery()).findByText('Relatório Q3')
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Galeria de artefatos' })).queryByText('Stray')).toBeNull())
    fireEvent.change(workspaceSelect(), { target: { value: '__none' } })
    // the unfiltered read comes back: the strays are shown and the choice was never thrown away
    const region = await gallery()
    await within(region).findByText('Stray')
    expect(workspaceSelect().value).toBe('__none')
    expect(workspaceOptions()).toContain('Sem workspace')
    expect(within(region).queryByText('Relatório Q3')).toBeNull()
  })

  it('Pessoal -> Estudos with the new read pending shows the skeleton, not an empty gallery nor the old list', async () => {
    mockPerClient({ hold: { '.w12': 'pending' } })
    await openArtifactsTab()
    fireEvent.change(workspaceSelect(), { target: { value: 'Pessoal' } })
    await within(await gallery()).findByText('Relatório Q3')
    fireEvent.change(workspaceSelect(), { target: { value: '.w12' } })
    const region = await gallery()
    await waitFor(() => expect(region.getAttribute('aria-busy')).toBe('true'))
    expect(within(region).getByRole('status').textContent).toMatch(/Carregando os artefatos/)
    expect(within(region).queryByText('Nenhum artefato ainda')).toBeNull()
    expect(within(region).queryByText('Relatório Q3')).toBeNull()
  })

  it('Pessoal -> Estudos with the new read failing shows the error with "Tentar de novo", not an empty gallery', async () => {
    const requests = mockPerClient({ hold: { '.w12': 'fail' } })
    await openArtifactsTab()
    fireEvent.change(workspaceSelect(), { target: { value: 'Pessoal' } })
    await within(await gallery()).findByText('Relatório Q3')
    fireEvent.change(workspaceSelect(), { target: { value: '.w12' } })
    const region = await gallery()
    await waitFor(() => expect(requests).toContain('/api/artifacts?cliente_id=.w12'))
    expect(await within(region).findByText('Não consegui carregar os artefatos.')).toBeTruthy()
    expect(within(region).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
    expect(within(region).queryByText('Nenhum artefato ainda')).toBeNull()
    expect(within(region).queryByText('Relatório Q3')).toBeNull()
  })
})
