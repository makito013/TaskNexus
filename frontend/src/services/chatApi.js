// Client of the chat REST contract (/api/chat/*, contract 3 of the architecture) and of the
// session routes the chat reuses (rename, terminate, reset). Kept out of api.js on purpose
// (ADR-26): only the v3 chat imports this file, so the V2 diff stays empty.
//
// This is the ONLY place of the chat that calls fetch. Writers (functions that mutate) are only
// called from the files listed in chatWriteGuard.test.js; everything else reads or receives
// callbacks.
//
// Errors: every failure is a ChatApiError { status, code, message }. `code` comes from the
// backend's `detail.code`; a response without it gets `http_error`, and a request that never
// got an answer (network down, bad URL) is status 0 / `network_error`.
import { encodeSessionKey } from './sessionKey.js'

export { encodeSessionKey }

const BASE = '/api'

export class ChatApiError extends Error {
  constructor({ status, code, message }) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
    this.code = code
  }
}

function jsonRequest(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function definedOnly(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

async function request(path, init) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, init)
  } catch (cause) {
    throw new ChatApiError({
      status: 0,
      code: 'network_error',
      message: cause?.message || 'network error',
    })
  }
  if (!response.ok) {
    let detail = null
    try {
      detail = (await response.json()).detail
    } catch {
      /* non-JSON body: the status alone describes it */
    }
    throw new ChatApiError({
      status: response.status,
      code: detail?.code ?? 'http_error',
      message:
        detail?.message || (typeof detail === 'string' ? detail : null) || `HTTP ${response.status}`,
    })
  }
  return response.json()
}

export const chatApi = {
  // -- reads ---------------------------------------------------------------------------------------

  health() {
    return request('/chat/health')
  },

  listSessions({ projectRef } = {}) {
    const query = projectRef ? `?project_ref=${encodeURIComponent(projectRef)}` : ''
    return request(`/chat/sessions${query}`)
  },

  // GET /api/sessions/active?engine=all: V2 (pty) and chat entries together, keyed by session.
  listLiveSessions() {
    return request('/sessions/active?engine=all')
  },

  // Replay page of the event log: { events, last_seq, has_more }.
  fetchEvents(sessionKey, { since = 0, limit = 500 } = {}) {
    return request(
      `/chat/sessions/${encodeSessionKey(sessionKey)}/events?since=${since}&limit=${limit}`,
    )
  },

  fetchSessionCommands(sessionKey) {
    return request(`/chat/sessions/${encodeSessionKey(sessionKey)}/commands`)
  },

  fetchCommands() {
    return request('/chat/commands')
  },

  fetchModels() {
    return request('/chat/models')
  },

  fetchConnectors(agentId) {
    return request(`/chat/agents/${encodeURIComponent(agentId)}/connectors`)
  },

  // -- writers -------------------------------------------------------------------------------------

  createSession({ projectRef, agentId, model, permissionMode, firstMessage }) {
    return request(
      '/chat/sessions',
      jsonRequest('POST', definedOnly({
        project_ref: projectRef,
        agent_id: agentId,
        model,
        permission_mode: permissionMode,
        first_message: firstMessage,
      })),
    )
  },

  openSession(sessionKey) {
    return request(`/chat/sessions/${encodeSessionKey(sessionKey)}/open`, { method: 'POST' })
  },

  closeSession(sessionKey) {
    return request(`/chat/sessions/${encodeSessionKey(sessionKey)}/close`, { method: 'POST' })
  },

  // engine: 'chat' | 'pty'. The pty -> chat direction needs confirm = true.
  switchEngine(sessionKey, { engine, confirm = false }) {
    return request(
      `/chat/sessions/${encodeSessionKey(sessionKey)}/switch-engine`,
      jsonRequest('POST', { engine, confirm }),
    )
  },

  // behavior: 'allow' | 'deny'; scope: 'once' | 'session'.
  decidePermission(permissionId, { behavior, scope = 'once', message, interrupt, answers }) {
    return request(
      `/chat/permissions/${encodeURIComponent(permissionId)}/decide`,
      jsonRequest('POST', definedOnly({ behavior, scope, message, interrupt, answers })),
    )
  },

  putCommands(commands) {
    return request('/chat/commands', jsonRequest('PUT', { commands }))
  },

  putModels(models) {
    return request('/chat/models', jsonRequest('PUT', { models }))
  },

  putConnectors(agentId, allowlist) {
    return request(
      `/chat/agents/${encodeURIComponent(agentId)}/connectors`,
      jsonRequest('PUT', { allowlist }),
    )
  },

  refreshConnectors(agentId) {
    return request(
      `/chat/agents/${encodeURIComponent(agentId)}/connectors/refresh`,
      { method: 'POST' },
    )
  },

  // Existing session routes, reused by the chat (the backend branches on the key's engine).
  renameSession(sessionKey, displayName) {
    return request(
      `/sessions/${encodeSessionKey(sessionKey)}/rename`,
      jsonRequest('PATCH', { display_name: displayName }),
    )
  },

  // 404 = already gone: terminating twice is a success, like the V2 client.
  async terminateSession(sessionKey) {
    try {
      return await request(`/sessions/${encodeSessionKey(sessionKey)}/terminate`, { method: 'POST' })
    } catch (error) {
      if (error instanceof ChatApiError && error.status === 404) return { status: 'already_gone' }
      throw error
    }
  },

  resetSession(sessionKey) {
    return request(`/sessions/${encodeSessionKey(sessionKey)}/reset`, { method: 'POST' })
  },
}
