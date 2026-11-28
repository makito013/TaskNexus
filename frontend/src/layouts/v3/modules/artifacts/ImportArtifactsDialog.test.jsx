import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import { artifact } from './artifactFixtures.js'
import ImportArtifactsDialog, { RECENT_WINDOW_DAYS } from './ImportArtifactsDialog.jsx'
import { importableProjects } from './artifactScope.js'
import { createArtifactsKit, failure, index } from './artifactTestKit.jsx'

installDialogElementStub()

const { backend, renderTab, stubFetch } = createArtifactsKit({ vi, render })

const NOW = Math.floor(Date.now() / 1000)
const cand = (path, extra = {}) => ({ path, kind: path.endsWith('.pdf') ? 'pdf' : path.endsWith('.html') ? 'html' : 'markdown', size: 1536, mtime: NOW - 60, ...extra })
const RECENT = [cand('docs/a.md'), cand('docs/b.html', { mtime: NOW - 86400 })]
const OLDER = cand('old/c.pdf', { mtime: 1_600_000_000, recent: false })
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
const PROJECTS = importableProjects(index)

function route({ candidates = [...RECENT, OLDER], hasOlder = true, importer = null, candidatesFor = null } = {}) {
  const requests = { candidates: [], imports: [] }
  const fetchMock = stubFetch([
    [/\/api\/artifacts\/import$/, (url, init) => {
      const body = JSON.parse(init.body)
      requests.imports.push(body)
      if (importer) return importer(body)
      return json({ created: body.caminhos.length, artifacts: body.caminhos.map((path, n) => artifact(50 + n, body.project_id, { path, title: path })), errors: [] })
    }],
    [/\/api\/projects\/.+\/artifact-candidates/, (url) => {
      requests.candidates.push(url)
      if (candidatesFor) return candidatesFor(url)
      const older = !url.includes('window_days')
      const answer = candidates.filter((entry) => older || entry.recent !== false)
      return json({ candidates: answer, truncated: false, since: NOW - 3 * 86400, has_older: hasOlder && !older })
    }],
  ])
  return { fetchMock, requests }
}

