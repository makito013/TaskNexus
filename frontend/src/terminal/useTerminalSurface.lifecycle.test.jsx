import { StrictMode, useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalSurface } from './useTerminalSurface.js'

// Richer xterm double than useTerminalSurface.test.jsx: it keeps the onData /
// onResize handlers so the tests can drive the data paths, and it exposes a
// mutable `options` so live theme updates are observable.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = []
    constructor(options) {
      this.options = { ...options }
      this.cols = 80
      this.rows = 24
      this.textarea = document.createElement('textarea')
      this.paste = vi.fn()
      this.write = vi.fn()
      this.dispose = vi.fn()
      this.focus = vi.fn()
      this.constructor.instances.push(this)
    }
    loadAddon() {}
    open(el) { if (el) el.appendChild(this.textarea) }
    onData(handler) { this.dataHandler = handler; return { dispose() {} } }
    onResize(handler) { this.resizeHandler = handler; return { dispose() {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    static handlers = []
    constructor(handler) { this.constructor.handlers.push(handler) }
  },
}))

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
function Harness({ withKeyboardRef = false, keyboardSuppressed = false, ...extra }) {
  const containerRef = useRef(null)
  const keyboardSuppressedRef = useRef(keyboardSuppressed)
  keyboardSuppressedRef.current = keyboardSuppressed
  surface = useTerminalSurface({
    containerRef,
    wsUrl: 'ws://host/ws/pty/k1',
    projectId: 'p1',
    agentId: 'a1',
    visible: true,
    theme: { background: '#000' },
    ...(withKeyboardRef ? { keyboardSuppressedRef } : {}),
    ...extra,
  })
  return <div ref={containerRef} data-testid="container" />
}

function openSocket(ws) {
  ws.readyState = FakeWebSocket.OPEN
  act(() => { ws.onopen() })
}

