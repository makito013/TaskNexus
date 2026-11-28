import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BACKOFF_MS,
  CLOSE_SLOW_READER,
  CLOSE_TOO_MANY_READERS,
  MAX_BACKOFF_MS,
  SLOW_RECONNECT_WINDOW_MS,
  backoffDelay,
  connectViewerFeed,
} from './viewerFeed.js'

class FakeSocket {
  static instances = []
  static throwOnConstruct = false

  constructor(url) {
    if (FakeSocket.throwOnConstruct) throw new Error('SecurityError')
    this.url = url
    this.closedByUs = false
    this.close = vi.fn(() => {
      this.closedByUs = true
    })
    FakeSocket.instances.push(this)
  }

  receive(frame) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
  }

  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const openFrame = (overrides = {}) => ({
  type: 'viewer_open',
  session_key: KEY,
  item: { item_id: 'i1', path: 'docs/plan.md', opened_by: 'agent' },
  reused: false,
  evicted: [],
  ...overrides,
})

let calls
const connect = () => {
  calls = { open: [], ready: 0 }
  return connectViewerFeed({
    onOpen: (...args) => calls.open.push(args),
    onReady: () => {
      calls.ready += 1
    },
    WebSocketImpl: FakeSocket,
  })
}
const last = () => FakeSocket.instances.at(-1)

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  FakeSocket.throwOnConstruct = false
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('backoffDelay', () => {
  it('walks 1, 2, 4, 8, 16 seconds and then stays at 30', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(backoffDelay)).toEqual([...BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS])
    expect(backoffDelay(0)).toBe(0)
  })
})

