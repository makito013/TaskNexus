import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Terminal } from '@xterm/xterm'
import TerminalFrame, { controlByteFor } from './TerminalFrame.jsx'

// xterm doubles: they record the ORDER of open() and fit() (the fonts gate is about that order), keep the
// handlers the frame registers and expose a mutable `options` so a live theme update is observable.
const order = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = []
    constructor(options) {
      this.options = { ...options }
      // Every assignment of `options.theme` AFTER the constructor is a repaint of the live terminal.
      let theme = options.theme
      this.themeWrites = []
      Object.defineProperty(this.options, 'theme', {
        enumerable: true,
        get: () => theme,
        set: (next) => { theme = next; this.themeWrites.push(next) },
      })
      this.cols = 100
      this.rows = 30
      this.textarea = document.createElement('textarea')
      this.write = vi.fn()
      this.dispose = vi.fn()
      this.focus = vi.fn()
      this.constructor.instances.push(this)
    }
    loadAddon() {}
    open(element) {
      order.push('open')
      if (element) element.appendChild(this.textarea)
    }
    onData() { return { dispose() {} } }
    onResize(handler) { this.resizeHandler = handler; return { dispose() {} } }
    attachCustomKeyEventHandler(handler) { this.keyHandler = handler }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { order.push('fit') } } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

class FakeWebSocket {
  static instances = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.close = vi.fn(() => { this.readyState = 3 })
    FakeWebSocket.instances.push(this)
  }
  send(data) { this.sent.push(data) }
}

const KEY = 'Pessoal/tn-sandbox::codex::ab12cd'
const root = document.documentElement
const TOKENS = {
  light: { '--v3-island': '#14171a', '--v3-island-ink': '#ffffff', '--v3-island-surface': '#22272e' },
  dark: { '--v3-island': '#050608', '--v3-island-ink': '#f1f1f1', '--v3-island-surface': '#101216' },
}
const setTokens = (tokens) => Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value))

let originalFonts
let originalResizeObserver
let originalWebSocket
function stubFonts(ready) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready, load: vi.fn(() => Promise.resolve([])) } })
}

beforeEach(() => {
  order.length = 0
  Terminal.instances = []
  FakeWebSocket.instances = []
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  originalWebSocket = global.WebSocket
  originalResizeObserver = global.ResizeObserver
  global.WebSocket = FakeWebSocket
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  setTokens(TOKENS.light)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  global.WebSocket = originalWebSocket
  global.ResizeObserver = originalResizeObserver
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else delete document.fonts
  for (const name of Object.keys(TOKENS.light)) root.style.removeProperty(name)
  root.removeAttribute('data-theme')
})

const renderFrame = (props = {}) => {
  const ref = createRef()
  const view = render(<TerminalFrame ref={ref} sessionKey={KEY} agentName="Codex" folderLabel="tn-sandbox" {...props} />)
  return { ref, ...view }
}
const openSocket = () => {
  const ws = FakeWebSocket.instances.at(-1)
  ws.readyState = 1
  act(() => { ws.onopen() })
  return ws
}