describe('useTerminalSurface lifecycle and data paths', () => {
  let originalWebSocket
  let originalResizeObserver

  beforeEach(() => {
    FakeWebSocket.instances = []
    Terminal.instances = []
    WebLinksAddon.handlers = []
    originalWebSocket = global.WebSocket
    global.WebSocket = FakeWebSocket
    originalResizeObserver = global.ResizeObserver
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    global.WebSocket = originalWebSocket
    global.ResizeObserver = originalResizeObserver
  })

  describe('StrictMode and unmount', () => {
    it('closes the discarded first socket and ignores its late close event (no ghost reconnect)', () => {
      vi.useFakeTimers()
      render(<StrictMode><Harness /></StrictMode>)
      // StrictMode runs mount -> cleanup -> mount: two terminals, two sockets.
      expect(Terminal.instances).toHaveLength(2)
      expect(FakeWebSocket.instances).toHaveLength(2)
      const [discarded, live] = FakeWebSocket.instances
      expect(discarded.close).toHaveBeenCalledTimes(1)
      expect(live.close).not.toHaveBeenCalled()

      // The discarded socket's close event arrives AFTER the live one replaced it.
      act(() => { discarded.onclose({ code: 1006 }) })
      act(() => { vi.advanceTimersByTime(60000) })
      expect(FakeWebSocket.instances).toHaveLength(2)
      expect(surface.status).toBe('connecting')
    })

    it('still reconnects when the CURRENT socket closes unexpectedly under StrictMode', () => {
      vi.useFakeTimers()
      render(<StrictMode><Harness /></StrictMode>)
      const live = FakeWebSocket.instances[1]
      act(() => { live.onclose({ code: 1006 }) })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(FakeWebSocket.instances).toHaveLength(3)
    })

    it('closes an open socket and disposes the terminal on unmount', () => {
      const { unmount } = render(<Harness />)
      const ws = FakeWebSocket.instances[0]
      openSocket(ws)
      unmount()
      expect(ws.close).toHaveBeenCalledTimes(1)
      expect(Terminal.instances[0].dispose).toHaveBeenCalledTimes(1)
    })

    it('closes a still-connecting socket on unmount', () => {
      const { unmount } = render(<Harness />)
      const ws = FakeWebSocket.instances[0]
      unmount()
      expect(ws.close).toHaveBeenCalledTimes(1)
    })

    it('cancels a pending reconnect timer on unmount', () => {
      vi.useFakeTimers()
      const { unmount } = render(<Harness />)
      act(() => { FakeWebSocket.instances[0].onclose({ code: 1006 }) })
      unmount()
      act(() => { vi.advanceTimersByTime(60000) })
      expect(FakeWebSocket.instances).toHaveLength(1)
    })

    it('replaces the terminal and the socket when the session identity changes', () => {
      const { rerender } = render(<Harness />)
      const first = FakeWebSocket.instances[0]
      rerender(<Harness wsUrl="ws://host/ws/pty/k2" />)
      expect(first.close).toHaveBeenCalledTimes(1)
      expect(Terminal.instances).toHaveLength(2)
      expect(Terminal.instances[0].dispose).toHaveBeenCalledTimes(1)
      expect(FakeWebSocket.instances).toHaveLength(2)
      expect(FakeWebSocket.instances[1].url).toBe('ws://host/ws/pty/k2')
    })
  })

  describe('data paths', () => {
    it('sends keystrokes as encoded bytes only while the socket is open', () => {
      render(<Harness />)
      const [term] = Terminal.instances
      const ws = FakeWebSocket.instances[0]
      term.dataHandler('ls')
      expect(ws.sent).toEqual([])
      openSocket(ws)
      ws.sent.length = 0
      term.dataHandler('ls')
      expect(ws.sent).toEqual([new TextEncoder().encode('ls')])
    })

    it('sends a resize frame only while the socket is open', () => {
      render(<Harness />)
      const [term] = Terminal.instances
      const ws = FakeWebSocket.instances[0]
      term.resizeHandler({ cols: 100, rows: 30 })
      expect(ws.sent).toEqual([])
      openSocket(ws)
      ws.sent.length = 0
      term.resizeHandler({ cols: 100, rows: 30 })
      expect(ws.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: 'resize', cols: 100, rows: 30 }])
    })

    it('sends a null agent_id in the init frame when no agent is given', () => {
      render(<Harness agentId={undefined} />)
      const ws = FakeWebSocket.instances[0]
      openSocket(ws)
      expect(JSON.parse(ws.sent[0]).agent_id).toBeNull()
    })

    it('writes Blob output to the terminal as bytes', async () => {
      render(<Harness />)
      const [term] = Terminal.instances
      const ws = FakeWebSocket.instances[0]
      await act(async () => { await ws.onmessage({ data: new Blob([new Uint8Array([104, 105])]) }) })
      expect(term.write).toHaveBeenCalledTimes(1)
      expect(Array.from(term.write.mock.calls[0][0])).toEqual([104, 105])
    })

    it('writes ArrayBuffer output to the terminal as bytes', async () => {
      render(<Harness />)
      const [term] = Terminal.instances
      const ws = FakeWebSocket.instances[0]
      await act(async () => { await ws.onmessage({ data: new Uint8Array([1, 2, 3]).buffer }) })
      expect(Array.from(term.write.mock.calls[0][0])).toEqual([1, 2, 3])
    })

    it('reports open on the init handshake and resets the backoff', () => {
      vi.useFakeTimers()
      const onStatusChange = vi.fn()
      render(<Harness onStatusChange={onStatusChange} />)
      act(() => { FakeWebSocket.instances[0].onclose({ code: 1006 }) })
      act(() => { vi.advanceTimersByTime(1000) })
      openSocket(FakeWebSocket.instances[1])
      act(() => { FakeWebSocket.instances[1].onclose({ code: 1006 }) })
      // Backoff was reset by the successful open: next delay is 1000ms again, not 2000ms.
      act(() => { vi.advanceTimersByTime(1000) })
      expect(FakeWebSocket.instances).toHaveLength(3)
      expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['reconnecting', 'open', 'reconnecting'])
    })
  })

  describe('injected options', () => {
    it('applies a new theme to the running terminal without recreating it or the socket', () => {
      const { rerender } = render(<Harness theme={{ background: '#111' }} />)
      const stable = { background: '#222' }
      rerender(<Harness theme={stable} />)
      expect(Terminal.instances).toHaveLength(1)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(Terminal.instances[0].options.theme).toBe(stable)
    })

    it('re-resolves a function theme when its identity changes, and not otherwise', () => {
      const first = vi.fn(() => ({ background: '#111' }))
      const second = vi.fn(() => ({ background: '#222' }))
      const { rerender } = render(<Harness theme={first} />)
      expect(first).toHaveBeenCalledTimes(1)
      rerender(<Harness theme={first} />)
      expect(first).toHaveBeenCalledTimes(1)
      rerender(<Harness theme={second} />)
      expect(second).toHaveBeenCalledTimes(1)
      expect(Terminal.instances[0].options.theme).toEqual({ background: '#222' })
    })

    it('does not touch the terminal theme when the theme identity is unchanged', () => {
      const stable = { background: '#111' }
      const { rerender } = render(<Harness theme={stable} />)
      Terminal.instances[0].options.theme = 'sentinel'
      rerender(<Harness theme={stable} />)
      expect(Terminal.instances[0].options.theme).toBe('sentinel')
    })

    it('builds a recreated terminal with the latest theme when theme and session change together', () => {
      const next = { background: '#333' }
      const { rerender } = render(<Harness theme={{ background: '#111' }} />)
      rerender(<Harness wsUrl="ws://host/ws/pty/k2" theme={next} />)
      expect(Terminal.instances).toHaveLength(2)
      expect(Terminal.instances[1].options.theme).toBe(next)
    })

    it('hands the injected onOpenLink to the web links addon', () => {
      const onOpenLink = vi.fn()
      render(<Harness onOpenLink={onOpenLink} />)
      expect(WebLinksAddon.handlers).toEqual([onOpenLink])
    })

    it('registers each link provider factory with the terminal when supported', () => {
      const provider = { provideLinks() {} }
      const factory = vi.fn(() => provider)
      const registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }))
      const original = Terminal.prototype.registerLinkProvider
      Terminal.prototype.registerLinkProvider = registerLinkProvider
      try {
        render(<Harness linkProviders={[factory]} />)
      } finally {
        if (original) Terminal.prototype.registerLinkProvider = original
        else delete Terminal.prototype.registerLinkProvider
      }
      expect(factory).toHaveBeenCalledWith(Terminal.instances[0])
      expect(registerLinkProvider).toHaveBeenCalledWith(provider)
    })
  })

  describe('keyboardSuppressedRef', () => {
    it('is optional: mounting without it does not throw and focuses the terminal', () => {
      render(<Harness />)
      expect(Terminal.instances[0].focus).toHaveBeenCalledTimes(1)
      expect(Terminal.instances[0].textarea.readOnly).toBe(false)
      expect(() => surface.focus()).not.toThrow()
      expect(Terminal.instances[0].focus).toHaveBeenCalledTimes(2)
    })

    it('makes the textarea read-only at mount and skips every focus() when suppressed', () => {
      vi.useFakeTimers()
      render(<Harness withKeyboardRef keyboardSuppressed />)
      const [term] = Terminal.instances
      expect(term.textarea.readOnly).toBe(true)
      expect(term.focus).not.toHaveBeenCalled()
      act(() => { surface.focus() })
      act(() => { surface.refit(); vi.advanceTimersByTime(50) })
      expect(term.focus).not.toHaveBeenCalled()
    })
  })
})
