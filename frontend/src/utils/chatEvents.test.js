import { describe, it, expect } from 'vitest'
import { createChatState, reduceChat, reduceChatEvents } from './chatEvents.js'

const KEY = 'p::claude::abc123'
let nextSeq = 0
// Persisted frame (integer seq) with the real envelope of contract 4.
const ev = (type, payload = {}, seq = ++nextSeq) => ({ type, session_key: KEY, seq, ts: 1000 + seq, ...payload })
// Ephemeral frame (seq null).
const live = (type, payload = {}) => ({ type, session_key: KEY, seq: null, ts: 5000, ...payload })

const fold = (events, state = createChatState()) => reduceChatEvents(state, events)
const kinds = (state) => state.messages.map((item) => item.kind)

describe('streaming to final (CA35)', () => {
  it('accumulates deltas in one bubble and replaces it by the final message', () => {
    let state = fold([
      ev('message.user', { client_msg_id: 'c1', text: 'oi', origin: 'ui' }),
      live('message.delta', { message_id: 'm1', text: 'Olá' }),
      live('message.delta', { message_id: 'm1', text: ', mundo' }),
    ])
    const streaming = state.messages.find((item) => item.kind === 'agent')
    expect(streaming).toMatchObject({ messageId: 'm1', text: 'Olá, mundo', streaming: true })
    expect(state.turn.running).toBe(true)

    state = fold([
      ev('message.assistant', { message_id: 'm1', model: 'haiku', origin: 'live', blocks: [{ type: 'text', text: 'Olá, mundo!' }] }),
      ev('turn.ended', { subtype: 'success', is_error: false, terminal_reason: 'end_turn', cost_usd: 0.01, duration_ms: 42000 }),
    ], state)
    const agents = state.messages.filter((item) => item.kind === 'agent')
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ text: 'Olá, mundo!', streaming: false, interrupted: false, model: 'haiku' })
    expect(state.turn).toMatchObject({ running: false, startedAt: null })
    expect(state.lastTurn).toMatchObject({ costUsd: 0.01, durationMs: 42000, isError: false })
  })

  it('ignores a late delta of a message that is already final', () => {
    const state = fold([
      ev('message.assistant', { message_id: 'm1', blocks: [{ type: 'text', text: 'done' }] }),
      live('message.delta', { message_id: 'm1', text: 'zzz' }),
    ])
    expect(state.messages[0].text).toBe('done')
    expect(state.messages).toHaveLength(1)
  })

  it('extends a message that arrives as two final events and never duplicates a tool part', () => {
    const state = fold([
      ev('message.assistant', { message_id: 'm1', blocks: [{ type: 'text', text: 'a' }] }),
      ev('message.assistant', { message_id: 'm1', blocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] }),
      ev('message.assistant', { message_id: 'm1', blocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] }),
    ])
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].parts).toEqual([{ type: 'text', text: 'a' }, { type: 'tool', toolUseId: 't1' }])
  })

  it('starts the turn clock from the user message and does not start it for imported history', () => {
    const started = fold([ev('message.user', { client_msg_id: 'c1', text: 'x', origin: 'ui' }, 1)])
    expect(started.turn).toMatchObject({ running: true, startedAt: 1001000 })
    const imported = fold([ev('message.user', { client_msg_id: 'c0', text: 'old', origin: 'import' })])
    expect(imported.turn.running).toBe(false)
  })

  it('turns a turn that ended with an error into an error bubble, and stops a streaming bubble', () => {
    const state = fold([
      ev('message.user', { client_msg_id: 'c1', text: 'x', origin: 'ui' }),
      live('message.delta', { message_id: 'm1', text: 'par' }),
      ev('turn.ended', { subtype: 'error_max_turns', is_error: true, terminal_reason: 'max_turns' }),
    ])
    expect(kinds(state)).toEqual(['user', 'agent', 'error'])
    expect(state.messages[1]).toMatchObject({ streaming: false, interrupted: false })
    expect(state.messages[2]).toMatchObject({ text: expect.stringContaining('interrompida por um erro'), detail: 'error_max_turns · max_turns' })
  })

  it('marks an interrupt (local or by terminal_reason) as an interrupted bubble with a divider, not an error', () => {
    const byClient = fold([
      ev('message.user', { client_msg_id: 'c1', text: 'x', origin: 'ui' }),
      live('message.delta', { message_id: 'm1', text: 'par' }),
      { type: 'local.interrupt' },
      ev('turn.ended', { subtype: 'error_during_execution', is_error: true }),
    ])
    expect(kinds(byClient)).toEqual(['user', 'agent', 'divider'])
    expect(byClient.messages[1].interrupted).toBe(true)
    expect(byClient.messages[2].variant).toBe('interrupted')
    expect(byClient.turn.interrupting).toBe(false)
    const byReason = fold([
      ev('message.user', { client_msg_id: 'c1', text: 'x', origin: 'ui' }),
      ev('turn.ended', { is_error: true, terminal_reason: 'aborted_streaming' }),
    ])
    expect(kinds(byReason)).toEqual(['user', 'divider'])
  })
})

