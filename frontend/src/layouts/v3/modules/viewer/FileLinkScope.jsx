import { createContext, useContext, useMemo } from 'react'
import { useViewerShell } from './ViewerShell.jsx'
import './FileLinks.css'

// The conversation whose messages are on screen, as far as file links are concerned: its text, its tool chips
// and nothing else. `useFileLinks()` answers null outside a scope or without the viewer shell, and a screen
// that gets null renders exactly what it did before (no buttons, no handler). Cards that carry text of the
// agent next to an approval button (the plan, the permission) never ask for it.
//   openPath(path, { line }) -> Promise<{ ok, error? }>   the user's request: POST to the viewer of the conversation
const FileLinkContext = createContext(null)

export function useFileLinks() {
  return useContext(FileLinkContext)
}

export default function FileLinkScope({ sessionKey, children }) {
  const shell = useViewerShell()
  const openFile = shell?.openFile
  const value = useMemo(
    () => (openFile && sessionKey ? { openPath: (path, { line = null } = {}) => openFile(sessionKey, path, { line }) } : null),
    [openFile, sessionKey],
  )
  return <FileLinkContext.Provider value={value}>{children}</FileLinkContext.Provider>
}
