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
//
// Fase N (08-planejamento-navegacao-cliente-projeto.md, 8.2.1 item 5 —
// decisão do Bruno: a barra CONTINUA no Board/Tarefas, "principalmente quando
// estiver em Todos"): a sidebar agora escolhe também um PROJETO
// (`sidebarProjetoId`, do useNavScope no AppV2), e a barra passa a PARTIR dela:
//
//   Sidebar                 Barra                                    Muda
//   "Todos"                 Cliente + Projeto (igual a antes)        só a tela
//   Cliente                 Projeto do cliente (igual a antes)       só a tela
//   Projeto                 Projeto já PREENCHIDO com ele, listando  só a tela
//                           também os subprojetos dele
//
// O refinamento feito na barra é LOCAL (nunca volta para a sidebar nem para o
// chat) e é DESCARTADO sempre que a sidebar muda — cliente OU projeto —: a
// sidebar é a base, a barra é "olhar outra coisa só aqui". O descarte acontece
// no próprio render em que a sidebar muda (estado marcado com a chave do
// escopo, ajustado durante o render), não num efeito: com efeito, esse render
// ainda filtraria pelo refinamento velho e o Board dispararia uma busca por
// ele antes de corrigir.
//
// "Raiz" (sidebar com `projetoId === clienteId`) filtra SÓ os itens presos
// direto no cliente — igualdade exata, não subárvore (utils/projectTree.js) —
// e ganha uma opção "Raiz" no select para ele poder vir preenchido.

import { useCallback, useMemo, useState } from 'react';
import { clienteIdFromProjetoId, isClienteId } from '../../utils/clientes.js';
import { resolveClienteNome } from '../../utils/taskGroups.js';
import { compareProjectPaths } from '../../utils/projects.js';

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

export function useClienteProjetoFilter(projects, sidebarClienteId, sidebarProjetoId = null) {
  // Um projeto sem cliente na sidebar não tem sentido ("Todos" é sempre
  // projeto nulo); normaliza para a barra nunca partir de um par impossível.
  const anchorProjetoId = sidebarClienteId != null ? (sidebarProjetoId ?? null) : null;

  // Refinamento LOCAL da barra, marcado com o escopo da sidebar em que foi
  // feito. `clienteId` só vale enquanto a sidebar está em "Todos" (Tier 1
  // local); `projetoId` é o Tier 2, que nasce igual ao projeto da sidebar.
  const scopeKey = `${sidebarClienteId ?? ''}\n${anchorProjetoId ?? ''}`;
  const [refinement, setRefinement] = useState(
    () => ({ scopeKey, clienteId: null, projetoId: anchorProjetoId })
  );
  let current = refinement;
  if (refinement.scopeKey !== scopeKey) {
    // A sidebar mudou: a barra volta a acompanhá-la NESTE render.
    current = { scopeKey, clienteId: null, projetoId: anchorProjetoId };
    setRefinement(current);
  }

  const localClienteId = current.clienteId;
  const selectedProjetoId = current.projetoId;
  const clienteSelectEnabled = sidebarClienteId == null;
  const effectiveClienteId = sidebarClienteId ?? localClienteId;

  // Trocar o cliente no select local recomeça o Tier 2 em "Todos os projetos"
  // — um projeto do cliente anterior não existe no novo.
  const setLocalClienteId = useCallback(
    (clienteId) => setRefinement({ scopeKey, clienteId, projetoId: null }),
    [scopeKey]
  );
  const setSelectedProjetoId = useCallback(
    (projetoId) => setRefinement((r) => ({
      scopeKey,
      clienteId: r.scopeKey === scopeKey ? r.clienteId : null,
      projetoId,
    })),
    [scopeKey]
  );

  // Top-level projects are the "clientes" candidates — same rule AppV2.jsx
  // already uses to build the sidebar list, consumed here from the single
  // source in utils/clientes.js instead of being rewritten inline.
  const clientes = useMemo(
    () => (projects || []).filter((p) => isClienteId(p.id)),
    [projects]
  );

  // Direct children only: this feeds the (shallow) Tier-2 dropdown. With a
  // project chosen on the sidebar the dropdown also carries that project's
  // ancestors and its whole subtree ("mostra também os subprojetos"), in tree
  // order, so the pre-filled value is always one of the options; "Raiz" adds
  // the client itself as the first option.
  const subProjetoIds = useMemo(() => {
    const found = (projects || []).find((p) => p.id === effectiveClienteId);
    const direct = found?.sub_projetos || [];
    if (anchorProjetoId == null || effectiveClienteId == null) return direct;
    if (anchorProjetoId === effectiveClienteId) return [effectiveClienteId, ...direct];
    const inClient = `${effectiveClienteId}/`;
    const related = (projects || [])
      .map((p) => p.id)
      .filter((id) => id.startsWith(inClient)
        && (anchorProjetoId === id
          || anchorProjetoId.startsWith(`${id}/`)
          || id.startsWith(`${anchorProjetoId}/`)));
    // O próprio projeto da sidebar entra mesmo antes de `projects` chegar,
    // senão o select preenchido ficaria sem a opção correspondente.
    return Array.from(new Set([...direct, ...related, anchorProjetoId])).sort(compareProjectPaths);
  }, [projects, effectiveClienteId, anchorProjetoId]);

  const selectedProjectIds = useMemo(() => {
    if (effectiveClienteId == null) return [];

    // "Raiz" (Fase N): só o próprio cliente, igualdade exata — a subárvore do
    // cliente inteiro já é o `selectedProjetoId == null` abaixo.
    if (selectedProjetoId === effectiveClienteId) return [effectiveClienteId];

    // Guard against a `selectedProjetoId` from another client. The reset used
    // to run in an effect (one render late); since Fase N it happens in the
    // very render where the client changes, but the guard stays as defense in
    // depth — a stale `onChange` from a select of the previous client must
    // never leak the other client's cards into a query.
    const rootId =
      selectedProjetoId && selectedProjetoId.startsWith(`${effectiveClienteId}/`)
        ? selectedProjetoId
        : effectiveClienteId;

    // Picking a specific project narrows to THAT project's subtree and
    // nothing else: client-only cards/tasks (attached directly to the client,
    // with no specific project) disappear. Product decision (Bruno, "filtro de
    // projeto deixa passar cards sem projeto" session) reversing the earlier
    // rule, which unioned `effectiveClienteId` back in and made a project
    // filter unable to exclude anything. Applies to BOTH v2 screens that share
    // this hook (BoardV2 and TarefasV2), deliberately and without a flag.
    const ids = collectSubtreeIds(rootId, projects);

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
