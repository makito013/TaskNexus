import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { ChatApiError, chatApi } from '../../../../services/chatApi.js'
import SwitchEngineDialog from './SwitchEngineDialog.jsx'

installDialogElementStub()

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const KEY = 'Pessoal/tn-sandbox::claude::qa4pty'

function open() {
  const onCancel = vi.fn()
  const onSwitched = vi.fn()
  render(<SwitchEngineDialog sessionKey={KEY} onCancel={onCancel} onSwitched={onSwitched} />)
  return { onCancel, onSwitched }
}

describe('SwitchEngineDialog (R-AV, pty to chat)', () => {
  it('has the title and the product text verbatim, and the focus starts on Cancelar', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Abrir esta conversa no chat?' })).toBeTruthy()
    expect(screen.getByText('Ao abrir no chat, esta conversa deixa de aparecer na V2 (versão atual do TaskNexus). Você pode voltar com “Abrir no terminal”. Continuar?')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Abrir no chat' }).className).toContain('v3-button--primary')
  })

  it('offers no "do not ask again" and no way back to the terminal (that is another dialog)', () => {
    open()
    expect(screen.queryByText(/não perguntar/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Abrir no terminal/ })).toBeNull()
  })

  it('Cancelar and Esc cancel without touching the backend', () => {
    const spy = vi.spyOn(chatApi, 'switchEngine')
    const { onCancel } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent(document.querySelector('dialog'), new Event('cancel', { cancelable: true }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(spy).not.toHaveBeenCalled()
  })

  it('"Abrir no chat" confirms the switch to the chat engine and reports the result', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockResolvedValue({ engine: 'chat', history: { imported: 4 } })
    const { onSwitched } = open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir no chat' })) })
    expect(chatApi.switchEngine).toHaveBeenCalledWith(KEY, { engine: 'chat', confirm: true })
    expect(onSwitched).toHaveBeenCalledWith({ engine: 'chat', history: { imported: 4 } })
  })

  it('while it opens, the button is busy and a second press sends nothing', async () => {
    let resolve
    vi.spyOn(chatApi, 'switchEngine').mockReturnValue(new Promise((done) => { resolve = done }))
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no chat' }))
    const busy = screen.getByRole('button', { name: 'Abrindo…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(busy)
    expect(chatApi.switchEngine).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ engine: 'chat' }) })
  })

  it('a failure keeps everything: the dialog stays, says so and can try again', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockRejectedValue(new ChatApiError({ status: 503, code: 'engine_unavailable', message: 'x' }))
    const { onSwitched, onCancel } = open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir no chat' })) })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível abrir no chat. A conversa continua onde estava.')
    expect(screen.getByRole('button', { name: 'Abrir no chat' }).getAttribute('aria-busy')).toBeNull()
    expect(onSwitched).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('"already a chat" (engine_conflict) is the goal reached, not an error', async () => {
    vi.spyOn(chatApi, 'switchEngine').mockRejectedValue(new ChatApiError({ status: 409, code: 'engine_conflict', message: 'x' }))
    const { onSwitched } = open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir no chat' })) })
    expect(onSwitched).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
