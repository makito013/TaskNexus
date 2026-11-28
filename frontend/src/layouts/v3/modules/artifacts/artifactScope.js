// Pure scope of the Artefatos tab: which artifacts belong to the workspace chosen in the header of the
// Projetos screen, to the project refined in the bar and to "Mostrar arquivados"; how they are grouped and
// named. Reads the registry index; no React, no I/O.
//
// A project is the EXACT artifact key (ADR-65, K13): the V2 cut by key prefix and labelled by the legacy
// client tree, which would print a minted key as ".w12". Scope and label come from the registry here.
import { foldText } from '../../../../utils/artifactModel.js'
import { NO_WORKSPACE_VALUE, resolveKey } from '../projects/registryIndex.js'
import { ALL_PROJECTS, DO_WORKSPACE, buildScope, isUnassignedKey, placeOf } from '../board/boardScope.js'

export { ALL_PROJECTS, DO_WORKSPACE, isUnassignedKey }

/**
 * @returns {{ matches(projectId: string): boolean, clienteId: string | null, projectOptions: object[],
 *   hasProjectChoice: boolean }}
 *   clienteId is the workspace key when the header names a real workspace, else null: "Todos" and "Sem
 *   workspace" ask the server for everything and cut here.
 */
export function buildArtifactScope({ registry, workspaceKey = '', projectKey = ALL_PROJECTS, showArchived = false }) {
  const base = buildScope({ registry, workspaceKey, projectKey, showArchived })
  const real = workspaceKey && workspaceKey !== NO_WORKSPACE_VALUE ? registry.workspaceByKey.get(workspaceKey) : null
  return {
    matches: base.matches,
    projectOptions: base.projectOptions,
    hasProjectChoice: base.hasProjectChoice,
    clienteId: real ? real.key : null,
  }
}

// "Pessoal / tn-sandbox", "Pessoal / Do workspace", "Pessoal / lab-voz (não cadastrada)",
// "Sem workspace / NewCo/x", "Projeto não encontrado / .w9/.p9".
export function placeLabel(projectId, registry) {
  const place = placeOf(projectId, registry)
  return `${place.workspace} / ${place.project ?? 'Do workspace'}`
}

// 'unregistered' | 'unassigned' | 'unknown' | null: the buckets get a neutral chip in the group heading.
function bucketOf(projectId, registry) {
  const { kind } = resolveKey(projectId, registry)
  return kind === 'unregistered' || kind === 'unassigned' || kind === 'unknown' ? kind : null
}

function isArchived(projectId, registry) {
  const resolved = resolveKey(projectId, registry)
  if (resolved.kind === 'project') return resolved.project.archived || resolved.workspace.archived
  if (resolved.kind === 'workspace' || resolved.kind === 'unregistered') return resolved.workspace.archived
  return false
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }) : null
const compareLabels = (a, b) => {
  const left = foldText(a)
  const right = foldText(b)
  return collator ? collator.compare(left, right) : left.localeCompare(right)
}

/**
 * One group per place, the list order kept inside each. With "recentes" the groups follow the first item
 * of each (the place of the newest artifact first); with "nome" they follow the alphabet of the label.
 * @returns {Array<{ key: string, label: string, bucket: string | null, archived: boolean, items: object[] }>}
 */
export function groupArtifacts(list, registry, order = 'recentes') {
  const byKey = new Map()
  for (const artifact of list || []) {
    if (!byKey.has(artifact.project_id)) byKey.set(artifact.project_id, [])
    byKey.get(artifact.project_id).push(artifact)
  }
  const groups = Array.from(byKey, ([key, items]) => ({
    key,
    label: placeLabel(key, registry),
    bucket: bucketOf(key, registry),
    archived: isArchived(key, registry),
    items,
  }))
  if (order === 'nome') groups.sort((a, b) => compareLabels(a.label, b.label))
  return groups
}

// Registered, not archived projects (of a workspace that is not archived either) inside the header's
// workspace, with a folder to read: what "Importar do projeto" can offer (K10). The archived switch never
// widens this: an archived project is not imported into.
export function importableProjects(registry, workspaceKey = '') {
  if (workspaceKey === NO_WORKSPACE_VALUE) return []
  return registry.projects.filter((project) => (
    !project.archived
    && !project.workspaceArchived
    && Boolean(project.primaryPath)
    && (!workspaceKey || project.workspaceKey === workspaceKey)
  ))
}
