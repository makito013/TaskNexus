// Places a card can be moved to or created in: the registered, active projects of
// the active workspaces, each workspace's own root ("Do workspace") and, when a
// card is being edited, its current place even if that place is a stray bucket
// or an archived one (so saving without touching the destination keeps it).
// "Mostrar arquivados" never changes this list: nothing new goes to an archive.
import { placeOf } from './boardScope.js'
import { resolveKey } from '../projects/registryIndex.js'

/**
 * @returns {{ workspaceKey: string | null, label: string,
 *             projects: { key: string, label: string, current?: boolean }[] }[]}
 */
export function listDestinations(registry, currentKey = null) {
  const groups = registry.workspaces
    .filter((workspace) => !workspace.archived)
    .map((workspace) => ({
      workspaceKey: workspace.key,
      label: workspace.name,
      projects: [
        { key: workspace.key, label: 'Do workspace' },
        ...workspace.projects
          .filter((project) => !project.archived && project.key !== workspace.key)
          .map((project) => ({ key: project.key, label: project.name })),
      ],
    }))

  if (!currentKey) return groups
  const already = groups.some((group) => group.projects.some((project) => project.key === currentKey))
  if (already) {
    return groups.map((group) => ({
      ...group,
      projects: group.projects.map((project) => (project.key === currentKey ? { ...project, current: true } : project)),
    }))
  }

  const place = placeOf(currentKey, registry)
  const current = { key: currentKey, label: `${place.project ?? 'Do workspace'} (atual)`, current: true }
  const resolved = resolveKey(currentKey, registry)
  const host = resolved.workspace ? groups.find((group) => group.workspaceKey === resolved.workspace.key) : null
  if (host) return groups.map((group) => (group === host ? { ...group, projects: [...group.projects, current] } : group))
  return [...groups, { workspaceKey: resolved.workspace ? resolved.workspace.key : null, label: place.workspace, projects: [current] }]
}
