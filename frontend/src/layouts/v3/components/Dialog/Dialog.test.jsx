import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import Dialog from './Dialog.jsx'

installDialogElementStub()

function Harness({ initiallyOpen = false, onClose = () => {}, footer, size, fallback }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div>
      <button id="trigger" onClick={() => setOpen(true)}>Open it</button>
      <Dialog
        open={open}
        title="Novo workspace"
        titleId="dlg-title"
        onClose={() => { onClose(); setOpen(false) }}
        footer={footer}
        size={size}
        returnFocusTo={fallback}
      >
        <label htmlFor="field">Nome</label>
        <input id="field" />
        <button>Inside</button>
      </Dialog>
    </div>
  )
}

describe('Dialog', () => {
  beforeEach(() => resetDialogElementStubState())
  afterEach(() => cleanup())

  it('renders nothing inside while closed and opens with showModal when `open` flips', () => {
    const { container } = render(<Harness />)
    const dialog = container.querySelector('dialog')
    expect(dialog.open).toBe(false)
    expect(dialog.querySelector('.v3-dialog__panel')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Novo workspace' })).toBeNull()

    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    fireEvent.click(screen.getByText('Open it'))
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(true)
    showModal.mockRestore()
  })

  it('is labelled by its title and uses the requested size', () => {
    const { container } = render(<Harness initiallyOpen size="narrow" />)
    const dialog = container.querySelector('dialog')
    expect(dialog.getAttribute('aria-labelledby')).toBe('dlg-title')
    expect(document.getElementById('dlg-title').textContent).toBe('Novo workspace')
    expect(dialog.className).toContain('v3-dialog--narrow')
  })

  it('moves the initial focus to the first field of the body', () => {
    render(<Harness initiallyOpen />)
    expect(document.activeElement).toBe(document.getElementById('field'))
  })

  it('Escape asks the parent to close (cancel is prevented, the parent decides)', () => {
    const onClose = vi.fn()
    const { container } = render(<Harness initiallyOpen onClose={onClose} />)
    fireEvent.keyDown(document.getElementById('field'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.querySelector('dialog').open).toBe(false)
  })

  it('the Fechar button closes', () => {
    const onClose = vi.fn()
    const { container } = render(<Harness initiallyOpen onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.querySelector('dialog').open).toBe(false)
  })

  it('hands the focus back to the trigger on close', () => {
    render(<Harness />)
    const trigger = document.getElementById('trigger')
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(document.getElementById('field'))
    fireEvent.keyDown(document.getElementById('field'), { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it('returnFocusTo wins over the previously focused element, and a function can fall back when the trigger is gone', () => {
    const fallback = document.createElement('h1')
    fallback.tabIndex = -1
    document.body.appendChild(fallback)
    render(<Harness fallback={() => fallback} />)
    const trigger = document.getElementById('trigger')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(document.activeElement).toBe(fallback)
    fallback.remove()
  })

  it('a click on the backdrop (the dialog itself) closes; a click inside does not', () => {
    const onClose = vi.fn()
    const { container } = render(<Harness initiallyOpen onClose={onClose} />)
    const dialog = container.querySelector('dialog')
    fireEvent.mouseDown(screen.getByText('Inside'))
    fireEvent.click(screen.getByText('Inside'))
    fireEvent.click(container.querySelector('.v3-dialog__panel'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a press that started inside and was released on the backdrop does not close', () => {
    const onClose = vi.fn()
    const { container } = render(<Harness initiallyOpen onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('Inside'))
    fireEvent.click(container.querySelector('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders the footer when given', () => {
    render(<Harness initiallyOpen footer={<button>Salvar</button>} />)
    expect(screen.getByRole('button', { name: 'Salvar' }).closest('footer')).toBeTruthy()
  })

  it('unmounting while open closes the native dialog and restores the focus', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { container, unmount } = render(
      <Dialog open title="T" titleId="t" onClose={() => {}}><input /></Dialog>,
    )
    const dialog = container.querySelector('dialog')
    expect(dialog.open).toBe(true)
    unmount()
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('only the top-most of two stacked dialogs reacts to Escape', () => {
    const closeBottom = vi.fn()
    const closeTop = vi.fn()
    render(
      <div>
        <Dialog open title="Bottom" titleId="b" onClose={closeBottom}><input id="bottom-field" /></Dialog>
        <Dialog open title="Top" titleId="t" onClose={closeTop}><input id="top-field" /></Dialog>
      </div>,
    )
    fireEvent.keyDown(document.getElementById('top-field'), { key: 'Escape' })
    expect(closeTop).toHaveBeenCalledTimes(1)
    expect(closeBottom).not.toHaveBeenCalled()
  })
})

describe('dialog element stub', () => {
  it('is idempotent and keeps returnValue', () => {
    installDialogElementStub()
    installDialogElementStub()
    const dialog = document.createElement('dialog')
    document.body.appendChild(dialog)
    const closed = vi.fn()
    dialog.addEventListener('close', closed)
    dialog.showModal()
    expect(dialog.open).toBe(true)
    expect(() => dialog.showModal()).toThrow()
    dialog.close('done')
    expect(dialog.open).toBe(false)
    expect(dialog.returnValue).toBe('done')
    expect(closed).toHaveBeenCalledTimes(1)
    dialog.close()
    expect(closed).toHaveBeenCalledTimes(1)
    dialog.remove()
  })

  it('fires a cancelable cancel on Escape and keeps the dialog open when it is prevented', () => {
    const dialog = document.createElement('dialog')
    dialog.innerHTML = '<button id="x">x</button>'
    document.body.appendChild(dialog)
    dialog.showModal()
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    fireEvent.keyDown(dialog.querySelector('#x'), { key: 'Escape' })
    expect(dialog.open).toBe(true)
    dialog.close()
    dialog.remove()
  })
})