function setup(props = {}) {
  const onClose = vi.fn()
  const onImported = vi.fn()
  const view = render(
    <ImportArtifactsDialog projects={PROJECTS} registry={index} initialProjectKey="Pessoal/tn-sandbox" onClose={onClose} onImported={onImported} {...props} />,
  )
  return { ...view, onClose, onImported }
}
const dialog = () => screen.getByTestId('import-artifacts-dialog')
const checkbox = (name) => within(dialog()).getByRole('checkbox', { name })
const importButton = () => screen.getByRole('button', { name: /^Importar (\d+ arquivos?|…)|^Importando…/ })
const ready = () => screen.findByText('a.md')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ImportArtifactsDialog: the list', () => {
  it('offers the registered projects with the registry labels, starts on the one asked for and reads 5 days', async () => {
    const { requests } = route()
    setup()
    const select = screen.getByRole('combobox', { name: 'Projeto' })
    expect([...select.options].map((option) => option.textContent)).toEqual(['Pessoal / tn-sandbox', 'Pessoal / Docs', 'Estudos / Lab'])
    expect(select.value).toBe('Pessoal/tn-sandbox')
    expect(document.activeElement).toBe(select)
    await ready()
    expect(requests.candidates).toEqual([`/api/projects/Pessoal/tn-sandbox/artifact-candidates?window_days=${RECENT_WINDOW_DAYS}`])
  })

  it('shows still rows while it reads, then name, path, type, size and the day of each file', async () => {
    let resolve
    route({ candidatesFor: () => new Promise((done) => { resolve = done }) })
    setup()
    expect(screen.getByText('Procurando arquivos recentes…')).toBeTruthy()
    await act(async () => { resolve(json({ candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: false })) })
    await ready()
    const row = checkbox(/a\.md/).closest('label')
    expect(within(row).getByText('docs/a.md').getAttribute('title')).toBe('docs/a.md')
    expect(within(row).getByText('MD')).toBeTruthy()
    expect(within(row).getByText(/^hoje \d\d:\d\d$/)).toBeTruthy()
    expect(within(row).getByText(/1\.5 KB|1,5 KB/)).toBeTruthy()
    expect(within(checkbox(/b\.html/).closest('label')).getByText(/^ontem \d\d:\d\d$/)).toBeTruthy()
  })

  it('"Selecionar todos" marks every row, the counter says how many and the button follows', async () => {
    route({ hasOlder: false })
    setup()
    await ready()
    expect(importButton().disabled).toBe(true)
    expect(importButton().textContent).toBe('Importar 0 arquivos')
    fireEvent.click(checkbox(/Selecionar todos/))
    expect(within(dialog()).getByText('2 selecionados')).toBeTruthy()
    expect(importButton().textContent).toBe('Importar 2 arquivos')
    expect(importButton().disabled).toBe(false)
    fireEvent.click(checkbox(/a\.md/))
    expect(within(dialog()).getByText('1 selecionado')).toBeTruthy()
    expect(checkbox(/Selecionar todos/).indeterminate).toBe(true)
    fireEvent.click(checkbox(/Selecionar todos/))
    fireEvent.click(checkbox(/Selecionar todos/))
    expect(within(dialog()).getByText('0 selecionados')).toBeTruthy()
  })

  it('"Buscar mais antigos" REPLACES the list (the recent ones stay once, no duplicates) and says what it did', async () => {
    const { requests } = route()
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    expect(await screen.findByText('c.pdf')).toBeTruthy()
    expect(requests.candidates[1]).toBe('/api/projects/Pessoal/tn-sandbox/artifact-candidates')
    expect(screen.getAllByText('a.md').length).toBe(1)
    expect(screen.getByRole('heading', { name: 'Mais antigos (1)' })).toBeTruthy()
    expect(screen.getByTestId('import-announcement').textContent).toBe('1 arquivo mais antigo adicionado.')
    expect(screen.queryByRole('button', { name: 'Buscar mais antigos' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Mais antigos (1)' }))
  })

  it('while it searches: busy, an info line, still rows and no importing', async () => {
    let resolve
    route({ candidatesFor: (url) => (url.includes('window_days')
      ? json({ candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: true })
      : new Promise((done) => { resolve = done })) })
    setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    expect(screen.getByText('Procurando arquivos mais antigos… isso pode demorar.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Buscando…' }).getAttribute('aria-busy')).toBe('true')
    expect(importButton().disabled).toBe(true)
    await act(async () => { resolve(json({ candidates: [...RECENT, OLDER], truncated: false, since: NOW - 86400 * 3, has_older: false })) })
    expect(await screen.findByText('c.pdf')).toBeTruthy()
  })

  it('a file that vanished from the replaced list is dropped from the selection', async () => {
    let call = 0
    route({ candidatesFor: (url) => {
      call += 1
      if (url.includes('window_days')) return json({ candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: true })
      return json({ candidates: [RECENT[1], OLDER], truncated: false, since: NOW - 86400 * 3, has_older: false })
    } })
    setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.click(checkbox(/b\.html/))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    await screen.findByText('c.pdf')
    expect(call).toBe(2)
    expect(within(dialog()).getByText('1 selecionado')).toBeTruthy()
    expect(screen.queryByText('a.md')).toBeNull()
  })

  it('a window with nothing recent says so and offers the older ones', async () => {
    route({ candidates: [OLDER] })
    setup()
    expect(await screen.findByText(`Nenhum arquivo novo nos últimos ${RECENT_WINDOW_DAYS} dias.`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    expect(await screen.findByText('c.pdf')).toBeTruthy()
  })

  it('a project with nothing to import says the files are already there, and "Nada mais antigo" after a search', async () => {
    route({ candidates: [], hasOlder: false })
    setup()
    expect(await screen.findByText('Nenhum arquivo para importar neste projeto.')).toBeTruthy()
    expect(screen.getByText(/já estavam em Artefatos/)).toBeTruthy()
    cleanup()
    route({ candidates: RECENT, hasOlder: true, candidatesFor: (url) => json(
      url.includes('window_days')
        ? { candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: true }
        : { candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: false },
    ) })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    await waitFor(() => expect(screen.getAllByText('Nada mais antigo neste projeto.').length).toBe(2))
    // the visible line and the one said aloud
    expect(screen.getByTestId('import-announcement').textContent).toBe('Nada mais antigo neste projeto.')
  })

  it('a failed read shows the error and "Tentar de novo" reads again', async () => {
    let attempts = 0
    route({ candidatesFor: () => {
      attempts += 1
      return attempts === 1 ? failure(500, 'Pasta ilegível.') : json({ candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: false })
    } })
    setup()
    expect((await screen.findByRole('alert')).textContent).toContain('Pasta ilegível.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await ready()
    expect(attempts).toBe(2)
  })

  it('a failed "mais antigos" keeps the list and offers another try', async () => {
    route({ candidatesFor: (url) => (url.includes('window_days')
      ? json({ candidates: RECENT, truncated: false, since: NOW - 86400 * 3, has_older: true })
      : failure(500, 'x')) })
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar mais antigos' }))
    expect((await screen.findByText('Não consegui buscar os mais antigos.')).getAttribute('role')).toBe('alert')
    expect(screen.getByText('a.md')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('a truncated answer says the 300 most recent are shown', async () => {
    route({ candidatesFor: () => json({ candidates: RECENT, truncated: true, since: NOW - 86400 * 3, has_older: false }) })
    setup()
    expect(await screen.findByText(/Mostrando os 300 arquivos mais recentes/)).toBeTruthy()
  })

  it('a project with extra folders warns that only the main one is imported (R-08)', async () => {
    route({ hasOlder: false })
    setup({ initialProjectKey: '.w12/.p38' })
    expect(screen.getByText('Este projeto tem pastas adicionais; só a pasta principal pode ser importada.')).toBeTruthy()
    await ready()
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/tn-sandbox' } })
    expect(screen.queryByText(/pastas adicionais/)).toBeNull()
  })

  it('changing the project reads that project and clears the selection', async () => {
    const { requests } = route({ hasOlder: false })
    setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/.p37' } })
    await waitFor(() => expect(requests.candidates.length).toBe(2))
    expect(requests.candidates[1]).toContain('/api/projects/Pessoal/.p37/artifact-candidates')
    await ready()
    expect(within(dialog()).getByText('0 selecionados')).toBeTruthy()
  })

  it('with no registered project there is nothing to read and the select is off', () => {
    const { fetchMock } = route()
    setup({ projects: [], initialProjectKey: null })
    expect(screen.getByText('Não há projeto cadastrado para importar.')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Projeto' }).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the first project when the one asked for is not offered', async () => {
    route({ hasOlder: false })
    setup({ initialProjectKey: 'Pessoal/old' })
    expect(screen.getByRole('combobox', { name: 'Projeto' }).value).toBe('Pessoal/tn-sandbox')
    await ready()
  })
})

describe('ImportArtifactsDialog: importing', () => {
  it('sends the project and the selected paths once, tells the screen and closes on success', async () => {
    const { requests } = route({ hasOlder: false })
    const { onClose, onImported } = setup()
    await ready()
    fireEvent.click(checkbox(/Selecionar todos/))
    const button = importButton()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(requests.imports).toEqual([{ project_id: 'Pessoal/tn-sandbox', caminhos: ['docs/a.md', 'docs/b.html'] }])
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(onImported.mock.calls[0][0].created).toBe(2)
  })

  it('a mixed result: what worked leaves, what failed stays marked with its own reason, the dialog stays open', async () => {
    route({
      hasOlder: false,
      importer: (body) => json({
        created: 1,
        artifacts: [artifact(60, body.project_id, { path: 'docs/a.md', title: 'a.md' })],
        errors: [{ caminho: 'docs/b.html', erro: 'Arquivo grande demais.' }],
      }),
    })
    const { onClose, onImported } = setup()
    await ready()
    fireEvent.click(checkbox(/Selecionar todos/))
    fireEvent.click(importButton())
    expect(await screen.findByText('Arquivo grande demais.')).toBeTruthy()
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(onImported.mock.calls[0][0].errors).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('a.md')).toBeNull()
    expect(checkbox(/b\.html/).checked).toBe(true)
    const summary = screen.getByText(/1 importado\(s\)\. Não consegui importar este:/)
    expect(summary.closest('[role="alert"]')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(summary))
    expect(importButton().textContent).toBe('Importar 1 arquivo')
  })

  it('a failed request shows the reason in an alert, keeps the selection and can be tried again', async () => {
    route({ hasOlder: false, importer: () => failure(500, 'Servidor ocupado.') })
    const { onClose, onImported } = setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.click(importButton())
    expect((await screen.findByText('Servidor ocupado.')).closest('[role="alert"]')).toBeTruthy()
    expect(onImported).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(checkbox(/a\.md/).checked).toBe(true)
    expect(importButton().disabled).toBe(false)
  })

  it('a network failure is said in Portuguese', async () => {
    route({ hasOlder: false, importer: () => { throw new TypeError('Failed to fetch') } })
    setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.click(importButton())
    expect(await screen.findByText('Sem conexão com o servidor. Tente de novo.')).toBeTruthy()
  })

  it('while importing nothing can be changed and "Importando…" says it', async () => {
    let resolve
    route({ hasOlder: false, importer: () => new Promise((done) => { resolve = done }) })
    setup()
    await ready()
    fireEvent.click(checkbox(/a\.md/))
    fireEvent.click(importButton())
    expect(screen.getByRole('button', { name: 'Importando…' }).getAttribute('aria-busy')).toBe('true')
    expect(checkbox(/a\.md/).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Projeto' }).disabled).toBe(true)
    await act(async () => { resolve(json({ created: 1, artifacts: [], errors: [] })) })
  })
})

// ---- through the tab ----
describe('importing in the Artefatos tab', () => {
  beforeEach(() => {
    clearViewerContentCache()
    window.sessionStorage.clear()
    window.innerWidth = 1440
  })

  it('the button of the bar is aria-disabled and explained when no project can take an import', async () => {
    backend()
    renderTab({ workspaceKey: NO_WORKSPACE_VALUE })
    await screen.findByText('Stray')
    const [button] = screen.getAllByRole('button', { name: '＋ Importar do projeto…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const hint = document.getElementById(button.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('Não há projeto cadastrado neste filtro para importar.')
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('imports: toast with the count, the new cards on the list, the focus on the gallery', async () => {
    const { calls } = backend({ candidates: RECENT, hasOlder: false })
    renderTab({ workspaceKey: 'Pessoal' })
    await screen.findByText('Relatório Q3')
    fireEvent.click(screen.getAllByRole('button', { name: '＋ Importar do projeto…' })[0])
    fireEvent.click(await within(document.body).findByRole('checkbox', { name: /Selecionar todos/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Importar 2 arquivos' }))
    expect(await screen.findByText('2 artefatos importados.')).toBeTruthy()
    expect(calls('/api/artifacts/import', 'POST').length).toBe(1)
    expect(await screen.findByRole('button', { name: /^docs\/a\.md \(MD\)/ })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Galeria de artefatos' })))
  })

  it('files that were all there already: "Esses arquivos já estavam em Artefatos."', async () => {
    backend({
      candidates: RECENT,
      hasOlder: false,
      importer: (body) => json({ created: 0, artifacts: [artifact(1, body.project_id, { path: 'docs/a.md', title: 'Relatório Q3' })], errors: [] }),
    })
    renderTab({ workspaceKey: 'Pessoal' })
    await screen.findByText('Relatório Q3')
    fireEvent.click(screen.getAllByRole('button', { name: '＋ Importar do projeto…' })[0])
    fireEvent.click(await within(document.body).findByRole('checkbox', { name: /a\.md/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Importar 1 arquivo' }))
    expect(await screen.findByText('Esses arquivos já estavam em Artefatos.')).toBeTruthy()
  })

  it('offers only the projects of the workspace of the header, and starts on the refined one', async () => {
    backend({ candidates: RECENT, hasOlder: false })
    renderTab({ workspaceKey: 'Pessoal' })
    await screen.findByText('Relatório Q3')
    fireEvent.change(screen.getByRole('combobox', { name: 'Projeto' }), { target: { value: 'Pessoal/.p37' } })
    fireEvent.click(screen.getAllByRole('button', { name: '＋ Importar do projeto…' })[0])
    await screen.findByTestId('import-artifacts-dialog')
    const selects = screen.getAllByRole('combobox', { name: 'Projeto' })
    const inDialog = selects[selects.length - 1]
    expect([...inDialog.options].map((option) => option.textContent)).toEqual(['Pessoal / tn-sandbox', 'Pessoal / Docs'])
    expect(inDialog.value).toBe('Pessoal/.p37')
  })
})
