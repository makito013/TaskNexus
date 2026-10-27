// Pure view model of the "Projetos e agentes" screen. No React, no clock, no I/O:
// the inputs are the raw JSON of the endpoints (registry index, /api/agents,
// /api/sessions/active, /api/sessions/persisted) and everything is derived here.
//
// Session state rules (opcoes-fase1.md section 2, ADR-11):
//   - `persisted` is the source of truth of needs_attention; `active` only fills
//     in for a key missing from `persisted` (race window) or when `persisted`
//     never loaded. Two sources are never OR-ed (an ack between the two GETs
//     would keep "needs you" for a whole tick).
//   - needs_attention with a dead PTY is still "needs_you" (detail "resumable").
//   - `active === null` (never loaded) means "live state unknown": nothing is
//     ever shown as running/stopped.
import { tabLabels } from '../../../../utils/sessionLabels.js'
import { compareProjectPaths } from '../../../../utils/projects.js'
import {
  NO_WORKSPACE_VALUE,
  locationLabel,
  placeName,
  resolveKey,
  scopeOf,
} from './registryIndex.js'

export const STATE_PRIORITY = ['needs_you', 'running', 'stopped', 'free']
const NO_RANK = STATE_PRIORITY.length
const UNKNOWN_AGENT_NAME = 'agente desconhecido'
const COLLATOR = new Intl.Collator('pt-BR')

const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key)

export function stateRank(state) {
  const position = STATE_PRIORITY.indexOf(state)
  return position === -1 ? NO_RANK : position
}

// "projectId::agentId[::suffix]". The project id may contain "/" but never "::".
// A key without "::" is legacy: agentId null.
export function parseSessionKey(key) {
  const parts = String(key).split('::')
  if (parts.length < 2) return { projectKey: parts[0], agentId: null, suffix: null }
  return {
    projectKey: parts[0],
    agentId: parts[1] || null,
    suffix: parts.length > 2 ? parts.slice(2).join('::') : null,
  }
}

// -> { state, detail, live, needsYou }
//   detail: 'running' | 'idle' | 'disconnected' (live) | 'resumable' (dead PTY)
export function sessionStateOf(key, active, persisted) {
  const live = hasOwn(active, key)
  let needsYou = false
  if (hasOwn(persisted, key)) needsYou = Boolean(persisted[key].needs_attention)
  else if (live) needsYou = Boolean(active[key].needs_attention)

  if (needsYou) return { state: 'needs_you', detail: live ? active[key].status ?? null : 'resumable', live, needsYou }
  if (live && active[key].status === 'running') return { state: 'running', detail: 'running', live, needsYou }
  if (live) return { state: 'stopped', detail: active[key].status ?? 'idle', live, needsYou }
  return { state: 'free', detail: 'resumable', live, needsYou }
}

// Finer than stateRank: a live "needs you" beats a resumable one (same group).
function sessionRank(row) {
  if (row.state === 'needs_you') return row.live ? 0 : 0.5
  return stateRank(row.state)
}

// id -> { agent, position } (position = order of the global agent registry).
function agentLookup(agents) {
  return new Map((agents || []).map((agent, position) => [agent.id, { agent, position }]))
}

/**
 * @typedef {{
 *  key: string, projectKey: string, agentId: string | null, suffix: string | null,
 *  label: string, state: string, detail: string | null, live: boolean, resumable: boolean,
 *  agentName: string, agentKind: string | null, resolved: object, scope: string,
 *  placeName: string, location: string, archived: boolean,
 *  orphan: { project: boolean, agent: boolean },
 * }} SessionRow
 */

// One row per session key: the keys of `persisted` in its own order (so the
// "Claude 2" numbering matches the V2), then the keys that are only live.
export function listSessions({ registry, agents, active, persisted }) {
  const keys = Object.keys(persisted || {})
  for (const key of Object.keys(active || {})) if (!hasOwn(persisted, key)) keys.push(key)

  const lookup = agentLookup(agents)
  const parsed = keys.map((key) => {
    const meta = parseSessionKey(key)
    return {
      key,
      ...meta,
      display_name: persisted?.[key]?.display_name ?? active?.[key]?.display_name ?? null,
      // tabLabels reads projectId/agentId (the label of an unknown agent falls
      // back to the raw id), so those two fields are the labelling ones.
      projectId: meta.projectKey,
      rawAgentId: meta.agentId,
      agentId: meta.agentId ?? UNKNOWN_AGENT_NAME,
    }
  })
  const labelled = tabLabels(parsed, (entry) => lookup.get(entry.agentId)?.agent)

  return labelled.map((entry) => {
    const resolved = resolveKey(entry.projectKey, registry)
    const state = sessionStateOf(entry.key, active, persisted)
    const agent = entry.rawAgentId == null ? null : lookup.get(entry.rawAgentId)?.agent ?? null
    return {
      key: entry.key,
      projectKey: entry.projectKey,
      agentId: entry.rawAgentId,
      suffix: entry.suffix,
      label: entry.label,
      state: state.state,
      detail: state.detail,
      live: state.live,
      // Only a saved conversation can be "resumed": a dead PTY that needs you,
      // or one that is simply free.
      resumable: state.state === 'needs_you' ? !state.live : state.state === 'free',
      agentName: agent?.nome || entry.rawAgentId || UNKNOWN_AGENT_NAME,
      agentKind: agent?.ia ?? null,
      resolved,
      scope: scopeOf(resolved),
      placeName: placeName(entry.projectKey, registry),
      location: locationLabel(entry.projectKey, registry),
      archived: Boolean(resolved.project?.archived || resolved.workspace?.archived),
      orphan: { project: resolved.kind === 'unknown', agent: agent == null },
    }
  })
}

