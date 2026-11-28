import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { probe } from '../viewer/viewerTestKit.jsx'
import { artifact } from './artifactFixtures.js'
import RenameArtifactDialog from './RenameArtifactDialog.jsx'
import { createArtifactsKit, failure } from './artifactTestKit.jsx'

installDialogElementStub()

const row = artifact(1, 'Pessoal/tn-sandbox', { title: 'Relatório Q3', path: 'docs/q3.md' })
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

function setup(props = {}) {
  const onClose = vi.fn()
  const onRenamed = vi.fn()
  const view = render(<RenameArtifactDialog artifact={row} onClose={onClose} onRenamed={onRenamed} {...props} />)
  return { ...view, onClose, onRenamed }
}
const field = () => screen.getByRole('textbox', { name: 'Título' })
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Renomear' }))
const patches = (fetchMock) => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RenameArtifactDialog', () => {
  it('opens on the field with the current title, saying the file keeps its name', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Renomear artefato' })).toBeTruthy()
    expect(field().value).toBe('Relatório Q3')
    expect(document.activeElement).toBe(field())
    expect(screen.getByText('O arquivo docs/q3.md continua com o mesmo nome.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
  })

  it('an empty title is refused inline and sends no request; typing clears the message', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { onClose } = setup()
    fireEvent.change(field(), { target: { value: '   ' } })
    submit()
    expect(screen.getByRole('alert').textContent).toContain('Dê um título ao artefato.')
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.change(field(), { target: { value: 'Novo' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the same title (spaces aside) closes without a request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { onClose, onRenamed } = setup()
    fireEvent.change(field(), { target: { value: '  Relatório Q3  ' } })
    submit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRenamed).not.toHaveBeenCalled()
  })

  it('sends the trimmed title in a PATCH, hands the updated row up and closes', async () => {
    const fetchMock = vi.fn(async () => json({ ...row, title: 'Novo título' }))
    vi.stubGlobal('fetch', fetchMock)
    const { onClose, onRenamed } = setup()
    fireEvent.change(field(), { target: { value: '  Novo título ' } })
    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(patches(fetchMock).length).toBe(1)
    const [url, init] = patches(fetchMock)[0]
    expect(url).toBe('/api/artifacts/a1')
    expect(JSON.parse(init.body)).toEqual({ titulo: 'Novo título' })
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ title: 'Novo título' }))
  })

  it('a double submit is ONE request, and the button says it is busy', async () => {
    let resolve
    const fetchMock = vi.fn(() => new Promise((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetchMock)
    setup()
    fireEvent.change(field(), { target: { value: 'Outro' } })
    submit()
    fireEvent.submit(field().closest('form'))
    expect(patches(fetchMock).length).toBe(1)
    const busy = screen.getByRole('button', { name: 'Renomeando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await act(async () => { resolve(json({ ...row, title: 'Outro' })) })
  })

  it('a refusal of the server stays inside, keeps the dialog open and returns to the field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: 'Título longo demais.' }, 400)))
    const { onClose, onRenamed } = setup()
    fireEvent.change(field(), { target: { value: 'Outro' } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toContain('Título longo demais.')
    expect(onClose).not.toHaveBeenCalled()
    expect(onRenamed).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field())
    // and it can be tried again
    expect(screen.getByRole('button', { name: 'Renomear' }).getAttribute('aria-busy')).toBeNull()
  })

  it('a network failure is said in Portuguese', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    setup()
    fireEvent.change(field(), { target: { value: 'Outro' } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toContain('Sem conexão com o servidor. Tente de novo.')
  })

  it('Esc and "Cancelar" close it without a request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an answer that arrives after it was closed hands nothing up', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done })))
    const { onRenamed, unmount } = setup()
    fireEvent.change(field(), { target: { value: 'Outro' } })
    submit()
    unmount()
    await act(async () => { resolve(json({ ...row, title: 'Outro' })) })
    expect(onRenamed).not.toHaveBeenCalled()
  })
})

// ---- through the tab ----
const { backend, renderTab } = createArtifactsKit({ vi, render })

describe('renaming in the Artefatos tab', () => {
  beforeEach(() => {
    clearViewerContentCache()
    window.sessionStorage.clear()
    window.innerWidth = 1440
  })

  async function openRename(title) {
    fireEvent.click(await screen.findByRole('button', { name: `Ações de ${title}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear…' }))
  }

  it('the card and the OPEN tab follow the new title, with a toast and the focus back on the card', async () => {
    backend()
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Relatório Q3 (MD)' }))
    await waitFor(() => expect(probe.viewer.getScope('artefatos').items.length).toBe(1))
    await openRename('Relatório Q3')
    fireEvent.change(field(), { target: { value: 'Relatório final' } })
    submit()
    expect(await screen.findByText('Artefato renomeado.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Relatório final (MD)' })).toBeTruthy()
    expect(screen.queryByText('Relatório Q3')).toBeNull()
    await waitFor(() => expect(probe.viewer.getScope('artefatos').items.map((item) => item.title)).toEqual(['Relatório final']))
    // no second tab was opened
    expect(probe.viewer.getScope('artefatos').items.length).toBe(1)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Relatório final (MD)' })))
  })

  it('an empty title never reaches the server from the tab', async () => {
    const { calls } = backend()
    renderTab()
    await openRename('Relatório Q3')
    fireEvent.change(field(), { target: { value: '' } })
    submit()
    expect(screen.getByRole('alert').textContent).toContain('Dê um título ao artefato.')
    expect(calls('/api/artifacts/a1', 'PATCH').length).toBe(0)
  })

  it('a rename refused by the server keeps the title on the card', async () => {
    backend({ rename: () => failure(400, 'Título inválido.') })
    renderTab()
    await openRename('Relatório Q3')
    fireEvent.change(field(), { target: { value: 'Outro' } })
    submit()
    expect((await within(document.body).findByRole('alert')).textContent).toContain('Título inválido.')
    expect(screen.getAllByText('Relatório Q3').length).toBeGreaterThan(0)
  })
})
