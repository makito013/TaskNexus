// Pure scope of the board: which cards belong to the workspace chosen in the
// header of the Projetos screen, to the project refined on the board and to the
// "Mostrar arquivados" switch. Reads the registry index; no React, no I/O.
//
// A project is the EXACT card key (ADR-65): the registry is flat, and a legacy
// sub-folder that is not registered shows up inside its workspace as
// "(não cadastrada)" instead of vanishing.
import { NO_WORKSPACE_VALUE, resolveKey, scopeOf } from '../projects/registryIndex.js'

// Refinement values of the project select ('' = every project of the scope).
export const ALL_PROJECTS = ''
export const DO_WORKSPACE = '__workspace'

function isArchivedPlace(resolved) {
  if (resolved.kind === 'project') return resolved.project.archived || resolved.workspace.archived
  if (resolved.kind === 'workspace' || resolved.kind === 'unregistered') return resolved.workspace.archived
  return false
}

export function buildScope({ registry, workspaceKey = '', projectKey = ALL_PROJECTS, showArchived = false }) {
  const realWorkspace = workspaceKey && workspaceKey !== NO_WORKSPACE_VALUE
    ? registry.workspaceByKey.get(workspaceKey) ?? null
    : null

  const matches = (cardKey) => {
    const resolved = resolveKey(cardKey, registry)
    if (!showArchived && isArchivedPlace(resolved)) return false
    if (workspaceKey && scopeOf(resolved) !== workspaceKey) return false
    // The root of a legacy workspace is a registered project keyed like the workspace itself, so the
    // root card resolves to a project: match it by key as well.
    if (projectKey === DO_WORKSPACE) return resolved.kind === 'workspace' || cardKey === workspaceKey
    if (projectKey) return cardKey === projectKey
    return true
  }

  const projectOptions = [{ value: ALL_PROJECTS, label: 'Todos os projetos' }]
  if (realWorkspace) {
    for (const project of realWorkspace.projects) {
      if (project.archived && !showArchived) continue
      projectOptions.push({ value: project.key, label: project.archived ? `${project.name} (arquivado)` : project.name })
    }
    projectOptions.push({ value: DO_WORKSPACE, label: 'Do workspace' })
  }

  // The cards the server is asked for: only a chosen project narrows the request.
  let fetchIds = []
  if (projectKey === DO_WORKSPACE && realWorkspace) fetchIds = [realWorkspace.key]
  else if (projectKey && projectKey !== DO_WORKSPACE) fetchIds = [projectKey]

  return { matches, projectOptions, fetchIds, hasProjectChoice: Boolean(realWorkspace) }
}

// Where a card lives, in words: the workspace label and, when the card is not at
// the root of its workspace, the project label.
export function placeOf(cardKey, registry) {
  const resolved = resolveKey(cardKey, registry)
  switch (resolved.kind) {
    case 'project':
      return { workspace: resolved.workspace.name, project: resolved.project.name }
    case 'workspace':
      return { workspace: resolved.workspace.name, project: null }
    case 'unregistered': {
      const slash = cardKey.indexOf('/')
      const rest = slash === -1 ? cardKey : cardKey.slice(slash + 1)
      return { workspace: resolved.workspace.name, project: `${rest} (não cadastrada)` }
    }
    case 'unassigned':
      return { workspace: 'Sem workspace', project: cardKey }
    default:
      return { workspace: 'Projeto não encontrado', project: cardKey }
  }
}

// Whether a card sits outside every workspace: the "Sem workspace" option of the
// filter must exist for it, or the card would be unreachable.
export function isUnassignedKey(cardKey, registry) {
  const { kind } = resolveKey(cardKey, registry)
  return kind === 'unassigned' || kind === 'unknown'
}
