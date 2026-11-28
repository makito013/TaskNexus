// Client of the live feed of the viewer (`/ws/viewer`, read-only). No React.
//
//   const feed = connectViewerFeed({ onOpen, onReady, WebSocketImpl })
//   feed.close()    stops everything; idempotent
//
// The server sends `{"type": "ready"}` first and then one `{"type": "viewer_open", session_key, item, reused,
// evicted}` per file an agent opens, for ANY conversation. Nothing is replayed, so every `ready` (the first and each
// reconnection) means "reload what you show": the caller does it from `onReady`.
//   onOpen(sessionKey, item, reused, evicted)   a frame that passed the checks below
//   onReady()                                   the connection is up and the server is listening
//
// A frame is dropped (never an error) when it is not JSON, has an unknown type, has no `item.item_id`, or carries a
// session key that `isSafeSessionKey` refuses: the key ends up in a URL path, whatever the sender says.
//
// Reconnection. The origin guard of the server accepts the handshake and then closes it (1008) for a page it
// refuses, so `onopen` firing proves nothing: the delay of the backoff (1 s, 2, 4, 8, 16, then 30 s) only goes back
// to the start when the server said `ready`. 4408 ("too slow", the queue overflowed) is the one close that
// reconnects at once, and only for a connection that had been ready and when no other 4408 came in the last 5 s;
// 1008, 4429 (too many readers) and any other close wait for the backoff.
import { isSafeSessionKey } from './sessionKey.js'

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
export const MAX_BACKOFF_MS = 30000
export const CLOSE_SLOW_READER = 4408
export const CLOSE_TOO_MANY_READERS = 4429
export const SLOW_RECONNECT_WINDOW_MS = 5000

export function backoffDelay(failures) {
  if (failures < 1) return 0
  return failures <= BACKOFF_MS.length ? BACKOFF_MS[failures - 1] : MAX_BACKOFF_MS
}

function feedUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/viewer`
}

// The frame as `onOpen` takes it, or null when it must be dropped.
function parseOpenFrame(frame) {
  const item = frame.item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  if (typeof item.item_id !== 'string' || item.item_id === '') return null
  if (!isSafeSessionKey(frame.session_key)) return null
  const evicted = Array.isArray(frame.evicted) ? frame.evicted.filter((id) => typeof id === 'string') : []
  return { sessionKey: frame.session_key, item, reused: Boolean(frame.reused), evicted }
}

export function connectViewerFeed({ onOpen = () => {}, onReady = () => {}, WebSocketImpl = WebSocket } = {}) {
  let socket = null
  let closedByCaller = false
  let failures = 0
  let retryTimer = null
  let lastSlowAt = null

  function scheduleRetry(delay) {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      open()
    }, delay)
  }

  function failAndBackOff() {
    failures += 1
    scheduleRetry(backoffDelay(failures))
  }

  function handleClose(current, wasReady, code) {
    if (current !== socket) return // replaced, or closed by the caller (close() empties `socket` first)
    socket = null
    const now = Date.now()
    if (code === CLOSE_SLOW_READER && wasReady && (lastSlowAt === null || now - lastSlowAt > SLOW_RECONNECT_WINDOW_MS)) {
      lastSlowAt = now
      scheduleRetry(0)
      return
    }
    if (code === CLOSE_SLOW_READER) lastSlowAt = now
    failAndBackOff()
  }

  function open() {
    if (closedByCaller || socket) return
    let current
    try {
      current = new WebSocketImpl(feedUrl())
    } catch {
      failAndBackOff()
      return
    }
    socket = current
    let wasReady = false
    current.onmessage = (message) => {
      if (current !== socket) return
      let frame = null
      try {
        frame = JSON.parse(message.data)
      } catch {
        frame = null
      }
      if (!frame || typeof frame !== 'object') return
      if (frame.type === 'ready') {
        wasReady = true
        failures = 0
        onReady()
      } else if (frame.type === 'viewer_open') {
        const parsed = parseOpenFrame(frame)
        if (parsed) onOpen(parsed.sessionKey, parsed.item, parsed.reused, parsed.evicted)
      }
    }
    current.onclose = (event) => handleClose(current, wasReady, event?.code)
  }

  open()

  return {
    close() {
      if (closedByCaller) return
      closedByCaller = true
      clearTimeout(retryTimer)
      retryTimer = null
      const current = socket
      socket = null
      try {
        current?.close()
      } catch {
        // already closed
      }
    },
  }
}
