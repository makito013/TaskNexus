// The viewer panel of the Artefatos tab: where it is drawn at each width, what it shows, how its tabs
// follow the list and survive a reload, and where a link inside an artifact goes (PA-17, PA-18, PA-19, PA-23).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { ARTIFACT_TABS_KEY } from '../../../../hooks/useArtifactTabsStorage.js'
import { contentBody, jsonResponse, probe } from '../viewer/viewerTestKit.jsx'
import { ARTIFACTS, artifact } from './artifactFixtures.js'
import { createArtifactsKit } from './artifactTestKit.jsx'

installDialogElementStub()
// The panel is a lazy chunk: the first test to draw it pays for the cold import, which a loaded machine can
// stretch past the default second.
configure({ asyncUtilTimeout: 5000 })

const { backend, renderTab } = createArtifactsKit({ vi, render })

const OTHER = artifact(20, 'Pessoal/tn-sandbox', { title: 'Other doc', path: 'docs/other.md' })
const LIST = [...ARTIFACTS, OTHER]
const LINKS = '[next](other.md) [gone](missing.md) [out](../../x.md) [root](/plan.md) [site](https://example.com)'

beforeEach(() => {
  clearViewerContentCache()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const root = () => document.querySelector('.v3-artifacts')
const card = (title) => screen.getByRole('button', { name: new RegExp(`^${title} \\(`) })
const panel = () => screen.findByRole('region', { name: 'Visualizador de arquivos' })
const loaded = () => screen.findByText('Relatório Q3')
const tabs = () => probe.viewer.getScope('artefatos').items

describe('where the panel is drawn', () => {
  it('is a column beside the gallery from 1280 px, 420 px wide, and the card says it is open', async () => {
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    expect(root().hasAttribute('data-viewer-dock')).toBe(false)
    fireEvent.click(card('Relatório Q3'))
    expect(root().hasAttribute('data-viewer-dock')).toBe(true)
    expect(root().style.getPropertyValue('--v3-viewer-dock-width')).toBe('420px')
    const region = await panel()
    expect(screen.getByTestId('viewer-dock').contains(region)).toBe(true)
    expect(card('Relatório Q3').getAttribute('aria-current')).toBe('true')
    expect(card('Plan').getAttribute('aria-current')).toBeNull()
    expect(await screen.findByText('Body')).toBeTruthy()
  })

  it('shows the file read from the ARTIFACT route, with a download link of the same route', async () => {
    const { calls } = backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    await screen.findByText('Body')
    expect(calls('/api/artifacts/a1/content', 'GET').length).toBe(1)
    expect(screen.getByRole('link', { name: 'Baixar' }).getAttribute('href')).toBe('/api/artifacts/a1/f/docs/q3.md?download=1')
    // an artifact tab was not "opened by" anyone and cannot be saved again
    expect(screen.queryByText(/aberto/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Salvar em Artefatos/ })).toBeNull()
  })

  it('is a drawer over the gallery from 1024 to 1279 px, with the focus on the active tab (the person asked)', async () => {
    window.innerWidth = 1100
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    const drawer = await screen.findByTestId('viewer-drawer')
    expect(root().hasAttribute('data-viewer-dock')).toBe(false)
    expect(within(drawer).getByRole('complementary', { name: 'Visualizador de arquivos' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(within(drawer).getByRole('tab', { selected: true })))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByTestId('viewer-drawer')).toBeNull()
  })

  it.each([[1279, 'drawer'], [1280, 'dock'], [1024, 'drawer']])('at %i px it is a %s', async (width, kind) => {
    window.innerWidth = width
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    await screen.findByRole(kind === 'dock' ? 'region' : 'complementary', { name: 'Visualizador de arquivos' })
    expect(Boolean(screen.queryByTestId('viewer-dock'))).toBe(kind === 'dock')
    expect(Boolean(screen.queryByTestId('viewer-drawer'))).toBe(kind === 'drawer')
  })

  it('the expand button takes it to a full screen over everything, at any width', async () => {
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    fireEvent.click(await screen.findByRole('button', { name: 'Tela cheia' }))
    expect(document.querySelector('dialog[data-viewer-fullscreen]')).not.toBeNull()
    expect(probe.viewer.getSurface('artefatos').fullscreen).toBe(true)
  })

  it('closing the panel gives the focus back to the card that was opened', async () => {
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Plan'))
    await panel()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualizador' }))
    expect(screen.queryByTestId('viewer-dock')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(card('Plan')))
  })

  it('the dock never takes more than leaves the gallery its minimum, and the saved width is not rewritten', async () => {
    window.localStorage.setItem('escritorio:viewer-dock-width', '1000')
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    await panel()
    // 1440 - 148 chrome - 16 gap - 320 gallery
    expect(root().style.getPropertyValue('--v3-viewer-dock-width')).toBe('956px')
    expect(window.localStorage.getItem('escritorio:viewer-dock-width')).toBe('1000')
  })
})

describe('the tabs', () => {
  it('opening cards adds tabs, a card already open is reused, and the list is remembered for this window', async () => {
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    fireEvent.click(card('Plan'))
    fireEvent.click(card('Relatório Q3'))
    expect(tabs().map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(tabs().every((item) => item.source === 'artifact')).toBe(true)
    await waitFor(() => {
      const stored = JSON.parse(window.sessionStorage.getItem(ARTIFACT_TABS_KEY))
      expect(stored.items.map((item) => item.artifact_id)).toEqual(['a1', 'a2'])
      expect(stored.activeId).toBe('a1')
    })
  })

  it('restoring the tabs after a reload fills the list and NEVER opens the panel', async () => {
    window.sessionStorage.setItem(ARTIFACT_TABS_KEY, JSON.stringify({
      items: [{ artifact_id: 'a1', project_id: 'Pessoal/tn-sandbox', path: 'docs/q3.md', title: 'Relatório Q3', kind: 'markdown', updated_at: 1_700_000_001 }],
      activeId: 'a1',
    }))
    const { calls } = backend({ artifacts: LIST })
    renderTab()
    await loaded()
    await waitFor(() => expect(tabs().map((item) => item.id)).toEqual(['a1']))
    expect(probe.viewer.getSurface('artefatos').open).toBe(false)
    expect(screen.queryByRole('region', { name: 'Visualizador de arquivos' })).toBeNull()
    expect(root().hasAttribute('data-viewer-dock')).toBe(false)
    expect(calls('/api/artifacts/a1/content', 'GET').length).toBe(0)
    // the button of the bar says how many tabs are waiting and opens the panel on demand
    const button = screen.getByRole('button', { name: /Visualizador/ })
    expect(button.textContent).toContain('Abas abertas: 1')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    await panel()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByText('Body')).toBeTruthy()
  })

  it('an unreadable or foreign stored value is ignored and the panel still never opens', async () => {
    window.sessionStorage.setItem(ARTIFACT_TABS_KEY, '{not json')
    backend({ artifacts: LIST })
    renderTab()
    await loaded()
    expect(tabs()).toEqual([])
    expect(screen.queryByRole('button', { name: /Visualizador/ })).toBeNull()
  })

  it('a tab restored for a project that left the registry opens with the 404 of the file (not cleaned away)', async () => {
    window.sessionStorage.setItem(ARTIFACT_TABS_KEY, JSON.stringify({
      items: [{ artifact_id: 'ghost', project_id: 'Gone/x', path: 'a.md', title: 'Ghost tab', kind: 'markdown', updated_at: 5 }],
      activeId: 'ghost',
    }))
    backend({ artifacts: LIST, content: () => ({ ok: false, status: 404, json: async () => ({ error: 'Arquivo não encontrado' }) }) })
    renderTab()
    await loaded()
    await waitFor(() => expect(tabs().map((item) => item.id)).toContain('ghost'))
    fireEvent.click(screen.getByRole('button', { name: /Visualizador/ }))
    expect(await screen.findByText('Esse arquivo não existe mais.')).toBeTruthy()
  })

  it('the open tab follows the list: a file that changed on disk refreshes the tab, no second tab appears', async () => {
    const { state } = backend({ artifacts: LIST })
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    await screen.findByText('Body')
    const before = tabs()[0].updated_at
    state.artifacts = state.artifacts.map((entry) => (entry.artifact_id === 'a1' ? { ...entry, mtime: entry.mtime + 500, title: 'Relatório Q3 v2' } : entry))
    act(() => probe.actions.notifyArtifactsChanged())
    await waitFor(() => expect(tabs()[0].title).toBe('Relatório Q3 v2'), { timeout: 2000 })
    expect(tabs().length).toBe(1)
    expect(tabs()[0].updated_at).toBeGreaterThan(before)
  })
})

describe('a link inside an open artifact', () => {
  const body = () => jsonResponse(contentBody({ kind: 'markdown', text: LINKS }))

  async function openWithLinks() {
    backend({ artifacts: LIST, content: (url) => (url.includes('/a1/') ? body() : jsonResponse(contentBody({ text: '# Other' }))) })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTab()
    await loaded()
    fireEvent.click(card('Relatório Q3'))
    await screen.findByRole('link', { name: 'next' })
    return open
  }

  it('a link to ANOTHER artifact of the list opens it as a tab of the panel', async () => {
    const open = await openWithLinks()
    fireEvent.click(screen.getByRole('link', { name: 'next' }))
    await waitFor(() => expect(tabs().map((item) => item.id)).toEqual(['a1', 'a20']))
    expect(probe.viewer.getScope('artefatos').activeId).toBe('a20')
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByText('Other')).toBeTruthy()
  })

  it('a link to a file that is not in the list opens the f/ route of the artifact in a new tab, without opener', async () => {
    const open = await openWithLinks()
    fireEvent.click(screen.getByRole('link', { name: 'gone' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('/api/artifacts/a1/f/docs/missing.md', '_blank', 'noopener,noreferrer')
    expect(tabs().length).toBe(1)
  })

  it('a link that starts at the root of the project is resolved from the root, not from the folder', async () => {
    const open = await openWithLinks()
    fireEvent.click(screen.getByRole('link', { name: 'root' }))
    expect(open).toHaveBeenCalledWith('/api/artifacts/a1/f/plan.md', '_blank', 'noopener,noreferrer')
  })

  it('a link that leaves the project says so in a toast and opens nothing', async () => {
    const open = await openWithLinks()
    fireEvent.click(screen.getByRole('link', { name: 'out' }))
    expect(await screen.findByText('Esse link aponta para fora do projeto.')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    expect(tabs().length).toBe(1)
  })

  it('a link to another site stays an external link with noopener, and is not handled by the tab', async () => {
    const open = await openWithLinks()
    const link = screen.getByRole('link', { name: /site/ })
    expect(link.getAttribute('rel')).toMatch(/noopener/)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(open).not.toHaveBeenCalled()
  })
})
