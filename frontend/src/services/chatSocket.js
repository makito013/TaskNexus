// WebSocket client of one chat conversation (/ws/chat/{session_key}, contract 4). No React.
//
//   const socket = connect(sessionKey, { since, onEvent, onStatus })
//   socket.send(frame)   -> request_id (queued while the socket is not open)
//   socket.pendingRequestIds() -> request ids still queued (not yet handed to a socket)
//   socket.retryNow()    -> reconnect right away (the "Tentar agora" button)
//   socket.close()       -> stops everything; idempotent
//
// onEvent receives every server frame once: a frame with an integer `seq` is dropped when
// `seq <= last seen` (the replay and the live queue can overlap, and a reconnect replays from
// `since`). Frames with `seq: null` (ephemeral: deltas, session.state, replay.complete,
// commands.changed...) always pass and never move the last seen `seq`.
//
// onStatus receives the connection state (never a server event):
//   { state: 'connecting' | 'open' | 'closed' }
//   { state: 'reconnecting', failures, retryInMs }   backoff running (failures 1..4)
//   { state: 'offline', failures, retryInMs }        5 or more failures in a row ("Sem conexão")
//   { state: 'too_many_readers' }                    4429: no reconnect
//   { state: 'forbidden' }                           4403: no reconnect
//   { state: 'not_found' }                           4404: no reconnect
//
// Reconnection (SP8): only after a drop that was not a refusal, and not after a terminal
// `status` event (spawn_failed, resume_failed, engine_unavailable): in those states a
// dropped socket stays down until the user asks (retryNow). 4408 (slow reader) reconnects at
// once with `since`, without counting as a failure.
import { encodeSessionKey } from './sessionKey.js'

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
export const MAX_BACKOFF_MS = 30000
export const OFFLINE_AFTER_FAILURES = 5

export const CLOSE_ORIGIN_DENIED = 4403
export const CLOSE_NOT_FOUND = 4404
export const CLOSE_SLOW_READER = 4408
export const CLOSE_TOO_MANY_READERS = 4429

// Closes that are an answer, not a drop: never retried automatically.
const REFUSALS = {
  [CLOSE_ORIGIN_DENIED]: 'forbidden',
  [CLOSE_NOT_FOUND]: 'not_found',
  [CLOSE_TOO_MANY_READERS]: 'too_many_readers',
}
// `closed` is NOT terminal: the server never closes the WebSocket because a process ended, and a
// "Retomável" conversation must reconnect after a network drop (send resumes the process).
const TERMINAL_STATUS_CODES = new Set(['spawn_failed', 'resume_failed', 'engine_unavailable'])

export function backoffDelay(failures) {
  if (failures < 1) return 0
  return failures <= BACKOFF_MS.length ? BACKOFF_MS[failures - 1] : MAX_BACKOFF_MS
}

function socketUrl(sessionKey, since) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/chat/${encodeSessionKey(sessionKey)}?since=${since}`
}

let requestCounter = 0
function nextRequestId() {
  requestCounter += 1
  return `r${Date.now().toString(36)}-${requestCounter}`
}

export function connect(sessionKey, {
  since = 0,
  onEvent = () => {},
  onStatus = () => {},
  WebSocketImpl = WebSocket,
} = {}) {
  let lastSeq = Math.max(0, Number(since) || 0)
  let socket = null
  let closedByCaller = false
  let failures = 0
  let retryTimer = null
  let terminalStatus = false
  const outbox = []

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function flush() {
    while (outbox.length > 0 && socket && socket.readyState === 1) {
      socket.send(JSON.stringify(outbox.shift()))
    }
  }

  function handleFrame(frame) {
    if (frame.seq !== null && frame.seq !== undefined) {
      if (frame.seq <= lastSeq) return
      lastSeq = frame.seq
    }
    if (frame.type === 'status') terminalStatus = TERMINAL_STATUS_CODES.has(frame.code)
    else if (frame.type === 'session.started' || frame.type === 'session.resumed' || frame.type === 'session.reset') terminalStatus = false
    onEvent(frame)
  }

  function scheduleRetry(delay) {
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = null
      open()
    }, delay)
  }

  function handleClose(current, code) {
    if (current !== socket || closedByCaller) return
    socket = null
    if (REFUSALS[code]) {
      onStatus({ state: REFUSALS[code] })
      return
    }
    if (code === CLOSE_SLOW_READER) {
      onStatus({ state: 'reconnecting', failures, retryInMs: 0 })
      scheduleRetry(0)
      return
    }
    if (terminalStatus) {
      onStatus({ state: 'closed' })
      return
    }
    failures += 1
    const retryInMs = backoffDelay(failures)
    onStatus({
      state: failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting',
      failures,
      retryInMs,
    })
    scheduleRetry(retryInMs)
  }

  function open() {
    if (closedByCaller || socket) return
    onStatus({ state: 'connecting' })
    const current = new WebSocketImpl(socketUrl(sessionKey, lastSeq))
    socket = current
    current.onopen = () => {
      if (current !== socket) return
      onStatus({ state: 'open' })
      flush()
    }
    current.onmessage = (message) => {
      if (current !== socket) return
      let frame = null
      try {
        frame = JSON.parse(message.data)
      } catch {
        frame = null // the server only sends JSON objects; anything else is not an event
      }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return
      failures = 0 // the server answered: the connection works
      handleFrame(frame)
    }
    current.onclose = (event) => handleClose(current, event?.code)
    // A failed connection is always followed by `close`, which is where it is handled.
    current.onerror = () => {}
  }

  open()

  return {
    send(frame) {
      if (closedByCaller) return null
      const requestId = frame.request_id ?? nextRequestId()
      outbox.push({ ...frame, request_id: requestId })
      flush()
      return requestId
    },

    retryNow() {
      if (closedByCaller) return
      clearRetry()
      if (socket) return // already connecting or open
      failures = 0
      terminalStatus = false
      open()
    },

    // Request ids still waiting for an open socket (never handed to one): they leave on the next
    // connection. Anything else the caller sent may have died with a half-dead socket.
    pendingRequestIds() {
      return outbox.map((frame) => frame.request_id)
    },

    close() {
      if (closedByCaller) return
      closedByCaller = true
      clearRetry()
      outbox.length = 0
      const current = socket
      socket = null
      if (current) {
        try {
          current.close(1000)
        } catch {
          /* already closed */
        }
      }
      onStatus({ state: 'closed' })
    },

    get lastSeq() {
      return lastSeq
    },
  }
}