// Card state chip text (state + whether the session can only be resumed).
export function cardStateLabel(card) {
  if (card.state === 'needs_you') return card.resumable ? 'precisa de você · retomável' : 'precisa de você'
  if (card.state === 'running') return 'rodando'
  if (card.state === 'stopped') return 'parado'
  return 'livre · retomável'
}

// "2 sessões · 1 ao vivo", "1 sessão · salva". The API exposes no timestamp.
export function cardMeta(card) {
  const count = `${card.sessionCount} ${card.sessionCount > 1 ? 'sessões' : 'sessão'}`
  return card.liveCount > 0 ? `${count} · ${card.liveCount} ao vivo` : `${count} · salva`
}

function buildCard(rows, agentPosition) {
  const best = rows.slice().sort((a, b) => sessionRank(a) - sessionRank(b))[0]
  const first = rows.find((row) => row.live) || rows[0]
  const countsByState = { needs_you: 0, running: 0, stopped: 0, free: 0 }
  for (const row of rows) countsByState[row.state] += 1
  return {
    id: `${best.projectKey}::${best.agentId ?? ''}`,
    projectKey: best.projectKey,
    agentId: best.agentId,
    agentName: best.agentName,
    agentKind: best.agentKind,
    agentPosition,
    state: best.state,
    resumable: best.resumable,
    sessionCount: rows.length,
    liveCount: rows.filter((row) => row.live).length,
    countsByState,
    sessions: rows,
    title: first.label,
    resolved: best.resolved,
    scope: best.scope,
    placeName: best.placeName,
    location: best.location,
    archived: best.archived,
  }
}

function compareCards(a, b) {
  return stateRank(a.state) - stateRank(b.state)
    || a.agentPosition - b.agentPosition
    || COLLATOR.compare(a.agentName, b.agentName)
    || COLLATOR.compare(a.id, b.id)
}

// Cards with a live PTY go first (they can be answered right now).
function compareWaiting(a, b) {
  return Number(a.resumable) - Number(b.resumable) || compareCards(a, b)
}

function bestRankOf(cards) {
  return cards.reduce((best, card) => Math.min(best, stateRank(card.state)), NO_RANK)
}

function withBest(group, cardLists) {
  const rank = Math.min(NO_RANK, ...cardLists.map(bestRankOf))
  return { ...group, bestRank: rank, bestState: rank >= NO_RANK ? null : STATE_PRIORITY[rank] }
}

/**
 * @returns {{
 *  waiting: object[], groups: object[], unassigned: object[], unknown: object[],
 *  counts: { needs_you: number, running: number, stopped: number, free_resumable: number },
 *  liveAvailable: boolean,
 * }}
 */
