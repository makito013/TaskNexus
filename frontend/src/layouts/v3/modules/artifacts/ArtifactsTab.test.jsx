import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import { probe } from '../viewer/viewerTestKit.jsx'
import { ARTIFACTS, artifact } from './artifactFixtures.js'
import { createArtifactsKit } from './artifactTestKit.jsx'

installDialogElementStub()

const { backend, renderTab } = createArtifactsKit({ vi, render })

beforeEach(() => {
  clearViewerContentCache()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const gallery = () => screen.getByRole('region', { name: 'Galeria de artefatos' })
const cardTitles = () => within(gallery()).queryAllByRole('button', { name: /\(MD\)|\(HTML\)|\(PDF\)/ }).map((button) => button.textContent)
const headings = () => within(gallery()).queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
const loaded = () => screen.findByText('Relatório Q3')
const listRequests = (calls) => calls(/\/api\/artifacts(\?|$)/, 'GET').map(([url]) => url)

describe('ArtifactsTab: reading and scope', () => {
  it('shows still placeholders and a busy gallery while the first read is out', async () => {
    let resolve
    const { fetchMock } = backend({ list: () => new Promise((done) => { resolve = done }) })
    renderTab()
    expect(gallery().getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Carregando os artefatos…')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true, status: 200, json: async () => ({ artifacts: ARTIFACTS }) }) })
    await loaded()
    expect(gallery().getAttribute('aria-busy')).toBeNull()
  })

  it('groups by place, "WORKSPACE / PROJETO · N", the registry names and never the minted key', async () => {
    backend()
    renderTab()
    await loaded()
    // "Recentes": the place of the newest artifact first
    expect(headings()).toEqual([
      'Projeto não encontrado / .w9/.p9 · 1Projeto não encontrado',
      'Sem workspace / NewCo/x · 1Sem workspace',
      'Pessoal / lab-voz (não cadastrada) · 1Não cadastrada',
      'Estudos / Do workspace · 1',
      'Estudos / Lab · 1',
      'Pessoal / Docs · 1',
      'Pessoal / tn-sandbox · 1',
    ])
    expect(headings().join(' ')).not.toMatch(/\.w12|\.p38|\.p37/)
  })

  it('asks the server for everything with "Todos" and "Sem workspace", and for the client with a workspace', async () => {
    const all = backend()
    renderTab()
    await loaded()
    expect(listRequests(all.calls)).toEqual(['/api/artifacts'])
    cleanup()
    const strays = backend()
    renderTab({ workspaceKey: NO_WORKSPACE_VALUE })
    await screen.findByText('Stray')
    expect(listRequests(strays.calls)).toEqual(['/api/artifacts'])
    cleanup()
    const one = backend()
    renderTab({ workspaceKey: '.w12' })
    await screen.findByText('Lab notes')
    expect(listRequests(one.calls)).toEqual(['/api/artifacts?cliente_id=.w12'])
  })

  it('"Sem workspace" keeps only the strays: the bucket and the key that does not exist', async () => {
    backend()
    renderTab({ workspaceKey: NO_WORKSPACE_VALUE })
    await screen.findByText('Stray')
    expect(screen.getByText('Ghost')).toBeTruthy()
    expect(screen.queryByText('Relatório Q3')).toBeNull()
    expect(screen.queryByText('Lab notes')).toBeNull()
  })

  it('a workspace keeps its own places, the unregistered sub-folder included, and a minted root apart from its project', async () => {
    backend()
    renderTab({ workspaceKey: 'Pessoal' })
    await loaded()
    expect(screen.getByText('Voice lab')).toBeTruthy()
    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.queryByText('Lab notes')).toBeNull()
    expect(screen.queryByText('Stray')).toBeNull()
  })

  it('a refined project is the exact key: one grid, no group headings, and "Do workspace" is the root only', async () => {
    backend()
    renderTab({ workspaceKey: '.w12' })
    await screen.findByText('Lab notes')
    expect(headings().length).toBe(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: '.w12/.p38' } })
    expect(headings()).toEqual([])
    expect(screen.getByText('Lab notes')).toBeTruthy()
    expect(screen.queryByText('Workspace readme')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: '__workspace' } })
    expect(screen.getByText('Workspace readme')).toBeTruthy()
    expect(screen.queryByText('Lab notes')).toBeNull()
  })

  it('a refinement belongs to its workspace: changing the workspace drops it for good', async () => {
    backend()
    const view = renderTab({ workspaceKey: '.w12' })
    await screen.findByText('Lab notes')
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: '.w12/.p38' } })
    expect(screen.queryByText('Workspace readme')).toBeNull()
    act(() => view.setProps({ workspaceKey: 'Pessoal' }))
    await screen.findByText('Relatório Q3')
    act(() => view.setProps({ workspaceKey: '.w12' }))
    await screen.findByText('Workspace readme')
    expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe('')
    expect(screen.getByText('Lab notes')).toBeTruthy()
  })

  it('turning "Mostrar arquivados" off drops the refinement of an archived project for good (D-18)', async () => {
    backend()
    const view = renderTab({ workspaceKey: 'Pessoal', showArchived: true })
    await loaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/old' } })
    expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe('Pessoal/old')
    expect(screen.getByText('Old thing')).toBeTruthy()
    act(() => view.setProps({ showArchived: false }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe(''))
    expect(screen.queryByText('Old thing')).toBeNull()
    act(() => view.setProps({ showArchived: true }))
    // it does not come back with the switch
    expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe('')
    expect(screen.getByText('Old thing')).toBeTruthy()
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
  })

  it('the project select is disabled without a real workspace', async () => {
    backend()
    renderTab()
    await loaded()
    expect(screen.getByRole('combobox', { name: 'Projeto' }).disabled).toBe(true)
  })

  it('"Mostrar arquivados" brings the archived project and workspace in, marked, in their own groups', async () => {
    backend()
    renderTab({ showArchived: true })
    await loaded()
    expect(screen.getByText('Old thing')).toBeTruthy()
    expect(screen.getByText('Legacy doc')).toBeTruthy()
    expect(within(gallery()).getAllByText('arquivado').length).toBe(2)
    cleanup()
    backend()
    renderTab({ showArchived: false })
    await loaded()
    expect(screen.queryByText('Old thing')).toBeNull()
  })
})

