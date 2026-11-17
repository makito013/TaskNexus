// Pure reducer of the chat: folds the frames of /ws/chat/{key} (contract 4) into the state the
// screen renders. No React, no I/O. `reduceChat(state, event)` never mutates `state` and is
// idempotent per `seq`: an event with an integer `seq <= state.lastSeq` returns the same state.
//
// State
//   messages     ordered thread items (`kind`):
//                  user    { id, clientMsgId, text, origin, status: 'sending'|'sent'|'failed', errorCode }
//                  agent   { id, messageId, text, parts: [{type:'text',text}|{type:'tool',toolUseId}],
//                            model, origin, streaming, interrupted }
//                  notice  { id, noticeKind, text }             system.notice
//                  divider { id, variant, ... }                 'model' | 'reset' | 'new_conversation'
//                                                               | 'history_imported'
//                  error   { id, text, detail }                 a turn that ended with an error
//   toolsById    { [tool_use_id]: { id, name, input, status, permissionId, result } }
//                status: 'running' | 'waiting' | 'done' | 'failed' | 'denied' | 'cancelled'
//   toolOrder    tool ids in arrival order
//   cards        permission cards: { id, kind: 'tool'|'question'|'plan', toolName, toolUseId, input,
//                allowSession, suggestionsAvailable, connector, status: 'pending'|'allowed'|'denied'
//                |'expired'|'cancelled', scope, by, message, decidedElsewhere }
//   pendingCount cards still pending
//   turn         { running, startedAt (ms), tool (name of the tool in flight), interrupting }
//   banner       null | { kind: 'spawn_failed', reason, detail } | { kind: 'resume_failed', detail }
//                | { kind: 'engine_unavailable', detail } | { kind: 'history_import_failed', reason }
//   closedReason null | 'idle' | 'terminated' | 'switched_to_pty' | 'shutdown' | 'capacity'
//   model, mode  last model / permission mode announced (see "model vocabulary")
//   lastSeq      highest persisted seq folded in (the `since` of a reconnect)
//   sessionState last `session.state` frame (ephemeral)
//   replayComplete, commandsVersion (bumped by `commands.changed`), lastTurn, rejected, rateLimit
//
// Model vocabulary: a model change is announced twice, first the alias the user chose
// (`haiku`) and then the name the CLI resolved (`claude-haiku-...`) in the next `init`. Both
// are `model.changed`; the last one wins in `state.model`, and two consecutive announcements
// with no message in between share ONE divider (the divider shows the last name).
//
// Local events (never sent by the server, fed by the session hook):
//   local.send { client_msg_id, request_id, text }   optimistic user message
//   local.decision { id, behavior, scope, message }  this client decided a card
//   local.decision_failed { id }                     the decision request failed: undo local.decision
//   local.interrupt {}                               this client asked to interrupt
//   local.connection_lost { keep }                   the socket dropped: a "sending" message whose
//                                                    request id is not in `keep` (still queued) was
//                                                    handed to a socket that may be dead -> "failed"
const INTERRUPT_REASONS = new Set(['aborted_streaming', 'aborted_tools'])
const ENVELOPE_KEYS = new Set(['type', 'session_key', 'seq', 'ts'])
const FAILED_BANNER_KINDS = new Set(['spawn_failed', 'resume_failed', 'engine_unavailable'])

export function createChatState() {
  return {
    messages: [],
    toolsById: {},
    toolOrder: [],
    cards: [],
    pendingCount: 0,
    turn: { running: false, startedAt: null, tool: null, interrupting: false },
    banner: null,
    closedReason: null,
    model: null,
    mode: null,
    lastSeq: 0,
    sessionState: null,
    sessionInfo: null,
    replayComplete: false,
    commandsVersion: 0,
    lastTurn: null,
    rejected: null,
    rateLimit: null,
    localDecisions: {},
  }
}

function nowMs(event) {
  return typeof event.ts === 'number' ? Math.round(event.ts * 1000) : Date.now()
}

function withMessages(state, messages) {
  return { ...state, messages }
}

function replaceAt(list, index, item) {
  return list.map((entry, position) => (position === index ? item : entry))
}

function findAgentIndex(messages, messageId) {
  return messages.findIndex((item) => item.kind === 'agent' && item.messageId === messageId)
}

function joinText(parts) {
  return parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n')
}

