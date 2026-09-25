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
// relativePathBelow(id, ancestorId)
// ---------------------------------------------------------------------------
// Generalisation of `relativeProjectPath`: the segments of `id` AFTER the
// segments of `ancestorId` (which may be at ANY depth, not just 1), joined
// with ' / '.
//
//   relativePathBelow('podesubir/principal/apps', 'podesubir/principal')
//     -> 'apps'                          (direct child -> clean name)
//   relativePathBelow('podesubir/principal/apps/guardapp', 'podesubir/principal')
//     -> 'apps / guardapp'               (depth >= 2 -> flattened path)
//   relativePathBelow('podesubir', 'podesubir') -> ''  (it IS the ancestor)
//
// This is the <option> label of the cascade's level 2 (Subprojeto): a clean
// name for the primary's direct child, a flattened ' / ' path for deeper
// descendants. `relativeProjectPath` stays as-is (frozen, 3 consumers) — this
// is the additive generalisation, not a replacement.
export function relativePathBelow(id, ancestorId) {
  // Defense: if `id` is not a descendant of `ancestorId`, return the whole id
  // (same fallback philosophy as relativeProjectPath). The `+ '/'` in the
  // prefix test is load-bearing: 'podesubir/principal2' must NOT read as a
  // descendant of 'podesubir/principal'.
  if (id !== ancestorId && !id.startsWith(ancestorId + '/')) return id;
  const ancestorDepth = ancestorId.split('/').length;
  return id.split('/').slice(ancestorDepth).join(' / ');
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
// - ELIGIBILITY: keep only `p.elegivel === true` (reflects `.claude/`,
//   `.gemini/` OR `.codex/`; replaces the `agentes?.length > 0` proxy). Parent
//   folders without any of those disappear entirely — they don't show up
//   disabled.
// - ORDER: `.sort((x, y) => compareProjectPaths(x.id, y.id))`.
// - RETURN: `{ id, label, depth }[]` — descendants only, already sorted.
//   The root <option> (`value=""`, text `Raiz de {nome}`) is NOT produced
//   here — it is prepended by the component, to avoid coupling this helper
//   to microcopy.
//
// ⚠️ ORPHANED IN PRODUCTION since the 2-level cascade landed: NewChatSheet now
// uses `listPrimaryProjectsForClient` + `listSubProjectsForPrimary` instead of
// this flattened single-level list. Kept (frozen, with its tests) per ADR-3 —
// new helpers are additive, old ones are not touched. Removal is a separate
// decision, not this round's.
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
// listPrimaryProjectsForClient(clienteId, projects)  — cascade level 1
// ---------------------------------------------------------------------------
// - FILTER: DIRECT children of the client only — `p.id` starts with
//   `clienteId + '/'` AND has exactly one more segment than `clienteId`.
// - NO eligibility filter: non-eligible GROUPING folders belong here. They are
//   a navigation step (the user walks down through them to an eligible
//   subproject); picking one does NOT enable "Criar chat" — see `eligible`.
//   This is the deliberate difference from `listSubProjectsForClient`.
// - ORDER: `compareProjectPaths` on the full id.
// - RETURN: `{ id, label, eligible, hasEligibleDescendants, depth }[]`.
//   The 1st <option> ("Raiz de {nome}", `value=""`) is NOT produced here — the
//   component prepends it, so this helper stays free of microcopy.
//
// `hasEligibleDescendants` distinguishes a real grouping folder (with subs —
// state D) from a dead-end one (state E). It is part of the closed contract
// (ADR-3) but NOT read by NewChatSheet today: the component decides D vs E by
// `listSubProjectsForPrimary(...).length`, which is the same signal computed
// from the list it already needs. Kept because the contract is the spec.
export function listPrimaryProjectsForClient(clienteId, projects) {
  const directDepth = clienteId.split('/').length + 1;
  const all = projects || [];
  return all
    .filter((p) => p.id.startsWith(clienteId + '/') && p.id.split('/').length === directDepth)
    .sort((x, y) => compareProjectPaths(x.id, y.id))
    .map((p) => ({
      id: p.id,
      label: relativePathBelow(p.id, clienteId),
      eligible: p.elegivel === true,
      hasEligibleDescendants: all.some((q) => q.id.startsWith(p.id + '/') && q.elegivel === true),
      depth: p.id.split('/').length - 1,
    }));
}

// ---------------------------------------------------------------------------
// listSubProjectsForPrimary(primaryId, projects)  — cascade level 2
// ---------------------------------------------------------------------------
// - FILTER: descendants at ANY depth below the primary
//   (`p.id.startsWith(primaryId + '/')`) that are `elegivel === true`.
//   Non-eligible intermediate folders between the primary and a deep
//   subproject disappear from the list — only the eligible descendant shows
//   up, with the path flattened into its label.
// - ORDER: `compareProjectPaths` — shared prefixes stay adjacent, so the list
//   reads as a tree.
// - RETURN: `{ id, label, depth }[]`, `depth` RELATIVE to the primary
//   (1 = direct child).
//   The 1st <option> is NOT produced here either: the component prepends it,
//   conditional on the primary's eligibility ("Todo o {primário}" vs
//   "Selecione um subprojeto").
//
// The level-2 <select> is only mounted when this array is non-empty (Bruno:
// "select deve mostrar somente quando tem um subprojeto registrado").
export function listSubProjectsForPrimary(primaryId, projects) {
  const primaryDepth = primaryId.split('/').length;
  return (projects || [])
    .filter((p) => p.id.startsWith(primaryId + '/') && p.elegivel === true)
    .sort((x, y) => compareProjectPaths(x.id, y.id))
    .map((p) => ({
      id: p.id,
      label: relativePathBelow(p.id, primaryId),
      depth: p.id.split('/').length - primaryDepth,
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
