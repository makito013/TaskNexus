import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import NewChatDialog from './NewChatDialog.jsx'

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

function setup(props = {}) {
  const handlers = { onClose: vi.fn(), onCreated: vi.fn() }
  const view = render(<NewChatDialog projectRef="Pessoal/tn" projectName="tn" {...handlers} {...props} />)
  return { ...handlers, ...view }
}

const agentSelect = () => screen.getByLabelText('Agente')
const startButton = () => screen.getByRole('button', { name: /Iniciar chat|Iniciando/ })
const ready = () => waitFor(() => expect(agentSelect().getAttribute('aria-busy')).toBeNull())

describe('NewChatDialog content', () => {
  it('is a dialog titled "Novo chat" with the project fixed and the optional title', async () => {
    setup()
    await ready()
    expect(screen.getByRole('dialog', { name: 'Novo chat' })).toBeTruthy()
    expect(screen.getByText('Projeto')).toBeTruthy()
    expect(screen.getByText('tn')).toBeTruthy()
    expect(screen.getByLabelText('Título (opcional)').getAttribute('placeholder')).toBe('Sem título')
    expect(screen.getByText('Se vazio, usamos a sua primeira mensagem.')).toBeTruthy()
    expect(screen.getByText('Só agentes Claude abrem em chat. Os outros abrem em terminal.')).toBeTruthy()
  })

  it('lists only the Claude agents, the first one chosen, and focuses the agent field', async () => {
    setup()
    await ready()
    expect([...agentSelect().options].map((option) => option.textContent)).toEqual(['Claude', 'Revisor'])
    expect(agentSelect().value).toBe('claude')
    expect(document.activeElement).toBe(agentSelect())
  })

  it('shows "Carregando agentes…" and a busy select while the agents load', () => {
    api.fetchAgents.mockReturnValue(new Promise(() => {}))
    setup()
    expect(agentSelect().getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Carregando agentes…')).toBeTruthy()
    expect(document.activeElement).toBe(agentSelect())
    expect(startButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('with no Claude agent it says so and blocks the start with a description', async () => {
    api.fetchAgents.mockResolvedValue([AGENTS[1], AGENTS[3]])
    const { onCreated } = setup()
    const message = await screen.findByText('Nenhum agente Claude cadastrado.')
    expect(startButton().getAttribute('aria-disabled')).toBe('true')
    expect(startButton().getAttribute('aria-describedby')).toBe(message.id)
    fireEvent.click(startButton())
    expect(chatApi.createSession).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('a failed agent load says so and lets the user retry', async () => {
    api.fetchAgents.mockRejectedValueOnce(new Error('down'))
    setup()
    expect(await screen.findByText('Não foi possível carregar os agentes.')).toBeTruthy()
    expect(startButton().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await ready()
    expect([...agentSelect().options]).toHaveLength(2)
  })
})

describe('NewChatDialog creating', () => {
  it('creates the chat in the project with the chosen agent and reports the new key', async () => {
    const { onCreated } = setup()
    await ready()
    fireEvent.change(agentSelect(), { target: { value: 'revisor' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Pessoal/tn::claude::new001'))
    expect(chatApi.createSession).toHaveBeenCalledWith({ projectRef: 'Pessoal/tn', agentId: 'revisor' })
    expect(chatApi.renameSession).not.toHaveBeenCalled()
  })

  it('a title is applied by renaming the new chat', async () => {
    const { onCreated } = setup()
    await ready()
    fireEvent.change(screen.getByLabelText('Título (opcional)'), { target: { value: '  Plano de migração  ' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(chatApi.renameSession).toHaveBeenCalledWith('Pessoal/tn::claude::new001', 'Plano de migração')
  })

  it('a refused title does not undo the chat: it still opens', async () => {
    chatApi.renameSession.mockRejectedValue(new Error('no'))
    const { onCreated } = setup()
    await ready()
    fireEvent.change(screen.getByLabelText('Título (opcional)'), { target: { value: 'x' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Pessoal/tn::claude::new001'))
  })

  it('Enter in the title field starts the chat', async () => {
    const { onCreated } = setup()
    await ready()
    fireEvent.submit(screen.getByLabelText('Título (opcional)').closest('form'))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })

  it('while creating the button is busy "Iniciando…" and a second press does not create twice', async () => {
    let release
    chatApi.createSession.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    const { onCreated } = setup()
    await ready()
    fireEvent.click(startButton())
    await waitFor(() => expect(startButton().getAttribute('aria-busy')).toBe('true'))
    expect(startButton().textContent).toBe('Iniciando…')
    fireEvent.click(startButton())
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
    release({ session_key: 'Pessoal/tn::claude::new002', status: 'new' })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Pessoal/tn::claude::new002'))
  })

  it('a refused creation shows the reason, keeps the dialog and the form, and allows another try', async () => {
    chatApi.createSession.mockRejectedValueOnce(new Error('503'))
    const { onCreated, onClose } = setup()
    await ready()
    fireEvent.change(screen.getByLabelText('Título (opcional)'), { target: { value: 'meu título' } })
    fireEvent.click(startButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível criar o chat. Tente de novo.')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Título (opcional)').value).toBe('meu título')
    expect(startButton().textContent).toBe('Iniciar chat')
    fireEvent.click(startButton())
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
})

describe('NewChatDialog closing', () => {
  it('Cancelar and Esc close it without creating anything', async () => {
    const { onClose } = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(chatApi.createSession).not.toHaveBeenCalled()
  })
})
