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

describe('TerminalView info strip (Designer 11.1, verbatim)', () => {
  it('codex, agy and the plain terminal: the "Visão de terminal" strip, with no "Abrir no chat"', () => {
    renderView({ kind: 'shell' })
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('Visão de terminal.')
    expect(note.textContent).toContain('O Codex roda em terminal e não tem conversa em bolhas, cartões nem comandos / do chat.')
    expect(screen.queryByRole('button', { name: 'Abrir no chat' })).toBeNull()
  })

  it('a Claude conversation sent to the terminal: its own sentence and the "Abrir no chat" button', () => {
    const { onOpenChat } = renderView({ kind: 'claude', agentName: 'Claude' })
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('Esta conversa está no terminal. O chat fica fechado enquanto o terminal estiver aberto.')
    expect(note.textContent).not.toContain('Visão de terminal.')
    fireEvent.click(within(note).getByRole('button', { name: 'Abrir no chat' }))
    expect(onOpenChat).toHaveBeenCalledTimes(1)
  })

  it('"Sair do terminal" is a tab stop BEFORE the frame, tells the shortcut and calls onExit', () => {
    const { onExit } = renderView()
    const exit = screen.getByRole('button', { name: 'Sair do terminal' })
    const frame = screen.getByRole('group', { name: 'Terminal de Codex' })
    expect(exit.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(exit.getAttribute('title')).toBe('F6 sai do terminal')
    expect(exit.getAttribute('aria-keyshortcuts')).toBe('F6')
    expect(exit.tabIndex).toBe(0)
    fireEvent.click(exit)
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalView keyboard way out (F6)', () => {
  it('F6 typed in the terminal puts the focus on "Sair do terminal"; Shift+F6 too', () => {
    renderView()
    openSocket()
    const exit = screen.getByRole('button', { name: 'Sair do terminal' })
    const handler = Terminal.instances[0].keyHandler
    expect(document.activeElement).not.toBe(exit)
    act(() => { handler({ type: 'keydown', key: 'F6', preventDefault() {} }) })
    expect(document.activeElement).toBe(exit)
    exit.blur()
    act(() => { handler({ type: 'keydown', key: 'F6', shiftKey: true, preventDefault() {} }) })
    expect(document.activeElement).toBe(exit)
  })

  it('the way out stays reachable on a low screen (the sentence is clipped, the buttons are not removed)', () => {
    renderView({ kind: 'claude', agentName: 'Claude' })
    const note = screen.getByRole('note')
    expect(note.className).toContain('v3-term__strip--info')
    expect(within(note).getByRole('button', { name: 'Sair do terminal' })).toBeTruthy()
    expect(within(note).getByRole('button', { name: 'Abrir no chat' })).toBeTruthy()
  })
})

describe('TerminalView strip for an agent called "terminal"', () => {
  it('does not repeat the word: "O terminal não tem conversa..."', () => {
    renderView({ agentName: 'terminal' })
    const note = screen.getByRole('note').textContent
    expect(note).toContain('O terminal não tem conversa em bolhas, cartões nem comandos / do chat.')
    expect(note).not.toContain('roda em terminal')
  })
})

describe('TerminalView bar on a failure', () => {
  it('the bar says "Não abriu" (never "Conectado") while the failure strip is up', () => {
    renderView()
    serverSends(openSocket(), { type: 'spawn_failed', detail: 'x' })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(document.querySelector('.v3-term__status').textContent).toBe('Não abriu')
  })

  it('"Tentar de novo" gives the bar its honest state back (a fresh attempt is connecting)', () => {
    renderView()
    serverSends(openSocket(), { type: 'resume_failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(document.querySelector('.v3-term__status').textContent).toBe('Conectando ao terminal…')
  })
})

describe('TerminalView states', () => {
  it('a missing agent: the danger strip says so; "Tentar de novo" remounts the terminal; a fresh connection clears it', () => {
    renderView()
    const first = openSocket()
    serverSends(first, { type: 'spawn_failed', detail: 'codex: command not found' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('O Codex não está instalado neste computador.')
    expect(alert.textContent).toContain('codex: command not found')

    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    expect(Terminal.instances).toHaveLength(2)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(first.close).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()

    // the second attempt fails the same way, then a good connection clears the old failure
    const second = openSocket()
    serverSends(second, { type: 'spawn_failed', detail: 'x' })
    expect(screen.getByRole('alert')).toBeTruthy()
    act(() => { second.onclose({ code: 1006 }) })
    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(1000) })
    const third = FakeWebSocket.instances.at(-1)
    third.readyState = 1
    act(() => { third.onopen() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a resume that failed is the generic "Não foi possível abrir o terminal." with a retry', () => {
    renderView({ kind: 'claude', agentName: 'Claude' })
    serverSends(openSocket(), { type: 'resume_failed' })
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir o terminal.')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('a session opened elsewhere (1008): "Sessão encerrada." and "Reabrir", which takes it back by a clean attach', () => {
    renderView()
    const ws = openSocket()
    act(() => { ws.onclose({ code: 1008 }) })
    const state = document.getElementById('terminal-state')
    expect(state.textContent).toContain('Sessão encerrada.')
    expect(state.textContent).toContain('Ela foi aberta em outra aba ou dispositivo.')
    fireEvent.click(within(state).getByRole('button', { name: 'Reabrir' }))
    expect(Terminal.instances).toHaveLength(2)
    expect(document.getElementById('terminal-state')).toBeNull()
  })

  it('shows no state strip while it is just connecting or connected', () => {
    renderView()
    expect(document.getElementById('terminal-state')).toBeNull()
    openSocket()
    expect(document.getElementById('terminal-state')).toBeNull()
  })
})

describe('TerminalView key bar (phone only)', () => {
  it('is absent on desktop and tablet', () => {
    renderView({ phone: false })
    expect(screen.queryByRole('toolbar', { name: 'Teclas do terminal' })).toBeNull()
  })

  it('has the six keys, each 44 px by CSS contract, labelled in full and safe to tap', () => {
    renderView({ phone: true })
    const bar = screen.getByRole('toolbar', { name: 'Teclas do terminal' })
    const keys = within(bar).getAllByRole('button')
    expect(keys.map((key) => key.getAttribute('aria-label'))).toEqual([
      'Esc', 'Tab', 'Ctrl, vale para a próxima tecla', 'Seta para cima', 'Seta para baixo', 'Ctrl+C',
    ])
    for (const key of keys) expect(key.getAttribute('data-terminal-safe-tap')).toBe('true')
  })

  it('each key sends its bytes to the PTY through sendControlByte', () => {
    renderView({ phone: true })
    const ws = openSocket()
    ws.sent.length = 0
    const press = (name) => fireEvent.click(screen.getByRole('button', { name }))
    press('Esc')
    press('Tab')
    press('Seta para cima')
    press('Seta para baixo')
    press('Ctrl+C')
    expect(ws.sent.map((bytes) => Array.from(bytes))).toEqual([
      [0x1b],
      [0x09],
      Array.from(new TextEncoder().encode('\x1b[A')),
      Array.from(new TextEncoder().encode('\x1b[B')),
      [0x03],
    ])
  })

  it('a press keeps the terminal focused (mousedown is cancelled), so the soft keyboard stays open', () => {
    renderView({ phone: true })
    const key = screen.getByRole('button', { name: 'Esc' })
    expect(fireEvent.mouseDown(key)).toBe(false)
  })

  it('"Ctrl" is a sticky modifier: pressed it is armed (aria-pressed), the next terminal key becomes a control byte and it releases', () => {
    renderView({ phone: true })
    const ws = openSocket()
    ws.sent.length = 0
    const ctrl = screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' })
    expect(ctrl.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(ctrl)
    expect(ctrl.getAttribute('aria-pressed')).toBe('true')
    expect(ws.sent).toHaveLength(0) // the modifier alone sends nothing

    act(() => { Terminal.instances[0].keyHandler({ type: 'keydown', key: 'c' }) })
    expect(Array.from(ws.sent[0])).toEqual([0x03])
    expect(ctrl.getAttribute('aria-pressed')).toBe('false')
  })

  it('pressing "Ctrl" again disarms it', () => {
    renderView({ phone: true })
    const ws = openSocket()
    ws.sent.length = 0
    const ctrl = screen.getByRole('button', { name: 'Ctrl, vale para a próxima tecla' })
    fireEvent.click(ctrl)
    fireEvent.click(ctrl)
    expect(ctrl.getAttribute('aria-pressed')).toBe('false')
    expect(Terminal.instances[0].keyHandler({ type: 'keydown', key: 'c' })).toBe(true)
    expect(ws.sent).toHaveLength(0)
  })
})
