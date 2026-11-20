import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import TerminalView from './TerminalView.jsx'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = []
    constructor(options) {
      this.options = { ...options }
      this.cols = 80
      this.rows = 24
      this.textarea = document.createElement('textarea')
      this.write = vi.fn()
      this.dispose = vi.fn()
      this.focus = vi.fn()
      this.constructor.instances.push(this)
    }
    loadAddon() {}
    open(element) { if (element) element.appendChild(this.textarea) }
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
    attachCustomKeyEventHandler(handler) { this.keyHandler = handler }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
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
let originalWebSocket
let originalResizeObserver

beforeEach(() => {
  Terminal.instances = []
  FakeWebSocket.instances = []
  originalWebSocket = global.WebSocket
  originalResizeObserver = global.ResizeObserver
  global.WebSocket = FakeWebSocket
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  global.WebSocket = originalWebSocket
  global.ResizeObserver = originalResizeObserver
})

function renderView(props = {}) {
  const handlers = { onOpenChat: vi.fn(), onExit: vi.fn() }
  const view = render(
    <TerminalView sessionKey={KEY} agentName="Codex" folderLabel="tn-sandbox" {...handlers} {...props} />,
  )
  return { ...handlers, ...view }
}
const currentSocket = () => FakeWebSocket.instances.at(-1)
function openSocket() {
  const ws = currentSocket()
  ws.readyState = 1
  act(() => { ws.onopen() })
  return ws
}
const serverSends = (ws, frame) => act(() => { ws.onmessage({ data: JSON.stringify(frame) }) })

// C6 review (L3): mutants M10 (exact name comparison) and M12 (retry keeps Ctrl armed).
describe('an agent whose name is the plain terminal, in any case or with spaces around it', () => {
  it.each(['Terminal', 'TERMINAL', '  terminal  '])('"%s" reads "O terminal não tem conversa...", never "roda em terminal"', (agentName) => {
    renderView({ agentName })
    const note = screen.getByRole('note').textContent
    expect(note).toContain('O terminal não tem conversa em bolhas, cartões nem comandos / do chat.')
    expect(note).not.toContain('roda em terminal')
  })
})

describe('a retry while Ctrl is armed', () => {
  it('releases it: the key shows released, and the next press arms the NEW surface', () => {
    renderView({ phone: true })
    serverSends(openSocket(), { type: 'resume_failed' })
    const ctrl = screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' })
    fireEvent.click(ctrl)
    expect(ctrl.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' }).getAttribute('aria-pressed')).toBe('false')

    const ws = openSocket()
    ws.sent.length = 0
    expect(Terminal.instances).toHaveLength(2)
    expect(Terminal.instances[1].keyHandler({ type: 'keydown', key: 'c' })).toBe(true) // the new surface is not armed
    expect(ws.sent).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' }))
    expect(screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' }).getAttribute('aria-pressed')).toBe('true')
    act(() => { Terminal.instances[1].keyHandler({ type: 'keydown', key: 'c', preventDefault() {} }) })
    expect(Array.from(ws.sent[0])).toEqual([0x03])
  })
})
