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

// C6 review (L3): mutant M3 (no catch on document.fonts.load).
describe('TerminalFrame fonts gate: a rejected font load', () => {
  it('does not hold the surface back: the terminal is built once fonts.ready is done', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve(), load: vi.fn(() => Promise.reject(new Error('font not found'))) },
    })
    renderFrame()
    await act(async () => {})
    await act(async () => {})
    expect(document.fonts.load).toHaveBeenCalled()
    expect(Terminal.instances).toHaveLength(1)
    expect(order).toContain('fit')
  })
})
