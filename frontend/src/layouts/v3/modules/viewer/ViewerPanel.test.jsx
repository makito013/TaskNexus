import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { KEY, SCOPE, callsTo, contentBody, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'
import ViewerPanel from './ViewerPanel.jsx'

const { stubFetch, renderWithShell } = createHarness({ vi, render })

const A = viewerItem({ item_id: 'a', path: 'docs/a.md', title: 'a.md', updated_at: 1 })
const B = viewerItem({ item_id: 'b', path: 'docs/b.md', title: 'b.md', updated_at: 2 })
const sessionRoute = (items) => [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method ? jsonResponse({ success: true, evicted: [] }) : jsonResponse({ items }))]
const contentRoute = (id, body = contentBody({ text: `# ${id}` }), status = 200) => [`/api/viewer/${id}/content`, jsonResponse(body, status)]

beforeEach(() => {
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const panel = () => screen.getByRole('region', { name: 'Visualizador de arquivos' })
async function mount(routes, props = {}) {
  const fetchMock = stubFetch(routes)
  renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} {...props} />)
  await act(async () => {})
  return fetchMock
}

describe('ViewerPanel states', () => {
  it('without a conversation says to open one', async () => {
    stubFetch([])
    renderWithShell(<ViewerPanel scope={null} variant="dock" onClose={vi.fn()} />, { activeSessionKey: null })
    expect(within(panel()).getByText('Abra uma conversa para ver arquivos do projeto.')).toBeTruthy()
  })

  it('with no tabs says so and where they come from', async () => {
    await mount([sessionRoute([])])
    expect(within(panel()).getByText('Nenhum arquivo aberto.')).toBeTruthy()
    expect(within(panel()).getByText('Quando o agente abrir um arquivo, ele aparece aqui.')).toBeTruthy()
  })

  it('while the tabs load shows a busy skeleton with a status inside the panel', async () => {
    stubFetch([[`/api/sessions/${KEY}/viewer`, new Promise(() => {})]])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    const busy = panel().querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    expect(within(busy).getByRole('status').textContent).toBe('Carregando as abas…')
  })

  it('a failed list shows a pt-BR alert, never the engine wording, and one retry is one request', async () => {
    let attempt = 0
    const fetchMock = stubFetch([[`/api/sessions/${KEY}/viewer`, () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('Failed to fetch')
      return new Promise(() => {})
    }]])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    const alert = within(panel()).getByRole('alert')
    expect(alert.textContent).toContain('Não consegui carregar as abas.')
    expect(panel().textContent).not.toMatch(/failed to fetch/i)
    const retry = within(alert).getByRole('button', { name: 'Tentar de novo' })
    fireEvent.click(retry)
    // The second click arrives while the first request is still out: it must not send another.
    fireEvent.click(within(panel()).queryByRole('button', { name: 'Tentar de novo' }) ?? retry)
    expect(callsTo(fetchMock, 'GET')).toHaveLength(2)
  })

  it('shows the file while it opens, then the content', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    stubFetch([sessionRoute([A]), [`/api/viewer/a/content`, async () => { await gate; return jsonResponse(contentBody({ text: '# Alpha' })) }]])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    expect(within(panel()).getByRole('status').textContent).toBe('Abrindo a.md…')
    await act(async () => release())
    expect(await within(panel()).findByRole('heading', { name: 'Alpha' })).toBeTruthy()
    const body = within(panel()).getByRole('region', { name: 'Conteúdo de a.md' })
    expect(body.getAttribute('tabindex')).toBe('0')
  })

  it('a file that fails to open (server error) says so in pt-BR with a retry that asks once', async () => {
    let attempt = 0
    const fetchMock = stubFetch([sessionRoute([A]), [`/api/viewer/a/content`, () => {
      attempt += 1
      return attempt === 1 ? jsonResponse({ detail: 'Internal Server Error' }, 500) : jsonResponse(contentBody({ text: '# Alpha' }))
    }]])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    const alert = await within(panel()).findByRole('alert')
    expect(alert.textContent).toContain('Não consegui abrir o arquivo.')
    expect(panel().textContent).not.toMatch(/internal server error/i)
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    expect(await within(panel()).findByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(callsTo(fetchMock, 'GET').filter(([url]) => url.includes('/content'))).toHaveLength(2)
  })

  it('an ASYNC network rejection of the content is the same pt-BR alert', async () => {
    stubFetch([sessionRoute([A]), [`/api/viewer/a/content`, () => Promise.reject(new TypeError('Failed to fetch'))]])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    expect((await within(panel()).findByRole('alert')).textContent).toContain('Não consegui abrir o arquivo.')
    expect(panel().textContent).not.toMatch(/failed to fetch/i)
  })

  it('a 404 is "gone": offers closing the tab or trying again, and has no download', async () => {
    const fetchMock = await mount([sessionRoute([A]), contentRoute('a', { detail: 'Not found' }, 404)])
    expect(await within(panel()).findByText('Esse arquivo não existe mais.')).toBeTruthy()
    expect(within(panel()).queryByRole('link', { name: 'Baixar' })).toBeNull()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Fechar aba' }))
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items).toEqual([]))
    expect(callsTo(fetchMock, 'DELETE')).toHaveLength(1)
  })

  it('a close that fails on the network AFTER the tab vanished brings the list back from the server', async () => {
    let deleteCalls = 0
    stubFetch([
      [`/api/sessions/${KEY}/viewer`, (_url, init) => {
        if (init?.method === 'DELETE') {
          deleteCalls += 1
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        return jsonResponse({ items: [A] })
      }],
      contentRoute('a'),
    ])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    await within(panel()).findByRole('heading', { name: 'a' })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar a.md' }))
    await waitFor(() => expect(deleteCalls).toBe(1))
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual(['a']))
  })
})

