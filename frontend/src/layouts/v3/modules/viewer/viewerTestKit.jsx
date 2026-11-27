// Test scaffold of the viewer suites (NOT a suite: the name does not match Vitest's include, the same
// precedent as chatTestKit.js). Builders of fetch answers, a capture of the two contexts and a render
// wrapper with what the real shell provides: the toasts, the sessions context and the viewer shell.
// It imports no test toolchain (boundaries.test.js allows that only in *.test.* files): the suite hands
// `vi` and `render` to createHarness.
import { StrictMode, useRef } from 'react'
import { useViewer, useViewerActions } from '../../../../hooks/viewerState.jsx'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ViewerShell, { useViewerShell } from './ViewerShell.jsx'
import ViewerSurface, { useChatViewerLayout } from './ViewerSurface.jsx'

export const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
export const SCOPE = `session:${KEY}`

export function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

// A viewer item as the backend returns it.
export function viewerItem(overrides = {}) {
  return {
    item_id: 'i1',
    session_key: KEY,
    path: 'docs/plan.md',
    title: 'plan.md',
    kind: 'markdown',
    language: null,
    line: null,
    opened_by: 'agent',
    updated_at: 1_700_000_000,
    ...overrides,
  }
}

// A content answer (GET .../content).
export function contentBody(overrides = {}) {
  return { name: 'plan.md', kind: 'markdown', text: '# Plan', size: 6, mime: 'text/markdown', truncated: false, ...overrides }
}

export const callsTo = (fetchMock, method) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method || 'GET') === method)

// Gives a test the live viewer state, the actions and the shell API.
export const probe = { viewer: null, actions: null, shell: null }
export function Probe() {
  probe.viewer = useViewer()
  probe.actions = useViewerActions()
  probe.shell = useViewerShell()
  return null
}

// What ChatScreen does with the viewer, without the rest of the chat: the grid section with the attributes the
// layout writes, a panel that stands for `.v3-chat-panel` (with its own Esc handler), a composer and the surface.
export function ChatHarness({ onPanelKeyDown = () => {}, scope = SCOPE, ignoreModals = false }) {
  const screenRef = useRef(null)
  const layout = useChatViewerLayout(screenRef)
  return (
    <section ref={screenRef} className="v3-chat" data-testid="chat-section" style={layout?.sectionStyle} {...layout?.sectionProps}>
      <div className="v3-chat-panel" onKeyDown={onPanelKeyDown}>
        <textarea data-testid="composer" aria-label="Mensagem" />
      </div>
      <ViewerSurface
        layout={layout}
        scope={scope}
        ignoreModals={ignoreModals}
        returnFocusTo={() => screenRef.current?.querySelector('[data-viewer-button]')}
      />
    </section>
  )
}

// { stubFetch, renderWithShell } bound to the suite's `vi` and `render`.
//   stubFetch(routes)  routes: [[substring | RegExp, answer | (url, init) => answer | Promise]]; an unmatched
//                      URL gets `{ items: [] }`. Returns the vi.fn installed as the global fetch.
export function createHarness({ vi, render }) {
  const stubFetch = (routes) => {
    const fetchMock = vi.fn(async (url, init) => {
      for (const [pattern, answer] of routes) {
        const matches = pattern instanceof RegExp ? pattern.test(url) : String(url).includes(pattern)
        if (matches) return typeof answer === 'function' ? answer(url, init) : answer
      }
      return jsonResponse({ items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const renderWithShell = (ui, { activeSessionKey = KEY, strict = false, sessions = {} } = {}) => {
    const value = { ...INERT_SESSIONS, ...sessions }
    const tree = (
      <ToastHost>
        <ProjectsSessionsContext.Provider value={value}>
          <ViewerShell activeSessionKey={activeSessionKey}>
            <Probe />
            {ui}
          </ViewerShell>
        </ProjectsSessionsContext.Provider>
      </ToastHost>
    )
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  }
  return { stubFetch, renderWithShell }
}
