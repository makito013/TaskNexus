import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { ChatApiError, chatApi } from '../../../../services/chatApi.js'
import ConnectorsDialog from './ConnectorsDialog.jsx'

installDialogElementStub()

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const payload = (known = [{ name: 'Gmail', allowed: false }, { name: 'Notion', allowed: false }]) => ({
  agent_id: 'claude',
  allowlist: known.filter((entry) => entry.allowed).map((entry) => entry.name),
  known,
  probed_at: 1,
})

async function open(response = payload(), props = {}) {
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue(response)
  const onClose = vi.fn()
  render(<ConnectorsDialog agentId="claude" agentName="Claude" onClose={onClose} {...props} />)
  await act(async () => {})
  return { onClose }
}
const switchOf = (name) => screen.getByRole('switch', { name: new RegExp(`^${name}:`) })

describe('ConnectorsDialog', () => {
  it('has the title, the opening text verbatim and every switch OFF by default', async () => {
    await open()
    expect(screen.getByRole('heading', { name: 'Conectores no chat — Claude' })).toBeTruthy()
    const text = document.querySelector('.v3-chat-conn__intro').textContent
    expect(text).toBe('Conectores da sua conta Claude ficam desligados por padrão. Os ligados ainda pedem sua aprovação antes de qualquer ação. Mudanças valem para chats novos ou retomados.')
    const switches = screen.getAllByRole('switch')
    expect(switches.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(switches.map((item) => item.getAttribute('aria-label'))).toEqual(['Gmail: desligado', 'Notion: desligado'])
    expect(screen.getAllByText('Desligado')).toHaveLength(2)
  })

  it('the server allowlist is what is on; nothing else', async () => {
    await open(payload([{ name: 'Gmail', allowed: true }, { name: 'Notion', allowed: false }]))
    expect(switchOf('Gmail').getAttribute('aria-checked')).toBe('true')
    expect(switchOf('Notion').getAttribute('aria-checked')).toBe('false')
  })

  it('shows a loading state, then moves the focus to the first switch', async () => {
    let resolve
    vi.spyOn(chatApi, 'fetchConnectors').mockReturnValue(new Promise((done) => { resolve = done }))
    render(<ConnectorsDialog agentId="claude" agentName="Claude" onClose={() => {}} />)
    expect(screen.getByText('Carregando conectores…')).toBeTruthy()
    await act(async () => { resolve(payload()) })
    expect(document.activeElement).toBe(screen.getAllByRole('switch')[0])
  })

  it('toggling updates the label, the state text and enables "Salvar" only with a change', async () => {
    await open()
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(switchOf('Gmail'))
    expect(switchOf('Gmail').getAttribute('aria-label')).toBe('Gmail: ligado')
    expect(screen.getByText('Ligado')).toBeTruthy()
    expect(save.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(switchOf('Gmail'))
    expect(save.getAttribute('aria-disabled')).toBe('true')
  })

  it('"Salvar" sends the names that are on and says to reopen the open chats', async () => {
    await open()
    vi.spyOn(chatApi, 'putConnectors').mockResolvedValue(payload([{ name: 'Gmail', allowed: true }, { name: 'Notion', allowed: false }]))
    fireEvent.click(switchOf('Gmail'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(chatApi.putConnectors).toHaveBeenCalledWith('claude', ['Gmail'])
    expect(screen.getByRole('status').textContent).toBe('Salvo. Reabra ou retome os chats abertos deste agente para aplicar.')
    expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('a refused save keeps the switches and says nothing changed', async () => {
    await open()
    vi.spyOn(chatApi, 'putConnectors').mockRejectedValue(new ChatApiError({ status: 500, code: 'http_error', message: 'x' }))
    fireEvent.click(switchOf('Notion'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível salvar. Nada foi alterado.')
    expect(switchOf('Notion').getAttribute('aria-checked')).toBe('true')
  })

  it('a partial_allowlist_unavailable refusal explains that only "all off" is possible', async () => {
    await open()
    vi.spyOn(chatApi, 'putConnectors').mockRejectedValue(new ChatApiError({ status: 422, code: 'partial_allowlist_unavailable', message: 'x' }))
    fireEvent.click(switchOf('Notion'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(screen.getByRole('alert').textContent).toBe('Por enquanto só é possível manter todos desligados.')
  })

  it('an empty list says where connectors come from', async () => {
    await open(payload([]))
    expect(screen.getByText('Nenhum conector da sua conta foi encontrado ainda. Eles aparecem depois que o agente abre um chat.')).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('a read error offers to try again; a 404 says the agent is gone', async () => {
    vi.spyOn(chatApi, 'fetchConnectors').mockRejectedValueOnce(new ChatApiError({ status: 500, code: 'http_error', message: 'x' })).mockResolvedValueOnce(payload())
    render(<ConnectorsDialog agentId="claude" agentName="Claude" onClose={() => {}} />)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível carregar os conectores.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })) })
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    cleanup()
    vi.spyOn(chatApi, 'fetchConnectors').mockRejectedValue(new ChatApiError({ status: 404, code: 'agent_not_found', message: 'x' }))
    render(<ConnectorsDialog agentId="gone" agentName="X" onClose={() => {}} />)
    await act(async () => {})
    expect(screen.getByText('Este agente não existe mais.')).toBeTruthy()
  })

  it('"Atualizar lista" asks for a new probe and keeps what the user switched on', async () => {
    await open()
    vi.spyOn(chatApi, 'refreshConnectors').mockResolvedValue(payload([{ name: 'Gmail', allowed: false }, { name: 'Slack', allowed: false }]))
    fireEvent.click(switchOf('Gmail'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' })) })
    expect(chatApi.refreshConnectors).toHaveBeenCalledWith('claude')
    expect(screen.getAllByRole('switch').map((item) => item.getAttribute('aria-label'))).toEqual(['Gmail: ligado', 'Slack: desligado'])
  })

  it('names are text, never markup, and no sentence promises that a connector "does not load"', async () => {
    await open(payload([{ name: '<img src=x onerror=1>', allowed: false }]))
    expect(document.querySelector('.v3-chat-conn img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=1>')).toBeTruthy()
    expect(document.querySelector('dialog').textContent).not.toMatch(/não carrega|nao carrega|não é carregad/i)
  })

  it('"Fechar" and Esc close it', async () => {
    const { onClose } = await open()
    fireEvent.click(within(document.querySelector('.v3-dialog__footer')).getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
