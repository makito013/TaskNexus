import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { useProjectsOverview } from './useProjectsOverview.js'

const REGISTRY = {
  seeded: null,
  workspaces: [{
    id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
    projects: [{
      id: 1, key: 'Pessoal/tn-sandbox', name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: true,
      folders: [{ id: 1, path: 'D:\\projetos\\Pessoal\\tn-sandbox', is_primary: true, position: 0, exists: true }],
    }],
  }],
}
const AGENTS = [{ id: 'claude', nome: 'Claude', ia: 'claude' }]
const PTY_KEY = 'Pessoal/tn-sandbox::claude'
const CHAT_KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'

let spies
function mockSources({ active = { [PTY_KEY]: { status: 'idle', connected: true, needs_attention: false } }, persisted = { [PTY_KEY]: { display_name: null, needs_attention: false } } } = {}) {
  spies = {
    workspaces: vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY),
    agents: vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS),
    cards: vi.spyOn(api, 'fetchCards').mockResolvedValue([]),
    columns: vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([]),
    active: vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue(active),
    persisted: vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue(persisted),
  }
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
async function mount(options) {
  const hook = renderHook((props) => useProjectsOverview(props), { initialProps: options })
  await flush()
  return hook
}

const chatLive = {
  active: { [CHAT_KEY]: { status: 'running', connected: true, needs_attention: false, display_name: 'Revisar' } },
  persisted: { [CHAT_KEY]: { display_name: 'Revisar', needs_attention: false, push_notified: false } },
}

describe('useProjectsOverview extraLive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSources()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('without extraLive, or with an empty one, the board and sessions are what the V2 sources give', async () => {
    const plain = await mount({})
    const empty = await mount({ extraLive: { active: {}, persisted: {} } })
    expect(empty.result.current.sessions.map((row) => row.key)).toEqual([PTY_KEY])
    expect(empty.result.current.sessions).toEqual(plain.result.current.sessions)
    expect(empty.result.current.board.counts).toEqual(plain.result.current.board.counts)
  })

  it('an empty extraLive keeps the memoised result: the same constant never rebuilds the view', async () => {
    const extra = { active: {}, persisted: {} }
    const hook = await mount({ extraLive: extra })
    const first = hook.result.current.board
    hook.rerender({ extraLive: extra })
    expect(hook.result.current.board).toBe(first)
  })

  it('chat keys are merged next to the V2 keys, in the board and in the session list', async () => {
    const hook = await mount({ extraLive: chatLive })
    expect(hook.result.current.sessions.map((row) => row.key).sort()).toEqual([CHAT_KEY, PTY_KEY].sort())
    const card = hook.result.current.board.groups[0].projects[0].agentCards[0]
    expect(card.sessionCount).toBe(2)
    expect(card.state).toBe('running')
    expect(card.liveCount).toBe(2)
  })

  it('a key with a suffix resolves its project and agent through parseSessionKey', async () => {
    const hook = await mount({ extraLive: chatLive })
    const row = hook.result.current.sessions.find((item) => item.key === CHAT_KEY)
    expect(row).toMatchObject({ projectKey: 'Pessoal/tn-sandbox', agentId: 'claude', suffix: 'k3x9q2', agentName: 'Claude' })
  })

  it('a chat that needs attention makes its card "needs you"', async () => {
    const extra = {
      active: { [CHAT_KEY]: { status: 'idle', connected: true, needs_attention: true, display_name: null } },
      persisted: { [CHAT_KEY]: { display_name: null, needs_attention: true, push_notified: false } },
    }
    const hook = await mount({ extraLive: extra })
    expect(hook.result.current.board.waiting.map((card) => card.id)).toEqual(['Pessoal/tn-sandbox::claude'])
    expect(hook.result.current.board.counts.needs_you).toBe(1)
  })

  it('live state that never loaded stays unavailable even with chats (the merge does not invent it)', async () => {
    spies.active.mockRejectedValue(new Error('down'))
    const hook = await mount({ extraLive: chatLive })
    expect(hook.result.current.liveAvailable).toBe(false)
    expect(hook.result.current.board.liveAvailable).toBe(false)
  })

  it('makes no request of its own: the same six reads as without extraLive', async () => {
    await mount({ extraLive: chatLive })
    const calls = Object.values(spies).map((spy) => spy.mock.calls.length)
    expect(calls).toEqual([1, 1, 1, 1, 1, 1])
  })
})
