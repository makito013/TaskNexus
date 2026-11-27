// "☆ Salvar em Artefatos" in the bar of the viewer (05 section 3.5, PA-14, PV-16): only for a tab of a
// conversation holding a .md/.html/.pdf of a project that is not an artifact yet; idempotent (201 new, 200
// already was); the answer is a toast.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { clearArtifactStatusCache } from '../../../../hooks/useSaveToArtifacts.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import ViewerToolbar from './ViewerToolbar.jsx'
import { KEY } from './viewerTestKit.jsx'

const ITEM = {
  id: 'i1',
  source: 'viewer',
  session_key: KEY,
  project_id: 'Pessoal/tn-sandbox',
  path: 'docs/plan.md',
  title: 'plan.md',
  kind: 'markdown',
  opened_by: 'agent',
  updated_at: 1_700_000_000,
}
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

function routes({ listed = [], post = () => json({ artifact_id: 'a1' }, 201), list = null } = {}) {
  const fetchMock = vi.fn(async (url, init) => {
    if (init?.method === 'POST') return post(JSON.parse(init.body))
    if (String(url).startsWith('/api/artifacts?')) return list ? list() : json({ artifacts: listed })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const posts = (fetchMock) => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

function setup(item = ITEM) {
  return render(
    <ToastHost>
      <ViewerToolbar item={item} content={{ name: 'plan.md', kind: 'markdown', text: '# Plan', size: 6 }} status="ready" onCloseTab={vi.fn()} />
    </ToastHost>,
  )
}
const saveButton = () => screen.queryByRole('button', { name: /Salvar em Artefatos|Salvando…|Salvo/ })
const settle = () => act(async () => {})

beforeEach(() => clearArtifactStatusCache())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('"Salvar em Artefatos": when it shows', () => {
  it('shows for a Markdown, HTML or PDF of a conversation that is not an artifact yet, asking the project list once', async () => {
    const fetchMock = routes()
    setup()
    await settle()
    expect(saveButton().textContent).toBe('☆ Salvar em Artefatos')
    expect(saveButton().getAttribute('aria-disabled')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/artifacts?projeto_id=Pessoal%2Ftn-sandbox'])
    for (const path of ['docs/a.html', 'docs/b.pdf']) {
      cleanup()
      clearArtifactStatusCache()
      setup({ ...ITEM, path })
      await settle()
      expect(saveButton(), path).not.toBeNull()
    }
  })

  it.each([
    ['a text file that is not a deliverable', { path: 'src/app.js' }],
    ['a tab with no project', { project_id: undefined }],
    ['an artifact tab', { source: 'artifact' }],
    ['a card attachment tab', { source: 'card_attachment' }],
  ])('does not show for %s, and asks nothing', async (_label, patch) => {
    const fetchMock = routes()
    setup({ ...ITEM, ...patch })
    await settle()
    expect(saveButton()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not show when the file is already an artifact of the project', async () => {
    routes({ listed: [{ project_id: 'Pessoal/tn-sandbox', path: 'docs/plan.md' }] })
    setup()
    await settle()
    expect(saveButton()).toBeNull()
  })

  it('an artifact of ANOTHER project with the same path does not hide it', async () => {
    routes({ listed: [{ project_id: 'Other/x', path: 'docs/plan.md' }] })
    setup()
    await settle()
    expect(saveButton()).not.toBeNull()
  })

  it('shows when the question itself failed (the POST is idempotent)', async () => {
    routes({ list: () => { throw new TypeError('Failed to fetch') } })
    setup()
    await settle()
    expect(saveButton()).not.toBeNull()
  })
})

describe('"Salvar em Artefatos": saving', () => {
  it('201: one POST with the project and the path, the toast says it was saved, the button says "Salvo"', async () => {
    const fetchMock = routes()
    setup()
    await settle()
    fireEvent.click(saveButton())
    expect(await screen.findByText('Salvo em Artefatos.')).toBeTruthy()
    expect(posts(fetchMock).length).toBe(1)
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ project_id: 'Pessoal/tn-sandbox', caminho: 'docs/plan.md' })
    expect(saveButton().textContent).toBe('★ Salvo')
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('200: it already was an artifact, and the toast says that instead', async () => {
    routes({ post: () => json({ artifact_id: 'a1' }, 200) })
    setup()
    await settle()
    fireEvent.click(saveButton())
    expect(await screen.findByText('Já estava em Artefatos.')).toBeTruthy()
  })

  it('while it saves the button is busy, says "Salvando…" and a second click sends nothing', async () => {
    let resolve
    const fetchMock = routes({ post: () => new Promise((done) => { resolve = done }) })
    setup()
    await settle()
    fireEvent.click(saveButton())
    const busy = screen.getByRole('button', { name: 'Salvando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(busy)
    expect(posts(fetchMock).length).toBe(1)
    await act(async () => { resolve(json({ artifact_id: 'a1' }, 201)) })
    expect(await screen.findByText('Salvo em Artefatos.')).toBeTruthy()
  })

  it('a failure is an alert toast with the fixed text and the button comes back to try again', async () => {
    routes({ post: () => json({ success: false, error: 'detalhe interno' }, 500) })
    setup()
    await settle()
    fireEvent.click(saveButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui salvar em Artefatos.')
    expect(alert.textContent).not.toContain('detalhe interno')
    expect(saveButton().textContent).toBe('☆ Salvar em Artefatos')
    expect(saveButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('a network failure is the same alert, never "Failed to fetch"', async () => {
    routes({ post: () => { throw new TypeError('Failed to fetch') } })
    setup()
    await settle()
    fireEvent.click(saveButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não consegui salvar em Artefatos.')
    expect(alert.textContent).not.toMatch(/failed to fetch/i)
  })

  it('the other actions of the bar are still there', async () => {
    routes()
    setup()
    await settle()
    expect(screen.getByRole('link', { name: 'Baixar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir no navegador' })).toBeTruthy()
  })
})
