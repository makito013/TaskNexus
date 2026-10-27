import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { workspacesApi } from '../../../../services/workspacesApi.js'

// The ONLY place of modules/projects/ that may call the registry writes and the
// folder tools (readOnlyGuard.test.js enforces it by reading the sources). The
// dialogs and the screen receive these functions as props.
//
//   createWorkspace / updateWorkspace / createProject / updateProject
//       writes: `pending` is up while they run, `error` keeps the last failure,
//       and `onDone()` (the overview's refetch) runs after a SUCCESS only, so the
//       screen shows the new registry before the promise resolves.
//   inspectFolders / discoverFolders / browseFolder
//       reads (the server only looks): plain pass-through, no pending/error/onDone.
//
// Every function rethrows, so the caller can map the 400/409 to the right field.
export function useRegistryMutations({ onDone } = {}) {
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const write = useCallback(async (call) => {
    if (mountedRef.current) {
      setPendingCount((count) => count + 1)
      setError(null)
    }
    try {
      const result = await call()
      await onDoneRef.current?.()
      return result
    } catch (failure) {
      if (mountedRef.current) setError(failure)
      throw failure
    } finally {
      if (mountedRef.current) setPendingCount((count) => count - 1)
    }
  }, [])

  const createWorkspace = useCallback((input) => write(() => workspacesApi.createWorkspace(input)), [write])
  const updateWorkspace = useCallback((id, input) => write(() => workspacesApi.updateWorkspace(id, input)), [write])
  const createProject = useCallback(
    (workspaceId, input) => write(() => workspacesApi.createProject(workspaceId, input)),
    [write],
  )
  const updateProject = useCallback((id, input) => write(() => workspacesApi.updateProject(id, input)), [write])
  const inspectFolders = useCallback((input) => workspacesApi.inspectFolders(input), [])
  const discoverFolders = useCallback(() => workspacesApi.discoverFolders(), [])
  const browseFolder = useCallback(() => workspacesApi.browseFolder(), [])

  return useMemo(
    () => ({
      createWorkspace,
      updateWorkspace,
      createProject,
      updateProject,
      inspectFolders,
      discoverFolders,
      browseFolder,
      pending: pendingCount > 0,
      error,
    }),
    [createWorkspace, updateWorkspace, createProject, updateProject, inspectFolders, discoverFolders, browseFolder, pendingCount, error],
  )
}
