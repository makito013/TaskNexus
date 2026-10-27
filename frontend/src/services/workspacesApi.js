// Client of the workspace registry (GET /api/workspaces). Kept out of api.js on
// purpose (ADR-26): only the v3 imports this file, so the V2 diff stays empty.
// The writes (create/update of workspaces and projects), the folder discovery and
// inspection and the native folder picker are only called from
// layouts/v3/modules/projects/useRegistryMutations.js (see readOnlyGuard.test.js).
const BASE = '/api'

function jsonRequest(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// Both PATCH endpoints reject unknown fields, so only the keys the caller set go out.
function definedOnly(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

function folderBody(folders) {
  return folders.map((folder) => ({ path: folder.path, is_primary: Boolean(folder.isPrimary ?? folder.is_primary) }))
}

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

  // POST /api/workspaces. adoptLegacyKey turns a client the V2 created after the
  // migration into a workspace that keeps its history (same key).
  createWorkspace({ name, adoptLegacyKey = null }) {
    return request('/workspaces', jsonRequest('POST', definedOnly({
      name,
      adopt_legacy_key: adoptLegacyKey ?? undefined,
    })))
  },

  updateWorkspace(id, { name, archived } = {}) {
    return request(`/workspaces/${id}`, jsonRequest('PATCH', definedOnly({ name, archived })))
  },

  // folders: [{ path, isPrimary }]. The response carries `warnings` (never blocking).
  createProject(workspaceId, { name, folders }) {
    return request(`/workspaces/${workspaceId}/projects`, jsonRequest('POST', {
      name,
      folders: folderBody(folders),
    }))
  },

  // Only the fields passed are sent: a rename must not resend (and so revalidate)
  // the folders, and an archive must not touch either.
  updateProject(id, { name, folders, archived } = {}) {
    return request(`/workspace-projects/${id}`, jsonRequest('PATCH', definedOnly({
      name,
      folders: folders === undefined ? undefined : folderBody(folders),
      archived,
    })))
  },

  // The V2 scan as a map of folders (a few seconds on a large projects root).
  discoverFolders() {
    return request('/folders/discover')
  },

  // At most 50 paths per call (server limit).
  inspectFolders({ paths, excludeProjectId = null }) {
    return request('/folders/inspect', jsonRequest('POST', definedOnly({
      paths,
      exclude_project_id: excludeProjectId ?? undefined,
    })))
  },

  // Opens the native folder picker ON THE MACHINE THE SERVER RUNS ON; resolves to
  // { path } (path is null when the picker is cancelled).
  browseFolder() {
    return request('/settings/projects-root/browse', { method: 'POST' })
  },
}
