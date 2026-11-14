import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { useTerminalSurface } from './useTerminalSurface.js'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = []
    constructor(options) {
      this.options = options
      this.cols = 80
      this.rows = 24
      this.textarea = document.createElement('textarea')
      this.paste = vi.fn()
      this.write = vi.fn()
      this.dispose = vi.fn()
      this.focus = vi.fn()
      this.calls = []
      this.constructor.instances.push(this)
    }
    loadAddon() {}
    open(el) {
      this.calls.push('open')
      if (el) el.appendChild(this.textarea)
    }
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
  },
}))
const fitCalls = []
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() { fitCalls.push('fit') }
  },
}))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }))

class FakeWebSocket {
  static instances = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.sent = []
    this.close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED })
    FakeWebSocket.instances.push(this)
  }
  send(data) { this.sent.push(data) }
}

let surface
function Harness(extra) {
  const containerRef = useRef(null)
  const keyboardSuppressedRef = useRef(false)
  surface = useTerminalSurface({
    containerRef,
    wsUrl: 'ws://host/ws/pty/k1',
    projectId: 'p1',
    agentId: 'a1',
    visible: true,
    theme: { background: '#000' },
    keyboardSuppressedRef,
    ...extra,
  })
  return <div ref={containerRef} data-testid="container" />
}

function openSocket(ws) {
  ws.readyState = FakeWebSocket.OPEN
  act(() => { ws.onopen() })
}

describe('useTerminalSurface', () => {
  let originalWebSocket
  let originalResizeObserver
  let originalFontsDescriptor

  beforeEach(() => {
    FakeWebSocket.instances = []
    Terminal.instances = []
    fitCalls.length = 0
    originalWebSocket = global.WebSocket
    global.WebSocket = FakeWebSocket
    originalResizeObserver = global.ResizeObserver
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    global.WebSocket = originalWebSocket
    global.ResizeObserver = originalResizeObserver
    if (originalFontsDescriptor) Object.defineProperty(document, 'fonts', originalFontsDescriptor)
    else delete document.fonts
  })

  it('opens the terminal inside the container and connects with the init frame', () => {
    render(<Harness />)
    const [term] = Terminal.instances
    expect(term.calls).toEqual(['open'])
    expect(term.options.theme).toEqual({ background: '#000' })
    expect(term.options.cursorBlink).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe('ws://host/ws/pty/k1')
    openSocket(ws)
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'init', project_id: 'p1', agent_id: 'a1', cols: 80, rows: 24 })
    expect(surface.status).toBe('open')
  })

  it('resolves a function theme inside the mount effect', () => {
    const theme = vi.fn(() => ({ background: '#123' }))
    render(<Harness theme={theme} />)
    expect(theme).toHaveBeenCalledTimes(1)
    expect(Terminal.instances[0].options.theme).toEqual({ background: '#123' })
  })

  it('does not connect until document.fonts.ready resolves, then fits and connects', async () => {
    let resolveFonts
    const ready = new Promise((resolve) => { resolveFonts = resolve })
    Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true })
    render(<Harness />)
    expect(FakeWebSocket.instances).toHaveLength(0)
    const fitsBefore = fitCalls.length
    await act(async () => { resolveFonts(); await ready })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(fitCalls.length).toBe(fitsBefore + 1)
  })

  it('connects after the fonts timeout when fonts.ready never resolves', async () => {
    Object.defineProperty(document, 'fonts', { value: { ready: new Promise(() => {}) }, configurable: true })
    vi.useFakeTimers()
    render(<Harness fontsReadyTimeoutMs={200} />)
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(199) })
    expect(FakeWebSocket.instances).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('sendControlByte writes to an open socket and is a no-op otherwise', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]
    surface.sendControlByte('\u001b')
    expect(ws.sent).toEqual([])
    openSocket(ws)
    ws.sent.length = 0
    surface.sendControlByte('\u001b')
    surface.sendControlByte(new Uint8Array([3]))
    expect(ws.sent[0]).toEqual(new TextEncoder().encode('\u001b'))
    expect(ws.sent[1]).toEqual(new Uint8Array([3]))
  })

  it('pasteText goes through term.paste and ignores empty input', () => {
    render(<Harness />)
    const [term] = Terminal.instances
    surface.pasteText('a\r\nb')
    surface.pasteText('')
    surface.pasteText(42)
    expect(term.paste).toHaveBeenCalledTimes(1)
    expect(term.paste).toHaveBeenCalledWith('a\r\nb')
  })

  it('routes control frames to onControlFrame and never to the terminal', async () => {
    const onControlFrame = vi.fn()
    render(<Harness onControlFrame={onControlFrame} />)
    const [term] = Terminal.instances
    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      await ws.onmessage({ data: JSON.stringify({ type: 'resume_failed' }) })
      await ws.onmessage({ data: 'plain output' })
    })
    expect(onControlFrame).toHaveBeenCalledWith({ type: 'resume_failed' })
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('plain output')
  })

  it('reports status changes and reconnects with backoff after an unintentional close', () => {
    vi.useFakeTimers()
    const onStatusChange = vi.fn()
    render(<Harness onStatusChange={onStatusChange} />)
    const first = FakeWebSocket.instances[0]
    openSocket(first)
    act(() => { first.onclose({ code: 1006 }) })
    expect(onStatusChange.mock.calls.map(([s]) => s)).toEqual(['open', 'reconnecting'])
    expect(FakeWebSocket.instances).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => { FakeWebSocket.instances[1].onclose({ code: 1006 }) })
    act(() => { vi.advanceTimersByTime(1999) })
    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(1) })
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('does not reconnect after code 1008 and reports evicted', () => {
    vi.useFakeTimers()
    render(<Harness />)
    act(() => { FakeWebSocket.instances[0].onclose({ code: 1008 }) })
    act(() => { vi.advanceTimersByTime(60000) })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(surface.status).toBe('evicted')
  })

  it('refit fits now and once more after 50ms', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fitCalls.length = 0
    act(() => { surface.refit() })
    expect(fitCalls).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(50) })
    expect(fitCalls).toHaveLength(2)
  })

  it('closeSocket closes the current socket and lets onclose reconnect', () => {
    vi.useFakeTimers()
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]
    openSocket(ws)
    act(() => { surface.closeSocket() })
    expect(ws.close).toHaveBeenCalledTimes(1)
    act(() => { ws.onclose({ code: 1000 }) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})
