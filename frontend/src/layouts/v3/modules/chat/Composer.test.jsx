import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useState } from 'react'
import Composer from './Composer.jsx'
import { selectableCommands } from './slashCommands.js'

afterEach(cleanup)

const RAW = [
  { name: 'compact', description: 'Resumir a conversa', argument_hint: '', source: 'builtin', handling: 'dispatch' },
  { name: 'model', description: 'Trocar o modelo da conversa', argument_hint: '', source: 'builtin', handling: 'ui' },
  { name: 'orquestrador-status', description: 'Mostra o pipeline', argument_hint: '[fase]', source: 'project', handling: 'dispatch' },
  { name: 'deploy', description: 'Publicar', argument_hint: '', source: 'user', handling: 'dispatch' },
  { name: 'login', description: '', argument_hint: '', source: 'builtin', handling: 'hidden' },
]
const READY = { status: 'ready', items: selectableCommands(RAW) }

function Harness({ initial = '', commands = READY, ...props }) {
  const [value, setValue] = useState(initial)
  return <Composer value={value} onChange={setValue} commands={commands} {...props} />
}
const box = () => screen.getByRole('combobox', { name: 'Mensagem para o agente' })
const type = (text) => fireEvent.change(box(), { target: { value: text } })

describe('Composer', () => {
  it('is a combobox with the Designer placeholder and a hints line', () => {
    render(<Harness />)
    expect(box().getAttribute('aria-autocomplete')).toBe('list')
    expect(box().getAttribute('aria-expanded')).toBe('false')
    expect(box().getAttribute('placeholder')).toBe('Mensagem para o agente, ou / para comandos')
    expect(screen.getByText(/comandos ·/).textContent).toContain('Esc')
  })

  it('Enter sends, Shift+Enter does not, an IME composition does not', () => {
    const onSend = vi.fn()
    render(<Harness initial="oi" onSend={onSend} />)
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('an empty draft cannot be sent; the button says so', () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    const send = screen.getByRole('button', { name: 'Enviar mensagem' })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(send)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('while a turn runs Enter does not send and the button is Interromper', () => {
    const onSend = vi.fn()
    const onInterrupt = vi.fn()
    render(<Harness initial="oi" running onSend={onSend} onInterrupt={onInterrupt} />)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Interromper turno' }))
    expect(onInterrupt).toHaveBeenCalled()
    expect(screen.getByText('Aguardando a resposta. Esc interrompe.')).toBeTruthy()
  })

  it('a refused chat is readonly with the explanatory placeholder, and "/" opens no menu', () => {
    render(<Harness initial="/" disabled describedBy="banner" />)
    expect(box().readOnly).toBe(true)
    expect(box().getAttribute('aria-disabled')).toBe('true')
    expect(box().getAttribute('aria-describedby')).toBe('banner')
    expect(box().getAttribute('placeholder')).toBe('Chat indisponível. Veja o aviso acima.')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('Rascunho guardado. O envio volta quando reconectar.')).toBeTruthy()
  })
})

describe('Composer "/" menu', () => {
  it('opens on "/" at the start, asks the screen for the commands and groups them with origin seals', () => {
    const onCommandsWanted = vi.fn()
    render(<Harness onCommandsWanted={onCommandsWanted} />)
    expect(onCommandsWanted).not.toHaveBeenCalled()
    type('/')
    expect(onCommandsWanted).toHaveBeenCalled()
    expect(box().getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: 'Comandos' })
    expect(box().getAttribute('aria-controls')).toBe(list.id)
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Do projeto', 'Seus comandos', 'Internos do chat'])
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.querySelector('.v3-chat-slash__name').textContent)).toEqual(['/orquestrador-status', '/deploy', '/compact', '/model'])
    expect(options.map((option) => option.querySelector('.v3-chip').textContent)).toEqual(['projeto', 'usuário', 'interno', 'interno'])
    expect(screen.queryByText('/login')).toBeNull() // hidden
    expect(screen.queryByText('Gerenciar comandos', { exact: false })).toBeNull()
    expect(document.activeElement === box() || document.activeElement === document.body).toBe(true)
  })

  it('does not open for a slash in the middle of the text or after a space', () => {
    render(<Harness />)
    type('veja /deploy')
    expect(box().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    type('/deploy arg')
    expect(box().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('typing filters into one flat list by relevance and the "ui" command shows it opens a card', () => {
    render(<Harness />)
    type('/mod')
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('abre um cartão')
  })

  it('"/orq" finds the project command by name', () => {
    render(<Harness />)
    type('/orq')
    expect(screen.getByRole('option').textContent).toContain('/orquestrador-status')
    expect(screen.getByRole('option').textContent).toContain('[fase]')
  })

  it('no match says so; an error says the text can still be sent; loading says loading', () => {
    const { unmount } = render(<Harness />)
    type('/zzz')
    expect(screen.getByText('Nenhum comando encontrado para “/zzz”.')).toBeTruthy()
    unmount()
    render(<Harness initial="/" commands={{ status: 'error', items: [] }} />)
    expect(screen.getByText('Não foi possível carregar os comandos. Você ainda pode enviar a mensagem como texto.')).toBeTruthy()
    cleanup()
    render(<Harness initial="/" commands={{ status: 'loading', items: [] }} />)
    expect(screen.getByText('Carregando comandos…')).toBeTruthy()
  })

  it('arrows walk with wrap and aria-activedescendant follows; the focus stays in the textarea', () => {
    render(<Harness initial="/" />)
    box().focus()
    expect(box().getAttribute('aria-activedescendant')).toBe('chat-slash-opt-0')
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    expect(box().getAttribute('aria-activedescendant')).toBe('chat-slash-opt-3')
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(box().getAttribute('aria-activedescendant')).toBe('chat-slash-opt-0')
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(box())
  })

  it('Enter picks the row (it does not send) and writes "/name " with the argument hint', () => {
    const onSend = vi.fn()
    render(<Harness initial="/orq" onSend={onSend} />)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('/orquestrador-status ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('[fase]')).toBeTruthy()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Tab picks too', () => {
    render(<Harness initial="/dep" />)
    fireEvent.keyDown(box(), { key: 'Tab' })
    expect(box().value).toBe('/deploy ')
  })

  it('a click on a row picks it', () => {
    render(<Harness initial="/" />)
    fireEvent.click(screen.getByRole('option', { name: /\/deploy/ }))
    expect(box().value).toBe('/deploy ')
  })

  it('Esc closes the menu keeping the text and is consumed (the screen must not read it as "interrupt")', () => {
    render(<Harness initial="/mo" />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { box().dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box().value).toBe('/mo')
    // typing again reopens it
    type('/mod')
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('Esc with no menu is left alone', () => {
    render(<Harness initial="oi" />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    box().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('a "ui" command picked from the menu opens its card and is never sent or kept as text', () => {
    const onUiCommand = vi.fn()
    const onSend = vi.fn()
    render(<Harness initial="/model" onUiCommand={onUiCommand} onSend={onSend} />)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onUiCommand).toHaveBeenCalledWith('model')
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('')
  })

  it('a typed "/model" that skipped the menu (Esc) still opens the card on Enter instead of being sent', () => {
    const onUiCommand = vi.fn()
    const onSend = vi.fn()
    render(<Harness initial="/model" onUiCommand={onUiCommand} onSend={onSend} />)
    fireEvent.keyDown(box(), { key: 'Escape' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onUiCommand).toHaveBeenCalledWith('model')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('with no rows to pick, Enter sends the text as it is', () => {
    const onSend = vi.fn()
    render(<Harness initial="/zzz" onSend={onSend} />)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('the descriptions and hints of a command are text, never markup', () => {
    const evil = selectableCommands([{ name: 'x', description: '<img src=x onerror="window.__pwned=1">', argument_hint: '<b>a</b>', source: 'project', handling: 'dispatch' }])
    const { container } = render(<Harness initial="/" commands={{ status: 'ready', items: evil }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.v3-chat-slash b')).toBeNull()
    expect(screen.getByText('<img src=x onerror="window.__pwned=1">')).toBeTruthy()
  })
})