// -- tools -------------------------------------------------------------------------------------

function upsertTool(state, id, patch) {
  if (!id) return state
  const existing = state.toolsById[id]
  const tool = {
    id,
    name: null,
    input: null,
    status: 'running',
    permissionId: null,
    result: null,
    ...existing,
    ...patch,
  }
  return {
    ...state,
    toolsById: { ...state.toolsById, [id]: tool },
    toolOrder: existing ? state.toolOrder : [...state.toolOrder, id],
  }
}

const OPEN_TOOL_STATUSES = new Set(['running', 'waiting'])

function derived(state) {
  const pendingCount = state.cards.filter((card) => card.status === 'pending').length
  let tool = null
  if (state.turn.running) {
    for (let index = state.toolOrder.length - 1; index >= 0; index -= 1) {
      const candidate = state.toolsById[state.toolOrder[index]]
      if (candidate && OPEN_TOOL_STATUSES.has(candidate.status)) {
        tool = candidate.name
        break
      }
    }
  }
  if (pendingCount === state.pendingCount && tool === state.turn.tool) return state
  return { ...state, pendingCount, turn: { ...state.turn, tool } }
}

function cancelOpenTools(state) {
  let toolsById = state.toolsById
  for (const id of state.toolOrder) {
    const tool = toolsById[id]
    if (OPEN_TOOL_STATUSES.has(tool.status)) {
      toolsById = { ...toolsById, [id]: { ...tool, status: 'cancelled' } }
    }
  }
  return toolsById === state.toolsById ? state : { ...state, toolsById }
}

// -- handlers ----------------------------------------------------------------------------------

function onSessionStarted(state, event) {
  const banner = state.banner && FAILED_BANNER_KINDS.has(state.banner.kind) ? null : state.banner
  return {
    ...state,
    banner,
    closedReason: null,
    model: event.model || state.model,
    mode: event.permission_mode || state.mode,
    sessionInfo: {
      claudeSessionId: event.claude_session_id ?? null,
      cwd: event.cwd ?? null,
      additionalDirectories: event.additional_directories ?? [],
      claudeCodeVersion: event.claude_code_version ?? null,
      mcpServers: event.mcp_servers ?? [],
    },
  }
}

function onSessionIdChanged(state, event) {
  if (state.messages.length === 0) return state
  return withMessages(state, [
    ...state.messages,
    { id: `d:${event.seq}`, kind: 'divider', variant: 'new_conversation' },
  ])
}

function onSessionReset(state, event) {
  const cards = state.cards.map((card) => (card.status === 'pending' ? { ...card, status: 'cancelled', by: 'system' } : card))
  return cancelOpenTools({
    ...state,
    cards,
    banner: null,
    closedReason: null,
    turn: { running: false, startedAt: null, tool: null, interrupting: false },
    messages: [
      ...state.messages.map((item) => (item.kind === 'agent' && item.streaming ? { ...item, streaming: false } : item)),
      { id: `d:${event.seq}`, kind: 'divider', variant: 'reset' },
    ],
  })
}

function onMessageUser(state, event) {
  const clientMsgId = event.client_msg_id ?? null
  const item = {
    id: `u:${clientMsgId ?? event.seq}`,
    kind: 'user',
    clientMsgId,
    text: event.text ?? '',
    origin: event.origin ?? 'ui',
    status: 'sent',
    errorCode: null,
    seq: event.seq,
    ts: event.ts,
  }
  const index = clientMsgId ? state.messages.findIndex((entry) => entry.kind === 'user' && entry.clientMsgId === clientMsgId) : -1
  const messages = index >= 0 ? replaceAt(state.messages, index, item) : [...state.messages, item]
  const starts = item.origin !== 'import'
  return {
    ...state,
    messages,
    turn: starts
      ? { ...state.turn, running: true, startedAt: state.turn.running ? state.turn.startedAt : nowMs(event) }
      : state.turn,
  }
}

