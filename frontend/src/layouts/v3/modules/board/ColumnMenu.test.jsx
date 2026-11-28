import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ColumnMenu from './ColumnMenu.jsx'

const TODO = { slug: 'a_fazer', label: 'A fazer', is_done: false }
const DONE = { slug: 'feito', label: 'Feito', is_done: true }

function setup(props = {}) {
  const handlers = { onRename: vi.fn(), onMarkDone: vi.fn(), onDelete: vi.fn() }
  const view = render(<ColumnMenu column={TODO} isLastColumn={false} {...handlers} {...props} />)
  const trigger = screen.getByRole('button', { name: `Mais ações da coluna ${(props.column ?? TODO).label}` })
  return { ...view, ...handlers, trigger, open: () => fireEvent.click(trigger) }
}

const items = () => [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')]

describe('ColumnMenu: the button', () => {
  it('is named after the column and announces a menu that starts closed', () => {
    const { trigger } = setup()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a menu named after the column, on the first item', () => {
    const { trigger, open } = setup()
    open()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu', { name: 'Mais ações da coluna A fazer' })).toBeTruthy()
    expect(document.activeElement).toBe(items()[0])
  })

  it('does not hand its presses to the drag of the header it sits in', () => {
    const onMouseDown = vi.fn()
    const onTouchStart = vi.fn()
    render(
      <header onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
        <ColumnMenu column={TODO} isLastColumn={false} onRename={vi.fn()} onMarkDone={vi.fn()} onDelete={vi.fn()} />
      </header>,
    )
    const trigger = screen.getByRole('button', { name: 'Mais ações da coluna A fazer' })
    fireEvent.mouseDown(trigger)
    fireEvent.touchStart(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseDown(screen.getAllByRole('menuitem')[0])
    fireEvent.touchStart(screen.getAllByRole('menuitem')[0])
    expect(onMouseDown).not.toHaveBeenCalled()
    expect(onTouchStart).not.toHaveBeenCalled()
  })
})

describe('ColumnMenu: the items', () => {
  it('offers rename, mark as done (a radio) and delete', () => {
    const { open } = setup()
    open()
    expect(screen.getByRole('menuitem', { name: 'Renomear coluna' })).toBeTruthy()
    const radio = screen.getByRole('menuitemradio', { name: 'Marcar como concluída' })
    expect(radio.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitem', { name: 'Excluir coluna' }).getAttribute('aria-disabled')).toBeNull()
  })

  it.each([
    ['Renomear coluna', 'onRename', 'menuitem'],
    ['Marcar como concluída', 'onMarkDone', 'menuitemradio'],
    ['Excluir coluna', 'onDelete', 'menuitem'],
  ])('"%s" closes the menu and does its job', (name, handler, role) => {
    const view = setup()
    view.open()
    fireEvent.click(screen.getByRole(role, { name }))
    expect(view[handler]).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('on the done column the radio is a line that says so, checked and not actionable', () => {
    const view = setup({ column: DONE })
    view.open()
    const line = screen.getByRole('menuitemradio', { name: 'Esta é a coluna de concluídos' })
    expect(line.getAttribute('aria-checked')).toBe('true')
    expect(line.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(line)
    expect(view.onMarkDone).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it.each([
    ['the done column', { column: DONE, isLastColumn: false }, 'Não dá para excluir a coluna de concluídos.'],
    ['the last column', { column: TODO, isLastColumn: true }, 'O board precisa de ao menos uma coluna.'],
    ['a last column that is also the done one (the done reason wins)', { column: DONE, isLastColumn: true }, 'Não dá para excluir a coluna de concluídos.'],
  ])('delete is unavailable on %s, still reachable, with the reason', (_label, props, reason) => {
    const view = setup(props)
    view.open()
    const remove = screen.getByRole('menuitem', { name: 'Excluir coluna' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(remove.getAttribute('aria-describedby')).textContent).toBe(reason)
    remove.focus()
    expect(document.activeElement).toBe(remove)
    fireEvent.click(remove)
    expect(view.onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('shows the delete item as the dangerous one', () => {
    const { open } = setup()
    open()
    expect(screen.getByRole('menuitem', { name: 'Excluir coluna' }).className).toContain('v3-board-menu__item--danger')
  })
})

describe('ColumnMenu: the keyboard', () => {
  it('arrows walk the items and wrap, Home and End jump, unavailable items included', () => {
    const { open } = setup({ column: DONE })
    open()
    const [rename, done, remove] = items()
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(done)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(remove)
  })

  it('Escape closes, gives the focus back to the button and goes no further', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ColumnMenu column={TODO} isLastColumn={false} onRename={vi.fn()} onMarkDone={vi.fn()} onDelete={vi.fn()} />
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'Mais ações da coluna A fazer' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(outer).not.toHaveBeenCalled()
  })

  it('Tab closes it and lets the focus move on', () => {
    const { open } = setup()
    open()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a press outside closes it, even one that another control stops from bubbling', () => {
    const { open } = setup()
    const elsewhere = document.createElement('button')
    elsewhere.addEventListener('mousedown', (event) => event.stopPropagation())
    document.body.appendChild(elsewhere)
    open()
    fireEvent.mouseDown(elsewhere)
    expect(screen.queryByRole('menu')).toBeNull()
    elsewhere.remove()
  })

  it('a press inside does not close it', () => {
    const { open } = setup()
    open()
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('the button toggles it', () => {
    const { open, trigger } = setup()
    open()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
