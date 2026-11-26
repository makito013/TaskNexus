import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { installDialogElementStub, resetDialogElementStubState } from '../../../../test/dialogElementStub.js'
import Dialog from '../Dialog/Dialog.jsx'
import ToastHost, { MAX_TOASTS } from './ToastHost.jsx'
import { useToast } from './toastContext.js'

installDialogElementStub()

let toastApi
function Capture() {
  toastApi = useToast()
  return null
}

function renderHost(extra = null) {
  return render(
    <ToastHost>
      <Capture />
      {extra}
    </ToastHost>,
  )
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetDialogElementStubState()
  })
  afterEach(() => vi.useRealTimers())

  it('renders nothing, and no status role, while there is no toast', () => {
    const { container } = renderHost()
    expect(container.querySelector('.v3-toast-region')).toBeNull()
    expect(document.querySelector('.v3-toast-region')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is a no-op outside the host', () => {
    let outside
    function Outside() {
      outside = useToast()
      return null
    }
    render(<Outside />)
    expect(outside.push({ text: 'x' })).toBeNull()
    expect(() => outside.dismiss(1)).not.toThrow()
    expect(document.querySelector('.v3-toast-region')).toBeNull()
  })

  it('shows an info toast as a status and an error toast as an alert', () => {
    renderHost()
    act(() => { toastApi.push({ text: 'Copiado.' }) })
    expect(screen.getByRole('status').textContent).toContain('Copiado.')
    act(() => { toastApi.push({ text: 'Falhou.', kind: 'error' }) })
    expect(screen.getByRole('alert').textContent).toContain('Falhou.')
  })

  it('dismisses itself after 6 seconds', () => {
    renderHost()
    act(() => { toastApi.push({ text: 'Copiado.' }) })
    act(() => { vi.advanceTimersByTime(5999) })
    expect(screen.queryByText('Copiado.')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(2) })
    expect(screen.queryByText('Copiado.')).toBeNull()
  })

  it('honours a custom duration', () => {
    renderHost()
    act(() => { toastApi.push({ text: 'Curto', durationMs: 1000 }) })
    act(() => { vi.advanceTimersByTime(1001) })
    expect(screen.queryByText('Curto')).toBeNull()
  })

  it('pauses while the pointer is over it and restarts the period afterwards', () => {
    renderHost()
    act(() => { toastApi.push({ text: 'Copiado.' }) })
    const toast = screen.getByRole('status')
    fireEvent.mouseEnter(toast)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.queryByText('Copiado.')).not.toBeNull()
    fireEvent.mouseLeave(toast)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByText('Copiado.')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.queryByText('Copiado.')).toBeNull()
  })

  it('pauses while a control inside has the focus', () => {
    renderHost()
    act(() => { toastApi.push({ text: 'Copiado.' }) })
    const close = screen.getByRole('button', { name: 'Dispensar aviso' })
    fireEvent.focus(close)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.queryByText('Copiado.')).not.toBeNull()
  })

  it('does not take the focus when it appears', () => {
    renderHost(<button>Antes</button>)
    screen.getByText('Antes').focus()
    act(() => { toastApi.push({ text: 'Copiado.' }) })
    expect(document.activeElement).toBe(screen.getByText('Antes'))
  })

  it('stacks at most three toasts and drops the oldest', () => {
    renderHost()
    act(() => {
      for (let index = 1; index <= MAX_TOASTS + 1; index += 1) toastApi.push({ text: `Aviso ${index}` })
    })
    expect(screen.queryByText('Aviso 1')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(MAX_TOASTS)
  })

  it('dismisses by id and by the close button (44px target class)', () => {
    renderHost()
    let id
    act(() => { id = toastApi.push({ text: 'Um' }) })
    act(() => { toastApi.dismiss(id) })
    expect(screen.queryByText('Um')).toBeNull()
    act(() => { toastApi.push({ text: 'Dois' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }))
    expect(screen.queryByText('Dois')).toBeNull()
  })

  it('runs the action and dismisses the toast', () => {
    renderHost()
    const onSelect = vi.fn()
    act(() => { toastApi.push({ text: 'Aberto', action: { label: 'Ver', onSelect } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Aberto')).toBeNull()
  })

  it('goes inside the modal that is on top while one is open', () => {
    render(
      <ToastHost>
        <Capture />
        <Dialog open title="Um" titleId="t1" onClose={() => {}}><p>corpo</p></Dialog>
      </ToastHost>,
    )
    act(() => { toastApi.push({ text: 'Dentro' }) })
    const dialog = document.querySelector('dialog')
    expect(dialog.contains(screen.getByText('Dentro'))).toBe(true)
  })
})