describe('TerminalFrame theme', () => {
  it('the xterm is built with the theme of the island tokens and the resolved mono font at 13 px', () => {
    renderFrame()
    const term = Terminal.instances[0]
    expect(term.options.theme.background).toBe('#14171a')
    expect(term.options.theme.foreground).toBe('#ffffff')
    expect(term.options.theme.cursor).toBe('#ffffff')
    expect(term.options.theme.selectionBackground).toBe('#22272e')
    expect(term.options.fontSize).toBe(13)
    expect(term.options.fontFamily).not.toContain('var(')
  })

  it('does not repaint the live terminal while the theme did not change (a status change re-renders the frame)', () => {
    vi.useFakeTimers()
    renderFrame()
    const ws = openSocket()
    act(() => { ws.onclose({ code: 1006 }) }) // reconnecting: the frame re-renders
    act(() => { vi.advanceTimersByTime(1000) })
    openSocket()
    expect(Terminal.instances[0].themeWrites).toEqual([])
  })

  it('repaints the SAME terminal when the theme switches, without a new terminal or socket', async () => {
    renderFrame()
    openSocket()
    expect(Terminal.instances).toHaveLength(1)
    setTokens(TOKENS.dark)
    await act(async () => {
      root.setAttribute('data-theme', 'dark')
      await Promise.resolve()
    })
    expect(Terminal.instances).toHaveLength(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(Terminal.instances[0].options.theme.background).toBe('#050608')
    expect(Terminal.instances[0].options.theme.foreground).toBe('#f1f1f1')
    expect(Terminal.instances[0].themeWrites).toHaveLength(1)
  })
})

describe('TerminalFrame fonts gate (fit() only after fonts.ready)', () => {
  it('does not build the terminal, fit or connect before the fonts are ready, and says it is connecting', async () => {
    let release
    stubFonts(new Promise((resolve) => { release = resolve }))
    renderFrame()
    expect(Terminal.instances).toHaveLength(0)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(order).toEqual([])
    expect(screen.getByRole('group', { name: 'Terminal de Codex' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Conectando ao terminal…')

    await act(async () => { release() })
    expect(Terminal.instances).toHaveLength(1)
    // open() comes first and every fit() after it, all of them after the fonts were ready.
    expect(order[0]).toBe('open')
    expect(order).toContain('fit')
  })

  it('a browser where fonts.ready never resolves is not blocked (bounded wait)', async () => {
    vi.useFakeTimers()
    stubFonts(new Promise(() => {}))
    renderFrame()
    expect(Terminal.instances).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(Terminal.instances).toHaveLength(1)
  })

  it('without the Font Loading API there is nothing to wait for', () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined })
    renderFrame()
    expect(Terminal.instances).toHaveLength(1)
  })

  it('asks for the mono face the terminal measures with (fonts.load) before building it', async () => {
    const ready = Promise.resolve()
    stubFonts(ready)
    renderFrame()
    await act(async () => { await ready })
    expect(document.fonts.load).toHaveBeenCalledTimes(1)
    expect(document.fonts.load.mock.calls[0][0]).toMatch(/^13px /)
  })
})

describe('TerminalFrame connection and bar', () => {
  it('opens /ws/pty/<key> exactly like the V2 (the key is not encoded) and sends the init frame', () => {
    renderFrame()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe(`ws://${window.location.host}/ws/pty/${KEY}`)
    const ws = openSocket()
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'init', project_id: 'Pessoal/tn-sandbox', agent_id: 'codex', cols: 100, rows: 30 })
  })

  it('the 40 px bar shows the status, "agent · project" and cols×rows, and follows a resize', () => {
    renderFrame()
    expect(screen.getByRole('status').textContent).toBe('Conectando ao terminal…')
    expect(document.querySelector('.v3-term__name').textContent).toBe('Codex · tn-sandbox')
    expect(document.querySelector('.v3-term__size').textContent).toBe('100×30')
    act(() => { Terminal.instances[0].resizeHandler({ cols: 120, rows: 40 }) })
    expect(document.querySelector('.v3-term__size').textContent).toBe('120×40')
  })

  it('says connected when the socket opens, and "Reconectando…" with the fin dot when it drops', () => {
    vi.useFakeTimers()
    const onStatusChange = vi.fn()
    renderFrame({ onStatusChange })
    const ws = openSocket()
    expect(screen.getByRole('status').textContent).toBe('Conectado')
    expect(document.querySelector('.v3-term__dot').className).toContain('v3-term__dot--open')
    expect(screen.getByRole('group', { name: 'Terminal de Codex' }).getAttribute('aria-busy')).toBeNull()
    act(() => { ws.onclose({ code: 1006 }) })
    expect(screen.getByRole('status').textContent).toBe('Reconectando…')
    expect(document.querySelector('.v3-term__dot').className).toContain('v3-term__dot--reconnecting')
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['open', 'reconnecting'])
  })

  it('a socket taken over by another tab (1008) is reported as evicted and does not reconnect', () => {
    vi.useFakeTimers()
    const onStatusChange = vi.fn()
    renderFrame({ onStatusChange })
    const ws = openSocket()
    act(() => { ws.onclose({ code: 1008 }) })
    act(() => { vi.advanceTimersByTime(60000) })
    expect(onStatusChange).toHaveBeenLastCalledWith('evicted')
    expect(screen.getByRole('status').textContent).toBe('Encerrado')
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('hands a backend control frame to the view and never writes it to the terminal', () => {
    const onControlFrame = vi.fn()
    renderFrame({ onControlFrame })
    const ws = openSocket()
    act(() => { ws.onmessage({ data: JSON.stringify({ type: 'spawn_failed', detail: 'no such file' }) }) })
    expect(onControlFrame).toHaveBeenCalledWith({ type: 'spawn_failed', detail: 'no such file' })
    expect(Terminal.instances[0].write).not.toHaveBeenCalled()
  })

  it('closes the socket and disposes the terminal on unmount', () => {
    const { unmount } = renderFrame()
    const ws = FakeWebSocket.instances[0]
    ws.readyState = 1
    unmount()
    expect(ws.close).toHaveBeenCalled()
    expect(Terminal.instances[0].dispose).toHaveBeenCalled()
  })
})

