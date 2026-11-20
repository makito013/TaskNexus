import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import NewChatDialog from './NewChatDialog.jsx'

// C6: "Novo chat" lists EVERY agent; a Claude agent creates a chat on the server, any other opens the terminal
// view with a key minted here (the PTY is spawned by the first /ws/pty connection, so nothing is created).
installDialogElementStub()

const AGENTS = [
  { id: 'claude', nome: 'Claude', ia: 'claude' },
  { id: 'codex', nome: 'Codex', ia: 'codex' },
  { id: 'revisor', nome: 'Revisor', ia: 'claude' },
  { id: 'shell', nome: 'Terminal', ia: 'terminal' },
]

beforeEach(() => {
  vi.spyOn(api, 'fetchAgents').mockResolvedValue(AGENTS)
  vi.spyOn(chatApi, 'createSession').mockResolvedValue({ session_key: 'Pessoal/tn::claude::new001', status: 'new' })
  vi.spyOn(chatApi, 'renameSession').mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup() {
  const handlers = { onClose: vi.fn(), onCreated: vi.fn() }
  render(<NewChatDialog projectRef="Pessoal/tn" projectName="tn" {...handlers} />)
  return handlers
}
const agentSelect = () => screen.getByLabelText('Agente')
const ready = () => waitFor(() => expect(agentSelect().getAttribute('aria-busy')).toBeNull())
const titleField = () => screen.getByLabelText('Título (opcional)')
const startButton = () => screen.getByRole('button', { name: /Iniciar chat|Iniciando|Abrir terminal/ })

describe('NewChatDialog lists every agent (C6)', () => {
  it('shows all the agents in the registry order, the first Claude agent chosen, and says where each kind opens', async () => {
    setup()
    await ready()
    expect([...agentSelect().options].map((option) => option.textContent)).toEqual(['Claude', 'Codex', 'Revisor', 'Terminal'])
    expect(agentSelect().value).toBe('claude')
    expect(screen.getByText('Só agentes Claude abrem em chat. Os outros abrem em terminal.')).toBeTruthy()
  })

  it('with only non-Claude agents the first one is chosen and the start is allowed', async () => {
    api.fetchAgents.mockResolvedValue([AGENTS[1], AGENTS[3]])
    setup()
    await ready()
    expect(agentSelect().value).toBe('codex')
    expect(startButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('with no agent at all it says so and blocks the start', async () => {
    api.fetchAgents.mockResolvedValue([])
    const { onCreated } = setup()
    const message = await screen.findByText('Nenhum agente cadastrado.')
    expect(startButton().getAttribute('aria-disabled')).toBe('true')
    expect(startButton().getAttribute('aria-describedby')).toBe(message.id)
    fireEvent.click(startButton())
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('NewChatDialog with an agent that is not Claude', () => {
  it('opens a terminal: no chat is created, the key is a new PTY key of the V2 format, and the button says so', async () => {
    const { onCreated } = setup()
    await ready()
    fireEvent.change(agentSelect(), { target: { value: 'codex' } })
    expect(startButton().textContent).toBe('Abrir terminal')
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(onCreated.mock.calls[0][0]).toMatch(/^Pessoal\/tn::codex::[0-9a-z]{6}$/)
    expect(chatApi.createSession).not.toHaveBeenCalled()
    expect(chatApi.renameSession).not.toHaveBeenCalled()
  })

  it('has no title to keep: the field is disabled and the help says so; back on a Claude agent it is enabled again', async () => {
    setup()
    await ready()
    fireEvent.change(agentSelect(), { target: { value: 'shell' } })
    expect(titleField().disabled).toBe(true)
    expect(screen.getByText('O terminal não guarda título.')).toBeTruthy()
    fireEvent.change(agentSelect(), { target: { value: 'revisor' } })
    expect(titleField().disabled).toBe(false)
    expect(screen.getByText('Se vazio, usamos a sua primeira mensagem.')).toBeTruthy()
    expect(startButton().textContent).toBe('Iniciar chat')
  })

  it('a Claude agent still creates a chat on the server', async () => {
    const { onCreated } = setup()
    await ready()
    fireEvent.change(agentSelect(), { target: { value: 'revisor' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Pessoal/tn::claude::new001'))
    expect(chatApi.createSession).toHaveBeenCalledWith({ projectRef: 'Pessoal/tn', agentId: 'revisor' })
  })

  it('two terminals of the same agent get two keys', async () => {
    const keys = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { onCreated } = setup()
      await ready()
      fireEvent.change(agentSelect(), { target: { value: 'codex' } })
      fireEvent.click(startButton())
      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
      keys.push(onCreated.mock.calls[0][0])
      cleanup()
    }
    expect(keys[0]).not.toBe(keys[1])
  })
})
