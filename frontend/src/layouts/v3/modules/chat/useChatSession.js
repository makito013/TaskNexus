import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { connect } from '../../../../services/chatSocket.js'
import { createChatState, reduceChat } from '../../../../utils/chatEvents.js'
import { shouldAckChat, shouldAckTerminal } from '../../../../utils/chatNotifications.js'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'

// Owner of the WebSocket of ONE conversation: opens /ws/chat/{key}, folds every frame into the chat
// state (utils/chatEvents.js) and exposes the actions the screen needs. It is one of the five
// writers of chatApi (chatWriteGuard): decide, open and reset live here.
//
// It is mounted by ChatSessionHost, ABOVE the screen area of the shell, so switching to another
// module and coming back keeps the same socket (CA38). The effect is keyed by the session key only:
// the cleanup closes the socket (idempotent), so the StrictMode mount -> cleanup -> mount leaves
// exactly one live socket, and a late callback of a closed socket is ignored.
//
// Local events fed to the reducer BEFORE the matching command leaves (the reducer needs them):
//   local.send        optimistic user bubble (client_msg_id + request_id)
//   local.decision    "decided by me" (so another device is told apart)
//   local.decision_failed   the decision request failed: the card is not "decided by me"
//   local.connection_lost   the socket dropped: messages handed to it become "Não enviada"
//   local.interrupt   an interruption is the user's, not an error
const RESET_VIEW = { type: 'hook.reset' }
const IDLE_CONNECTION = { state: 'idle' }
const LIVE_STATES = new Set(['connecting', 'open'])

function sessionReducer(state, action) {
  if (action.type === RESET_VIEW.type) return createChatState()
  return reduceChat(state, action)
}

let idCounter = 0
function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  idCounter += 1
  return `c${Date.now().toString(36)}-${idCounter}`
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function decisionKind({ behavior, scope, interrupt }) {
  if (behavior === 'allow') return scope === 'session' ? 'allowSession' : 'allow'
  return interrupt ? 'denyStop' : 'deny'
}