function onMessageDelta(state, event) {
  const messageId = event.message_id
  const text = event.text ?? ''
  const index = findAgentIndex(state.messages, messageId)
  if (index < 0) {
    return withMessages(state, [
      ...state.messages,
      {
        id: `a:${messageId}`,
        kind: 'agent',
        messageId,
        text,
        parts: [{ type: 'text', text }],
        model: null,
        origin: 'live',
        streaming: true,
        interrupted: false,
        seq: null,
        ts: event.ts,
      },
    ])
  }
  const current = state.messages[index]
  if (!current.streaming) return state // a late delta of a message that is already final
  const merged = current.text + text
  return withMessages(state, replaceAt(state.messages, index, {
    ...current,
    text: merged,
    parts: [{ type: 'text', text: merged }],
  }))
}

function onMessageAssistant(state, event) {
  const blocks = Array.isArray(event.blocks) ? event.blocks : []
  let next = state
  const parts = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text ?? '' })
    } else if (block.type === 'tool_use') {
      parts.push({ type: 'tool', toolUseId: block.id })
      next = upsertTool(next, block.id, {
        name: block.name ?? null,
        input: block.input ?? null,
        ...(next.toolsById[block.id] ? {} : { status: 'running' }),
      })
    }
  }
  const index = findAgentIndex(next.messages, event.message_id)
  const existing = index >= 0 ? next.messages[index] : null
  // A streamed bubble is replaced by the final one; a second final event of the same message
  // (the SDK can split one message into several) extends it.
  const keptParts = existing && !existing.streaming
    ? [
        ...existing.parts,
        ...parts.filter((part) => part.type === 'text' || !existing.parts.some((old) => old.type === 'tool' && old.toolUseId === part.toolUseId)),
      ]
    : parts
  const item = {
    id: existing?.id ?? `a:${event.message_id ?? event.seq}`,
    kind: 'agent',
    messageId: event.message_id ?? null,
    text: joinText(keptParts),
    parts: keptParts,
    model: event.model ?? existing?.model ?? null,
    origin: event.origin ?? 'live',
    streaming: false,
    interrupted: false,
    seq: event.seq,
    ts: event.ts,
  }
  return withMessages(next, index >= 0 ? replaceAt(next.messages, index, item) : [...next.messages, item])
}

function onToolResult(state, event) {
  const existing = state.toolsById[event.tool_use_id]
  const keepsStatus = existing && (existing.status === 'denied' || existing.status === 'cancelled')
  return upsertTool(state, event.tool_use_id, {
    status: keepsStatus ? existing.status : event.is_error ? 'failed' : 'done',
    result: {
      summary: event.summary ?? '',
      content: event.content ?? '',
      truncated: Boolean(event.truncated),
      isError: Boolean(event.is_error),
    },
  })
}

function onSystemNotice(state, event) {
  return withMessages(state, [
    ...state.messages,
    { id: `n:${event.seq}`, kind: 'notice', noticeKind: event.kind ?? null, text: event.text ?? '' },
  ])
}

function onPermissionRequest(state, event) {
  if (state.cards.some((card) => card.id === event.id)) return state
  const card = {
    id: event.id,
    kind: event.kind ?? 'tool',
    toolName: event.tool_name ?? null,
    toolUseId: event.tool_use_id ?? null,
    input: event.input ?? null,
    allowSession: Boolean(event.allow_session),
    suggestionsAvailable: Boolean(event.suggestions_available),
    connector: event.connector ?? null,
    status: 'pending',
    scope: null,
    by: null,
    message: null,
    decidedElsewhere: false,
    seq: event.seq,
    ts: event.ts,
  }
  let next = { ...state, cards: [...state.cards, card] }
  const tool = next.toolsById[card.toolUseId]
  if (card.toolUseId && !(tool && tool.result)) {
    next = upsertTool(next, card.toolUseId, {
      name: tool?.name ?? card.toolName,
      input: tool?.input ?? card.input,
      status: 'waiting',
      permissionId: card.id,
    })
  }
  return next
}

function onPermissionResolved(state, event) {
  const index = state.cards.findIndex((card) => card.id === event.id)
  if (index < 0) return state
  const card = state.cards[index]
  const decided = event.status === 'allowed' || event.status === 'denied'
  const resolved = {
    ...card,
    status: event.status,
    scope: event.scope ?? 'once',
    by: event.by ?? null,
    message: event.message ?? null,
    decidedElsewhere: decided && event.by !== 'system' && !state.localDecisions[card.id],
  }
  let next = { ...state, cards: replaceAt(state.cards, index, resolved) }
  const tool = card.toolUseId ? next.toolsById[card.toolUseId] : null
  if (tool && tool.status === 'waiting') {
    const status = event.status === 'allowed' ? 'running' : event.status === 'denied' ? 'denied' : 'cancelled'
    next = upsertTool(next, tool.id, { status })
  }
  return next
}

