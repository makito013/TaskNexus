import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import ApprovalCard from './ApprovalCard.jsx'

afterEach(() => cleanup())

const BASH = { verb: 'rodar', object: 'npm test' }

function setup(props = {}) {
  const handlers = {
    onAllow: vi.fn(),
    onAllowSession: vi.fn(),
    onDeny: vi.fn(),
    onDenyStop: vi.fn(),
    focusAfterDecision: vi.fn(),
  }
  const view = render(<ApprovalCard agentName="Claude" summary={BASH} allowSession {...handlers} {...props} />)
  return { ...handlers, ...view }
}

const buttonNames = () => screen.getAllByRole('button').map((button) => button.textContent)

describe('ApprovalCard pending', () => {
  it('names who asks, what and where, in a labelled group', () => {
    setup({ context: 'tn-sandbox' })
    const group = screen.getByRole('group', { name: 'Pedido de permissão' })
    expect(within(group).getByText('Claude')).toBeTruthy()
    expect(within(group).getByText('quer rodar')).toBeTruthy()
    expect(within(group).getByText('npm test').tagName).toBe('CODE')
    expect(within(group).getByText('tn-sandbox')).toBeTruthy()
  })

  it('orders the buttons Permitir, Permitir nesta conversa, Negar, Negar e parar', () => {
    setup()
    expect(buttonNames()).toEqual(['Permitir', 'Permitir nesta conversa', 'Negar', 'Negar e parar'])
  })

  it('only Permitir is the primary action and the session caption is shown', () => {
    setup()
    const primaries = screen.getAllByRole('button').filter((button) => button.className.includes('v3-button--primary'))
    expect(primaries.map((button) => button.textContent)).toEqual(['Permitir'])
    expect(screen.getByText('Vale só até encerrar esta conversa.')).toBeTruthy()
  })

  it('offers no persistent-rule option, whatever the props', () => {
    setup()
    expect(screen.queryByText(/sempre/i)).toBeNull()
    expect(screen.queryByText(/regra/i)).toBeNull()
  })

  it('hides "Permitir nesta conversa" when the server says allow_session is false', () => {
    setup({ allowSession: false })
    expect(buttonNames()).toEqual(['Permitir', 'Negar', 'Negar e parar'])
    expect(screen.queryByText('Vale só até encerrar esta conversa.')).toBeNull()
  })

  it('hides "Permitir nesta conversa" for a connector even if allowSession is true, and names the connector', () => {
    setup({ allowSession: true, connector: 'Atlassian', summary: { verb: 'usar', object: 'Atlassian › search' } })
    expect(screen.queryByRole('button', { name: 'Permitir nesta conversa' })).toBeNull()
    expect(screen.getByText('Conector da sua conta: Atlassian')).toBeTruthy()
  })

  it('Permitir and Permitir nesta conversa call their callbacks', () => {
    const { onAllow, onAllowSession } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Permitir nesta conversa' }))
    expect(onAllow).toHaveBeenCalledTimes(1)
    expect(onAllowSession).toHaveBeenCalledTimes(1)
  })

  it('"Negar e parar" denies at once, with no reason box', () => {
    const { onDenyStop, onDeny } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Negar e parar' }))
    expect(onDenyStop).toHaveBeenCalledTimes(1)
    expect(onDeny).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Motivo (opcional)')).toBeNull()
  })

  it('"Negar" opens a reason box with focus; the reason goes with the denial', () => {
    const { onDeny } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    const reason = screen.getByLabelText('Motivo (opcional)')
    expect(document.activeElement).toBe(reason)
    expect(onDeny).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: '  não agora  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar negação' }))
    expect(onDeny).toHaveBeenCalledWith('não agora')
  })

  it('Ctrl+Enter and Cmd+Enter confirm the denial; a plain Enter does not', () => {
    const { onDeny } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    const reason = screen.getByLabelText('Motivo (opcional)')
    fireEvent.keyDown(reason, { key: 'Enter' })
    expect(onDeny).not.toHaveBeenCalled()
    fireEvent.keyDown(reason, { key: 'Enter', ctrlKey: true })
    expect(onDeny).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    fireEvent.keyDown(screen.getByLabelText('Motivo (opcional)'), { key: 'Enter', metaKey: true })
    expect(onDeny).toHaveBeenCalledTimes(2)
  })

  it('Esc never decides: in the reason box it only closes the box, and it does not bubble', () => {
    const { onAllow, onDeny, onDenyStop } = setup()
    const outer = vi.fn()
    // a parent that would interrupt the turn on Esc must not see it
    cleanup()
    const handlers = { onAllow, onDeny, onDenyStop }
    render(
      <div onKeyDown={outer}>
        <ApprovalCard agentName="Claude" summary={BASH} {...handlers} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    fireEvent.keyDown(screen.getByLabelText('Motivo (opcional)'), { key: 'Escape' })
    expect(screen.queryByLabelText('Motivo (opcional)')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
    expect([onAllow, onDeny, onDenyStop].every((handler) => handler.mock.calls.length === 0)).toBe(true)
  })

  it('Esc on the card itself decides nothing', () => {
    const { onAllow, onDeny, onDenyStop, onAllowSession } = setup()
    fireEvent.keyDown(screen.getByRole('group', { name: 'Pedido de permissão' }), { key: 'Escape' })
    expect([onAllow, onDeny, onDenyStop, onAllowSession].every((handler) => handler.mock.calls.length === 0)).toBe(true)
  })

  it('hands the focus back (focusAfterDecision) only when the decision came from inside the card', () => {
    const { focusAfterDecision } = setup()
    const allow = screen.getByRole('button', { name: 'Permitir' })
    allow.focus()
    fireEvent.click(allow)
    expect(focusAfterDecision).toHaveBeenCalledTimes(1)
    cleanup()

    const other = setup()
    document.body.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }))
    // fireEvent.click does not move the focus: nothing in the card had it
    expect(other.focusAfterDecision).not.toHaveBeenCalled()
  })

  it('shows a long command in 3 lines with "Ver comando completo", and never drops text', () => {
    const command = Array.from({ length: 6 }, (_, index) => `linha ${index + 1}`).join('\n')
    setup({ summary: { verb: 'rodar', object: command } })
    const code = document.querySelector('.v3-approval__object')
    expect(code.className).toContain('v3-approval__object--clamped')
    expect(code.textContent).toBe(command)
    fireEvent.click(screen.getByRole('button', { name: 'Ver comando completo' }))
    expect(code.className).not.toContain('v3-approval__object--clamped')
    expect(screen.getByRole('button', { name: 'Ocultar comando completo' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('a short command has no "Ver comando completo"', () => {
    setup()
    expect(screen.queryByRole('button', { name: /comando completo/ })).toBeNull()
  })

  it('renders the command as text, never as markup', () => {
    setup({ summary: { verb: 'rodar', object: '<img src=x onerror=alert(1)>' } })
    expect(document.querySelector('.v3-approval img')).toBeNull()
    expect(document.querySelector('.v3-approval__object').textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('"Ver detalhes" toggles the details given by the consumer', () => {
    setup({ details: <p>entrada completa</p> })
    expect(screen.queryByText('entrada completa')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Ver detalhes' })
    fireEvent.click(toggle)
    expect(screen.getByText('entrada completa')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ocultar detalhes' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('has no "Ver detalhes" when there are no details', () => {
    setup()
    expect(screen.queryByRole('button', { name: /detalhes/ })).toBeNull()
  })

  it('every decision button is described by the full sentence of the request', () => {
    setup()
    const sentence = document.querySelector('.v3-approval__sr-only')
    expect(sentence.textContent).toBe('Claude quer rodar npm test')
    for (const name of ['Permitir', 'Negar', 'Negar e parar']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-describedby')).toContain(sentence.id)
    }
  })

  it('a custom label names the group (question and plan cards)', () => {
    setup({ label: 'Plano para aprovar', summary: { verb: 'propor um plano', object: null } })
    expect(screen.getByRole('group', { name: 'Plano para aprovar' })).toBeTruthy()
    expect(document.querySelector('.v3-approval__object')).toBeNull()
  })
})

describe('ApprovalCard sending and error', () => {
  it('while sending the pressed button is busy and the others are aria-disabled, and nothing fires twice', () => {
    const { onAllow, onDeny } = setup({ status: 'sending', pendingAction: 'allow' })
    const allow = screen.getByRole('button', { name: 'Enviando…' })
    expect(allow.getAttribute('aria-busy')).toBe('true')
    for (const name of ['Permitir nesta conversa', 'Negar', 'Negar e parar']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true')
    }
    fireEvent.click(allow)
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    expect(onAllow).not.toHaveBeenCalled()
    expect(onDeny).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Motivo (opcional)')).toBeNull()
  })

  it('on error the buttons are back and the card says so', () => {
    setup({ status: 'error' })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível enviar sua decisão. Tente de novo.')
    expect(buttonNames()).toContain('Permitir')
    expect(screen.getByRole('button', { name: 'Permitir' }).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('ApprovalCard resolved', () => {
  const cases = [
    ['allowed', 'Você permitiu'],
    ['allowed_session', 'Você permitiu nesta conversa'],
    ['denied', 'Você negou'],
    ['denied_stop', 'Você negou e parou o turno'],
  ]

  it.each(cases)('%s is one quiet line without buttons', (status, text) => {
    setup({ status })
    const line = screen.getByRole('status')
    expect(line.textContent).toContain(`${text} · rodar npm test`)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(line.getAttribute('data-status')).toBe(status)
  })

  it('a denial shows the reason the user gave', () => {
    setup({ status: 'denied', denyMessage: 'ainda não' })
    expect(screen.getByText('Motivo: ainda não')).toBeTruthy()
  })

  it('"elsewhere" says it was decided on another device, dashed, no error', () => {
    setup({ status: 'elsewhere' })
    expect(screen.getByText('Decidido em outro dispositivo.')).toBeTruthy()
    expect(screen.getByRole('status').className).toContain('v3-approval--elsewhere')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('"expired" says it expired when the conversation was reopened', () => {
    setup({ status: 'expired' })
    expect(screen.getByText('Expirou ao reabrir a conversa.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('"cancelled" has its own text', () => {
    setup({ status: 'cancelled' })
    expect(screen.getByText('Pedido cancelado.')).toBeTruthy()
  })

  it('a long summary is clipped to one line in the resolved text', () => {
    setup({ status: 'allowed', summary: { verb: 'rodar', object: 'x'.repeat(300) } })
    expect(screen.getByRole('status').textContent.length).toBeLessThan(140)
  })
})
