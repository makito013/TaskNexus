import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import CardDialog from './CardDialog.jsx'
import { COLUMNS, card, registry } from './boardFixtures.js'

installDialogElementStub()

const index = registry()
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}
const epoch = (...parts) => new Date(...parts).getTime() / 1000

function tree(show, props) {
  return (
    <ToastHost>
      {show && (
        <CardDialog
          mode="edit"
          card={{ ...card(12, 'Pessoal/tn-sandbox', { titulo: 'Corrigir login' }), ...props.cardExtra }}
          columns={COLUMNS}
          doneSlug="feito"
          registry={index}
          leavesView={() => false}
          onSave={vi.fn()}
          onDelete={vi.fn()}
          onUploadImage={vi.fn()}
          onDeleteImage={vi.fn()}
          onAnswerQuestion={vi.fn()}
          onDeleteQuestion={vi.fn()}
          onClose={vi.fn()}
          {...props.handlers}
        />
      )}
    </ToastHost>
  )
}
const dialog = () => screen.getByRole('dialog', { name: /./ })
const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)) })

afterEach(() => {
  cleanup()
  resetDialogElementStubState()
})

describe('CardDialog: "Criado em" is the local day', () => {
  it.each([
    ['22:30 on the 25th', [2026, 10, 25, 22, 30], '25/11/2026'],
    ['23:59 on the 25th', [2026, 10, 25, 23, 59], '25/11/2026'],
    ['00:15 on the 3rd', [2026, 0, 3, 0, 15], '03/01/2026'],
  ])('a card created at %s shows its own day', (_label, parts, expected) => {
    render(tree(true, { cardExtra: { criado_em: epoch(...parts) } }))
    expect(within(dialog()).getByText(expected)).toBeTruthy()
  })

  it('a card without a creation time shows a dash', () => {
    render(tree(true, { cardExtra: { criado_em: null } }))
    expect(dialog().querySelector('.v3-card-created').textContent).toBe('—')
  })
})

describe('CardDialog: a write that ends after the dialog closed', () => {
  it('a save that fails after the dialog is gone becomes a toast', async () => {
    const gate = deferred()
    const handlers = { onSave: vi.fn().mockReturnValue(gate.promise), onClose: vi.fn() }
    const view = render(tree(true, { handlers }))
    fireEvent.change(within(dialog()).getByLabelText('Título'), { target: { value: 'Outro' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    view.rerender(tree(false, { handlers }))
    await act(async () => { gate.reject(new Error('down')) })
    await flush()
    expect(screen.getByText('Não consegui salvar o card. Tente de novo.')).toBeTruthy()
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('a save that goes through after the dialog is gone still says "Card salvo."', async () => {
    const gate = deferred()
    const handlers = { onSave: vi.fn().mockReturnValue(gate.promise), onClose: vi.fn() }
    const view = render(tree(true, { handlers }))
    fireEvent.change(within(dialog()).getByLabelText('Título'), { target: { value: 'Outro' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Salvar' }))
    view.rerender(tree(false, { handlers }))
    await act(async () => { gate.resolve({}) })
    await flush()
    expect(screen.getByText('Card salvo.')).toBeTruthy()
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('an image upload that fails after the dialog is gone becomes a toast', async () => {
    const gate = deferred()
    const handlers = { onUploadImage: vi.fn().mockReturnValue(gate.promise) }
    const view = render(tree(true, { handlers }))
    const input = dialog().querySelector('input[type="file"]')
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(handlers.onUploadImage).toHaveBeenCalledTimes(1)
    view.rerender(tree(false, { handlers }))
    await act(async () => { gate.reject(new Error('down')) })
    await flush()
    expect(screen.getByText('Não consegui enviar a imagem.')).toBeTruthy()
  })

  it('a delete that fails after the dialog is gone becomes a toast', async () => {
    const gate = deferred()
    const handlers = { onDelete: vi.fn().mockReturnValue(gate.promise), onClose: vi.fn() }
    const view = render(tree(true, { handlers }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Excluir card' }))
    view.rerender(tree(false, { handlers }))
    await act(async () => { gate.reject(new Error('down')) })
    await flush()
    expect(screen.getByText('Não consegui excluir o card. Tente de novo.')).toBeTruthy()
  })
})
