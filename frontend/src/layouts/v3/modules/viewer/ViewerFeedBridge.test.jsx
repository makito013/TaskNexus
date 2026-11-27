import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { clearViewerContentCache } from '../../../../hooks/useViewerContent.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ViewerShell from './ViewerShell.jsx'
import { KEY, Probe, SCOPE, callsTo, createHarness, jsonResponse, probe, viewerItem } from './viewerTestKit.jsx'

installDialogElementStub()

const { stubFetch, renderWithShell } = createHarness({ vi, render })

class FakeSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.close = vi.fn()
    FakeSocket.instances.push(this)
  }

  emit(frame) {
    act(() => {
      this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
    })
  }
}

const OTHER_KEY = 'Pessoal/tn-sandbox::claude::z9z9z9'
const OTHER_SCOPE = `session:${OTHER_KEY}`
const LIVE = { [KEY]: { connected: true } }
const open = (overrides = {}) => ({
  type: 'viewer_open',
  session_key: KEY,
  item: { item_id: 'i1', session_key: KEY, path: 'docs/plan.md', title: 'plan.md', kind: 'markdown', opened_by: 'agent', updated_at: 1_700_000_000 },
  reused: false,
  evicted: [],
  ...overrides,
})
const sockets = () => FakeSocket.instances
const liveSockets = () => FakeSocket.instances.filter((socket) => socket.close.mock.calls.length === 0)
const feedGets = (fetchMock) => callsTo(fetchMock, 'GET').filter(([url]) => String(url).endsWith('/viewer'))

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  clearViewerContentCache()
  window.innerWidth = 1440
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ViewerFeedBridge: when the socket exists', () => {
  it('opens no socket while no session is alive', async () => {
    stubFetch([])
    renderWithShell(null)
    await act(async () => {})

    expect(sockets()).toHaveLength(0)
  })

  it('opens ONE socket to /ws/viewer as soon as a session is alive', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await act(async () => {})

    expect(sockets()).toHaveLength(1)
    expect(sockets()[0].url).toBe(`ws://${window.location.host}/ws/viewer`)
  })

  it('under StrictMode (the double effect) exactly one socket stays alive', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE }, strict: true })
    await act(async () => {})

    expect(liveSockets()).toHaveLength(1)
  })

  it('stays open when the sessions go away again, and closes only when the shell unmounts', async () => {
    stubFetch([])
    const tree = (liveByKey) => (
      <ToastHost>
        <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, liveByKey }}>
          <ViewerShell activeSessionKey={KEY}>
            <Probe />
          </ViewerShell>
        </ProjectsSessionsContext.Provider>
      </ToastHost>
    )
    const view = render(tree({}))
    await act(async () => {})
    expect(sockets()).toHaveLength(0)

    view.rerender(tree(LIVE))
    await act(async () => {})
    expect(sockets()).toHaveLength(1)

    view.rerender(tree({}))
    await act(async () => {})
    expect(sockets()).toHaveLength(1)
    expect(sockets()[0].close).not.toHaveBeenCalled()

    view.unmount()
    expect(sockets()[0].close).toHaveBeenCalledTimes(1)
  })

  it('a frame that arrives after the shell unmounted does nothing', async () => {
    stubFetch([])
    const view = renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await act(async () => {})
    const socket = sockets()[0]
    view.unmount()

    expect(() => socket.emit(open())).not.toThrow()
  })
})

describe('ViewerFeedBridge: ready', () => {
  it('reloads the tabs of the conversation on the route and the artifacts list, with a forced GET', async () => {
    const fetchMock = stubFetch([[`/api/sessions/${KEY}/viewer`, jsonResponse({ items: [] })]])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const before = feedGets(fetchMock).length
    const signal = probe.viewer.artifactsSignal

    sockets()[0].emit({ type: 'ready' })

    await waitFor(() => expect(feedGets(fetchMock).length).toBe(before + 1))
    expect(feedGets(fetchMock).at(-1)[0]).toBe(`/api/sessions/${KEY}/viewer`)
    await waitFor(() => expect(probe.viewer.artifactsSignal).toBe(signal + 1))
  })

  it('also reloads every other conversation that was already loaded, once each', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    await act(async () => {
      await probe.actions.loadItems(OTHER_SCOPE)
    })
    expect(probe.viewer.getScope(OTHER_SCOPE).loaded).toBe(true)
    fetchMock.mockClear()

    sockets()[0].emit({ type: 'ready' })

    await waitFor(() => expect(feedGets(fetchMock)).toHaveLength(2))
    expect(feedGets(fetchMock).map(([url]) => url).sort()).toEqual(
      [`/api/sessions/${KEY}/viewer`, `/api/sessions/${OTHER_KEY}/viewer`].sort(),
    )
  })

  it('without a conversation on the route it reloads the loaded ones only and still signals the artifacts', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { activeSessionKey: null, sessions: { liveByKey: LIVE } })
    await act(async () => {})
    const signal = probe.viewer.artifactsSignal
    fetchMock.mockClear()

    sockets()[0].emit({ type: 'ready' })

    await waitFor(() => expect(probe.viewer.artifactsSignal).toBe(signal + 1))
    expect(feedGets(fetchMock)).toHaveLength(0)
  })

  it('every reconnection says ready again and reloads again', async () => {
    const fetchMock = stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const signal = probe.viewer.artifactsSignal

    sockets()[0].emit({ type: 'ready' })
    sockets()[0].emit({ type: 'ready' })

    await waitFor(() => expect(probe.viewer.artifactsSignal).toBe(signal + 2))
    expect(feedGets(fetchMock).length).toBeGreaterThanOrEqual(3)
  })
})