describe('connectViewerFeed: the connection and the frames', () => {
  it('opens /ws/viewer on the page host (ws on http, wss on https)', () => {
    connect()
    expect(last().url).toBe(`ws://${window.location.host}/ws/viewer`)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('opens a wss: URL when the page is on https', () => {
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { protocol: 'https:', host: 'tasknexus.example:443' } })
    try {
      connect()
      expect(last().url).toBe('wss://tasknexus.example:443/ws/viewer')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('calls onReady for `ready` and onOpen with the arguments of receiveOpen for a viewer_open frame', () => {
    connect()
    last().receive({ type: 'ready' })
    last().receive(openFrame({ reused: true, evicted: ['old'] }))

    expect(calls.ready).toBe(1)
    expect(calls.open).toEqual([[KEY, { item_id: 'i1', path: 'docs/plan.md', opened_by: 'agent' }, true, ['old']]])
  })

  it('a frame with no `evicted` list is an empty one, and a non-string id in it is dropped', () => {
    connect()
    last().receive(openFrame({ evicted: undefined }))
    last().receive(openFrame({ evicted: ['a', 7, null, 'b'] }))

    expect(calls.open.map((args) => args[3])).toEqual([[], ['a', 'b']])
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '42'],
    ['null', 'null'],
    ['an unknown type', JSON.stringify({ type: 'something_else', session_key: KEY, item: { item_id: 'i1' } })],
    ['a frame with no type', JSON.stringify({ session_key: KEY, item: { item_id: 'i1' } })],
    ['a frame with no item', JSON.stringify({ type: 'viewer_open', session_key: KEY })],
    ['an item that is a list', JSON.stringify({ type: 'viewer_open', session_key: KEY, item: [] })],
    ['an item with no item_id', JSON.stringify({ type: 'viewer_open', session_key: KEY, item: { path: 'a.md' } })],
    ['an item with an empty item_id', JSON.stringify({ type: 'viewer_open', session_key: KEY, item: { item_id: '' } })],
    ['an item_id that is not text', JSON.stringify({ type: 'viewer_open', session_key: KEY, item: { item_id: 7 } })],
    ['no session key', JSON.stringify({ type: 'viewer_open', item: { item_id: 'i1' } })],
    ['a dot-segment key', JSON.stringify(openFrame({ session_key: 'P/../other::claude::x' }))],
    ['a %2e%2e key', JSON.stringify(openFrame({ session_key: 'P::a::x/%2e%2e/%2e%2e/P::a::victim' }))],
    ['a key with a query', JSON.stringify(openFrame({ session_key: 'P::claude::x?y=1' }))],
    ['an empty key', JSON.stringify(openFrame({ session_key: '' }))],
  ])('drops %s without calling anything and without throwing', (_name, raw) => {
    connect()
    expect(() => last().receive(raw)).not.toThrow()

    expect(calls.open).toEqual([])
    expect(calls.ready).toBe(0)
  })

  it('keeps working after a dropped frame', () => {
    connect()
    last().receive('garbage')
    last().receive(openFrame())

    expect(calls.open).toHaveLength(1)
  })

  it('close() closes the socket, stops the retries and ignores whatever the old socket still says; twice is fine', () => {
    const feed = connect()
    const socket = last()
    socket.drop(1006)
    feed.close()
    vi.advanceTimersByTime(60000)
    expect(FakeSocket.instances).toHaveLength(1)

    const feed2 = connect()
    const live = last()
    feed2.close()
    expect(live.close).toHaveBeenCalledTimes(1)
    live.receive(openFrame())
    live.receive({ type: 'ready' })
    live.drop(1006)
    vi.advanceTimersByTime(60000)
    expect(calls.open).toEqual([])
    expect(calls.ready).toBe(0)
    expect(FakeSocket.instances).toHaveLength(2) // the one of feed2 only
    expect(() => feed2.close()).not.toThrow()
    expect(live.close).toHaveBeenCalledTimes(1)
  })

  it('a socket that cannot even be built is retried by the backoff, not thrown', () => {
    FakeSocket.throwOnConstruct = true
    expect(() => connect()).not.toThrow()
    FakeSocket.throwOnConstruct = false

    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})

describe('connectViewerFeed: reconnection (C18)', () => {
  const elapse = (ms) => vi.advanceTimersByTime(ms)

  it('five handshakes closed with 1008 and never ready are spaced 1, 2, 4, 8 and 16 seconds, then 30', () => {
    connect()
    const gaps = [...BACKOFF_MS, MAX_BACKOFF_MS]
    gaps.forEach((gap, index) => {
      expect(FakeSocket.instances).toHaveLength(index + 1)
      last().onopen?.() // the guard accepts the handshake before it closes it: opening proves nothing
      last().drop(1008)
      elapse(gap - 1)
      expect(FakeSocket.instances, `before ${gap} ms`).toHaveLength(index + 1)
      elapse(1)
      expect(FakeSocket.instances, `at ${gap} ms`).toHaveLength(index + 2)
    })
  })

  it('`ready` starts the backoff over: the next drop waits 1 second again', () => {
    connect()
    last().drop(1008)
    elapse(1000)
    last().drop(1008)
    elapse(2000)
    expect(FakeSocket.instances).toHaveLength(3)

    last().receive({ type: 'ready' })
    last().drop(1006)
    elapse(999)
    expect(FakeSocket.instances).toHaveLength(3)
    elapse(1)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('an opened socket that was never ready does not reset the backoff', () => {
    connect()
    last().drop(1008)
    elapse(1000)
    last().onopen?.()
    last().drop(1008)
    elapse(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    elapse(1)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('4408 on a connection that had been ready reconnects at once', () => {
    connect()
    last().receive({ type: 'ready' })
    last().drop(CLOSE_SLOW_READER)
    elapse(0)

    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('a second 4408 within 5 seconds waits for the backoff; after the window it is immediate again', () => {
    connect()
    last().receive({ type: 'ready' })
    last().drop(CLOSE_SLOW_READER)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(2)

    last().receive({ type: 'ready' })
    elapse(SLOW_RECONNECT_WINDOW_MS - 100)
    last().drop(CLOSE_SLOW_READER)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(2) // not at once
    elapse(999)
    expect(FakeSocket.instances).toHaveLength(2)
    elapse(1)
    expect(FakeSocket.instances).toHaveLength(3)

    last().receive({ type: 'ready' })
    elapse(SLOW_RECONNECT_WINDOW_MS + 1)
    last().drop(CLOSE_SLOW_READER)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('4408 on a connection that was never ready waits for the backoff', () => {
    connect()
    last().drop(CLOSE_SLOW_READER)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(1)
    elapse(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('4429 (too many readers) and 1008 follow the backoff and never reconnect at once', () => {
    connect()
    last().receive({ type: 'ready' })
    last().drop(CLOSE_TOO_MANY_READERS)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(1)
    elapse(1000)
    expect(FakeSocket.instances).toHaveLength(2)

    last().receive({ type: 'ready' })
    last().drop(1008)
    elapse(0)
    expect(FakeSocket.instances).toHaveLength(2)
    elapse(1000)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('a close of a socket the caller already replaced or closed does not start a second connection', () => {
    const feed = connect()
    const first = last()
    first.drop(1006)
    first.drop(1006) // a duplicate event of the same socket
    elapse(1000)
    expect(FakeSocket.instances).toHaveLength(2)
    feed.close()
    first.drop(1006)
    elapse(60000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})
