// frontend/src/utils/projectNames.js
// Display name of a project. Product decision (Bruno, "orphan card/task"
// session): a project with no resolvable name (removed/unknown, no entry in
// `projects`) does not fall back to the raw id — returns `null`, same as
// `resolveClienteNome` (utils/taskGroups.js). Callers treat `null` as "omit
// the name", never as a raw id standing in for it.
//
// Moved verbatim from layouts/v2/useClienteProjetoFilter.js so layouts that
// must not import each other (v3 only reaches services/hooks/utils) can share
// it. The v2 module re-exports it, so its callers are unchanged.
export function resolveProjectName(projetoId, projects) {
  const found = (projects || []).find((p) => p.id === projetoId);
  return found ? found.nome : null;
}