describe('tool chips', () => {
  const assistantWithTool = (id = 't1', name = 'Bash') =>
    ev('message.assistant', { message_id: `m-${id}`, blocks: [{ type: 'tool_use', id, name, input: { command: 'ls' } }] })

  it('runs, then is done or failed by tool.result', () => {
    let state = fold([assistantWithTool('t1'), assistantWithTool('t2', 'Read')])
    expect(state.toolsById.t1).toMatchObject({ name: 'Bash', status: 'running', input: { command: 'ls' } })
    expect(state.toolOrder).toEqual(['t1', 't2'])
    state = fold([
      ev('tool.result', { tool_use_id: 't1', is_error: false, summary: 'ok', content: 'out', truncated: false }),
      ev('tool.result', { tool_use_id: 't2', is_error: true, summary: 'boom', content: 'boom', truncated: true }),
    ], state)
    expect(state.toolsById.t1).toMatchObject({ status: 'done', result: { summary: 'ok', content: 'out', truncated: false, isError: false } })
    expect(state.toolsById.t2).toMatchObject({ status: 'failed', result: { truncated: true, isError: true } })
  })

  it('shows the tool in flight while the turn runs and clears it afterwards', () => {
    let state = fold([ev('message.user', { client_msg_id: 'c', text: 'x', origin: 'ui' }), assistantWithTool('t1')])
    expect(state.turn.tool).toBe('Bash')
    state = fold([ev('tool.result', { tool_use_id: 't1', is_error: false })], state)
    expect(state.turn.tool).toBeNull()
  })

  it('waits for the user while a permission card is pending, then runs on allow', () => {
    let state = fold([
      assistantWithTool('t1'),
      ev('permission.request', { id: 'p1', kind: 'tool', tool_name: 'Bash', tool_use_id: 't1', input: { command: 'ls' }, allow_session: false, suggestions_available: false, connector: null }),
    ])
    expect(state.toolsById.t1).toMatchObject({ status: 'waiting', permissionId: 'p1' })
    state = fold([ev('permission.resolved', { id: 'p1', status: 'allowed', scope: 'once', by: 'ws' })], state)
    expect(state.toolsById.t1.status).toBe('running')
  })

  it('is denied when the card is denied and keeps "denied" when the CLI reports the refusal as an error result', () => {
    const state = fold([
      assistantWithTool('t1'),
      ev('permission.request', { id: 'p1', kind: 'tool', tool_name: 'Bash', tool_use_id: 't1', input: {}, allow_session: false }),
      ev('permission.resolved', { id: 'p1', status: 'denied', scope: 'once', by: 'rest', message: 'no' }),
      ev('tool.result', { tool_use_id: 't1', is_error: true, summary: 'denied' }),
    ])
    expect(state.toolsById.t1.status).toBe('denied')
    expect(state.toolsById.t1.result.isError).toBe(true)
  })

  it('creates the chip from the request when the permission arrives before the assistant message', () => {
    const state = fold([
      ev('permission.request', { id: 'p1', kind: 'tool', tool_name: 'Write', tool_use_id: 't9', input: { file_path: 'a' }, allow_session: true }),
      ev('message.assistant', { message_id: 'm', blocks: [{ type: 'tool_use', id: 't9', name: 'Write', input: { file_path: 'a' } }] }),
    ])
    expect(state.toolsById.t9).toMatchObject({ name: 'Write', status: 'waiting' })
  })

  it('cancels tools left open when an errored turn ends', () => {
    const state = fold([assistantWithTool('t1'), ev('turn.ended', { is_error: true, terminal_reason: 'aborted_tools' })])
    expect(state.toolsById.t1.status).toBe('cancelled')
  })
})

