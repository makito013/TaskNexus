import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import ClearFinishedDialog from './ClearFinishedDialog.jsx'
import DeleteCardDialog from './DeleteCardDialog.jsx'
import ImageLightbox from './ImageLightbox.jsx'

installDialogElementStub()

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => cleanup())

describe('DeleteCardDialog', () => {
  const setup = (onDelete = vi.fn().mockResolvedValue({}), extra = {}) => {
    const onClose = vi.fn()
    const view = render(<DeleteCardDialog card={{ id: 7, titulo: 'X' }} subcount={3} onDelete={onDelete} onClose={onClose} {...extra} />)
    return { ...view, onDelete, onClose }
  }

  it('warns about the subtasks with their count, starts on "Cancelar" and has no field in the body', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Apagar o card também apaga as 3 subtarefas.')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(dialog.querySelector('.v3-dialog__body input, .v3-dialog__body select')).toBeNull()
  })

  it('says "1 subtarefa" in the singular', () => {
    setup(undefined, { subcount: 1 })
    expect(screen.getByRole('dialog').textContent).toContain('apaga a 1 subtarefa')
  })

  it('deletes once even when pressed twice, then closes', async () => {
    const gate = deferred()
    const { onDelete, onClose } = setup(vi.fn().mockReturnValue(gate.promise))
    const button = screen.getByRole('button', { name: 'Excluir' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => { gate.resolve({}) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a refusal (async) is told inside, keeps the dialog and the focus, and allows another try', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({})
    const { onClose } = setup(onDelete)
    const button = screen.getByRole('button', { name: 'Excluir' })
    button.focus()
    fireEvent.click(button)
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe('Sem conexão com o servidor. Tente de novo.')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('a card that is already gone is told and only "Fechar" is left', async () => {
    const gone = Object.assign(new Error('x'), { cardGone: true })
    const { onClose } = setup(vi.fn().mockRejectedValue(gone))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe('Este card não existe mais.')
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    const closers = screen.getAllByRole('button', { name: 'Fechar' })
    fireEvent.click(closers[closers.length - 1])
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ClearFinishedDialog', () => {
  const setup = (overrides = {}) => {
    const props = {
      targetLabel: 'tn-sandbox',
      onPreview: vi.fn().mockResolvedValue({ cards: 2, imagens: 1 }),
      onExecute: vi.fn().mockResolvedValue({ cards: 2 }),
      onDone: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    }
    return { ...render(<ClearFinishedDialog {...props} />), ...props }
  }
  const dialog = () => screen.getByRole('dialog')

  it('loading: counts, "Cancelar" has the focus from the first render and the action is unavailable', async () => {
    const gate = deferred()
    setup({ onPreview: vi.fn().mockReturnValue(gate.promise) })
    expect(dialog().textContent).toContain('Contando os cards concluídos…')
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Cancelar' }))
    expect(within(dialog()).getByRole('button', { name: /^Excluir/ }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => { gate.resolve({ cards: 0, imagens: 0 }) })
  })

  it('empty: says there is nothing and offers only "Fechar"', async () => {
    setup({ onPreview: vi.fn().mockResolvedValue({ cards: 0, imagens: 0 }) })
    await screen.findByText('Nenhum card concluído em tn-sandbox.')
    expect(within(dialog()).queryByRole('button', { name: /^Excluir/ })).toBeNull()
    expect(within(dialog()).getAllByRole('button', { name: 'Fechar' }).length).toBeGreaterThan(0)
  })

  it('ready: names the target and the count, never the failed images', async () => {
    setup({ onPreview: vi.fn().mockResolvedValue({ cards: 2, imagens: 1, imagens_com_falha: 5 }) })
    await screen.findByRole('button', { name: 'Excluir 2 cards' })
    expect(dialog().textContent).toContain('2 cards')
    expect(dialog().textContent).toContain('tn-sandbox')
    expect(dialog().textContent).toContain('Isso não pode ser desfeito.')
    expect(dialog().textContent).not.toMatch(/falha/i)
  })

  it('ready, one card: singular', async () => {
    setup({ onPreview: vi.fn().mockResolvedValue({ cards: 1, imagens: 0 }) })
    await screen.findByRole('button', { name: 'Excluir 1 card' })
  })

  it('executing: runs once for a double press, shows the busy state, then reports the count and closes', async () => {
    const gate = deferred()
    const { onExecute, onDone, onClose } = setup({ onExecute: vi.fn().mockReturnValue(gate.promise) })
    const button = await screen.findByRole('button', { name: 'Excluir 2 cards' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.textContent).toBe('Excluindo…')
    expect(within(dialog()).getByRole('button', { name: 'Cancelar' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => { gate.resolve({ cards: 2 }) })
    expect(onDone).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a refused run (async) says so, keeps the focus on the button and "Tentar de novo" runs again', async () => {
    const onExecute = vi.fn().mockRejectedValueOnce(new Error('Falha ao limpar')).mockResolvedValue({ cards: 2 })
    const { onDone } = setup({ onExecute })
    const button = await screen.findByRole('button', { name: 'Excluir 2 cards' })
    button.focus()
    fireEvent.click(button)
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('Não consegui limpar os concluídos. Tente de novo.')
    expect(document.activeElement).toBe(button)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2))
    expect(onExecute).toHaveBeenCalledTimes(2)
  })

  it('a failed preview offers "Tentar de novo", which reads again; a lost connection is told as such', async () => {
    const onPreview = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ cards: 1, imagens: 0 })
    setup({ onPreview })
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('Sem conexão com o servidor. Tente de novo.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByRole('button', { name: 'Excluir 1 card' })
    expect(onPreview).toHaveBeenCalledTimes(2)
  })

  it('does not execute while the preview is still loading', async () => {
    const gate = deferred()
    const { onExecute } = setup({ onPreview: vi.fn().mockReturnValue(gate.promise) })
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Excluir/ }))
    expect(onExecute).not.toHaveBeenCalled()
    await act(async () => { gate.resolve({ cards: 1, imagens: 0 }) })
  })
})

describe('ImageLightbox', () => {
  it('shows the image, closes with Esc, and with a click on the backdrop only when the press began there', () => {
    const onClose = vi.fn()
    render(<ImageLightbox image={{ id: 1, url: '/board_uploads/1/a.png' }} number={2} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Imagem 2' })
    expect(dialog.querySelector('img').getAttribute('src')).toBe('/board_uploads/1/a.png')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog.querySelector('img'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('a broken image says so instead of showing nothing', () => {
    render(<ImageLightbox image={{ id: 1, url: '/x.png' }} number={1} onClose={vi.fn()} />)
    fireEvent.error(screen.getByRole('dialog').querySelector('img'))
    expect(screen.getByRole('dialog').textContent).toContain('Não consegui carregar a imagem.')
  })
})
