// frontend/src/layouts/v2/useClienteProjetoFilter.js
// Local Cliente/Projeto filter cascade for the v2 screens (BoardV2 now,
// TarefasV2 later). Deliberately LOCAL state: `selectedClienteId` in
// AppV2.jsx is shared with the chat sidebar and must not be driven from a
// board-level dropdown, so this hook layers a Tier-1 pick of its own that is
// only meaningful while the sidebar sits on "Todos" (sidebarClienteId ==
// null), plus a Tier-2 project pick that always applies.
//
// Aggregation is by ID PREFIX, not by `Project.sub_projetos`. `sub_projetos`
// (backend/app/agent_discovery.py, backend/app/models.py) only lists DIRECT
// children, so the old `[clienteId, ...subProjetoIds]` formula silently
// dropped cards living in 3+ level hierarchies (cliente/projeto/sub). The
// dropdown stays shallow (direct children only) while the filter behind it
// goes deep — intentional, see the tests named for it.

import { useEffect, useMemo, useState } from 'react';
import { clienteIdFromProjetoId, isClienteId } from '../../utils/clientes.js';
import { resolveClienteNome } from '../../utils/taskGroups.js';

// Every project id in `rootId`'s subtree, including `rootId` itself. Matching
// is on the full "rootId/" prefix so that a sibling whose id merely starts
// with the same characters (rootId "cliente" vs "cliente2/x") never matches.
export function collectSubtreeIds(rootId, projects) {
  if (!rootId) return [];
  const prefix = `${rootId}/`;
  return (projects || [])
    .filter((p) => p.id === rootId || p.id.startsWith(prefix))
    .map((p) => p.id);
}

// Display name of a project. Product decision (Bruno, "orphan card/task"
// session): a project with no resolvable name (removed/unknown, no entry in
// `projects`) does not fall back to the raw id — returns `null`, same as
// `resolveClienteNome` (utils/taskGroups.js). `resolveCardTags` below is
// already conditional on this, so a missing name just omits the tag; it used
// to fall back to the raw id verbatim from BoardV2.jsx, which is exactly what
// this decision removed.
export function resolveProjectName(projetoId, projects) {
  const found = (projects || []).find((p) => p.id === projetoId);
  return found ? found.nome : null;
}

// Card/task tags — the client tag is always shown, the project tag only when
// the project is genuinely different from the client (a client-as-project row
// would otherwise render the very same name twice). A missing/null projetoId
// yields no tags at all, never an empty pill.
export function resolveCardTags(projetoId, projects) {
  if (!projetoId) return { clienteId: null, clienteNome: null, projetoNome: null };
  const clienteId = clienteIdFromProjetoId(projetoId);
  const clienteNome = resolveClienteNome(clienteId, projects);
  const projetoNome = projetoId !== clienteId ? resolveProjectName(projetoId, projects) : null;
  return { clienteId, clienteNome, projetoNome };
}

export function useClienteProjetoFilter(projects, sidebarClienteId) {
  // Local Tier-1 selection: only relevant while the sidebar is on "Todos"
  // (sidebarClienteId == null). Covers the "board opened via Todos" case.
  const [localClienteId, setLocalClienteId] = useState(null);

  // Reset the local pick whenever the sidebar LEAVES "Todos" — a stale local
  // selection can't survive that transition.
  useEffect(() => {
    if (sidebarClienteId != null) setLocalClienteId(null);
  }, [sidebarClienteId]);

  const clienteSelectEnabled = sidebarClienteId == null;
  const effectiveClienteId = sidebarClienteId ?? localClienteId;

  // Top-level projects are the "clientes" candidates — same rule AppV2.jsx
  // already uses to build the sidebar list, consumed here from the single
  // source in utils/clientes.js instead of being rewritten inline.
  const clientes = useMemo(
    () => (projects || []).filter((p) => isClienteId(p.id)),
    [projects]
  );

  // Direct children only: this feeds the (shallow) Tier-2 dropdown.
  const subProjetoIds = useMemo(() => {
    const found = (projects || []).find((p) => p.id === effectiveClienteId);
    return found?.sub_projetos || [];
  }, [projects, effectiveClienteId]);

  const [selectedProjetoId, setSelectedProjetoId] = useState(null);
  useEffect(() => { setSelectedProjetoId(null); }, [effectiveClienteId]);

  const selectedProjectIds = useMemo(() => {
    if (effectiveClienteId == null) return [];

    // Guard against a `selectedProjetoId` left over from the previous client:
    // the reset above runs in an effect, so the render where
    // `effectiveClienteId` changes still sees the old project id. Ignoring an
    // id outside the current client keeps that render from leaking the other
    // client's cards.
    const rootId =
      selectedProjetoId && selectedProjetoId.startsWith(`${effectiveClienteId}/`)
        ? selectedProjetoId
        : effectiveClienteId;

    const subtree = collectSubtreeIds(rootId, projects);
    // Client-only cards/tasks (attached directly to the client, with no
    // specific project) must stay visible even when a specific project is
    // selected — definitive product behavior, not a bug.
    const ids = rootId !== effectiveClienteId
      ? Array.from(new Set([effectiveClienteId, ...subtree]))
      : subtree;

    // An empty array means "no filter at all" to useCards (it drops the query
    // param and fetches EVERY project), so never return one while a client is
    // selected — `projects` can legitimately still be empty on the first
    // render, before useProjects resolves.
    return ids.length ? ids : [effectiveClienteId];
  }, [effectiveClienteId, selectedProjetoId, projects]);

  return {
    clienteSelectEnabled,
    clientes,
    effectiveClienteId,
    localClienteId,
    setLocalClienteId,
    subProjetoIds,
    selectedProjetoId,
    setSelectedProjetoId,
    selectedProjectIds,
  };
}
