import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ColumnMenu from './ColumnMenu.jsx'
import DeleteColumnDialog from './DeleteColumnDialog.jsx'
import NewColumn from './NewColumn.jsx'

// QA of F2 (columns and drag). The four tests that pinned defects found live in Chrome (they were
// `it.fails`) are plain tests now that the defects are fixed (D-17).

installDialogElementStub()

beforeEach(() => resetDialogElementStubState())
afterEach(() => cleanup())

const failure = (message, extra = {}) => Object.assign(new Error(message), extra)

describe('F2 QA: new column after a refusal (bug 1)', () => {
  // Chrome moves the focus to <body> when the focused field becomes disabled (the field is
  // disabled while the request is in flight). jsdom does not, so the test blurs it by hand.
  it('keeps the keyboard focus in the field after the server refuses the name', async () => {
    const onCreate = vi.fn(() => new Promise((_resolve, reject) => {
      document.activeElement.blur()
      reject(failure("Já existe uma coluna chamada 'Feito'"))
    }))
    render(<NewColumn onCreate={onCreate} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
    const field = screen.getByRole('textbox', { name: 'Nome da nova coluna' })
    fireEvent.change(field, { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain("Já existe uma coluna chamada 'Feito'")
    expect(document.activeElement).toBe(field)
  })

  it('keeps what was typed and the field open after the refusal', async () => {
    const onCreate = vi.fn().mockRejectedValue(failure("Já existe uma coluna chamada 'Feito'"))
    render(<NewColumn onCreate={onCreate} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
    const field = screen.getByRole('textbox', { name: 'Nome da nova coluna' })
    fireEvent.change(field, { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(field.value).toBe('Feito')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.disabled).toBe(false)
  })
})

describe('F2 QA: delete refused turns into the explanation (bug 2)', () => {
  it('keeps the focus inside the modal dialog once "Excluir" is replaced by "Entendi"', async () => {
    const onDelete = vi.fn().mockRejectedValue(failure('com cards', { reason: 'coluna_com_cards', cards: 3 }))
    render(<DeleteColumnDialog column={{ slug: 'feito', label: 'Feito' }} onDelete={onDelete} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Excluir' })
    confirm.focus()
    await act(async () => { fireEvent.click(confirm) })
    expect(within(dialog).getByRole('button', { name: 'Entendi' })).toBeTruthy()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('explains the refusal by its reason and offers only "Entendi"', async () => {
    const onDelete = vi.fn().mockRejectedValue(failure('texto qualquer', { reason: 'coluna_com_cards', cards: 3 }))
    render(<DeleteColumnDialog column={{ slug: 'feito', label: 'Feito' }} onDelete={onDelete} onClose={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir' })) })
    expect(screen.getByText('A coluna ainda tem cards. Mova ou exclua os cards primeiro.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })
})

describe('F2 QA: "Marcar como concluída" from the column menu (bug 3)', () => {
  it('gives the focus back to the "⋯" button after the item is chosen', () => {
    const column = { slug: 'a_fazer', label: 'A fazer', is_done: false }
    render(<ColumnMenu column={column} isLastColumn={false} onRename={vi.fn()} onMarkDone={vi.fn()} onDelete={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Mais ações da coluna A fazer' })
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitemradio', { name: 'Marcar como concluída' })
    item.focus()
    fireEvent.click(item)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('hands the slug to the board and closes the menu', () => {
    const onMarkDone = vi.fn()
    const column = { slug: 'a_fazer', label: 'A fazer', is_done: false }
    render(<ColumnMenu column={column} isLastColumn={false} onRename={vi.fn()} onMarkDone={onMarkDone} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações da coluna A fazer' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Marcar como concluída' }))
    expect(onMarkDone).toHaveBeenCalledWith('a_fazer')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('F2 QA: the card hint text must not widen the page (bug 4)', () => {
  // `.v3-projects__sr-only` is `position: absolute`. Without a positioned ancestor it is placed in
  // the initial containing block, so it escapes the board scroller's `overflow` and the document
  // grows (html scrollWidth 2930 and scrollHeight 21914 at 1280 with 274 cards, measured in Chrome).
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'Board.css'), 'utf8')
  const blockOf = (selector) => {
    const start = css.indexOf(`\n${selector} {`)
    if (start < 0) return ''
    return css.slice(start, css.indexOf('}', start))
  }

  it('makes the card the containing block of its absolutely positioned hint and select label', () => {
    expect(blockOf('.v3-board-card')).toMatch(/position:\s*relative/)
  })

  it('the stylesheet still declares the card block this test reads', () => {
    expect(blockOf('.v3-board-card')).toContain('border')
  })
})