// `enabled: false` keeps the key (state, draft) but opens no socket: the screen shows the terminal for
// this key, and a chat reader left open behind it would be a second motor on the conversation.
// `terminal: true` says the screen shows this key as the terminal: its `ack` then goes over REST
// (`api.ackSession`), since the chat socket is closed.
export function useChatSession(sessionKey, { enabled = true, terminal = false } = {}) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createChatState)
  const [connection, setConnection] = useState(IDLE_CONNECTION)
  // { [permissionId]: { phase: 'sending' | 'sent' | 'error', kind } } for the decisions this client made.
  const [decisions, setDecisions] = useState({})
  const [actionError, setActionError] = useState(null)
  const [draft, setDraftState] = useState('')
  const socketRef = useRef(null)
  const draftsRef = useRef(new Map())

  useEffect(() => {
    dispatch(RESET_VIEW)
    setDecisions({})
    setActionError(null)
    setDraftState(sessionKey ? draftsRef.current.get(sessionKey) ?? '' : '')
    if (!sessionKey || !enabled) {
      setConnection(IDLE_CONNECTION)
      return undefined
    }
    let active = true
    const socket = connect(sessionKey, {
      since: 0,
      onEvent: (frame) => {
        if (active) dispatch(frame)
      },
      onStatus: (status) => {
        if (!active) return
        setConnection(status)
        if (LIVE_STATES.has(status.state)) return
        // A refusal never reconnects, so nothing queued will leave either.
        const keep = status.state === 'reconnecting' || status.state === 'offline' ? socketRef.current?.pendingRequestIds() ?? [] : []
        dispatch({ type: 'local.connection_lost', keep })
      },
    })
    socketRef.current = socket
    return () => {
      active = false
      socket.close()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [sessionKey, enabled])

  // `ack`: the user is looking at this conversation (it is the open one of the screen, the tab is
  // visible, the socket is open) and the server still marks it "needs attention" (the "Turno
  // concluído" mark). The server clears it; the shell drops its local mark at once. If the ack is
  // lost the next poll flips the mark back on and the effect sends it again.
  //
  // In the terminal view (`terminal`) there is no socket: the same rule acks over REST, and the row can
  // also be a terminal session that has no chat row (codex, agy, the plain terminal).
  const { chats, ptyPersisted, focusedKey, clearAttention } = useProjectsSessions()
  const [documentVisible, setDocumentVisible] = useState(isDocumentVisible)
  useEffect(() => {
    const sync = () => setDocumentVisible(isDocumentVisible())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])
  const chat = sessionKey ? chats.find((candidate) => candidate?.session_key === sessionKey) : null
  const focused = sessionKey != null && focusedKey === sessionKey
  const mustAck = shouldAckChat({ chat, focused, documentVisible, socketOpen: connection.state === 'open' })
  useEffect(() => {
    if (!mustAck) return
    socketRef.current?.send({ type: 'ack' })
    clearAttention?.(sessionKey)
  }, [mustAck, sessionKey, clearAttention])
  const mustAckOverRest = Boolean(terminal) && shouldAckTerminal({
    row: chat ?? (sessionKey ? ptyPersisted?.[sessionKey] : null) ?? null,
    focused,
    documentVisible,
  })
  useEffect(() => {
    if (!mustAckOverRest) return
    api.ackSession(sessionKey).catch(() => { /* the next poll restores the mark and this effect runs again */ })
    clearAttention?.(sessionKey)
  }, [mustAckOverRest, sessionKey, clearAttention])

  const send = useCallback((text) => {
    const socket = socketRef.current
    const value = String(text ?? '')
    if (!socket || value.trim() === '') return false
    const clientMsgId = newClientId()
    const requestId = `q-${clientMsgId}`
    dispatch({ type: 'local.send', client_msg_id: clientMsgId, request_id: requestId, text: value })
    socket.send({ type: 'send', text: value, client_msg_id: clientMsgId, request_id: requestId })
    return true
  }, [])

  const interrupt = useCallback(() => {
    const socket = socketRef.current
    if (!socket) return
    dispatch({ type: 'local.interrupt' })
    socket.send({ type: 'interrupt' })
  }, [])

  // Returns the request id of the frame (the ModelCard matches a command.rejected with it), or null.
  const setModel = useCallback((model) => socketRef.current?.send({ type: 'set_model', model }) ?? null, [])

  // choice: { behavior: 'allow' | 'deny', scope = 'once', message, interrupt, answers, note }
  // `note` never leaves the browser: it is what the user typed (a denial reason, a comment on a plan)
  // and the card shows it back on its resolved line; `message` is what the server relays to the model.
  const decide = useCallback(async (card, choice) => {
    const scope = choice.scope ?? 'once'
    const { note, ...payload } = choice
    const base = {
      kind: decisionKind({ ...choice, scope }),
      ...(choice.answers ? { answers: choice.answers } : {}),
      ...(note ? { note } : {}),
    }
    dispatch({ type: 'local.decision', id: card.id, behavior: choice.behavior, scope, message: choice.message })
    setDecisions((current) => ({ ...current, [card.id]: { phase: 'sending', ...base } }))
    try {
      await chatApi.decidePermission(card.id, { ...payload, scope })
      setDecisions((current) => ({ ...current, [card.id]: { phase: 'sent', ...base } }))
    } catch {
      dispatch({ type: 'local.decision_failed', id: card.id })
      setDecisions((current) => ({ ...current, [card.id]: { phase: 'error', ...base } }))
    }
  }, [])

  // "Tentar de novo" / "Abrir de novo": reconnect the socket if it is down and ask the server to
  // start the conversation again. The outcome arrives as events (session.started or status).
  const open = useCallback(async () => {
    setActionError(null)
    socketRef.current?.retryNow()
    try {
      await chatApi.openSession(sessionKey)
    } catch (error) {
      setActionError({ action: 'open', error })
    }
  }, [sessionKey])

  // "Iniciar nova conversa": the server publishes session.reset, which clears the banner.
  const reset = useCallback(async () => {
    setActionError(null)
    try {
      await chatApi.resetSession(sessionKey)
    } catch (error) {
      setActionError({ action: 'reset', error })
    }
  }, [sessionKey])

  const retryNow = useCallback(() => {
    socketRef.current?.retryNow()
  }, [])

  const setDraft = useCallback((text) => {
    const value = String(text ?? '')
    if (value === '') draftsRef.current.delete(sessionKey)
    else draftsRef.current.set(sessionKey, value)
    setDraftState(value)
  }, [sessionKey])

  // "Citar no chat": puts text at the END of the draft of ANY conversation, separated by one space and
  // followed by one (so a POSIX path never ends up as a "/" command). Memory only; it never sends.
  const queueDraft = useCallback((targetKey, text) => {
    const addition = String(text ?? '')
    if (!targetKey || addition === '') return
    const current = draftsRef.current.get(targetKey) ?? ''
    const base = current === '' || /\s$/.test(current) ? current : `${current} `
    const next = `${base}${addition} `
    draftsRef.current.set(targetKey, next)
    if (targetKey === sessionKey) setDraftState(next)
  }, [sessionKey])

  return useMemo(
    () => ({
      sessionKey: sessionKey ?? null,
      state,
      connection,
      decisions,
      actionError,
      draft,
      setDraft,
      queueDraft,
      send,
      interrupt,
      setModel,
      decide,
      open,
      reset,
      retryNow,
    }),
    [sessionKey, state, connection, decisions, actionError, draft, setDraft, queueDraft, send, interrupt, setModel, decide, open, reset, retryNow],
  )
}
