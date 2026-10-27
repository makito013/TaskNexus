// Client of the workspace registry (GET /api/workspaces). Kept out of api.js on
// purpose (ADR-26): only the v3 imports this file, so the V2 diff stays empty.
// Read-only for now - the write calls arrive with the registration dialogs.
const BASE = '/api'

async function request(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    let detail = null
    try {
      detail = (await response.json()).detail
    } catch {
      /* non-JSON body */
    }
    const error = new Error(detail?.message || (typeof detail === 'string' ? detail : null) || `HTTP ${response.status}`)
    error.status = response.status
    error.code = detail?.code ?? null
    error.problems = detail?.problems ?? []
    throw error
  }
  return response.json()
}

export const workspacesApi = {
  // include_archived=1 returns archived workspaces and projects too; the screen
  // always asks for them and filters on the client, so toggling the checkbox
  // never needs another request.
  fetchWorkspaces({ includeArchived = false } = {}) {
    return request(`/workspaces?include_archived=${includeArchived ? 1 : 0}`)
  },
}
