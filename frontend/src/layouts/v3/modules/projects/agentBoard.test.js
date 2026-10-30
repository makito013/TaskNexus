import { describe, it, expect } from 'vitest'
import {
  STATE_PRIORITY,
  buildAgentBoard,
  cardMeta,
  cardStateLabel,
  filterBoard,
  filterSessions,
  hasUnassignedPlaces,
  listSessions,
  parseSessionKey,
  projectsIslandMessage,
  sessionStateOf,
} from './agentBoard.js'
import { buildRegistryIndex } from './registryIndex.js'

const project = (id, key, name, extra = {}) => ({
  id,
  key,
  name,
  origin: 'seed',
  archived: false,
  primary_locked: false,
  folders: [{ id, path: `D:\\projetos\\${key.replace('/', '\\')}`, is_primary: true, position: 0, exists: true }],
  ...extra,
})

const RESPONSE = {
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        project(1, 'Pessoal/tn-sandbox', 'tn-sandbox'),
        project(2, 'Pessoal/TaskNexus', 'TaskNexus'),
        project(3, 'Pessoal/silent', 'silent'),
        project(4, 'Pessoal/old', 'old', { archived: true }),
      ],
    },
    {
      id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false,
      projects: [project(5, 'podesubir/ymci-backend', 'ymci-backend')],
    },
    { id: 3, key: '.w3', name: 'Estudos', origin: 'user', archived: false, projects: [] },
    {
      id: 4, key: 'RD', name: 'RD', origin: 'seed', archived: true,
      projects: [project(6, 'RD/rd-campanhas', 'rd-campanhas', { archived: true })],
    },
  ],
}

const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
  { id: 'terminal', nome: 'Terminal', ia: 'terminal' },
]

const registry = buildRegistryIndex(RESPONSE)
const meta = (attention = false, name = null) => ({ display_name: name, needs_attention: attention, push_notified: false })
const live = (status, attention = false) => ({ status, connected: status !== 'disconnected', needs_attention: attention, display_name: null })

function build(active, persisted, agents = AGENTS) {
  return buildAgentBoard({ registry, agents, active, persisted })
}

describe('parseSessionKey', () => {
  it('splits project, agent and suffix', () => {
    expect(parseSessionKey('Pessoal/tn-sandbox::claude')).toEqual({ projectKey: 'Pessoal/tn-sandbox', agentId: 'claude', suffix: null })
    expect(parseSessionKey('Pessoal/x::codex::a1b2c3')).toEqual({ projectKey: 'Pessoal/x', agentId: 'codex', suffix: 'a1b2c3' })
  })

  it('treats a key without "::" as legacy with no agent', () => {
    expect(parseSessionKey('Pessoal/legacy')).toEqual({ projectKey: 'Pessoal/legacy', agentId: null, suffix: null })
  })

  it('keeps the "default" agent id as it is', () => {
    expect(parseSessionKey('p::default').agentId).toBe('default')
  })
})