describe('permission cards (CA36, CA37)', () => {
  const request = (id, extra = {}) =>
    ev('permission.request', { id, kind: 'tool', tool_name: 'Edit', tool_use_id: `t-${id}`, input: { file_path: 'a.py' }, suggestions_available: true, allow_session: true, connector: null, ...extra })

  it('creates a pending card and counts it', () => {
    const state = fold([request('p1'), request('p2')])
    expect(state.cards.map((card) => [card.id, card.status])).toEqual([['p1', 'pending'], ['p2', 'pending']])
    expect(state.pendingCount).toBe(2)
    expect(state.cards[0]).toMatchObject({ toolName: 'Edit', toolUseId: 't-p1', input: { file_path: 'a.py' }, connector: null })
  })

  it('propagates allow_session to the card, true and false (Bash and content rules)', () => {
    const state = fold([
      request('p1', { allow_session: true }),
      request('p2', { tool_name: 'Bash', allow_session: false }),
      request('p3', { tool_name: 'mcp__x__y', allow_session: false, connector: 'x' }),
    ])
    expect(state.cards.map((card) => card.allowSession)).toEqual([true, false, false])
    expect(state.cards[2].connector).toBe('x')
  })

  it('ignores a duplicated request id', () => {
    const state = fold([request('p1'), request('p1')])
    expect(state.cards).toHaveLength(1)
  })

  it('resolves a card decided by this client without the "other device" mark', () => {
    let state = fold([request('p1')])
    state = reduceChat(state, { type: 'local.decision', id: 'p1', behavior: 'allow', scope: 'once' })
    state = fold([ev('permission.resolved', { id: 'p1', status: 'allowed', scope: 'once', by: 'ws' })], state)
    expect(state.cards[0]).toMatchObject({ status: 'allowed', by: 'ws', scope: 'once', decidedElsewhere: false })
    expect(state.pendingCount).toBe(0)
  })

  it('marks a card decided by someone else as "decided on another device"', () => {
    const state = fold([request('p1'), ev('permission.resolved', { id: 'p1', status: 'denied', scope: 'once', by: 'rest', message: 'não' })])
    expect(state.cards[0]).toMatchObject({ status: 'denied', decidedElsewhere: true, message: 'não' })
  })

  it('expires or cancels by the system without the "other device" mark', () => {
    const state = fold([
      request('p1'),
      request('p2'),
      ev('permission.resolved', { id: 'p1', status: 'expired', scope: 'once', by: 'system' }),
      ev('permission.resolved', { id: 'p2', status: 'cancelled', scope: 'once', by: 'system' }),
    ])
    expect(state.cards.map((card) => [card.status, card.decidedElsewhere])).toEqual([['expired', false], ['cancelled', false]])
    expect(state.pendingCount).toBe(0)
  })

  it('ignores a resolution of an unknown card', () => {
    const state = fold([ev('permission.resolved', { id: 'ghost', status: 'allowed', by: 'ws' })])
    expect(state.cards).toEqual([])
  })

  it('cancels the pending cards and tools when the conversation is reset', () => {
    const state = fold([request('p1'), ev('session.reset', {})])
    expect(state.cards[0].status).toBe('cancelled')
    expect(state.pendingCount).toBe(0)
    expect(state.messages.at(-1)).toMatchObject({ kind: 'divider', variant: 'reset' })
  })
})

describe('status to banner (R-REC)', () => {
  it('maps each failure code and clears the banner when the session starts', () => {
    let state = fold([ev('status', { code: 'spawn_failed', reason: 'cli_not_found', detail: 'no claude' })])
    expect(state.banner).toEqual({ kind: 'spawn_failed', reason: 'cli_not_found', detail: 'no claude' })
    state = fold([ev('status', { code: 'resume_failed', detail: 'x' })], state)
    expect(state.banner).toEqual({ kind: 'resume_failed', detail: 'x' })
    state = fold([ev('status', { code: 'engine_unavailable', detail: 'no sdk' })], state)
    expect(state.banner).toEqual({ kind: 'engine_unavailable', detail: 'no sdk' })
    state = fold([ev('session.resumed', { model: 'm', permission_mode: 'default' })], state)
    expect(state.banner).toBeNull()
  })

  it('records the reason of a closed process, stops the turn and clears it on the next start', () => {
    let state = fold([ev('message.user', { client_msg_id: 'c', text: 'x', origin: 'ui' }), ev('status', { code: 'closed', reason: 'idle' })])
    expect(state.closedReason).toBe('idle')
    expect(state.turn.running).toBe(false)
    expect(state.banner).toBeNull()
    state = fold([ev('session.started', { model: 'm' })], state)
    expect(state.closedReason).toBeNull()
  })

  it('does not treat session.state.status as a banner', () => {
    const state = fold([live('session.state', { engine: 'chat', process: 'stopped', turn: 'idle', status: 'failed', last_error: 'x', model: 'm', permission_mode: 'default' })])
    expect(state.banner).toBeNull()
  })
})

