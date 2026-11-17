import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect, backoffDelay } from './chatSocket.js'

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.closedWith = null
    FakeWebSocket.instances.push(this)
  }

  send(data) {
    this.sent.push(JSON.parse(data))
  }

  close(code) {
    this.closedWith = code
    this.readyState = 3
  }

  // test helpers
  open() {
    this.readyState = 1
    this.onopen?.()
  }

  receive(frame) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
  }

  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const KEY = 'Pessoal/tn::claude::k3x9q2'
const frame = (type, seq, extra = {}) => ({ type, session_key: KEY, seq, ts: 1, ...extra })

let events
let statuses
function start(options = {}) {
  return connect(KEY, {
    WebSocketImpl: FakeWebSocket,
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    ...options,
  })
}
const current = () => FakeWebSocket.instances.at(-1)
const states = () => statuses.map((status) => status.state)

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  events = []
  statuses = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('chatSocket connection', () => {
  it('connects to /ws/chat with each segment of the key encoded and the since cursor', () => {
    start({ since: 7 })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(current().url).toMatch(/^wss?:\/\/[^/]+\/ws\/chat\/Pessoal\/tn%3A%3Aclaude%3A%3Ak3x9q2\?since=7$/)
    expect(states()).toEqual(['connecting'])
    current().open()
    expect(states()).toEqual(['connecting', 'open'])
  })
})