describe('ArtifactsTab: type, search, order', () => {
  it('the type chips are one radio group: "PDF" shows only PDFs, arrows walk and select', async () => {
    backend()
    renderTab()
    await loaded()
    const group = screen.getByRole('radiogroup', { name: 'Tipo de arquivo' })
    expect(within(group).getAllByRole('radio').map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]))
      .toEqual([['Todos', 'true'], ['MD', 'false'], ['HTML', 'false'], ['PDF', 'false']])
    fireEvent.click(within(group).getByRole('radio', { name: 'PDF' }))
    expect(cardTitles().length).toBe(1)
    expect(screen.getByText('Voice lab')).toBeTruthy()
    const checked = within(group).getByRole('radio', { name: 'PDF' })
    expect(checked.getAttribute('aria-checked')).toBe('true')
    expect(checked.tabIndex).toBe(0)
    expect(within(group).getByRole('radio', { name: 'MD' }).tabIndex).toBe(-1)
    fireEvent.keyDown(checked, { key: 'ArrowRight' })
    expect(within(group).getByRole('radio', { name: 'Todos' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(within(group).getByRole('radio', { name: 'Todos' }), { key: 'ArrowLeft' })
    expect(within(group).getByRole('radio', { name: 'PDF' }).getAttribute('aria-checked')).toBe('true')
  })

  it('every control of the bar has an accessible name in Portuguese', async () => {
    backend()
    renderTab()
    await loaded()
    expect(screen.getByRole('searchbox', { name: 'Buscar artefatos' }).getAttribute('placeholder')).toBe('Buscar por título ou caminho')
    expect(screen.getByRole('combobox', { name: 'Ordenar' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Projeto' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '＋ Importar do projeto…' }).length).toBe(2)
  })

  it('searches title, path and description without accents or case ("relatorio" finds "Relatório Q3")', async () => {
    backend({ artifacts: [...ARTIFACTS, artifact(20, 'Pessoal/tn-sandbox', { title: 'Other', path: 'x.md', description: 'sobre o ORÇAMENTO' })] })
    renderTab()
    await loaded()
    const box = screen.getByRole('searchbox', { name: 'Buscar artefatos' })
    fireEvent.change(box, { target: { value: 'relatorio' } })
    expect(cardTitles().length).toBe(1)
    fireEvent.change(box, { target: { value: 'orcamento' } })
    expect(screen.getByText('Other')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'docs/q3' } })
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
  })

  it('"Nome" sorts by title without accents; "Recentes" is the newest first', async () => {
    backend({
      artifacts: [
        artifact(1, 'Pessoal/tn-sandbox', { title: 'Zebra', updated_at: 300, mtime: 300 }),
        artifact(2, 'Pessoal/tn-sandbox', { title: 'Árvore', updated_at: 200, mtime: 200 }),
        artifact(3, 'Pessoal/tn-sandbox', { title: 'Mapa', updated_at: 100, mtime: 100 }),
      ],
    })
    renderTab({ workspaceKey: 'Pessoal' })
    await screen.findByText('Zebra')
    expect(cardTitles().map((text) => text.replace(/ \(MD\)/, ''))).toEqual(['Zebra', 'Árvore', 'Mapa'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar' }), { target: { value: 'nome' } })
    expect(cardTitles().map((text) => text.replace(/ \(MD\)/, ''))).toEqual(['Árvore', 'Mapa', 'Zebra'])
  })
})

describe('ArtifactsTab: states', () => {
  it('a filter with no match says so and "Limpar filtros" brings the list back', async () => {
    backend()
    renderTab()
    await loaded()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar artefatos' }), { target: { value: 'zzzz' } })
    expect(screen.getByText('Nenhum artefato com esses filtros.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Buscar artefatos' }).value).toBe('')
  })

  it('a scope with no artifact is the empty state, with "Importar do projeto", not the filter one', async () => {
    backend({ artifacts: [] })
    renderTab({ workspaceKey: 'Pessoal' })
    expect(await screen.findByRole('heading', { name: 'Nenhum artefato ainda' })).toBeTruthy()
    expect(screen.getByText('Os arquivos que o agente publicar aparecem aqui.')).toBeTruthy()
    expect(screen.queryByText('Nenhum artefato com esses filtros.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Importar do projeto' })).toBeTruthy()
  })

  it('a type or a search on a scope that has NOTHING is still the empty state, not "esses filtros"', async () => {
    backend({ artifacts: [] })
    renderTab({ workspaceKey: 'Pessoal' })
    await screen.findByRole('heading', { name: 'Nenhum artefato ainda' })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Tipo de arquivo' })).getByRole('radio', { name: 'PDF' }))
    expect(screen.getByRole('heading', { name: 'Nenhum artefato ainda' })).toBeTruthy()
    expect(screen.queryByText('Nenhum artefato com esses filtros.')).toBeNull()
  })

  it('a failed first read shows the alert and "Tentar de novo" reads again', async () => {
    let attempts = 0
    const { fetchMock } = backend({
      list: () => {
        attempts += 1
        return attempts === 1
          ? { ok: false, status: 500, json: async () => ({ error: 'Não consegui carregar os artefatos.' }) }
          : { ok: true, status: 200, json: async () => ({ artifacts: ARTIFACTS }) }
      },
    })
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui carregar os artefatos.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    await loaded()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('a failed reload with a list on screen keeps the list and says "Sem atualizar agora"', async () => {
    let attempts = 0
    backend({
      list: () => {
        attempts += 1
        return attempts === 1
          ? { ok: true, status: 200, json: async () => ({ artifacts: ARTIFACTS }) }
          : { ok: false, status: 500, json: async () => ({ error: 'down' }) }
      },
    })
    renderTab()
    await loaded()
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(attempts).toBe(1)
    act(() => probe.actions.notifyArtifactsChanged())
    await waitFor(() => expect(screen.getByText('Sem atualizar agora')).toBeTruthy(), { timeout: 2000 })
    expect(screen.getByText('Relatório Q3')).toBeTruthy()
    expect(screen.getByText('Sem atualizar agora').getAttribute('role')).toBe('status')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an answer that arrives after a newer one does not win (the workspace changed in between)', async () => {
    const resolvers = {}
    backend({ list: (url) => new Promise((done) => { resolvers[url] = done }) })
    const view = renderTab({ workspaceKey: 'Pessoal' })
    await waitFor(() => expect(Object.keys(resolvers)).toEqual(['/api/artifacts?cliente_id=Pessoal']))
    act(() => view.setProps({ workspaceKey: '.w12' }))
    await waitFor(() => expect(Object.keys(resolvers).length).toBe(2))
    const answer = (rows) => ({ ok: true, status: 200, json: async () => ({ artifacts: rows }) })
    await act(async () => { resolvers['/api/artifacts?cliente_id=.w12'](answer([ARTIFACTS[2]])) })
    expect(await screen.findByText('Lab notes')).toBeTruthy()
    // the old answer lands last: it must not replace the newer list
    await act(async () => { resolvers['/api/artifacts?cliente_id=Pessoal'](answer([ARTIFACTS[0]])) })
    expect(screen.getByText('Lab notes')).toBeTruthy()
    expect(screen.queryByText('Relatório Q3')).toBeNull()
  })

  it('announces the count only when it changes, never on the first answer', async () => {
    backend()
    renderTab()
    await loaded()
    const live = gallery().querySelector('[aria-live="polite"]')
    expect(live.textContent).toBe('')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar artefatos' }), { target: { value: 'relatorio' } })
    await waitFor(() => expect(live.textContent).toBe('1 artefato.'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar artefatos' }), { target: { value: '' } })
    await waitFor(() => expect(live.textContent).toBe('7 artefatos.'))
  })
})

describe('ArtifactsTab: when the list is read again', () => {
  it('focus twice within 2 s is ONE read (the throttle), and a focus 2 s later is another', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { calls } = backend()
    renderTab()
    await loaded()
    expect(listRequests(calls).length).toBe(1)
    vi.setSystemTime(Date.now() + 2100)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(listRequests(calls).length).toBe(2)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(listRequests(calls).length).toBe(2)
  })

  it('the signal waits 300 ms and a second one inside the wait restarts it', async () => {
    const { calls } = backend()
    renderTab()
    await loaded()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    act(() => probe.actions.notifyArtifactsChanged())
    await act(async () => { vi.advanceTimersByTime(299) })
    expect(listRequests(calls).length).toBe(1)
    act(() => probe.actions.notifyArtifactsChanged())
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(listRequests(calls).length).toBe(1)
    await act(async () => { vi.advanceTimersByTime(60) })
    expect(listRequests(calls).length).toBe(2)
  })

  it('a hidden page reads nothing when it gets focus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { calls } = backend()
    renderTab()
    await loaded()
    vi.setSystemTime(Date.now() + 5000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(listRequests(calls).length).toBe(1)
  })

  it('an artifact the agent published (the signal) is read again after 300 ms, several in a row are one read', async () => {
    const { calls, state } = backend()
    renderTab()
    await loaded()
    state.artifacts = [...state.artifacts, artifact(30, 'Pessoal/tn-sandbox', { title: 'Fresh one', path: 'fresh.md' })]
    act(() => {
      probe.actions.notifyArtifactsChanged()
      probe.actions.notifyArtifactsChanged()
      probe.actions.notifyArtifactsChanged()
    })
    expect(listRequests(calls).length).toBe(1)
    expect(await screen.findByText('Fresh one')).toBeTruthy()
    expect(listRequests(calls).length).toBe(2)
  })
})

describe('ArtifactsTab: the "Sem workspace" option', () => {
  it('reports true when an UNFILTERED read has an artifact outside every workspace', async () => {
    backend()
    const { onHasUnassigned } = renderTab()
    await loaded()
    await waitFor(() => expect(onHasUnassigned).toHaveBeenLastCalledWith(true))
  })

  it('reports false when every artifact has a place', async () => {
    backend({ artifacts: ARTIFACTS.filter((entry) => !['a6', 'a7'].includes(entry.artifact_id)) })
    const { onHasUnassigned } = renderTab()
    await loaded()
    await waitFor(() => expect(onHasUnassigned).toHaveBeenLastCalledWith(false))
  })

  it('says nothing when the read was narrowed to one workspace (it cannot know)', async () => {
    backend()
    const { onHasUnassigned } = renderTab({ workspaceKey: 'Pessoal' })
    await loaded()
    expect(onHasUnassigned).not.toHaveBeenCalled()
  })
})

describe('ArtifactsTab: the menu opened by a long press (D-27)', () => {
  const cardNode = () => document.querySelector('[data-artifact-id="a1"]')
  const scrim = () => screen.queryByTestId('artifact-menu-scrim')

  it('the residual click of the lifting finger does not close the menu; a press of its own does', async () => {
    backend()
    renderTab()
    await loaded()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.pointerDown(cardNode(), { pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => { vi.advanceTimersByTime(500) })
    expect(scrim()).toBeTruthy()
    // the click the browser sends on release lands on the scrim, which no press of its own began
    fireEvent.click(scrim())
    expect(scrim()).toBeTruthy()
    fireEvent.pointerDown(scrim(), { pointerType: 'touch' })
    fireEvent.click(scrim())
    expect(scrim()).toBeNull()
  })
})
