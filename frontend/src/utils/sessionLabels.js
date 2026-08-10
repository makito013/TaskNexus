// frontend/src/utils/sessionLabels.js
// Shared labeling logic between SessionTabs.jsx (single project) and
// Sidebar.jsx's global "Chats Abertos" list (cross-project) — Fase 4 UI-SPEC
// section 1 requires identical behavior in both, not a divergent reimplementation.
//
// seenCount is keyed by `${projectId}::${agentId}`, not just agentId, so
// numbering ("Claude", "Claude 2") stays scoped per project — two different
// projects each running a single Claude chat must both show plain "Claude",
// not "Claude"/"Claude 2", since the project name (shown separately in the
// global list row) is what disambiguates them, not a fabricated suffix.
export function tabLabels(sessionsList, lookupAgent) {
  const seenCount = {}
  return sessionsList.map((s) => {
    const agent = lookupAgent(s)
    const name = agent?.nome || s.agentId
    const countKey = `${s.projectId}::${s.agentId}`
    seenCount[countKey] = (seenCount[countKey] || 0) + 1
    const n = seenCount[countKey]
    const positionalDefault = n > 1 ? `${name} ${n}` : name
    // Fase 4 (D-08): nome customizado via long-press/duplo clique tem
    // prioridade sobre o default posicional "Claude"/"Claude 2".
    const label = s.display_name?.trim() || positionalDefault
    return { ...s, label, ia: agent?.ia }
  })
}
