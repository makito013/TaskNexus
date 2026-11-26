import { createContext, useContext, useMemo, useState } from 'react'

// The view state of the Projetos screen that has to outlive the screen: the open
// tab, the workspace filter and "Mostrar arquivados". Going to a chat ("Ver",
// "Citar") unmounts the screen; coming back finds these as they were. Memory
// only: nothing here is written to the address or to web storage.
//
// unassignedKnown: whether anything lives outside a workspace, as last reported
// by the Board tab (null = not known yet). The workspace filter needs it to keep
// "Sem workspace" selected across the trip to the chat.
// boardProject: the project refined on the Board tab, marked with the workspace it was chosen in
// (it only counts while that workspace is still the filter).
function useViewState() {
  const [tab, setTab] = useState('agents')
  const [workspaceKey, setWorkspaceKey] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [unassignedKnown, setUnassignedKnown] = useState(null)
  const [boardProject, setBoardProject] = useState({ workspaceKey: '', projectKey: '' })
  return useMemo(
    () => ({ tab, setTab, workspaceKey, setWorkspaceKey, showArchived, setShowArchived, unassignedKnown, setUnassignedKnown, boardProject, setBoardProject }),
    [tab, workspaceKey, showArchived, unassignedKnown, boardProject],
  )
}

const ProjectsViewContext = createContext(null)

export function ProjectsViewProvider({ children }) {
  const value = useViewState()
  return <ProjectsViewContext.Provider value={value}>{children}</ProjectsViewContext.Provider>
}

// Without a provider (a screen rendered on its own, as the tests do) the state
// is local to the component that asks for it.
export function useProjectsView() {
  const shared = useContext(ProjectsViewContext)
  const local = useViewState()
  return shared ?? local
}
