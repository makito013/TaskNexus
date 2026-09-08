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

// ---------------------------------------------------------------------------
// relativeProjectPath(id, clienteId)
// ---------------------------------------------------------------------------
// Relative path of a project under its client: the segments of `id` after
// the first one, joined with ' / ' (space-slash-space).
//
//   relativeProjectPath('podesubir/gateway/access-gateway-controlid-db', 'podesubir')
//     -> 'gateway / access-gateway-controlid-db'
//   relativeProjectPath('podesubir', 'podesubir') -> ''  (it IS the root)
//
// Consumed by 3 surfaces — must live in this single module, or a future edit
// would drift the 3 places out of sync:
//   1. the <option> text in NewChatSheet's project select;
//   2. ChatList.resolveRowMeta (depth >= 2);
//   3. the depth test (via `.split('/')` of the id) deciding 'Raiz' vs path.
export function relativeProjectPath(id, clienteId) {
  const segments = id.split('/');
  // Defense: if the id doesn't start with clienteId, return the whole id
  // (same fallback philosophy as resolveProjectLabel — show something
  // rather than nothing).
  if (segments[0] !== clienteId) return id;
  return segments.slice(1).join(' / ');
}

// ---------------------------------------------------------------------------
// compareProjectPaths(a, b)
// ---------------------------------------------------------------------------
// Tree order for project ids. Compares SEGMENT BY SEGMENT, never the raw
// string: "-" (0x2D) sorts before "/" (0x2F), so a hyphenated sibling would
// wedge itself between a parent and its own children.
//
// - What is compared: the FULL `id`. Every candidate shares the
//   `${clienteId}/` prefix, so ordering by full id and by relative path are
//   identical — comparing the full id avoids a partial string slice.
// - Collation within a segment: plain `<` (code-unit), NOT `localeCompare`
//   (which would need an explicit locale + sensitivity to be reproducible;
//   today's names agree either way).
export function compareProjectPaths(a, b) {
  const as = a.split('/');
  const bs = b.split('/');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i += 1) {
    if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  // All shared segments are equal -> the shorter path (the ancestor) comes
  // first. Never returns 0 for distinct ids.
  return as.length - bs.length;
}

// ---------------------------------------------------------------------------
// listSubProjectsForClient(clienteId, projects)
// ---------------------------------------------------------------------------
// - FILTER: `projects` (flat array from /api/projetos) where
//   `p.id.startsWith(clienteId + '/')` (descendants at any depth — not just
//   direct children like the old `sub_projetos`).
// - ELIGIBILITY: keep only `p.elegivel === true` (reflects `.claude/` OR
//   `.gemini/`; replaces the `agentes?.length > 0` proxy). Parent folders
//   without `.claude/` disappear entirely — they don't show up disabled.
// - ORDER: `.sort((x, y) => compareProjectPaths(x.id, y.id))`.
// - RETURN: `{ id, label, depth }[]` — descendants only, already sorted.
//   The root <option> (`value=""`, text `Raiz de {nome}`) is NOT produced
//   here — it is prepended by the component, to avoid coupling this helper
//   to microcopy.
export function listSubProjectsForClient(clienteId, projects) {
  return (projects || [])
    .filter((p) => p.id.startsWith(clienteId + '/') && p.elegivel === true)
    .sort((x, y) => compareProjectPaths(x.id, y.id))
    .map((p) => ({
      id: p.id,
      label: relativeProjectPath(p.id, clienteId),
      depth: p.id.split('/').length - 1,
    }));
}

// ---------------------------------------------------------------------------
// truncatePathMeta(relativePath, budget = 2)
// ---------------------------------------------------------------------------
// Truncates the HEAD of a relative path, preserving the last `budget`
// segments (the real folder = the chat's identity). Computed in JS, not via
// CSS `direction: rtl` (the rtl trick is fragile with `/` as separator, and
// jsdom has no layout — CSS ellipsis would only be QA-manual-testable).
//
//   truncatePathMeta('gateway / access-gateway-controlid-db')
//     -> 'gateway / access-gateway-controlid-db'          (2 segments, fits)
//   truncatePathMeta('principal / apps / podesubir-guardapp-rn')
//     -> '… / apps / podesubir-guardapp-rn'
//
// The caller must set `title={fullPath}` on the row so hover reveals it all.
export function truncatePathMeta(relativePath, budget = 2) {
  const segments = relativePath.split(' / ');
  if (segments.length <= budget) return relativePath;
  return '… / ' + segments.slice(-budget).join(' / ');
}
