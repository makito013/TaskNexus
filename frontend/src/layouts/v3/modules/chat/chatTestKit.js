// Test scaffold of the chat screens (NOT a suite: the name does not match Vitest's include, the same
// precedent as src/test/fakeVisualViewport.js). A WebSocket double that records what was sent and lets
// a test play the server, plus a builder of server frames.
export class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.closeCalls = 0
    FakeWebSocket.instances.push(this)
  }

  send(data) {
    this.sent.push(JSON.parse(data))
  }

  close() {
    this.closeCalls += 1
    this.readyState = 3
  }

  // -- the server's side ------------------------------------------------------------------------

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

export function resetSockets() {
  FakeWebSocket.instances = []
}

export const liveSockets = () => FakeWebSocket.instances.filter((socket) => socket.readyState !== 3)
export const lastSocket = () => FakeWebSocket.instances.at(-1)

// frames(KEY)('message.user', 1, { text: 'oi' }) -> a server frame of that conversation.
export function frames(sessionKey) {
  return (type, seq, extra = {}) => ({ type, session_key: sessionKey, seq, ts: Date.now() / 1000, ...extra })
}