describe('history events', () => {
  it('puts the "imported" divider before the imported messages', () => {
    const state = fold([
      ev('message.user', { client_msg_id: 'a', text: 'novo', origin: 'ui' }),
      ev('message.user', { client_msg_id: 'b', text: 'velho 1', origin: 'import' }),
      ev('message.assistant', { message_id: 'm1', origin: 'import', blocks: [{ type: 'text', text: 'velho 2' }] }),
      ev('history.imported', { count: 2 }),
    ])
    expect(state.messages.map((item) => item.kind === 'divider' ? item.variant : item.text)).toEqual(['novo', 'history_imported', 'velho 1', 'velho 2'])
    expect(state.messages[1].count).toBe(2)
  })

  it('shows a banner when the import failed', () => {
    const state = fold([ev('history.import_failed', { reason: 'timeout' })])
    expect(state.banner).toEqual({ kind: 'history_import_failed', reason: 'timeout' })
  })
})

describe('model and mode vocabulary', () => {
  it('keeps the LAST of the two model.changed of a switch (alias, then the name the CLI resolved) and one divider', () => {
    const state = fold([
      ev('session.started', { model: 'claude-sonnet-resolved', permission_mode: 'default' }),
      ev('model.changed', { model: 'haiku' }),
      ev('model.changed', { model: 'claude-haiku-resolved' }),
    ])
    expect(state.model).toBe('claude-haiku-resolved')
    const dividers = state.messages.filter((item) => item.variant === 'model')
    expect(dividers).toHaveLength(1)
    expect(dividers[0].model).toBe('claude-haiku-resolved')
  })

  it('makes a new divider when a message came in between', () => {
    const state = fold([
      ev('model.changed', { model: 'haiku' }),
      ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }),
      ev('model.changed', { model: 'opus' }),
    ])
    expect(state.messages.filter((item) => item.variant === 'model')).toHaveLength(2)
    expect(state.model).toBe('opus')
  })

  it('takes model and mode from session.started, mode.changed and session.state', () => {
    let state = fold([ev('session.started', { model: 'm1', permission_mode: 'default', cwd: '/x', mcp_servers: [] })])
    expect(state).toMatchObject({ model: 'm1', mode: 'default' })
    expect(state.sessionInfo).toMatchObject({ cwd: '/x' })
    state = fold([ev('mode.changed', { permission_mode: 'plan' })], state)
    expect(state.mode).toBe('plan')
    state = fold([live('session.state', { model: 'm2', permission_mode: 'acceptEdits', turn: 'idle', pending_permissions: 0 })], state)
    expect(state).toMatchObject({ model: 'm2', mode: 'acceptEdits' })
    expect(state.sessionState.turn).toBe('idle')
    expect(state.sessionState.seq).toBeUndefined()
  })
})

describe('ephemeral frames and the cursor', () => {
  it('does not drop commands.changed (seq null) when lastSeq is above zero and does not move lastSeq', () => {
    let state = fold([ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }, 7)])
    expect(state.lastSeq).toBe(7)
    state = reduceChat(state, live('commands.changed'))
    state = reduceChat(state, live('commands.changed'))
    expect(state.commandsVersion).toBe(2)
    expect(state.lastSeq).toBe(7)
  })

  it('never moves lastSeq backwards or with deltas and state frames', () => {
    let state = fold([ev('system.notice', { kind: 'local_command', text: 'ok' }, 10)])
    state = fold([live('message.delta', { message_id: 'm', text: 'a' }), live('session.state', { turn: 'idle' }), live('rate_limit', { detail: { x: 1 } })], state)
    expect(state.lastSeq).toBe(10)
    expect(state.rateLimit).toEqual({ x: 1 })
  })

  it('reconciles the running turn with the last session.state when the replay completes', () => {
    // The log has a user message without turn.ended (server crash), the live state says idle.
    let state = fold([
      live('session.state', { turn: 'idle', model: 'm', permission_mode: 'default' }),
      ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }),
    ])
    expect(state.turn.running).toBe(true)
    state = reduceChat(state, live('replay.complete', { last_seq: 1 }))
    expect(state.replayComplete).toBe(true)
    expect(state.turn.running).toBe(false)
    state = reduceChat(state, live('session.state', { turn: 'running' }))
    expect(state.turn.running).toBe(true)
  })

  it('keeps unknown event types out of the way but advances the cursor', () => {
    const state = fold([ev('something.new', { a: 1 }, 3)])
    expect(state.lastSeq).toBe(3)
    expect(state.messages).toEqual([])
  })
})