describe('ViewerFeedBridge: a viewer_open frame', () => {
  it('for the conversation on screen opens the panel, adds the tab, zeroes the count and takes no focus', async () => {
    stubFetch([])
    renderWithShell(<textarea aria-label="Mensagem" data-testid="composer" />, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const composer = screen.getByTestId('composer')
    composer.focus()

    sockets()[0].emit(open())

    await waitFor(() => expect(probe.viewer.getSurface('chat').open).toBe(true))
    expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual(['i1'])
    expect(probe.viewer.getScope(SCOPE).activeId).toBe('i1')
    expect(probe.viewer.unseen[SCOPE] ?? 0).toBe(0)
    expect(document.activeElement).toBe(composer)
    expect(document.querySelector('.v3-toast-region')).toBeNull()
  })

  it('for the conversation on screen announces it in a polite status line, and the line goes away', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    expect(screen.queryByRole('status')).toBeNull()
    vi.useFakeTimers()

    sockets()[0].emit(open())

    expect(screen.getByRole('status').textContent).toBe('claude abriu plan.md.')
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('for another conversation adds to its count, opens nothing and raises the "Ver" toast', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    sockets()[0].emit(open({ session_key: OTHER_KEY, item: { ...open().item, session_key: OTHER_KEY } }))

    await waitFor(() => expect(probe.viewer.unseen[OTHER_SCOPE]).toBe(1))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(probe.viewer.getScope(OTHER_SCOPE).items.map((item) => item.id)).toEqual(['i1'])
    expect(await screen.findByText('claude abriu plan.md.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Ver' })).not.toBeNull()
  })

  it('on another screen (no conversation on the route) counts and raises the toast, never opens the panel', async () => {
    stubFetch([])
    renderWithShell(null, { activeSessionKey: null, sessions: { liveByKey: LIVE } })
    await act(async () => {})

    sockets()[0].emit(open())

    await waitFor(() => expect(probe.viewer.unseen[SCOPE]).toBe(1))
    expect(probe.viewer.getSurface('chat').open).toBe(false)
    expect(await screen.findByRole('button', { name: 'Ver' })).not.toBeNull()
  })

  it('the same frame under StrictMode raises one toast, not two', async () => {
    stubFetch([])
    renderWithShell(null, { activeSessionKey: null, strict: true, sessions: { liveByKey: LIVE } })
    await act(async () => {})

    liveSockets()[0].emit(open())

    await screen.findByText('claude abriu plan.md.')
    expect(document.querySelectorAll('.v3-toast')).toHaveLength(1)
  })

  it('a reused tab is updated in place, not duplicated', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    sockets()[0].emit(open())
    sockets()[0].emit(open({ reused: true, item: { ...open().item, line: 7, updated_at: 1_700_000_100 } }))

    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1))
    expect(probe.viewer.getScope(SCOPE).items[0].line).toBe(7)
  })

  it('the evicted ids of the frame are dropped from the tabs', async () => {
    stubFetch([[`/api/sessions/${KEY}/viewer`, jsonResponse({ items: [viewerItem({ item_id: 'old', path: 'docs/old.md' })] })]])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1))

    sockets()[0].emit(open({ evicted: ['old'] }))

    await waitFor(() => expect(probe.viewer.getScope(SCOPE).items.map((item) => item.id)).toEqual(['i1']))
  })

  it.each([
    ['an unsafe key', { session_key: 'P/../x::claude::y' }],
    ['a %2e%2e key', { session_key: 'P::a::x/%2e%2e/%2e%2e/P::a::victim' }],
    ['no item', { item: undefined }],
    ['an item with no id', { item: { path: 'a.md' } }],
  ])('drops a frame with %s: no tab, no count, no toast', async (_name, overrides) => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    sockets()[0].emit(open(overrides))
    sockets()[0].emit('not json')

    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(0)
    expect(Object.keys(probe.viewer.scopes).filter((scope) => scope !== SCOPE)).toEqual([])
    expect(probe.viewer.unseen).toEqual({})
    expect(document.querySelector('.v3-toast-region')).toBeNull()
  })

  it('a .md opened by the agent raises the artifacts signal; a .py does not', async () => {
    stubFetch([])
    renderWithShell(null, { sessions: { liveByKey: LIVE } })
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))
    const signal = probe.viewer.artifactsSignal

    sockets()[0].emit(open({ item: { ...open().item, item_id: 'py', path: 'src/app.py', title: 'app.py' } }))
    expect(probe.viewer.artifactsSignal).toBe(signal)

    sockets()[0].emit(open())
    await waitFor(() => expect(probe.viewer.artifactsSignal).toBe(signal + 1))
  })

  it('works inside StrictMode with a conversation on screen: one panel open, one tab', async () => {
    stubFetch([])
    render(
      <StrictMode>
        <ToastHost>
          <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, liveByKey: LIVE }}>
            <ViewerShell activeSessionKey={KEY}>
              <Probe />
            </ViewerShell>
          </ProjectsSessionsContext.Provider>
        </ToastHost>
      </StrictMode>,
    )
    await waitFor(() => expect(probe.viewer.getScope(SCOPE).loaded).toBe(true))

    liveSockets()[0].emit(open())

    await waitFor(() => expect(probe.viewer.getSurface('chat').open).toBe(true))
    expect(probe.viewer.getScope(SCOPE).items).toHaveLength(1)
  })
})