describe('sessionStateOf (ADR-11)', () => {
  it('needs attention with a live PTY is needs_you and keeps the live status as detail', () => {
    const result = sessionStateOf('k', { k: live('running', true) }, { k: meta(true) })
    expect(result).toMatchObject({ state: 'needs_you', detail: 'running', live: true })
  })

  it('needs_attention with a dead PTY is still needs_you, resumable', () => {
    const result = sessionStateOf('k', {}, { k: meta(true) })
    expect(result).toMatchObject({ state: 'needs_you', detail: 'resumable', live: false })
  })

  it('persisted decides needs_attention: an ack seen in persisted wins over a stale active flag', () => {
    const result = sessionStateOf('k', { k: live('idle', true) }, { k: meta(false) })
    expect(result.state).toBe('stopped')
  })

  it('a key only in active falls back to active.needs_attention', () => {
    expect(sessionStateOf('k', { k: live('idle', true) }, {}).state).toBe('needs_you')
    expect(sessionStateOf('k', { k: live('idle', false) }, {}).state).toBe('stopped')
  })

  it('running, stopped (idle / disconnected) and free', () => {
    expect(sessionStateOf('k', { k: live('running') }, { k: meta() }).state).toBe('running')
    expect(sessionStateOf('k', { k: live('idle') }, { k: meta() })).toMatchObject({ state: 'stopped', detail: 'idle' })
    expect(sessionStateOf('k', { k: live('disconnected') }, { k: meta() })).toMatchObject({ state: 'stopped', detail: 'disconnected' })
    expect(sessionStateOf('k', {}, { k: meta() })).toMatchObject({ state: 'free', detail: 'resumable', live: false })
  })

  it('an active source that never loaded never produces running or stopped', () => {
    expect(sessionStateOf('k', null, { k: meta() }).state).toBe('free')
    expect(sessionStateOf('k', null, { k: meta(true) })).toMatchObject({ state: 'needs_you', detail: 'resumable' })
  })

  it('a persisted source that never loaded falls back to active', () => {
    expect(sessionStateOf('k', { k: live('running', true) }, null).state).toBe('needs_you')
    expect(sessionStateOf('k', { k: live('running') }, null).state).toBe('running')
  })

  it('exposes the priority order', () => {
    expect(STATE_PRIORITY).toEqual(['needs_you', 'running', 'stopped', 'free'])
  })
})

describe('listSessions', () => {
  it('uses the order of persisted, then the keys that are only live', () => {
    const rows = listSessions({
      registry,
      agents: AGENTS,
      active: { 'Pessoal/TaskNexus::codex': live('idle'), 'Pessoal/tn-sandbox::claude': live('running') },
      persisted: { 'Pessoal/tn-sandbox::claude': meta(), 'Pessoal/TaskNexus::claude': meta() },
    })
    expect(rows.map((row) => row.key)).toEqual([
      'Pessoal/tn-sandbox::claude',
      'Pessoal/TaskNexus::claude',
      'Pessoal/TaskNexus::codex',
    ])
  })

  it('numbers two chats of the same agent in the same project ("Claude", "Claude 2") and honours display_name', () => {
    const rows = listSessions({
      registry,
      agents: AGENTS,
      active: {},
      persisted: {
        'Pessoal/tn-sandbox::claude': meta(),
        'Pessoal/tn-sandbox::claude::a1b2c3': meta(),
        'Pessoal/tn-sandbox::codex': meta(false, 'Ajustar testes'),
      },
    })
    expect(rows.map((row) => row.label)).toEqual(['Claude', 'Claude 2', 'Ajustar testes'])
    expect(rows[1].suffix).toBe('a1b2c3')
  })

  it('labels a key without "::" and an agent missing from the registry', () => {
    const rows = listSessions({
      registry,
      agents: AGENTS,
      active: {},
      persisted: { 'Pessoal/legacy': meta(), 'Pessoal/tn-sandbox::removido': meta(), 'Pessoal/tn-sandbox::default': meta() },
    })
    expect(rows[0]).toMatchObject({ agentId: null, agentName: 'agente desconhecido', label: 'agente desconhecido' })
    expect(rows[0].orphan.agent).toBe(true)
    expect(rows[1]).toMatchObject({ agentId: 'removido', agentName: 'removido', label: 'removido' })
    expect(rows[2]).toMatchObject({ agentId: 'default', agentName: 'default' })
  })

  it('resolves the place of each row through the registry', () => {
    const rows = listSessions({
      registry,
      agents: AGENTS,
      active: {},
      persisted: {
        'Pessoal/tn-sandbox::claude': meta(),
        'Pessoal/lab-voz::claude': meta(),
        'NewCo/api::claude': meta(),
        '.w9/.p9::claude': meta(),
      },
    })
    expect(rows.map((row) => row.location)).toEqual([
      'Pessoal › tn-sandbox',
      'Pessoal › lab-voz (não cadastrada)',
      'Sem workspace › NewCo/api',
      'Projeto não encontrado › .w9/.p9',
    ])
    expect(rows.map((row) => row.scope)).toEqual(['Pessoal', 'Pessoal', '__none', '__none'])
    expect(rows[3].orphan.project).toBe(true)
  })

  it('returns nothing when both sources are null', () => {
    expect(listSessions({ registry, agents: AGENTS, active: null, persisted: null })).toEqual([])
  })
})

