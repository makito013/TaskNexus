import { createContext, useContext, useEffect } from 'react'

// Lets the screen of a module drive the shell's island (phrase, pet state and
// actions) without the shell knowing the screen's data. The shell provides
// `report`; a screen calls useIslandReport(moduleId, content) with a MEMOIZED
// content object { message, state, actions } and the island follows it. The
// report is tagged with the module id, so a stale report of another module is
// never shown, and it is cleared when the screen unmounts.
const IslandReportContext = createContext(null)

export const IslandProvider = IslandReportContext.Provider

export function useIslandReport(moduleId, content) {
  const report = useContext(IslandReportContext)

  useEffect(() => {
    if (report) report({ moduleId, ...content })
  }, [report, moduleId, content])

  useEffect(() => {
    if (!report) return undefined
    return () => report(null)
  }, [report])
}
