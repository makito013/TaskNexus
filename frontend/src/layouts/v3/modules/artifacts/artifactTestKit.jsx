// Test scaffold of the artifacts suites (NOT a suite: the name does not match Vitest's include, the same
// precedent as viewerTestKit.jsx). It imports no test toolchain (boundaries.test.js allows that only in
// *.test.* files): the suite hands `vi` and `render` to createArtifactsKit.
//
//   backend(options)  stubs fetch with a small stateful artifacts API and returns { state, fetchMock, calls }
//   renderTab(props)  renders ArtifactsTab inside what the real shell provides (toasts, the sessions context,
//                     the viewer shell and the chat session host), with a socket that goes nowhere
import { useState } from 'react'
import ChatSessionHost, { useChatSessionContext } from '../chat/ChatSessionHost.jsx'
import { contentBody, createHarness, jsonResponse } from '../viewer/viewerTestKit.jsx'
import ArtifactsTab from './ArtifactsTab.jsx'
import { ARTIFACTS, registry } from './artifactFixtures.js'

export const index = registry()

// What the chat session host holds, for a test to read (the draft of a conversation).
export const sessionProbe = { current: null }
function SessionProbe() {
  sessionProbe.current = useChatSessionContext()
  return null
}

// Renders the tab with props a test can change later (the header's workspace, "Mostrar arquivados").
const hostApi = { setProps: null }
function TabHost({ initial }) {
  const [props, setProps] = useState(initial)
  hostApi.setProps = (next) => setProps((previous) => ({ ...previous, ...next }))
  return <ArtifactsTab registry={index} workspaceKey="" showArchived={false} {...props} />
}

export function notFound() {
  return { ok: false, status: 404, json: async () => ({ success: false, error: 'Artefato não encontrado.' }) }
}
export function failure(status, error) {
  return { ok: false, status, json: async () => ({ success: false, error }) }
}

export function createArtifactsKit({ vi, render }) {
  const { stubFetch, renderWithShell } = createHarness({ vi, render })

  class FakeSocket {
    constructor(url) {
      this.url = url
      FakeSocket.instances.push(this)
    }
    close() {}
  }
  FakeSocket.instances = []

  function backend({
    artifacts = ARTIFACTS,
    candidates = [],
    hasOlder = false,
    list = null,
    rename = null,
    remove = null,
    importer = null,
    candidatesFor = null,
    content = null,
  } = {}) {
    const state = { artifacts: artifacts.map((entry) => ({ ...entry })) }
    const fetchMock = stubFetch([
      [/\/api\/artifacts\/import$/, (url, init) => {
        if (importer) return importer(JSON.parse(init.body), state)
        const body = JSON.parse(init.body)
        const made = body.caminhos.map((path, number) => ({
          artifact_id: `imp${number}`, project_id: body.project_id, path, title: path, kind: 'markdown', exists: true,
          size: 10, mtime: 1_700_000_100, updated_at: 1_700_000_100, created_by: 'user',
        }))
        return jsonResponse({ created: made.length, artifacts: made, errors: [] })
      }],
      [/\/api\/projects\/.+\/artifact-candidates/, (url) => {
        if (candidatesFor) return candidatesFor(url)
        const older = !url.includes('window_days')
        const answer = candidates.filter((entry) => older || entry.recent !== false)
        return jsonResponse({
          candidates: answer, truncated: false, since: 1_700_000_000, has_older: hasOlder && !older,
        })
      }],
      [/\/api\/artifacts\/[^/?]+\/content/, (url) => (content ? content(url) : jsonResponse(contentBody({ text: '# Body' })))],
      [/\/api\/artifacts\/[^/?]+$/, (url, init) => {
        const id = decodeURIComponent(url.split('/').pop())
        if (init?.method === 'PATCH') {
          if (rename) return rename(id, JSON.parse(init.body), state)
          const row = state.artifacts.find((entry) => entry.artifact_id === id)
          Object.assign(row, { title: JSON.parse(init.body).titulo })
          return jsonResponse({ ...row })
        }
        if (init?.method === 'DELETE') {
          if (remove) return remove(id, state)
          state.artifacts = state.artifacts.filter((entry) => entry.artifact_id !== id)
          return jsonResponse({ success: true })
        }
        return failure(405, 'method')
      }],
      [/\/api\/artifacts(\?|$)/, (url, init) => {
        if (init?.method === 'POST') return jsonResponse({ ...state.artifacts[0] }, 201)
        if (list) return list(url, state)
        return jsonResponse({ artifacts: state.artifacts })
      }],
    ])
    const calls = (matcher, method) => fetchMock.mock.calls.filter(([url, init]) => (
      (init?.method || 'GET') === method && (matcher instanceof RegExp ? matcher.test(url) : String(url).includes(matcher))
    ))
    return { state, fetchMock, calls }
  }

  function renderTab(props = {}, { chats = [], liveByKey = {}, openChat = vi.fn(), activeKey = null, strict = false } = {}) {
    vi.stubGlobal('WebSocket', FakeSocket)
    const { onHasUnassigned = vi.fn(), ...rest } = props
    const view = renderWithShell(
      <ChatSessionHost activeKey={activeKey}>
        <SessionProbe />
        <TabHost initial={{ onHasUnassigned, ...rest }} />
      </ChatSessionHost>,
      { activeSessionKey: null, sessions: { chats, liveByKey, openChat }, strict },
    )
    return { ...view, openChat, onHasUnassigned, sockets: FakeSocket.instances, setProps: (next) => hostApi.setProps(next) }
  }

  return { backend, renderTab, stubFetch }
}
