import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import { KEY, SCOPE, callsTo, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'
import { CONNECTION_MESSAGE, NO_CONVERSATION_MESSAGE, localizeViewerMessage, useViewerShell } from './ViewerShell.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

class CountingSocket {
  static count = 0

  constructor() {
    CountingSocket.count += 1
  }
}

beforeEach(() => {
  CountingSocket.count = 0
  vi.stubGlobal('WebSocket', CountingSocket)
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const toastRegion = () => document.querySelector('.v3-toast-region')
const postRoute = (answerForPost) => [
  `/api/sessions/${KEY}/viewer`,
  (_url, init) => (init?.method === 'POST' ? answerForPost() : jsonResponse({ items: [] })),
]

describe('ViewerShell: the shared state and what the screens call', () => {
  it('provides the shell API inside the shell and null outside it', () => {
    stubFetch([])
    renderWithShell(null)
    expect(typeof probe.shell.openFile).toBe('function')
    expect(typeof probe.shell.setChatContentVisible).toBe('function')
    cleanup()
    let outside = 'unset'
    function Outside() {
      outside = useViewerShell()
      return null
    }
    render(<Outside />)
    expect(outside).toBeNull()
  })

  it('loads the tabs of the conversation on the route with one GET and opens no socket', async () => {
    const fetchMock = stubFetch([[`/api/sessions/${KEY}/viewer`, jsonResponse({ items: [viewerItem()] })]])
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1))
    expect(callsTo(fetchMock, 'GET')).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sessions/${KEY}/viewer`)
    expect(CountingSocket.count).toBe(0)
    expect(probe.viewer.getSurface('chat').open).toBe(false)
  })

  it('a read failure becomes the state of the scope: no toast, no socket', async () => {
    stubFetch([[`/api/sessions/${KEY}/viewer`, () => { throw new TypeError('Failed to fetch') }]])
    renderWithShell(null)
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    expect(probe.viewer.getScope(SCOPE).error).toBeTruthy()
    expect(toastRegion()).toBeNull()
    expect(CountingSocket.count).toBe(0)
  })

  it('a key that is not a safe session key makes no request at all', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { activeSessionKey: 'P/../other::claude::x' })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no route conversation (another screen) makes no request either', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { activeSessionKey: null })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the host rule: an arrival opens the panel only while the conversation content is on screen', async () => {
    stubFetch([])
    renderWithShell(null)
    await act(async () => {})
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'a' })))
    expect(probe.viewer.getSurface('chat').open).toBe(true)
    expect(probe.viewer.unseen[SCOPE]).toBe(0)
    act(() => probe.actions.setOpen('chat', false))
    act(() => probe.shell.setChatContentVisible(false))
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'b', path: 'docs/b.md' })))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(probe.viewer.unseen[SCOPE]).toBe(1)
  })

  it('treats a viewport below 768 as a phone: an opening is always full screen', async () => {
    stubFetch([])
    window.innerWidth = 600
    renderWithShell(null)
    await act(async () => {})
    act(() => probe.actions.receiveOpen(KEY, viewerItem({ item_id: 'a' })))
    expect(probe.viewer.getSurface('chat')).toEqual({ open: true, fullscreen: true })
  })

  it('the panel focus request is handed out once', () => {
    stubFetch([])
    renderWithShell(null)
    expect(probe.shell.consumePanelFocus()).toBe(false)
    probe.shell.requestPanelFocus()
    expect(probe.shell.consumePanelFocus()).toBe(true)
    expect(probe.shell.consumePanelFocus()).toBe(false)
  })
})

describe('ViewerShell.openFile', () => {
  it('posts the path with line and relative base, adds the tab and opens the panel', async () => {
    const fetchMock = stubFetch([
      postRoute(() => jsonResponse({ success: true, item: viewerItem({ item_id: 'n1', path: 'src/app.py', kind: 'code', line: 10 }), evicted: [] })),
    ])
    renderWithShell(null)
    await act(async () => {})
    let result
    await act(async () => {
      result = await probe.shell.openFile(KEY, 'src/app.py#L10', { line: 10, relativeTo: 'docs/plan.md' })
    })
    expect(result.ok).toBe(true)
    const [post] = callsTo(fetchMock, 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ caminho: 'src/app.py#L10', linha: 10, relativo_a: 'docs/plan.md' })
    expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual(['n1'])
    expect(probe.viewer.getSurface('chat').open).toBe(true)
  })

  it('a double call for the same file sends ONE request and both get the same answer', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchMock = stubFetch([
      [`/api/sessions/${KEY}/viewer`, async (_url, init) => {
        if (init?.method !== 'POST') return jsonResponse({ items: [] })
        await gate
        return jsonResponse({ success: true, item: viewerItem({ item_id: 'n1' }), evicted: [] })
      }],
    ])
    renderWithShell(null)
    await act(async () => {})
    let first
    let second
    act(() => {
      first = probe.shell.openFile(KEY, 'docs/plan.md')
      second = probe.shell.openFile(KEY, 'docs/plan.md')
    })
    expect(first).toBe(second)
    await act(async () => release())
    const [a, b] = await Promise.all([first, second])
    expect(a.ok && b.ok).toBe(true)
    expect(callsTo(fetchMock, 'POST')).toHaveLength(1)
    // Once it settled, asking again is a new request.
    await act(async () => { await probe.shell.openFile(KEY, 'docs/plan.md') })
    expect(callsTo(fetchMock, 'POST')).toHaveLength(2)
  })

  it('a different file is a different request', async () => {
    const fetchMock = stubFetch([postRoute(() => jsonResponse({ success: true, item: viewerItem({ item_id: 'x' }), evicted: [] }))])
    renderWithShell(null)
    await act(async () => {})
    await act(async () => {
      await Promise.all([probe.shell.openFile(KEY, 'a.md'), probe.shell.openFile(KEY, 'b.md')])
    })
    expect(callsTo(fetchMock, 'POST')).toHaveLength(2)
  })

  it('the backend refusal shows its own message (already pt-BR) in a toast', async () => {
    stubFetch([postRoute(() => jsonResponse({ error: 'Arquivo não encontrado: docs/x.md' }, 404))])
    renderWithShell(null)
    await act(async () => {})
    let result
    await act(async () => { result = await probe.shell.openFile(KEY, 'docs/x.md') })
    expect(result).toEqual({ ok: false, error: 'Arquivo não encontrado: docs/x.md' })
    expect(within(await screen.findByRole('alert')).getByText('Arquivo não encontrado: docs/x.md')).toBeTruthy()
  })

  it('an ASYNC network rejection becomes the pt-BR connection message, never the engine wording', async () => {
    let rejectPost
    stubFetch([postRoute(() => new Promise((_resolve, reject) => { rejectPost = () => reject(new TypeError('Failed to fetch')) }))])
    renderWithShell(null)
    await act(async () => {})
    let pending
    act(() => { pending = probe.shell.openFile(KEY, 'docs/plan.md') })
    expect(toastRegion()).toBeNull()
    await act(async () => rejectPost())
    const result = await pending
    expect(result).toEqual({ ok: false, error: CONNECTION_MESSAGE })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(CONNECTION_MESSAGE)
    expect(document.body.textContent).not.toMatch(/failed to fetch/i)
  })

  it('a rejection that lands AFTER the panel was closed still reports, changes no tab and does not reopen the panel', async () => {
    let rejectPost
    stubFetch([postRoute(() => new Promise((_resolve, reject) => { rejectPost = () => reject(new TypeError('Failed to fetch')) }))])
    renderWithShell(null)
    await act(async () => {})
    act(() => probe.actions.setOpen('chat', true))
    let pending
    act(() => { pending = probe.shell.openFile(KEY, 'docs/plan.md') })
    act(() => probe.actions.setOpen('chat', false))
    await act(async () => rejectPost())
    expect((await pending).ok).toBe(false)
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(probe.viewer.getScope(SCOPE).items).toEqual([])
    expect((await screen.findByRole('alert')).textContent).toContain(CONNECTION_MESSAGE)
  })

  it('after a failure the same file can be asked again (no stuck in-flight entry)', async () => {
    let attempt = 0
    const fetchMock = stubFetch([
      postRoute(() => {
        attempt += 1
        if (attempt === 1) throw new TypeError('Failed to fetch')
        return jsonResponse({ success: true, item: viewerItem({ item_id: 'ok1' }), evicted: [] })
      }),
    ])
    renderWithShell(null)
    await act(async () => {})
    await act(async () => { await probe.shell.openFile(KEY, 'docs/plan.md') })
    let result
    await act(async () => { result = await probe.shell.openFile(KEY, 'docs/plan.md') })
    expect(result.ok).toBe(true)
    expect(callsTo(fetchMock, 'POST')).toHaveLength(2)
  })

  it('refuses an unsafe key before any request and says there is no conversation', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { activeSessionKey: null })
    let result
    await act(async () => { result = await probe.shell.openFile('P/../x::a::1', 'docs/plan.md') })
    expect(result).toEqual({ ok: false, error: NO_CONVERSATION_MESSAGE })
    expect(callsTo(fetchMock, 'POST')).toHaveLength(0)
    expect((await screen.findByRole('alert')).textContent).toContain(NO_CONVERSATION_MESSAGE)
  })
})

describe('ViewerShell toast bridge', () => {
  it('shows one toast per viewer toast even when React runs the effects twice', async () => {
    stubFetch([])
    renderWithShell(null, { strict: true })
    await act(async () => {})
    act(() => probe.actions.showToast('Algo aconteceu.', 'error'))
    await screen.findByRole('alert')
    expect(document.querySelectorAll('.v3-toast')).toHaveLength(1)
    // The viewer's own slot is free again for the next message.
    expect(probe.viewer.toast).toBeNull()
  })

  it('an info toast is a status, not an alert', async () => {
    stubFetch([])
    renderWithShell(null)
    act(() => probe.actions.showToast('Pronto.'))
    expect((await screen.findByRole('status')).textContent).toContain('Pronto.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('localizes the engine wording of a network failure and keeps a backend message as it is', () => {
    expect(localizeViewerMessage('Failed to fetch')).toBe(CONNECTION_MESSAGE)
    expect(localizeViewerMessage('NetworkError when attempting to fetch resource.')).toBe(CONNECTION_MESSAGE)
    expect(localizeViewerMessage('Load failed')).toBe(CONNECTION_MESSAGE)
    expect(localizeViewerMessage('Arquivo não encontrado: a.md')).toBe('Arquivo não encontrado: a.md')
    expect(localizeViewerMessage('')).toBe('Não consegui abrir o arquivo.')
    expect(localizeViewerMessage(undefined, 'Falhou.')).toBe('Falhou.')
  })
})