export function buildAgentBoard({ registry, agents, active, persisted }) {
  const rows = listSessions({ registry, agents, active, persisted })
  const lookup = agentLookup(agents)

  // Aggregate by "projectKey::agentId" (the suffix never becomes an agent).
  const pairs = new Map()
  for (const row of rows) {
    const id = `${row.projectKey}::${row.agentId ?? ''}`
    if (!pairs.has(id)) pairs.set(id, [])
    pairs.get(id).push(row)
  }
  const cards = [...pairs.values()].map((pairRows) => {
    const agentId = pairRows[0].agentId
    const position = agentId != null && lookup.has(agentId)
      ? lookup.get(agentId).position
      : Number.MAX_SAFE_INTEGER
    return buildCard(pairRows, position)
  })

  const projectGroups = new Map()
  const workspaceBuckets = new Map()
  for (const workspace of registry.workspaces) {
    workspaceBuckets.set(workspace.id, { unregistered: new Map(), workspaceLevel: [] })
    for (const project of workspace.projects) {
      projectGroups.set(project.key, {
        project,
        agentCards: [],
        freeAgents: [],
        primaryPath: project.primaryPath,
        exists: project.exists,
        archived: project.archived,
      })
    }
  }
  const unassignedMap = new Map()
  const unknownMap = new Map()

  for (const card of cards) {
    const { resolved } = card
    if (resolved.kind === 'project') {
      projectGroups.get(resolved.project.key).agentCards.push(card)
    } else if (resolved.kind === 'workspace') {
      workspaceBuckets.get(resolved.workspace.id).workspaceLevel.push(card)
    } else if (resolved.kind === 'unregistered') {
      const bucket = workspaceBuckets.get(resolved.workspace.id)
      if (!bucket.unregistered.has(card.projectKey)) {
        bucket.unregistered.set(card.projectKey, { key: card.projectKey, name: card.placeName, cards: [] })
      }
      bucket.unregistered.get(card.projectKey).cards.push(card)
    } else if (resolved.kind === 'unassigned') {
      const clientKey = resolved.rawClientKey
      if (!unassignedMap.has(clientKey)) unassignedMap.set(clientKey, { clientKey, keys: new Set(), cards: [] })
      const bucket = unassignedMap.get(clientKey)
      bucket.keys.add(card.projectKey)
      bucket.cards.push(card)
    } else {
      if (!unknownMap.has(card.projectKey)) unknownMap.set(card.projectKey, { key: card.projectKey, cards: [] })
      unknownMap.get(card.projectKey).cards.push(card)
    }
  }

  const agentList = agents || []
  const sortedCards = (list) => list.slice().sort(compareCards)
  const byNameThenPath = (a, b) => COLLATOR.compare(a.project.name, b.project.name)
    || compareProjectPaths(a.project.key, b.project.key)

  const groups = registry.workspaces.map((workspace) => {
    const bucket = workspaceBuckets.get(workspace.id)
    const owned = workspace.projects.map((project) => {
      const group = projectGroups.get(project.key)
      group.agentCards = sortedCards(group.agentCards)
      const present = new Set(group.agentCards.map((card) => card.agentId))
      group.freeAgents = agentList
        .filter((agent) => !present.has(agent.id))
        .map((agent) => ({ id: agent.id, name: agent.nome || agent.id }))
      return withBest(group, [group.agentCards])
    })
    const projects = owned
      .filter((group) => group.agentCards.length > 0)
      .sort((a, b) => a.bestRank - b.bestRank || byNameThenPath(a, b))
    const silent = owned.filter((group) => group.agentCards.length === 0).sort(byNameThenPath)
    const unregistered = [...bucket.unregistered.values()]
      .map((entry) => withBest({ ...entry, cards: sortedCards(entry.cards) }, [entry.cards]))
      .sort((a, b) => a.bestRank - b.bestRank || compareProjectPaths(a.key, b.key))
    const workspaceLevel = sortedCards(bucket.workspaceLevel)
    return withBest(
      { workspace, projects, silent, unregistered, workspaceLevel },
      [...projects.map((entry) => entry.agentCards), ...unregistered.map((entry) => entry.cards), workspaceLevel],
    )
  }).sort((a, b) => a.bestRank - b.bestRank
    || COLLATOR.compare(a.workspace.name, b.workspace.name)
    || COLLATOR.compare(a.workspace.key, b.workspace.key))

  const unassigned = [...unassignedMap.values()]
    .map((entry) => withBest(
      { ...entry, keys: [...entry.keys].sort(compareProjectPaths), cards: sortedCards(entry.cards) },
      [entry.cards],
    ))
    .sort((a, b) => a.bestRank - b.bestRank || COLLATOR.compare(a.clientKey, b.clientKey))
  const unknown = [...unknownMap.values()]
    .map((entry) => withBest({ ...entry, cards: sortedCards(entry.cards) }, [entry.cards]))
    .sort((a, b) => a.bestRank - b.bestRank || compareProjectPaths(a.key, b.key))

  return {
    waiting: cards.filter((card) => card.state === 'needs_you').sort(compareWaiting),
    groups,
    unassigned,
    unknown,
    counts: {
      needs_you: cards.filter((card) => card.state === 'needs_you').length,
      running: cards.filter((card) => card.state === 'running').length,
      stopped: cards.filter((card) => card.state === 'stopped').length,
      free_resumable: cards.filter((card) => card.state === 'free').length,
    },
    liveAvailable: active != null,
  }
}

