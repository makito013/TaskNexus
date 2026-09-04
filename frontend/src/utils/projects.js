// frontend/src/utils/projects.js
// Project id -> human label, with the raw id as fallback.
//
// ⚠️ This is NOT the same function as `resolveProjectName` in
// `layouts/v2/useClienteProjetoFilter.js`, despite the near-identical body.
// The two have OPPOSITE semantics on the unresolved case, on purpose:
//
// - `resolveProjectLabel` (here): falls back to the raw id. Used where the
//   value is an <option>/field label the user actively picked, so showing
//   something — even a raw id — beats showing an empty row.
// - `useClienteProjetoFilter.resolveProjectName`: returns `null`. Product
//   decision (Bruno, "orphan card/task" session): a card whose project was
//   removed from disk shows NO tag rather than a raw id. Covered by
//   `useClienteProjetoFilter.test.js`.
//
// Do not "consolidate" them. This one lives here (instead of inside
// CardFormModal.jsx, where it used to be exported from) so the name
// collision is visible at the import site.
export function resolveProjectLabel(projetoId, projetos) {
  const found = (projetos || []).find((p) => p.id === projetoId);
  return found ? found.nome : projetoId;
}