describe('buildAgentBoard', () => {
  it('aggregates the sessions of one agent in one project into a single card with the best state', () => {
    const board = build(
      { 'Pessoal/tn-sandbox::claude': live('running'), 'Pessoal/tn-sandbox::claude::zzz111': live('idle', true) },
      { 'Pessoal/tn-sandbox::claude': meta(), 'Pessoal/tn-sandbox::claude::zzz111': meta(true) },
    )
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    const [card] = group.projects[0].agentCards
    expect(group.projects).toHaveLength(1)
    expect(group.projects[0].agentCards).toHaveLength(1)
    expect(card).toMatchObject({ state: 'needs_you', resumable: false, sessionCount: 2, liveCount: 2 })
    expect(card.countsByState).toEqual({ needs_you: 1, running: 1, stopped: 0, free: 0 })
    expect(cardMeta(card)).toBe('2 sessões · 2 ao vivo')
    expect(cardStateLabel(card)).toBe('precisa de você')
  })

  it('needs_attention with a dead PTY is a "retomável" needs_you card, and sits in the waiting list', () => {
    const board = build({}, { 'Pessoal/tn-sandbox::claude': meta(true) })
    expect(board.waiting).toHaveLength(1)
    expect(board.waiting[0]).toMatchObject({ state: 'needs_you', resumable: true })
    expect(cardStateLabel(board.waiting[0])).toBe('precisa de você · retomável')
    expect(board.counts.needs_you).toBe(1)
  })

  it('a key only in active still produces a card', () => {
    const board = build({ 'Pessoal/tn-sandbox::terminal': live('idle') }, {})
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(group.projects[0].agentCards[0]).toMatchObject({ agentName: 'Terminal', state: 'stopped' })
  })

  it('a failed active source never shows running: only saved states, liveAvailable false', () => {
    const board = build(null, { 'Pessoal/tn-sandbox::claude': meta(), 'Pessoal/tn-sandbox::codex': meta(true) })
    expect(board.liveAvailable).toBe(false)
    const cards = board.groups.flatMap((g) => g.projects.flatMap((p) => p.agentCards))
    expect(cards.map((card) => card.state).sort()).toEqual(['free', 'needs_you'])
    expect(board.counts.running).toBe(0)
    expect(board.counts.stopped).toBe(0)
  })

  it('a failed persisted source falls back to active and is still available', () => {
    const board = build({ 'Pessoal/tn-sandbox::claude': live('running', true) }, null)
    expect(board.liveAvailable).toBe(true)
    expect(board.waiting).toHaveLength(1)
  })

  it('the free line lists the agents without a session in that project', () => {
    const board = build({ 'Pessoal/tn-sandbox::claude': live('running') }, { 'Pessoal/tn-sandbox::claude': meta() })
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(group.projects[0].freeAgents.map((a) => a.name)).toEqual(['Codex', 'Terminal'])
  })

  it('a project without sessions goes to "silent", with its primary path and existence', () => {
    const board = build({}, {})
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(group.projects).toEqual([])
    expect(group.silent.map((entry) => entry.project.name)).toEqual(['old', 'silent', 'TaskNexus', 'tn-sandbox'].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    expect(group.silent[0]).toMatchObject({ exists: true, archived: true })
    expect(group.silent[0].primaryPath).toContain('Pessoal')
  })

  it('puts a session of an unregistered folder in the bucket of its workspace', () => {
    const board = build({}, { 'Pessoal/lab-voz::claude': meta() })
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(group.unregistered).toHaveLength(1)
    expect(group.unregistered[0]).toMatchObject({ key: 'Pessoal/lab-voz', name: 'lab-voz' })
    expect(group.unregistered[0].cards[0].location).toBe('Pessoal › lab-voz (não cadastrada)')
  })

  it('puts a session of a client with no workspace in "unassigned", grouped by client', () => {
    const board = build({}, { 'NewCo/api::claude': meta(), 'NewCo/web::codex': meta(true) })
    expect(board.unassigned).toHaveLength(1)
    expect(board.unassigned[0]).toMatchObject({ clientKey: 'NewCo', keys: ['NewCo/api', 'NewCo/web'], bestState: 'needs_you' })
    expect(hasUnassignedPlaces(board)).toBe(true)
  })

  it('puts a session of the workspace key itself in the workspace-level list', () => {
    const board = build({}, { 'Pessoal::claude': meta() })
    const group = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(group.workspaceLevel).toHaveLength(1)
  })

  it('puts a minted key that is not in the registry in "unknown" (never dropped)', () => {
    const board = build({}, { '.w9/.p9::claude': meta(true) })
    expect(board.unknown).toHaveLength(1)
    expect(board.unknown[0].key).toBe('.w9/.p9')
    expect(board.waiting).toHaveLength(1)
    expect(hasUnassignedPlaces(board)).toBe(true)
  })

  it('does not drop a legacy key that has no "::" (agente desconhecido)', () => {
    const board = build({}, { 'Pessoal/tn-sandbox': meta() })
    const card = board.groups.find((g) => g.workspace.key === 'Pessoal').projects[0].agentCards[0]
    expect(card).toMatchObject({ agentId: null, agentName: 'agente desconhecido' })
  })

  it('orders workspaces by best state, then name; projects by best state, then name', () => {
    const board = build(
      { 'podesubir/ymci-backend::claude': live('running'), 'Pessoal/tn-sandbox::claude': live('idle') },
      { 'podesubir/ymci-backend::claude': meta(), 'Pessoal/tn-sandbox::claude': meta(), 'Pessoal/TaskNexus::claude': meta(true) },
    )
    expect(board.groups.map((g) => g.workspace.name)).toEqual(['Pessoal', 'podesubir', 'Estudos', 'RD'])
    const pessoal = board.groups[0]
    expect(pessoal.projects.map((p) => p.project.name)).toEqual(['TaskNexus', 'tn-sandbox'])
    expect(pessoal.bestState).toBe('needs_you')
  })

  it('orders the projects of a workspace by their best state before their name', () => {
    // By name alone TaskNexus would come first; tn-sandbox is waiting for the user.
    const board = build(
      { 'Pessoal/TaskNexus::claude': live('idle'), 'Pessoal/tn-sandbox::claude': live('idle', true) },
      { 'Pessoal/TaskNexus::claude': meta(), 'Pessoal/tn-sandbox::claude': meta(true) },
    )
    const pessoal = board.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(pessoal.projects.map((p) => p.project.name)).toEqual(['tn-sandbox', 'TaskNexus'])
  })

  it('orders the cards of a project by state, then by the order of the agent registry', () => {
    const board = build(
      { 'Pessoal/tn-sandbox::terminal': live('idle'), 'Pessoal/tn-sandbox::codex': live('idle'), 'Pessoal/tn-sandbox::claude': live('running') },
      {},
    )
    const cards = board.groups.find((g) => g.workspace.key === 'Pessoal').projects[0].agentCards
    expect(cards.map((card) => card.agentName)).toEqual(['Claude', 'Codex', 'Terminal'])
  })

  it('puts a needs_you with a live PTY before a resumable one in the waiting list', () => {
    const board = build(
      { 'Pessoal/tn-sandbox::codex': live('idle', true) },
      { 'Pessoal/tn-sandbox::claude': meta(true), 'Pessoal/tn-sandbox::codex': meta(true) },
    )
    expect(board.waiting.map((card) => card.agentName)).toEqual(['Codex', 'Claude'])
  })

  it('counts cards by state', () => {
    const board = build(
      { 'Pessoal/a::claude': live('running'), 'Pessoal/b::claude': live('idle') },
      { 'Pessoal/a::claude': meta(), 'Pessoal/b::claude': meta(), 'Pessoal/c::claude': meta(), 'Pessoal/d::claude': meta(true) },
    )
    expect(board.counts).toEqual({ needs_you: 1, running: 1, stopped: 1, free_resumable: 1 })
  })

  it('works with an empty agent list (names fall back to the id)', () => {
    const board = build({}, { 'Pessoal/tn-sandbox::claude': meta() }, [])
    expect(board.groups.find((g) => g.workspace.key === 'Pessoal').projects[0].agentCards[0].agentName).toBe('claude')
  })
})

describe('filterBoard', () => {
  const board = build(
    { 'Pessoal/tn-sandbox::claude': live('running'), 'podesubir/ymci-backend::codex': live('idle', true) },
    {
      'Pessoal/tn-sandbox::claude': meta(),
      'Pessoal/old::claude': meta(),
      'podesubir/ymci-backend::codex': meta(true),
      'Pessoal/lab-voz::claude': meta(true),
      'NewCo/api::claude': meta(),
      'RD/rd-campanhas::claude': meta(true),
    },
  )
  const names = (result) => result.groups.map((g) => g.workspace.name)

  it('hides archived workspaces and projects by default, keeps them with showArchived', () => {
    const hidden = filterBoard(board, {})
    expect(names(hidden)).not.toContain('RD')
    expect(hidden.groups.find((g) => g.workspace.key === 'Pessoal').projects.map((p) => p.project.name)).toEqual(['tn-sandbox'])
    expect(hidden.groups.find((g) => g.workspace.key === 'Pessoal').silent.map((p) => p.project.name)).not.toContain('old')

    const shown = filterBoard(board, { showArchived: true })
    expect(names(shown)).toContain('RD')
    expect(shown.groups.find((g) => g.workspace.key === 'Pessoal').projects.map((p) => p.project.name)).toContain('old')
  })

  it('never hides a session that needs the user from the waiting strip, archived or not', () => {
    const result = filterBoard(board, {})
    expect(result.waiting.map((card) => card.projectKey)).toEqual(
      expect.arrayContaining(['RD/rd-campanhas', 'podesubir/ymci-backend', 'Pessoal/lab-voz']),
    )
  })

  it('filters by workspace, including the strip, and drops the unassigned groups', () => {
    const result = filterBoard(board, { workspaceKey: 'podesubir' })
    expect(names(result)).toEqual(['podesubir'])
    expect(result.waiting.map((card) => card.projectKey)).toEqual(['podesubir/ymci-backend'])
    expect(result.unassigned).toEqual([])
  })

  it('"__none" keeps only the places outside any workspace', () => {
    const result = filterBoard(board, { workspaceKey: '__none' })
    expect(result.groups).toEqual([])
    expect(result.unassigned.map((bucket) => bucket.clientKey)).toEqual(['NewCo'])
    expect(result.waiting).toEqual([])
  })

  it('"only waiting" keeps needs_you cards, drops silent projects and empty groups', () => {
    const result = filterBoard(board, { onlyWaiting: true })
    expect(names(result).sort()).toEqual(['Pessoal', 'podesubir'])
    const pessoal = result.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(pessoal.projects).toEqual([])
    expect(pessoal.silent).toEqual([])
    expect(pessoal.unregistered.map((u) => u.key)).toEqual(['Pessoal/lab-voz'])
    expect(result.unassigned).toEqual([])
    expect(result.hasContent).toBe(true)
  })

  it('combining "only waiting" with a workspace that has nobody waiting leaves nothing', () => {
    const result = filterBoard(board, { onlyWaiting: true, workspaceKey: '.w3' })
    expect(result.hasContent).toBe(false)
    expect(result.groups).toEqual([])
  })

  it('marks a workspace without projects as empty and counts the visible projects', () => {
    const result = filterBoard(board, {})
    const studies = result.groups.find((g) => g.workspace.key === '.w3')
    expect(studies).toMatchObject({ empty: true, projectCount: 0 })
    const pessoal = result.groups.find((g) => g.workspace.key === 'Pessoal')
    expect(pessoal.empty).toBe(false)
    expect(pessoal.projectCount).toBe(3)
    expect(filterBoard(board, { showArchived: true }).groups.find((g) => g.workspace.key === 'Pessoal').projectCount).toBe(4)
  })

  it('an empty workspace is not "empty" under the only-waiting filter (it is simply omitted)', () => {
    expect(names(filterBoard(board, { onlyWaiting: true }))).not.toContain('Estudos')
  })
})

describe('filterSessions', () => {
  const rows = listSessions({
    registry,
    agents: AGENTS,
    active: {},
    persisted: {
      'Pessoal/tn-sandbox::claude': meta(),
      'Pessoal/old::claude': meta(),
      'RD/rd-campanhas::claude': meta(true),
      'NewCo/api::claude': meta(),
    },
  })

  it('applies workspace, only-waiting and archived filters (a needs_you row is never hidden as archived)', () => {
    expect(filterSessions(rows, {}).map((r) => r.key)).toEqual([
      'Pessoal/tn-sandbox::claude', 'RD/rd-campanhas::claude', 'NewCo/api::claude',
    ])
    expect(filterSessions(rows, { showArchived: true })).toHaveLength(4)
    expect(filterSessions(rows, { workspaceKey: '__none' }).map((r) => r.key)).toEqual(['NewCo/api::claude'])
    expect(filterSessions(rows, { workspaceKey: 'Pessoal' }).map((r) => r.key)).toEqual(['Pessoal/tn-sandbox::claude'])
    expect(filterSessions(rows, { onlyWaiting: true }).map((r) => r.key)).toEqual(['RD/rd-campanhas::claude'])
  })
})

describe('projectsIslandMessage', () => {
  const card = (agentName, placeName, resumable = false) => ({ agentName, placeName, resumable })

  it('speaks while loading and when the registry failed', () => {
    expect(projectsIslandMessage({ loading: true })).toEqual({
      text: 'Estou olhando as mesas dos agentes. Um instante.', state: 'thinking',
    })
    expect(projectsIslandMessage({ failed: true })).toEqual({
      text: 'Não consegui ler o cadastro de projetos, então não sei onde cada agente está.', state: 'alert',
    })
  })

  it('says it cannot see what is running when the live state is unavailable', () => {
    expect(projectsIslandMessage({ liveAvailable: false, waiting: [card('Claude', 'x')] }).text).toBe(
      'Não consigo ver o que está rodando agora. Mostro só as sessões salvas.',
    )
  })

  it('says nothing waits, with or without running agents', () => {
    expect(projectsIslandMessage({}).text).toBe('Nada espera você agora.')
    expect(projectsIslandMessage({ running: 1 }).text).toBe('Nada espera você. 1 agente rodando.')
    expect(projectsIslandMessage({ running: 3 }).text).toBe('Nada espera você. 3 agentes rodando.')
  })

  it('names the single waiting agent place, and the list for several', () => {
    expect(projectsIslandMessage({ waiting: [card('Claude', 'ymci-backend')] })).toEqual({
      text: '1 agente espera você em ymci-backend.', state: 'alert',
    })
    expect(projectsIslandMessage({ waiting: [card('Claude', 'a'), card('Codex', 'b', true)], running: 2 }).text).toBe(
      '2 agentes esperam você: Claude em a e Codex em b (retomável). 2 rodando.',
    )
  })

  it('caps the named agents at three', () => {
    const waiting = ['a', 'b', 'c', 'd', 'e'].map((place) => card('Claude', place))
    expect(projectsIslandMessage({ waiting }).text).toBe(
      '5 agentes esperam você: Claude em a e Claude em b e Claude em c e mais 2.',
    )
  })

  it('tells an empty workspace to get its first project', () => {
    expect(projectsIslandMessage({ emptyWorkspaceName: 'Estudos' }).text).toBe(
      'O workspace Estudos ainda não tem projetos. Adicione o primeiro para eu mostrar os agentes dele.',
    )
  })
})