describe('idempotence by seq', () => {
  it('folding the same persisted event twice, or an older one, returns the same state object', () => {
    const first = ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }, 5)
    const state = reduceChat(createChatState(), first)
    expect(reduceChat(state, first)).toBe(state)
    expect(reduceChat(state, ev('message.user', { client_msg_id: 'z', text: 'old' }, 4))).toBe(state)
  })

  it('a full replay applied twice gives the same result as once', () => {
    const log = [
      ev('session.started', { model: 'm' }, 1),
      ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }, 2),
      ev('message.assistant', { message_id: 'm1', blocks: [{ type: 'text', text: 'y' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] }, 3),
      ev('permission.request', { id: 'p1', kind: 'tool', tool_name: 'Bash', tool_use_id: 't1', input: {}, allow_session: false }, 4),
      ev('permission.resolved', { id: 'p1', status: 'allowed', scope: 'once', by: 'ws' }, 5),
      ev('turn.ended', { is_error: false }, 6),
    ]
    const once = fold(log)
    expect(fold(log, once)).toEqual(once)
  })

  it('does not mutate the state it receives', () => {
    const state = createChatState()
    const snapshot = JSON.stringify(state)
    reduceChat(state, ev('message.user', { client_msg_id: 'a', text: 'x', origin: 'ui' }))
    reduceChat(state, ev('permission.request', { id: 'p', tool_use_id: 't' }))
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('ignores a malformed event', () => {
    const state = createChatState()
    expect(reduceChat(state, null)).toBe(state)
    expect(reduceChat(state, { seq: 1 })).toBe(state)
  })
})

describe('optimistic user messages and rejections', () => {
  it('shows the message as sending, then confirms it with the server echo (same client_msg_id)', () => {
    let state = reduceChat(createChatState(), { type: 'local.send', client_msg_id: 'c1', request_id: 'r1', text: 'oi' })
    expect(state.messages[0]).toMatchObject({ kind: 'user', status: 'sending', text: 'oi' })
    state = reduceChat(state, ev('message.user', { client_msg_id: 'c1', text: 'oi', origin: 'ui' }))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ status: 'sent', seq: nextSeq })
  })

  it('marks the optimistic message failed when its request is rejected', () => {
    let state = reduceChat(createChatState(), { type: 'local.send', client_msg_id: 'c1', request_id: 'r1', text: 'oi' })
    state = reduceChat(state, live('command.rejected', { request_id: 'r1', code: 'capacity_exceeded', message: 'full' }))
    expect(state.messages[0]).toMatchObject({ status: 'failed', errorCode: 'capacity_exceeded' })
    expect(state.rejected).toEqual({ requestId: 'r1', code: 'capacity_exceeded', message: 'full' })
  })
})

describe('resyncing (a drop until the next replay.complete)', () => {
  it('is false at the start, true after a connection loss, and false again at replay.complete', () => {
    let state = createChatState()
    expect(state.resyncing).toBe(false)
    state = reduceChat(state, { type: 'local.connection_lost', keep: [] })
    expect(state.resyncing).toBe(true)
    state = reduceChat(state, { type: 'replay.complete', session_key: 'k', seq: null, last_seq: 0 })
    expect(state.resyncing).toBe(false)
  })

  it('a second loss while resyncing keeps the same state object', () => {
    const lost = reduceChat(createChatState(), { type: 'local.connection_lost', keep: [] })
    expect(reduceChat(lost, { type: 'local.connection_lost', keep: [] })).toBe(lost)
  })
})
