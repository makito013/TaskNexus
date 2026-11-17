import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chatApi, ChatApiError, encodeSessionKey } from './chatApi.js'

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)
  return { url, init: init ?? {}, body: init?.body ? JSON.parse(init.body) : undefined }
}

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const ENCODED_KEY = 'Pessoal/tn-sandbox%3A%3Aclaude%3A%3Ak3x9q2'

describe('chatApi reads', () => {
  it('builds the URL of each read', async () => {
    await chatApi.health()
    expect(lastCall().url).toBe('/api/chat/health')
    await chatApi.listSessions()
    expect(lastCall().url).toBe('/api/chat/sessions')
    await chatApi.listSessions({ projectRef: 'Pessoal/tn sandbox' })
    expect(lastCall().url).toBe('/api/chat/sessions?project_ref=Pessoal%2Ftn%20sandbox')
    await chatApi.listLiveSessions()
    expect(lastCall().url).toBe('/api/sessions/active?engine=all')
    await chatApi.fetchCommands()
    expect(lastCall().url).toBe('/api/chat/commands')
    await chatApi.fetchModels()
    expect(lastCall().url).toBe('/api/chat/models')
    await chatApi.fetchConnectors('orq uestrador')
    expect(lastCall().url).toBe('/api/chat/agents/orq%20uestrador/connectors')
  })

  it('encodes each segment of the session key and keeps the slashes', async () => {
    expect(encodeSessionKey(KEY)).toBe(ENCODED_KEY)
    await chatApi.fetchEvents(KEY, { since: 12, limit: 300 })
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/events?since=12&limit=300`)
    await chatApi.fetchEvents(KEY)
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/events?since=0&limit=500`)
    await chatApi.fetchSessionCommands(KEY)
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/commands`)
  })

  it('never sends a method other than GET for reads', async () => {
    await chatApi.health()
    await chatApi.listSessions()
    await chatApi.fetchEvents(KEY)
    expect(fetchMock.mock.calls.every(([, init]) => !init || init.method === undefined)).toBe(true)
  })
})

describe('chatApi writers', () => {
  it('creates a session with snake_case fields and drops the undefined ones', async () => {
    await chatApi.createSession({ projectRef: 'p', agentId: 'claude', permissionMode: 'plan' })
    const { url, init, body } = lastCall()
    expect(url).toBe('/api/chat/sessions')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(body).toEqual({ project_ref: 'p', agent_id: 'claude', permission_mode: 'plan' })
  })

  it('opens, closes and switches the engine of a session', async () => {
    await chatApi.openSession(KEY)
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/open`)
    expect(lastCall().init.method).toBe('POST')
    await chatApi.closeSession(KEY)
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/close`)
    await chatApi.switchEngine(KEY, { engine: 'chat', confirm: true })
    expect(lastCall().url).toBe(`/api/chat/sessions/${ENCODED_KEY}/switch-engine`)
    expect(lastCall().body).toEqual({ engine: 'chat', confirm: true })
    await chatApi.switchEngine(KEY, { engine: 'pty' })
    expect(lastCall().body).toEqual({ engine: 'pty', confirm: false })
  })

  it('decides a permission with scope once by default', async () => {
    await chatApi.decidePermission('abc123', { behavior: 'allow' })
    expect(lastCall().url).toBe('/api/chat/permissions/abc123/decide')
    expect(lastCall().body).toEqual({ behavior: 'allow', scope: 'once' })
    await chatApi.decidePermission('abc123', { behavior: 'deny', message: 'no', interrupt: true })
    expect(lastCall().body).toEqual({ behavior: 'deny', scope: 'once', message: 'no', interrupt: true })
    await chatApi.decidePermission('abc123', { behavior: 'allow', scope: 'session', answers: { q: 'a' } })
    expect(lastCall().body).toEqual({ behavior: 'allow', scope: 'session', answers: { q: 'a' } })
  })

  it('writes the catalogs and the connector allowlist', async () => {
    await chatApi.putCommands([{ name: 'x' }])
    expect(lastCall().init.method).toBe('PUT')
    expect(lastCall().body).toEqual({ commands: [{ name: 'x' }] })
    await chatApi.putModels([{ value: 'haiku' }])
    expect(lastCall().url).toBe('/api/chat/models')
    expect(lastCall().body).toEqual({ models: [{ value: 'haiku' }] })
    await chatApi.putConnectors('claude', ['Atlassian'])
    expect(lastCall().url).toBe('/api/chat/agents/claude/connectors')
    expect(lastCall().body).toEqual({ allowlist: ['Atlassian'] })
    await chatApi.refreshConnectors('claude')
    expect(lastCall().url).toBe('/api/chat/agents/claude/connectors/refresh')
    expect(lastCall().init.method).toBe('POST')
  })

  it('reuses the session routes for rename, terminate and reset', async () => {
    await chatApi.renameSession(KEY, 'Novo nome')
    expect(lastCall().url).toBe(`/api/sessions/${ENCODED_KEY}/rename`)
    expect(lastCall().init.method).toBe('PATCH')
    expect(lastCall().body).toEqual({ display_name: 'Novo nome' })
    await chatApi.terminateSession(KEY)
    expect(lastCall().url).toBe(`/api/sessions/${ENCODED_KEY}/terminate`)
    await chatApi.resetSession(KEY)
    expect(lastCall().url).toBe(`/api/sessions/${ENCODED_KEY}/reset`)
  })

  it('treats a 404 on terminate as already gone and rethrows other failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: { code: 'session_not_found', message: 'x' } }, 404))
    await expect(chatApi.terminateSession(KEY)).resolves.toEqual({ status: 'already_gone' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: { code: 'process_error', message: 'x' } }, 502))
    await expect(chatApi.terminateSession(KEY)).rejects.toMatchObject({ status: 502 })
  })
})

describe('chatApi errors', () => {
  it('turns detail.code and detail.message into a ChatApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: { code: 'already_decided', message: 'already decided' } }, 409),
    )
    const error = await chatApi.decidePermission('p1', { behavior: 'allow' }).catch((e) => e)
    expect(error).toBeInstanceOf(ChatApiError)
    expect(error).toMatchObject({ status: 409, code: 'already_decided', message: 'already decided' })
  })

  it('falls back to http_error for a body without detail.code', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('not json') } })
    const error = await chatApi.health().catch((e) => e)
    expect(error).toMatchObject({ status: 500, code: 'http_error', message: 'HTTP 500' })
  })

  it('accepts a plain string detail', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, 404))
    const error = await chatApi.health().catch((e) => e)
    expect(error).toMatchObject({ status: 404, code: 'http_error', message: 'Not Found' })
  })

  it('maps a request that never got an answer to status 0 network_error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await chatApi.health().catch((e) => e)
    expect(error).toBeInstanceOf(ChatApiError)
    expect(error).toMatchObject({ status: 0, code: 'network_error', message: 'Failed to fetch' })
  })
})
