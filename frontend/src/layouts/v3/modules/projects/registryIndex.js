// Pure view of the workspace registry (GET /api/workspaces). No React, no I/O.
// The registry reuses the legacy `projeto_id` / `cliente_id` strings as keys, so
// any key found in a session, card or task can be mapped to a place on screen
// by `resolveKey` (table of opcoes2-trilha1.md section 2.8).

export const NO_WORKSPACE_VALUE = '__none'

// Mirror of backend/app/workspace_keys.py `_MINTED_KEY`: ".w12", ".w12/.p38" and
// "Pessoal/.p37". Deliberately narrow - "Pessoal/.hidden" is a LEGACY key.
const MINTED_KEY = /^(?:\.w\d+|(?:\.w\d+|[^./][^/]*)\/\.p\d+)$/

export function isSyntheticKey(key) {
  return typeof key === 'string' && MINTED_KEY.test(key)
}

function firstSegment(key) {
  return key.split('/', 1)[0]
}

function primaryFolderOf(project) {
  const folders = project.folders || []
  return folders.find((folder) => folder.is_primary) || folders[0] || null
}

/**
 * @typedef {{
 *  id: number, key: string, name: string, origin: string, archived: boolean,
 *  workspaceId: number, workspaceKey: string, workspaceName: string,
 *  workspaceArchived: boolean, primaryPath: string | null, exists: boolean,
 *  primaryLocked: boolean, folders: object[],
 * }} RegistryProject
 */

// response: the GET /api/workspaces body ({ seeded, workspaces: [...] }).
export function buildRegistryIndex(response) {
  const workspaces = (response?.workspaces || []).map((workspace) => ({
    id: workspace.id,
    key: workspace.key,
    name: workspace.name,
    origin: workspace.origin,
    archived: Boolean(workspace.archived),
    projects: [],
  }))

  const workspaceByKey = new Map()
  const workspaceById = new Map()
  const projectByKey = new Map()
  const projectsByWorkspaceId = new Map()
  const projects = []

  workspaces.forEach((workspace, position) => {
    workspaceByKey.set(workspace.key, workspace)
    workspaceById.set(workspace.id, workspace)
    const owned = []
    for (const raw of response.workspaces[position].projects || []) {
      const primary = primaryFolderOf(raw)
      const project = {
        id: raw.id,
        key: raw.key,
        name: raw.name,
        origin: raw.origin,
        archived: Boolean(raw.archived),
        workspaceId: workspace.id,
        workspaceKey: workspace.key,
        workspaceName: workspace.name,
        workspaceArchived: workspace.archived,
        folders: raw.folders || [],
        primaryPath: primary ? primary.path : null,
        // Missing flag (older payload) counts as "exists": the badge only shows
        // when the server said the folder is gone.
        exists: primary ? primary.exists !== false : true,
        primaryLocked: Boolean(raw.primary_locked),
      }
      owned.push(project)
      projects.push(project)
      projectByKey.set(project.key, project)
    }
    workspace.projects = owned
    projectsByWorkspaceId.set(workspace.id, owned)
  })

  return {
    workspaces,
    projects,
    workspaceByKey,
    projectByKey,
    workspaceById,
    projectsByWorkspaceId,
    seeded: response?.seeded ?? null,
  }
}

/**
 * Where a key (project_id of a card, task or session) lives on screen.
 * kind: 'project' | 'workspace' | 'unregistered' | 'unassigned' | 'unknown'
 * clientKey: the workspace key the key is scoped to (null for unassigned/unknown;
 *            unassigned keeps the raw first segment in `rawClientKey`).
 */
export function resolveKey(key, index) {
  const base = { key, workspace: null, project: null, clientKey: null, rawClientKey: null }
  if (typeof key !== 'string' || key === '') return { ...base, kind: 'unknown' }

  const project = index.projectByKey.get(key)
  if (project) {
    const workspace = index.workspaceById.get(project.workspaceId)
    return { ...base, kind: 'project', workspace, project, clientKey: workspace.key }
  }
  const ownWorkspace = index.workspaceByKey.get(key)
  if (ownWorkspace) {
    return { ...base, kind: 'workspace', workspace: ownWorkspace, clientKey: ownWorkspace.key }
  }
  // A registry-minted key that is not in the registry: there is no DELETE, so it
  // should not happen; never guess a place for it.
  if (isSyntheticKey(key)) return { ...base, kind: 'unknown' }

  const head = firstSegment(key)
  const parent = index.workspaceByKey.get(head)
  if (parent) {
    return { ...base, kind: 'unregistered', workspace: parent, clientKey: parent.key, rawClientKey: head }
  }
  return { ...base, kind: 'unassigned', rawClientKey: head }
}

// Value used by the workspace filter for a resolved key.
export function scopeOf(resolved) {
  return resolved.clientKey ?? NO_WORKSPACE_VALUE
}

// Options of the workspace filter. "Sem workspace" only when something lives
// there; archived workspaces only when archived rows are being shown.
export function workspaceOptions(index, { hasUnassigned = false, showArchived = false } = {}) {
  const options = [{ value: '', label: 'Todos os workspaces' }]
  for (const workspace of index.workspaces) {
    if (workspace.archived && !showArchived) continue
    options.push({ value: workspace.key, label: workspace.name })
  }
  if (hasUnassigned) options.push({ value: NO_WORKSPACE_VALUE, label: 'Sem workspace' })
  return options
}

function restOfKey(key) {
  const slash = key.indexOf('/')
  return slash === -1 ? key : key.slice(slash + 1)
}

// "Pessoal › tn-sandbox", "Pessoal › lab-voz (não cadastrada)",
// "Sem workspace › NewCo/x", "Projeto não encontrado › .w9/.p9".
export function locationLabel(key, index) {
  const resolved = resolveKey(key, index)
  switch (resolved.kind) {
    case 'project':
      return `${resolved.workspace.name} › ${resolved.project.name}`
    case 'workspace':
      return `${resolved.workspace.name} › Do workspace`
    case 'unregistered':
      return `${resolved.workspace.name} › ${restOfKey(key)} (não cadastrada)`
    case 'unassigned':
      return `Sem workspace › ${key}`
    default:
      return `Projeto não encontrado › ${key}`
  }
}

// Short name of the place a session or card belongs to (card sub line, island).
export function placeName(key, index) {
  const resolved = resolveKey(key, index)
  if (resolved.kind === 'project') return resolved.project.name
  if (resolved.kind === 'workspace') return resolved.workspace.name
  if (resolved.kind === 'unregistered') return restOfKey(key)
  return key
}