function onTurnEnded(state, event) {
  const interrupted = Boolean(event.is_error) && (state.turn.interrupting || INTERRUPT_REASONS.has(event.terminal_reason))
  const failed = Boolean(event.is_error) && !interrupted
  let messages = state.messages.map((item) => (
    item.kind === 'agent' && item.streaming ? { ...item, streaming: false, interrupted } : item
  ))
  if (interrupted) messages = [...messages, { id: `d:${event.seq}`, kind: 'divider', variant: 'interrupted' }]
  if (failed) {
    messages = [...messages, {
      id: `e:${event.seq}`,
      kind: 'error',
      text: 'A resposta foi interrompida por um erro. Você pode enviar a mensagem de novo.',
      detail: [event.subtype, event.terminal_reason].filter(Boolean).join(' · '),
    }]
  }
  const ended = {
    ...state,
    messages,
    turn: { running: false, startedAt: null, tool: null, interrupting: false },
    lastTurn: {
      subtype: event.subtype ?? null,
      isError: Boolean(event.is_error),
      interrupted,
      terminalReason: event.terminal_reason ?? null,
      costUsd: event.cost_usd ?? null,
      durationMs: event.duration_ms ?? null,
      numTurns: event.num_turns ?? null,
      permissionDenials: event.permission_denials ?? [],
    },
  }
  return event.is_error ? cancelOpenTools(ended) : ended
}

function onModelChanged(state, event) {
  const last = state.messages[state.messages.length - 1]
  const messages = last && last.kind === 'divider' && last.variant === 'model'
    ? replaceAt(state.messages, state.messages.length - 1, { ...last, model: event.model })
    : [...state.messages, { id: `d:${event.seq}`, kind: 'divider', variant: 'model', model: event.model }]
  return { ...state, model: event.model, messages }
}

// The process never took the messages that were still "Enviando…" when it failed to start: they are
// "Não enviada" (the user can send them again), not "sending" for ever.
function failPendingSends(state, code) {
  if (!state.messages.some((item) => item.kind === 'user' && item.status === 'sending')) return state
  return {
    ...state,
    messages: state.messages.map((item) => (item.kind === 'user' && item.status === 'sending' ? { ...item, status: 'failed', errorCode: code } : item)),
  }
}

function onStatus(state, event) {
  switch (event.code) {
    case 'spawn_failed':
      return failPendingSends({ ...state, banner: { kind: 'spawn_failed', reason: event.reason ?? null, detail: event.detail ?? null } }, event.code)
    case 'resume_failed':
      return failPendingSends({ ...state, banner: { kind: 'resume_failed', detail: event.detail ?? null } }, event.code)
    case 'engine_unavailable':
      return failPendingSends({ ...state, banner: { kind: 'engine_unavailable', detail: event.detail ?? null } }, event.code)
    case 'closed':
      return {
        ...state,
        closedReason: event.reason ?? null,
        turn: { running: false, startedAt: null, tool: null, interrupting: false },
      }
    default:
      return state
  }
}

function onHistoryImported(state, event) {
  const messages = state.messages
  let start = messages.length
  while (start > 0 && messages[start - 1].origin === 'import') start -= 1
  const divider = { id: `d:${event.seq}`, kind: 'divider', variant: 'history_imported', count: event.count ?? 0 }
  return withMessages(state, [...messages.slice(0, start), divider, ...messages.slice(start)])
}

function onSessionState(state, event) {
  const info = Object.fromEntries(Object.entries(event).filter(([key]) => !ENVELOPE_KEYS.has(key)))
  const next = {
    ...state,
    sessionState: info,
    model: info.model || state.model,
    mode: info.permission_mode || state.mode,
  }
  if (!state.replayComplete) return next
  const running = info.turn === 'running'
  return {
    ...next,
    turn: running === state.turn.running ? state.turn : { ...state.turn, running, startedAt: running ? state.turn.startedAt ?? Date.now() : null },
  }
}

