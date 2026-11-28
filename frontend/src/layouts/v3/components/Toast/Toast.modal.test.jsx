import { useState } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import Dialog from '../Dialog/Dialog.jsx'
import { topModal } from '../Dialog/modalStack.js'
import ToastHost from './ToastHost.jsx'
import { useToast } from './toastContext.js'

// A modal <dialog> lives in the browser's top layer: nothing drawn in <body> can be above it, and everything
// behind it is inert. So a toast raised while a modal is open must be drawn INSIDE the modal that is on top,
// follow the stack when a modal opens or goes away, and return to <body> only when none is left.

installDialogElementStub()

let toastApi
function Capture() {
  toastApi = useToast()
  return null
}

// Two stacked dialogs the test opens and closes by buttons that live outside them (their `open` is state).
function Stack({ initial = { first: true, second: true } }) {
  const [open, setOpen] = useState(initial)
  return (
    <ToastHost>
      <Capture />
      <button onClick={() => setOpen((current) => ({ ...current, second: false }))}>close second</button>
      <button onClick={() => setOpen((current) => ({ ...current, first: false }))}>close first</button>
      <button onClick={() => setOpen((current) => ({ ...current, second: true }))}>open second</button>
      {open.first && <Dialog open title="First" titleId="first" onClose={() => {}}><p>first body</p></Dialog>}
      {open.second && <Dialog open title="Second" titleId="second" onClose={() => {}}><p>second body</p></Dialog>}
    </ToastHost>
  )
}

const dialogOf = (name) => screen.getByRole('dialog', { name })
const regionOf = (text) => screen.getByText(text).closest('.v3-toast-region')
const press = (name) => act(() => { fireEvent.click(screen.getByText(name)) })

beforeEach(() => resetDialogElementStubState())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Toast over stacked modals', () => {
  it('with no modal open it is drawn in <body>', () => {
    render(<ToastHost><Capture /></ToastHost>)
    act(() => { toastApi.push({ text: 'Solto.' }) })
    expect(regionOf('Solto.').parentElement).toBe(document.body)
  })

  it('with two modals open it is inside the one on top, and in no other place', () => {
    render(<Stack />)
    act(() => { toastApi.push({ text: 'No topo.' }) })
    expect(topModal()).toBe(dialogOf('Second'))
    expect(dialogOf('Second').contains(screen.getByText('No topo.'))).toBe(true)
    expect(dialogOf('First').contains(screen.getByText('No topo.'))).toBe(false)
    expect(document.querySelectorAll('.v3-toast-region')).toHaveLength(1)
  })

  it('when the modal on top goes away the toast moves into the one below, still alive', () => {
    render(<Stack />)
    act(() => { toastApi.push({ text: 'Fica.' }) })
    press('close second')
    expect(screen.getByText('Fica.')).toBeTruthy()
    expect(dialogOf('First').contains(screen.getByText('Fica.'))).toBe(true)
    expect(regionOf('Fica.').parentElement).not.toBe(document.body)
  })

  it('when the last modal goes away the toast goes back to <body>', () => {
    render(<Stack />)
    act(() => { toastApi.push({ text: 'Volta.' }) })
    press('close second')
    press('close first')
    expect(screen.getByText('Volta.')).toBeTruthy()
    expect(regionOf('Volta.').parentElement).toBe(document.body)
  })

  it('a modal that opens over a toast takes it along, so it is never behind the new top layer', () => {
    render(<Stack initial={{ first: true, second: false }} />)
    act(() => { toastApi.push({ text: 'Acompanha.' }) })
    expect(dialogOf('First').contains(screen.getByText('Acompanha.'))).toBe(true)
    press('open second')
    expect(dialogOf('Second').contains(screen.getByText('Acompanha.'))).toBe(true)
    expect(dialogOf('First').contains(screen.getByText('Acompanha.'))).toBe(false)
  })

  it('a toast raised while the top modal is unmounting lands in the one below, never in a dead element', () => {
    render(<Stack />)
    press('close second')
    act(() => { toastApi.push({ text: 'Depois.' }) })
    expect(dialogOf('First').contains(screen.getByText('Depois.'))).toBe(true)
  })

  it('a toast dismissed by its own button leaves nothing behind in the modal', () => {
    render(<Stack />)
    act(() => { toastApi.push({ text: 'Some.' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }))
    expect(screen.queryByText('Some.')).toBeNull()
    expect(document.querySelector('.v3-toast-region')).toBeNull()
  })
})