describe('ViewerPanel tabs', () => {
  it('switches tabs, reads each file once and keeps the cache when coming back', async () => {
    const fetchMock = await mount([sessionRoute([A, B]), contentRoute('a'), contentRoute('b')])
    // The newest tab (b) is the active one on load.
    await within(panel()).findByRole('heading', { name: 'b' })
    fireEvent.click(screen.getByRole('tab', { name: 'a.md' }))
    await within(panel()).findByRole('heading', { name: 'a' })
    fireEvent.click(screen.getByRole('tab', { name: 'b.md' }))
    await within(panel()).findByRole('heading', { name: 'b' })
    fireEvent.click(screen.getByRole('tab', { name: 'a.md' }))
    await within(panel()).findByRole('heading', { name: 'a' })
    expect(callsTo(fetchMock, 'GET').filter(([url]) => url.includes('/content'))).toHaveLength(2)
  })

  it('a file the agent rewrote (same tab, newer version) is read again, not served from the cache', async () => {
    let version = 0
    stubFetch([
      sessionRoute([A]),
      ['/api/viewer/a/content', () => { version += 1; return jsonResponse(contentBody({ text: `# Version ${version}` })) }],
    ])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    await within(panel()).findByRole('heading', { name: 'Version 1' })
    act(() => probe.actions.receiveOpen(KEY, { ...A, updated_at: A.updated_at + 10 }))
    expect(await within(panel()).findByRole('heading', { name: 'Version 2' })).toBeTruthy()
  })

  it('opening 16 files keeps 15, closing the active tab moves to the right neighbour, the last closes the panel', async () => {
    stubFetch([sessionRoute([])])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    for (let index = 1; index <= 16; index += 1) {
      act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: `f${index}`, path: `docs/f${index}.md`, title: `f${index}.md`, updated_at: index })))
    }
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(15)
    expect(probe.viewer.getScope(SCOPE).items.some((item) => item.id === 'f1')).toBe(false)
    // Reopening the same file reuses its tab.
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'f5', path: 'docs/f5.md', title: 'f5.md', updated_at: 99 })))
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(15)
    act(() => probe.actions.setActive(SCOPE, 'f5'))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar f5.md' }))
    expect(probe.viewer.getScope(SCOPE).activeId).toBe('f6')
    for (const item of [...probe.viewer.getScope(SCOPE).items]) {
      fireEvent.click(screen.getByRole('button', { name: `Fechar ${item.title}` }))
    }
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('"Fechar todas" of the strip menu closes every tab once and the panel', async () => {
    const fetchMock = await mount([sessionRoute([A, B]), contentRoute('a'), contentRoute('b')])
    act(() => probe.actions.setOpen('chat', true))
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações dos arquivos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar todas' }))
    expect(probe.viewer.getScope(SCOPE).items).toEqual([])
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(callsTo(fetchMock, 'DELETE')).toHaveLength(1)
  })
})

describe('ViewerPanel header', () => {
  it('the dock offers full screen and close; the full screen offers "✕ Fechar" only', async () => {
    const onClose = vi.fn()
    const onFullscreen = vi.fn()
    stubFetch([sessionRoute([])])
    const { rerender } = renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={onClose} onFullscreen={onFullscreen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tela cheia' }))
    expect(onFullscreen).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar visualizador' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    stubFetch([sessionRoute([])])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="fullscreen" onClose={onClose} onFullscreen={onFullscreen} />)
    expect(screen.queryByRole('button', { name: 'Tela cheia' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '✕ Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(rerender).toBeTypeOf('function')
  })

  it('the drawer variant is a complementary landmark, the others a region', async () => {
    stubFetch([sessionRoute([])])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="drawer" onClose={vi.fn()} />)
    expect(screen.getByRole('complementary', { name: 'Visualizador de arquivos' })).toBeTruthy()
  })

  it('has exactly one scroll region for the file', async () => {
    await mount([sessionRoute([A]), contentRoute('a')])
    await within(panel()).findByRole('heading', { name: 'a' })
    expect(panel().querySelectorAll('[data-viewer-scroll]')).toHaveLength(1)
  })
})

describe('ViewerPanel links', () => {
  it('a relative link of a Markdown opens another tab through the shell, and a double click is one request', async () => {
    const withLink = viewerItem({ item_id: 'a', path: 'docs/a.md', title: 'a.md' })
    const fetchMock = stubFetch([
      [`/api/sessions/${KEY}/viewer`, (_url, init) => (init?.method === 'POST'
        ? jsonResponse({ success: true, item: viewerItem({ item_id: 'n', path: 'docs/other.md', title: 'other.md' }), evicted: [] })
        : jsonResponse({ items: [withLink] }))],
      contentRoute('a', contentBody({ text: '[other](other.md)' })),
      contentRoute('n', contentBody({ text: '# Other' })),
    ])
    renderWithShell(<ViewerPanel scope={SCOPE} variant="dock" onClose={vi.fn()} />)
    await act(async () => {})
    const link = await within(panel()).findByRole('link', { name: 'other' })
    fireEvent.click(link)
    fireEvent.click(link)
    await within(panel()).findByRole('heading', { name: 'Other' })
    const posts = callsTo(fetchMock, 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1].body)).toEqual({ caminho: 'other.md', relativo_a: 'docs/a.md' })
  })
})