// Filters of the toolbar, applied on the view model (no request):
//   workspaceKey: '' (all) | a workspace key | '__none' (outside any workspace)
//   onlyWaiting:  keep only "needs_you" cards
//   showArchived: archived projects/workspaces are hidden unless true
// The "Esperando você" strip follows the workspace filter but NEVER the archived
// toggle nor onlyWaiting: a session that needs the user is not hidden by tidying.
export function filterBoard(board, { workspaceKey = '', onlyWaiting = false, showArchived = false } = {}) {
  const keepCards = (cards) => (onlyWaiting ? cards.filter((card) => card.state === 'needs_you') : cards)
  const outsideWorkspaces = workspaceKey === '' || workspaceKey === NO_WORKSPACE_VALUE

  const waiting = board.waiting.filter((card) => workspaceKey === '' || card.scope === workspaceKey)

  const groups = []
  if (workspaceKey !== NO_WORKSPACE_VALUE) {
    for (const group of board.groups) {
      if (workspaceKey !== '' && group.workspace.key !== workspaceKey) continue
      if (group.workspace.archived && !showArchived) continue
      const visible = (list) => list.filter((entry) => showArchived || !entry.archived)
      const projects = visible(group.projects)
        .map((entry) => ({ ...entry, agentCards: keepCards(entry.agentCards) }))
        .filter((entry) => entry.agentCards.length > 0)
      const silent = onlyWaiting ? [] : visible(group.silent)
      const unregistered = group.unregistered
        .map((entry) => ({ ...entry, cards: keepCards(entry.cards) }))
        .filter((entry) => entry.cards.length > 0)
      const workspaceLevel = keepCards(group.workspaceLevel)
      const hasContent = projects.length + silent.length + unregistered.length + workspaceLevel.length > 0
      if (onlyWaiting && !hasContent) continue
      groups.push({
        ...group,
        projects,
        silent,
        unregistered,
        workspaceLevel,
        projectCount: visible(group.projects).length + visible(group.silent).length,
        empty: !onlyWaiting && !hasContent,
      })
    }
  }

  const narrowBuckets = (list) => (outsideWorkspaces
    ? list.map((entry) => ({ ...entry, cards: keepCards(entry.cards) })).filter((entry) => entry.cards.length > 0)
    : [])
  const unassigned = narrowBuckets(board.unassigned)
  const unknown = narrowBuckets(board.unknown)

  return {
    waiting,
    groups,
    unassigned,
    unknown,
    hasContent: groups.length + unassigned.length + unknown.length > 0,
  }
}

// Rows of the Sessões tab with the same toolbar filters. As in the Agentes tab,
// a "needs you" row is never hidden by the archived toggle.
export function filterSessions(rows, { workspaceKey = '', onlyWaiting = false, showArchived = false } = {}) {
  return rows.filter((row) => {
    if (workspaceKey !== '' && row.scope !== workspaceKey) return false
    if (onlyWaiting && row.state !== 'needs_you') return false
    if (row.archived && !showArchived && row.state !== 'needs_you') return false
    return true
  })
}

// Does anything live outside the registered workspaces? (feeds the filter option)
export function hasUnassignedPlaces(board) {
  return board.unassigned.length > 0 || board.unknown.length > 0
}

const MAX_NAMED_WAITING = 3

// Kan's phrase. Returns { text, state } (state = pet state).
export function projectsIslandMessage({
  loading = false,
  failed = false,
  liveAvailable = true,
  waiting = [],
  running = 0,
  emptyWorkspaceName = null,
} = {}) {
  if (loading) return { text: 'Estou olhando as mesas dos agentes. Um instante.', state: 'thinking' }
  if (failed) {
    return { text: 'Não consegui ler o cadastro de projetos, então não sei onde cada agente está.', state: 'alert' }
  }
  if (emptyWorkspaceName) {
    return {
      text: `O workspace ${emptyWorkspaceName} ainda não tem projetos. Adicione o primeiro para eu mostrar os agentes dele.`,
      state: 'idle',
    }
  }
  if (!liveAvailable) {
    return { text: 'Não consigo ver o que está rodando agora. Mostro só as sessões salvas.', state: 'idle' }
  }
  const count = waiting.length
  const tail = running > 0 ? ` ${running} rodando.` : ''
  if (count === 0) {
    const text = running > 0
      ? `Nada espera você. ${running} ${running > 1 ? 'agentes rodando' : 'agente rodando'}.`
      : 'Nada espera você agora.'
    return { text, state: 'idle' }
  }
  if (count === 1) {
    return { text: `1 agente espera você em ${waiting[0].placeName}.${tail}`, state: 'alert' }
  }
  const named = waiting
    .slice(0, MAX_NAMED_WAITING)
    .map((card) => `${card.agentName} em ${card.placeName}${card.resumable ? ' (retomável)' : ''}`)
  const more = count > MAX_NAMED_WAITING ? ` e mais ${count - MAX_NAMED_WAITING}` : ''
  return { text: `${count} agentes esperam você: ${named.join(' e ')}${more}.${tail}`, state: 'alert' }
}