describe('TerminalFrame ref (what the phone key bar uses)', () => {
  it('sendControlByte writes the bytes to the open socket as given', () => {
    const { ref } = renderFrame()
    const ws = openSocket()
    ws.sent.length = 0
    act(() => { ref.current.sendControlByte(new Uint8Array([0x1b])) })
    expect(ws.sent).toHaveLength(1)
    expect(Array.from(ws.sent[0])).toEqual([0x1b])
    act(() => { ref.current.sendControlByte('\t') })
    expect(Array.from(ws.sent[1])).toEqual([0x09])
  })

  it('an armed Ctrl turns the next letter typed in the terminal into its control byte and disarms', () => {
    const onCtrlConsumed = vi.fn()
    const { ref } = renderFrame({ onCtrlConsumed })
    const ws = openSocket()
    const handler = Terminal.instances[0].keyHandler
    ws.sent.length = 0

    // not armed: the key goes through to xterm
    expect(handler({ type: 'keydown', key: 'd' })).toBe(true)
    expect(ws.sent).toHaveLength(0)

    act(() => { ref.current.setCtrlArmed(true) })
    expect(handler({ type: 'keyup', key: 'd' })).toBe(true) // only keydown counts
    expect(handler({ type: 'keydown', key: 'ArrowUp' })).toBe(true) // no control byte: passes, stays armed
    expect(handler({ type: 'keydown', key: 'd' })).toBe(false) // swallowed by xterm, sent as Ctrl+D
    expect(Array.from(ws.sent[0])).toEqual([0x04])
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
    expect(handler({ type: 'keydown', key: 'd' })).toBe(true) // disarmed
  })
})