function onReplayComplete(state) {
  const running = state.sessionState ? state.sessionState.turn === 'running' : state.turn.running
  return {
    ...state,
    replayComplete: true,
    turn: running === state.turn.running ? state.turn : { ...state.turn, running, startedAt: running ? state.turn.startedAt ?? Date.now() : null },
  }
}

function onCommandRejected(state, event) {
  const index = state.messages.findIndex(
    (item) => item.kind === 'user' && item.status === 'sending' && item.requestId === event.request_id,
  )
  const rejected = { requestId: event.request_id ?? null, code: event.code ?? null, message: event.message ?? '' }
  if (index < 0) return { ...state, rejected }
  return {
    ...state,
    rejected,
    messages: replaceAt(state.messages, index, { ...state.messages[index], status: 'failed', errorCode: rejected.code }),
  }
}

function onLocalSend(state, event) {
  if (state.messages.some((item) => item.kind === 'user' && item.clientMsgId === event.client_msg_id)) return state
  return withMessages(state, [...state.messages, {
    id: `u:${event.client_msg_id}`,
    kind: 'user',
    clientMsgId: event.client_msg_id,
    requestId: event.request_id ?? null,
    text: event.text ?? '',
    origin: 'ui',
    status: 'sending',
    errorCode: null,
    seq: null,
    ts: null,
  }])
}

// The frame of a "sending" message that was already handed to a socket may have died with it: the
// message is "Não enviada" (the user can send it again). One that is still queued leaves on the next
// connection and stays "sending". If the server did take it, the replay brings the echo
// (message.user with the same client_msg_id) and the bubble becomes "sent" again.
function onConnectionLost(state, event) {
  const keep = new Set(event.keep ?? [])
  const isLost = (item) => item.kind === 'user' && item.status === 'sending' && !keep.has(item.requestId)
  if (!state.messages.some(isLost)) return state
  return {
    ...state,
    messages: state.messages.map((item) => (isLost(item) ? { ...item, status: 'failed', errorCode: 'connection_lost' } : item)),
  }
}

function onDecisionFailed(state, event) {
  if (!state.localDecisions[event.id]) return state
  const { [event.id]: _undone, ...rest } = state.localDecisions
  return { ...state, localDecisions: rest }
}

const HANDLERS = {
  'session.started': onSessionStarted,
  'session.resumed': onSessionStarted,
  'session.id_changed': onSessionIdChanged,
  'session.reset': onSessionReset,
  'session.state': onSessionState,
  'message.user': onMessageUser,
  'message.delta': onMessageDelta,
  'message.assistant': onMessageAssistant,
  'tool.result': onToolResult,
  'system.notice': onSystemNotice,
  'permission.request': onPermissionRequest,
  'permission.resolved': onPermissionResolved,
  'turn.ended': onTurnEnded,
  'model.changed': onModelChanged,
  'mode.changed': (state, event) => ({ ...state, mode: event.permission_mode ?? state.mode }),
  'commands.changed': (state) => ({ ...state, commandsVersion: state.commandsVersion + 1 }),
  status: onStatus,
  'history.imported': onHistoryImported,
  'history.import_failed': (state, event) => ({ ...state, banner: { kind: 'history_import_failed', reason: event.reason ?? null } }),
  'replay.complete': onReplayComplete,
  rate_limit: (state, event) => ({ ...state, rateLimit: event.detail ?? null }),
  'command.rejected': onCommandRejected,
  'local.send': onLocalSend,
  'local.decision': (state, event) => ({
    ...state,
    localDecisions: { ...state.localDecisions, [event.id]: { behavior: event.behavior, scope: event.scope ?? 'once', message: event.message ?? null } },
  }),
  'local.decision_failed': onDecisionFailed,
  'local.connection_lost': onConnectionLost,
  'local.interrupt': (state) => ({ ...state, turn: { ...state.turn, interrupting: true } }),
}

export function reduceChat(state, event) {
  if (!event || typeof event.type !== 'string') return state
  const persisted = typeof event.seq === 'number'
  if (persisted && event.seq <= state.lastSeq) return state
  const handler = HANDLERS[event.type]
  let next = handler ? handler(state, event) : state
  // `seq: null` events (commands.changed, deltas, session.state...) never move lastSeq.
  if (persisted) next = { ...next, lastSeq: event.seq }
  return derived(next)
}

export function reduceChatEvents(state, events) {
  return events.reduce(reduceChat, state)
}
