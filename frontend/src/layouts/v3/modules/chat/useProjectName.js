import { useEffect, useState } from 'react'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { buildRegistryIndex, isSyntheticKey, resolveKey } from '../projects/registryIndex.js'
import { projectLabel } from './chatLabels.js'

// The readable name of the project a chat belongs to, from the workspace registry the Projects screen
// already reads (".w5/.p50" -> "orq"). One read per mount; while it loads, or if it fails, the label
// of the key stands in, except for a registry-minted key (".p50" says nothing to the user): then the
// name stays empty and the screen shows no project chip rather than a code.
export function resolveProjectName(projectRef, index) {
  if (index) {
    const resolved = resolveKey(projectRef, index)
    if (resolved.kind === 'project') return resolved.project.name
    if (resolved.kind === 'workspace') return resolved.workspace.name
  }
  return isSyntheticKey(projectRef) ? '' : projectLabel(projectRef)
}

export function useProjectName(projectRef) {
  const [index, setIndex] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => workspacesApi.fetchWorkspaces({ includeArchived: true }))
      .then(
        (response) => {
          if (!cancelled) setIndex(buildRegistryIndex(response))
        },
        () => {},
      )
    return () => {
      cancelled = true
    }
  }, [])

  return resolveProjectName(projectRef, index)
}
