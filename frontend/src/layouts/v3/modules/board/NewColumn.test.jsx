import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import NewColumn from './NewColumn.jsx'

const failure = (message) => new Error(message)

function setup(props = {}) {
  const onCreate = props.onCreate ?? vi.fn().mockResolvedValue({ slug: 'novo', label: 'Novo' })
  const onCreated = vi.fn()
  render(<NewColumn onCreate={onCreate} onCreated={onCreated} {...props} />)
  return { onCreate, onCreated }
}

const open = () => fireEvent.click(screen.getByRole('button', { name: '+ Nova coluna' }))
const field = () => screen.getByRole('textbox', { name: 'Nome da nova coluna' })

describe('NewColumn', () => {
  it('starts as a button; activating it turns it into a field with the focus', () => {
    setup()
    open()
    expect(screen.queryByRole('button', { name: '+ Nova coluna' })).toBeNull()
    expect(document.activeElement).toBe(field())
    expect(field().getAttribute('placeholder')).toBe('Nome da coluna')
  })

  it('Enter creates the column, tells who asked and goes back to the button', async () => {
    const { onCreate, onCreated } = setup()
    open()
    fireEvent.change(field(), { target: { value: '  Em teste ' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(onCreate).toHaveBeenCalledWith('Em teste')
    expect(onCreated).toHaveBeenCalledWith({ slug: 'novo', label: 'Novo' })
    expect(screen.getByRole('button', { name: '+ Nova coluna' })).toBeTruthy()
  })

  it('Escape cancels, with no request, and the focus goes back to the button', () => {
    const { onCreate } = setup()
    open()
    fireEvent.change(field(), { target: { value: 'Rascunho' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    const button = screen.getByRole('button', { name: '+ Nova coluna' })
    expect(document.activeElement).toBe(button)
    expect(onCreate).not.toHaveBeenCalled()
    open()
    expect(field().value).toBe('')
  })

  it('an empty name is dropped on Enter and goes back to the button, with no request', async () => {
    const { onCreate } = setup()
    open()
    fireEvent.change(field(), { target: { value: '   ' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '+ Nova coluna' })).toBeTruthy()
  })

  it('shows busy and disables the field while it creates', async () => {
    let settle
    setup({ onCreate: vi.fn().mockReturnValue(new Promise((done) => { settle = done })) })
    open()
    fireEvent.change(field(), { target: { value: 'Nova' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(field().getAttribute('aria-busy')).toBe('true')
    expect(field().disabled).toBe(true)
    await act(async () => { settle({ slug: 'nova' }) })
  })

  it('a refusal of the server stays under the field, which keeps what was typed', async () => {
    const { onCreated } = setup({ onCreate: vi.fn().mockRejectedValue(failure('Já existe uma coluna com esse nome.')) })
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Já existe uma coluna com esse nome.')
    expect(field().value).toBe('Feito')
    expect(field().disabled).toBe(false)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(field().getAttribute('aria-describedby')).toContain(alert.id)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('a message nobody can read becomes a sentence, and typing again clears it', async () => {
    setup({ onCreate: vi.fn().mockRejectedValue(failure('[object Object]')) })
    open()
    fireEvent.change(field(), { target: { value: 'Nova' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui criar a coluna. Tente de novo.')
    fireEvent.change(field(), { target: { value: 'Nova 2' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaving the field empty closes it; leaving it with a name creates the column, as the V2 does', async () => {
    const { onCreate } = setup()
    open()
    fireEvent.blur(field())
    expect(screen.getByRole('button', { name: '+ Nova coluna' })).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
    open()
    fireEvent.change(field(), { target: { value: 'Rascunho' } })
    await act(async () => { fireEvent.blur(field()) })
    expect(onCreate).toHaveBeenCalledWith('Rascunho')
  })

  it('on a board with no column it is the primary button "Criar a primeira coluna" and creates the same way', async () => {
    const onCreate = vi.fn().mockResolvedValue({ slug: 'a', label: 'A' })
    render(<NewColumn first onCreate={onCreate} onCreated={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Criar a primeira coluna' })
    expect(button.className).toContain('v3-button--primary')
    expect(screen.queryByRole('button', { name: '+ Nova coluna' })).toBeNull()
    fireEvent.click(button)
    fireEvent.change(field(), { target: { value: 'A fazer' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(onCreate).toHaveBeenCalledWith('A fazer')
  })
})

// A refusal that arrives LATER (a real request): a synchronous rejection is batched into the same
// act as the keystroke and hides what happens to the focus and to the next blur.
describe('NewColumn: leaving the field after a refusal', () => {
  const REFUSED = 'Já existe uma coluna com esse nome.'

  function deferred() {
    let settle
    let fail
    const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject })
    return { promise, settle, fail }
  }

  function withOutside(onCreate) {
    const onCreated = vi.fn()
    render(
      <>
        <button type="button">Outside</button>
        <NewColumn onCreate={onCreate} onCreated={onCreated} />
        <button type="button" aria-haspopup="menu">Menu</button>
      </>,
    )
    return { onCreated, outside: screen.getByRole('button', { name: 'Outside' }), menu: screen.getByRole('button', { name: 'Menu' }) }
  }

  it('after an Enter that is refused later, leaving for another control keeps the focus there and sends nothing more', async () => {
    const pending = deferred()
    const onCreate = vi.fn().mockReturnValue(pending.promise)
    const { outside } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await act(async () => { pending.fail(failure(REFUSED)) })
    expect(document.activeElement).toBe(field())
    expect(screen.getByRole('alert').textContent).toContain(REFUSED)

    // Tab, or a click, to another control: the refused name is not sent again, and the error stays.
    await act(async () => { outside.focus() })
    await act(async () => { await Promise.resolve() })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(outside)
    expect(screen.getByRole('alert').textContent).toContain(REFUSED)
    expect(field().value).toBe('Feito')
  })

  it('leaving and coming back again and again never sends the refused name nor takes the focus', async () => {
    const onCreate = vi.fn().mockImplementation(() => new Promise((_, reject) => { setTimeout(() => reject(failure(REFUSED)), 5) }))
    const { outside, menu } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await act(async () => { await new Promise((done) => setTimeout(done, 20)) })
    for (const target of [outside, menu, outside]) {
      await act(async () => { field().focus() })
      await act(async () => { target.focus() })
      await act(async () => { await new Promise((done) => setTimeout(done, 20)) })
      expect(document.activeElement).toBe(target)
    }
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('Enter on the refused name sends it again: only the blur is quiet', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(failure(REFUSED)).mockResolvedValue({ slug: 'feito_2', label: 'Feito' })
    const { onCreated } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('a new text brings the blur back: leaving with another name creates it', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(failure(REFUSED)).mockResolvedValue({ slug: 'novo', label: 'Novo' })
    const { onCreated, outside } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    fireEvent.change(field(), { target: { value: 'Novo' } })
    await act(async () => { outside.focus() })
    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onCreate).toHaveBeenLastCalledWith('Novo')
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('a refusal that comes after the blur (the one that sent it) leaves the focus where the person went', async () => {
    const pending = deferred()
    const onCreate = vi.fn().mockReturnValue(pending.promise)
    const { menu } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    await act(async () => { menu.focus() })
    expect(onCreate).toHaveBeenCalledTimes(1)
    // The person has already gone to the menu button; the focus is theirs, the error is only shown.
    await act(async () => { pending.fail(failure(REFUSED)) })
    expect(document.activeElement).toBe(menu)
    expect(screen.getByRole('alert').textContent).toContain(REFUSED)
    expect(field().value).toBe('Feito')
  })

  it('a menu item that holds the focus when the refusal arrives keeps it', async () => {
    const pending = deferred()
    const onCreate = vi.fn().mockReturnValue(pending.promise)
    const onCreated = vi.fn()
    render(
      <>
        <NewColumn onCreate={onCreate} onCreated={onCreated} />
        <div role="menu"><button type="button" role="menuitem">Renomear coluna</button></div>
      </>,
    )
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    const item = screen.getByRole('menuitem', { name: 'Renomear coluna' })
    await act(async () => { item.focus() })
    await act(async () => { pending.fail(failure(REFUSED)) })
    expect(document.activeElement).toBe(item)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('a refusal with the focus on nothing (the field was disabled under it) still gives it back to the field', async () => {
    const pending = deferred()
    withOutside(vi.fn().mockReturnValue(pending.promise))
    open()
    fireEvent.change(field(), { target: { value: 'Feito' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    // The focus ends up on nothing (a browser drops it from a field that becomes disabled; here the
    // element that held it goes away).
    const stray = document.body.appendChild(document.createElement('button'))
    act(() => { stray.focus() })
    stray.remove()
    expect(document.activeElement).toBe(document.body)
    await act(async () => { pending.fail(failure(REFUSED)) })
    expect(document.activeElement).toBe(field())
  })

  it('Enter twice and a blur while the request is out send only one', async () => {
    const pending = deferred()
    const onCreate = vi.fn().mockReturnValue(pending.promise)
    const { onCreated, outside } = withOutside(onCreate)
    open()
    fireEvent.change(field(), { target: { value: 'Nova' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await act(async () => { outside.focus() })
    fireEvent.blur(field())
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => { pending.settle({ slug: 'nova', label: 'Nova' }) })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})