describe('TerminalFrame keyboard (Ctrl of the phone bar, F6 way out)', () => {
  const key = (type, name, extra = {}) => ({ type, key: name, preventDefault: vi.fn(), ...extra })

  it('the key that became a control byte is cancelled (preventDefault), so the browser does not type it too', () => {
    const { ref } = renderFrame()
    openSocket()
    const handler = Terminal.instances[0].keyHandler
    act(() => { ref.current.setCtrlArmed(true) })
    const event = key('keydown', 'l')
    expect(handler(event)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('swallows the keypress of the spent key until its keyup, and only that key event', () => {
    const { ref } = renderFrame()
    openSocket()
    const handler = Terminal.instances[0].keyHandler
    act(() => { ref.current.setCtrlArmed(true) })
    handler(key('keydown', 'l'))
    const press = key('keypress', 'l')
    expect(handler(press)).toBe(false)
    expect(press.preventDefault).toHaveBeenCalled()
    expect(handler(key('keyup', 'l'))).toBe(true)
    // the next real typing is not eaten
    expect(handler(key('keypress', 'l'))).toBe(true)
  })

  it('a keypress with no Ctrl spent before it passes through', () => {
    renderFrame()
    openSocket()
    const press = key('keypress', 'a')
    expect(Terminal.instances[0].keyHandler(press)).toBe(true)
    expect(press.preventDefault).not.toHaveBeenCalled()
  })

  it.each([['F6', {}], ['Shift+F6', { shiftKey: true }]])('%s keeps the key from the PTY and asks the view to take the focus out', (_name, extra) => {
    const onLeave = vi.fn()
    renderFrame({ onLeave })
    const ws = openSocket()
    ws.sent.length = 0
    const handler = Terminal.instances[0].keyHandler
    const down = key('keydown', 'F6', extra)
    expect(handler(down)).toBe(false)
    expect(down.preventDefault).toHaveBeenCalled()
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(handler(key('keyup', 'F6', extra))).toBe(false) // the rest of the key never reaches xterm
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(ws.sent).toHaveLength(0)
  })

  it('F6 with Ctrl, Alt or Meta is not the way out (the browser or the OS owns it)', () => {
    const onLeave = vi.fn()
    renderFrame({ onLeave })
    openSocket()
    const handler = Terminal.instances[0].keyHandler
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(handler(key('keydown', 'F6', extra))).toBe(true)
    }
    expect(onLeave).not.toHaveBeenCalled()
  })
})

describe('TerminalFrame bar on a failed attempt', () => {
  it('does not say "Conectado" while the view shows a failure: the socket is open, the program is not', () => {
    const { rerender } = renderFrame()
    openSocket()
    expect(screen.getByRole('status').textContent).toBe('Conectado')
    rerender(<TerminalFrame sessionKey={KEY} agentName="Codex" folderLabel="tn-sandbox" failed />)
    expect(screen.getByRole('status').textContent).toBe('Não abriu')
    expect(document.querySelector('.v3-term__dot').className).toContain('v3-term__dot--failed')
  })
})

describe('controlByteFor', () => {
  it('maps letters and the punctuation of the control range, nothing else', () => {
    expect(controlByteFor('c')).toBe(0x03)
    expect(controlByteFor('C')).toBe(0x03)
    expect(controlByteFor('a')).toBe(0x01)
    expect(controlByteFor('z')).toBe(0x1a)
    expect(controlByteFor('[')).toBe(0x1b)
    expect(controlByteFor(' ')).toBe(0)
    expect(controlByteFor('1')).toBeNull()
    expect(controlByteFor('Enter')).toBeNull()
    expect(controlByteFor(undefined)).toBeNull()
  })
})

describe('TerminalView.css (no transition of size on the frame or its ancestors)', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'TerminalView.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('declares no transition other than border-color and box-shadow', () => {
    const transitions = [...css.matchAll(/transition[a-z-]*\s*:\s*([^;]+);/g)].map((match) => match[1])
    expect(transitions.length).toBeGreaterThan(0)
    for (const value of transitions) expect(value).not.toMatch(/\b(width|height|padding|margin|all|inset|flex)/)
    expect(transitions.join(' ')).toMatch(/border-color/)
  })

  it('on a phone with little visible height the info strip keeps only its buttons (keyboard flag and height query)', () => {
    const height = css.match(/@media \(max-width: 767px\) and \(max-height: (\d+)px\)\s*\{([\s\S]*?)\n\}/)
    expect(height).not.toBeNull()
    expect(Number(height[1])).toBeGreaterThanOrEqual(500)
    expect(height[2]).toMatch(/\.v3-term__strip--info \.v3-chat-banner__body\s*\{[^}]*clip-path/)
    expect(height[2]).toMatch(/\.v3-term__strip--info \.v3-chat-banner__dot\s*\{[^}]*display:\s*none/)
    expect(css).toMatch(/\[data-v3-keyboard="open"\] \.v3-term__strip--info \.v3-chat-banner__body\s*\{[^}]*clip-path/)
    expect(css).toMatch(/\[data-v3-keyboard="open"\] \.v3-term__strip--info \.v3-chat-banner__dot\s*\{[^}]*display:\s*none/)
    // the buttons are never hidden
    expect(css).not.toMatch(/v3-chat-banner__actions[^{]*\{[^}]*display:\s*none/)
    expect(css).not.toMatch(/position:\s*fixed/)
  })

  it('the phone key bar wraps and its keys keep a 44 px floor, with a label that fits (Ctrl+C)', () => {
    expect(css.match(/\.v3-term__keys\s*\{([^}]*)\}/)[1]).toMatch(/flex-wrap:\s*wrap/)
    const keyRule = css.match(/\.v3-term__key\s*\{([^}]*)\}/)[1]
    expect(keyRule).toMatch(/min-width:\s*44px/)
    expect(keyRule).toMatch(/white-space:\s*nowrap/)
    expect(Number(keyRule.match(/font-size:\s*(\d+)px/)[1])).toBeLessThanOrEqual(12)
    expect(css).toMatch(/@media \(max-width: 359px\)\s*\{\s*\.v3-term__key\s*\{\s*font-size:\s*11px/)
  })

  it('puts the padding on the wrapper, never on the xterm surface (FitAddon measures its parent)', () => {
    const surface = css.match(/\.v3-term__surface\s*\{([^}]*)\}/)[1]
    expect(surface).toMatch(/padding:\s*0/)
    expect(css.match(/\.v3-term__body\s*\{([^}]*)\}/)[1]).toMatch(/padding:\s*var\(--v3-space-2\)/)
  })
})