describe('chatSocket dedupe (CA39)', () => {
  it('drops a persisted event whose seq is not above the last seen one', () => {
    start()
    current().open()
    current().receive(frame('message.user', 1))
    current().receive(frame('message.user', 2))
    current().receive(frame('message.user', 2))
    current().receive(frame('message.user', 1))
    current().receive(frame('message.user', 3))
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('always passes ephemeral frames and does not move the cursor', () => {
    const socket = start({ since: 5 })
    current().open()
    current().receive(frame('commands.changed', null))
    current().receive(frame('commands.changed', null))
    current().receive(frame('replay.complete', null, { last_seq: 5 }))
    expect(events.map((event) => event.type)).toEqual(['commands.changed', 'commands.changed', 'replay.complete'])
    expect(socket.lastSeq).toBe(5)
  })

  it('ignores frames that are not JSON objects', () => {
    start()
    current().open()
    current().receive('not json')
    current().receive('[1,2]')
    current().receive('null')
    current().receive(frame('message.user', 1))
    expect(events).toHaveLength(1)
  })
})

describe('chatSocket reconnection (SP8)', () => {
  it('reconnects after a drop with since = last seq and the backoff 1, 2, 4, 8, 16 s', () => {
    start()
    current().open()
    current().receive(frame('message.user', 4))
    current().drop()
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', failures: 1, retryInMs: 1000 })
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(current().url).toMatch(/since=4$/)
    for (const [failures, delay] of [[2, 2000], [3, 4000], [4, 8000]]) {
      current().drop()
      expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', failures, retryInMs: delay })
      vi.advanceTimersByTime(delay)
    }
    expect(FakeWebSocket.instances).toHaveLength(5)
  })

  it('says "offline" after 5 failures in a row and keeps trying every 30 s at most', () => {
    start()
    const delays = []
    for (let attempt = 0; attempt < 7; attempt += 1) {
      current().drop()
      delays.push(statuses.at(-1).retryInMs)
      vi.advanceTimersByTime(statuses.at(-1).retryInMs)
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    expect(states().filter((state) => state === 'offline')).toHaveLength(3)
    expect(statuses.find((status) => status.state === 'offline')).toMatchObject({ failures: 5 })
    expect(backoffDelay(0)).toBe(0)
  })

  it('resets the failure count once the server answers', () => {
    start()
    current().drop()
    vi.advanceTimersByTime(1000)
    current().open()
    current().receive(frame('session.state', null))
    current().drop()
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', failures: 1, retryInMs: 1000 })
  })

  it.each([
    [4403, 'forbidden'],
    [4404, 'not_found'],
    [4429, 'too_many_readers'],
  ])('never reconnects after close %i (%s)', (code, state) => {
    start()
    current().open()
    current().drop(code)
    expect(statuses.at(-1)).toEqual({ state })
    vi.advanceTimersByTime(120000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('reconnects at once after 4408 with since and without counting a failure', () => {
    start()
    current().open()
    current().receive(frame('message.user', 9))
    current().drop(4408)
    vi.advanceTimersByTime(0)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(current().url).toMatch(/since=9$/)
    current().drop()
    expect(statuses.at(-1)).toMatchObject({ failures: 1, retryInMs: 1000 })
  })

  it.each(['spawn_failed', 'resume_failed', 'engine_unavailable'])(
    'does not reconnect on its own after a terminal status event (%s)',
    (code) => {
      start()
      current().open()
      current().receive(frame('status', 3, { code }))
      current().drop()
      expect(statuses.at(-1)).toEqual({ state: 'closed' })
      vi.advanceTimersByTime(120000)
      expect(FakeWebSocket.instances).toHaveLength(1)
    },
  )

  it('reconnects with backoff and since after a drop when the log says status closed (a resumable chat)', () => {
    start()
    current().open()
    current().receive(frame('status', 3, { code: 'closed', reason: 'idle' }))
    current().drop()
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', failures: 1, retryInMs: 1000 })
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(current().url).toMatch(/since=3$/)
  })

  it('reconnects after a drop that follows a reset of a failed resume', () => {
    start()
    current().open()
    current().receive(frame('status', 3, { code: 'resume_failed' }))
    current().receive(frame('session.reset', 4))
    current().drop()
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting' })
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('lists the request ids that are still queued, and none once they were handed to an open socket', () => {
    const socket = start()
    const queued = socket.send({ type: 'send', text: 'a' })
    expect(socket.pendingRequestIds()).toEqual([queued])
    current().open()
    expect(socket.pendingRequestIds()).toEqual([])
  })

  it('keeps the socket open on those events and reconnects again after a new session.started', () => {
    start()
    current().open()
    current().receive(frame('status', 3, { code: 'spawn_failed', reason: 'process_error' }))
    expect(current().closedWith).toBeNull()
    current().receive(frame('session.started', 4))
    current().drop()
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('retryNow reconnects right away from the offline state and after a terminal status', () => {
    const socket = start()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      current().drop()
      vi.advanceTimersByTime(statuses.at(-1).retryInMs)
    }
    current().drop()
    expect(statuses.at(-1).state).toBe('offline')
    const before = FakeWebSocket.instances.length
    socket.retryNow()
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
    current().open()
    current().receive(frame('status', 5, { code: 'resume_failed' }))
    current().drop()
    socket.retryNow()
    expect(FakeWebSocket.instances).toHaveLength(before + 2)
  })
})

describe('chatSocket send queue', () => {
  it('queues frames while connecting, flushes them in order on open and stamps request_id', () => {
    const socket = start()
    const first = socket.send({ type: 'send', client_msg_id: 'a', text: 'one' })
    const second = socket.send({ type: 'interrupt', request_id: 'mine' })
    expect(current().sent).toEqual([])
    current().open()
    expect(current().sent).toEqual([
      { type: 'send', client_msg_id: 'a', text: 'one', request_id: first },
      { type: 'interrupt', request_id: 'mine' },
    ])
    expect(second).toBe('mine')
    expect(first).toMatch(/\S/)
  })

  it('sends straight away once open and gives distinct request ids', () => {
    const socket = start()
    current().open()
    const a = socket.send({ type: 'ack' })
    const b = socket.send({ type: 'ack' })
    expect(current().sent).toHaveLength(2)
    expect(a).not.toBe(b)
  })

  it('keeps the queue across a reconnect', () => {
    const socket = start()
    current().open()
    current().drop()
    socket.send({ type: 'send', client_msg_id: 'b', text: 'later' })
    vi.advanceTimersByTime(1000)
    current().open()
    expect(current().sent.map((item) => item.client_msg_id)).toEqual(['b'])
  })
})

describe('chatSocket close', () => {
  it('closes the socket, stops the retry timer, ignores late frames and is idempotent', () => {
    const socket = start()
    current().open()
    const first = current()
    socket.close()
    socket.close()
    expect(first.closedWith).toBe(1000)
    expect(statuses.filter((status) => status.state === 'closed')).toHaveLength(1)
    first.receive(frame('message.user', 1))
    first.drop()
    vi.advanceTimersByTime(120000)
    expect(events).toEqual([])
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.send({ type: 'ack' })).toBeNull()
  })

  it('cancels a pending reconnect', () => {
    const socket = start()
    current().drop()
    socket.close()
    vi.advanceTimersByTime(120000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('StrictMode style connect, close, connect leaves exactly one live socket', () => {
    const first = start()
    first.close()
    start()
    expect(FakeWebSocket.instances.filter((socket) => socket.closedWith === null)).toHaveLength(1)
  })
})
