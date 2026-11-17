import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'

// The highlighter is heavy (wasm grammars): a stand-in that colours every line proves the upgrade path.
vi.mock('shiki', () => ({
  codeToTokens: vi.fn(async (code) => ({
    tokens: code.replace(/\n$/, '').split('\n').map((line) => [{ content: line, color: '#aa0000', fontStyle: 0 }]),
  })),
}))

installDialogElementStub()

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const f = frames(KEY)
const META = {
  session_key: KEY,
  project_ref: 'Pessoal/tn-sandbox',
  agent_id: 'claude',
  display_name: 'Revisar o deploy',
  engine: 'chat',
  origin: 'v3',
  status: 'idle',
  live_status: 'idle',
  pending_permissions: 0,
  needs_attention: false,
  model: 'haiku',
  permission_mode: 'default',
  last_error: null,
  updated_at: Date.now() / 1000,
}

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(chatApi, 'decidePermission').mockResolvedValue({})
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
  vi.spyOn(chatApi, 'resetSession').mockResolvedValue({})
  vi.spyOn(chatApi, 'renameSession').mockResolvedValue({})
  vi.spyOn(chatApi, 'terminateSession').mockResolvedValue({})
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  delete window.__pwned
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function renderScreen({ chats = [META], graceKeys = [], loaded = true, liveAvailable = true } = {}) {
  const spies = {
    goTo: vi.fn(),
    openChat: vi.fn(),
    registerCreated: vi.fn(),
    refresh: vi.fn(),
    setFocusedKey: vi.fn(),
  }
  const reports = []
  const value = { ...INERT_SESSIONS, chats, graceKeys, loaded, liveAvailable, ...spies }
  const view = render(
    <IslandProvider value={(report) => reports.push(report)}>
      <ProjectsSessionsContext.Provider value={value}>
        <ChatSessionHost activeKey={KEY}>
          <ChatScreen sessionKey={KEY} />
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>,
  )
  await act(async () => {})
  return { ...view, ...spies, reports }
}

const play = (...events) => act(() => events.forEach((event) => lastSocket().receive(event)))
const open = () => act(() => lastSocket().open())
async function ready(options) {
  const view = await renderScreen(options)
  open()
  play(f('replay.complete', null, { last_seq: 0 }))
  return view
}
// Persisted events carry a growing seq; the cards and their resolutions take the next ones.
let seqCounter = 100
const nextSeq = () => {
  seqCounter += 1
  return seqCounter
}
const resolved = (id, status, extra = {}) => f('permission.resolved', nextSeq(), { id, status, ...extra })
const turnStart = (seq = 1, text = 'oi') => f('message.user', seq, { client_msg_id: `c${seq}`, text, origin: 'ui' })
const assistant = (seq, messageId, blocks) => f('message.assistant', seq, { message_id: messageId, blocks })
const card = (id, extra = {}) => f('permission.request', nextSeq(), {
  id, kind: 'tool', tool_name: 'Bash', tool_use_id: `tool-${id}`, input: { command: 'npm test' }, allow_session: false, connector: null, ...extra,
})
const composer = () => screen.getByRole('combobox', { name: 'Mensagem para o agente' })

describe('ChatScreen opening states', () => {
  it('shows the opening skeleton, a disabled composer and the chat title until the replay is over', async () => {
    await renderScreen()
    expect(screen.getByRole('heading', { level: 1, name: 'Revisar o deploy' })).toBeTruthy()
    expect(screen.getByText('Abrindo a conversa…')).toBeTruthy()
    expect(composer().getAttribute('aria-disabled')).toBe('true')
    expect(composer().readOnly).toBe(true)
    expect(composer().getAttribute('placeholder')).toBe('Mensagem para o agente, ou / para comandos')
  })

  it('an empty chat invites the user to write, with the composer ready', async () => {
    await ready()
    expect(screen.getByRole('heading', { level: 2, name: 'Converse com Claude' })).toBeTruthy()
    expect(screen.getByText('Escreva uma mensagem ou digite / para ver os comandos.')).toBeTruthy()
    expect(composer().getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByText('Abrindo a conversa…')).toBeNull()
  })

  it('the screen is the chat section with the list on the left and the open chat marked', async () => {
    await ready()
    expect(document.querySelector('[data-session-key]').getAttribute('data-session-key')).toBe(KEY)
    expect(screen.getByRole('navigation', { name: 'Chats do projeto' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Revisar o deploy/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('header chips: agent, project, model, permission mode, state', async () => {
    await ready()
    const header = screen.getByRole('heading', { level: 1 }).closest('header')
    for (const text of ['Claude', 'tn-sandbox', 'haiku', 'Pede aprovação', 'Parado']) {
      expect(within(header).getByText(text)).toBeTruthy()
    }
  })

  it('the title falls back to the first message and then to "Nova conversa"', async () => {
    await ready({ chats: [{ ...META, display_name: null }] })
    expect(screen.getByRole('heading', { level: 1, name: 'Nova conversa' })).toBeTruthy()
    play(turnStart(1, 'Quero revisar o PR 42'))
    expect(screen.getByRole('heading', { level: 1, name: 'Quero revisar o PR 42' })).toBeTruthy()
  })

  it('a refused (unknown) conversation says so and goes back to Projects; not while it was just created', async () => {
    const view = await renderScreen()
    act(() => lastSocket().drop(4404))
    expect(await screen.findByRole('heading', { level: 1, name: 'Não encontramos esta conversa.' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Projetos' }))
    expect(view.goTo).toHaveBeenCalledWith('/projects')
    cleanup()
    resetSockets()
    await renderScreen({ graceKeys: [KEY] })
    act(() => lastSocket().drop(4404))
    expect(screen.queryByText('Não encontramos esta conversa.')).toBeNull()
    expect(screen.getByText('Abrindo a conversa…')).toBeTruthy()
  })
})

describe('ChatScreen conversation (CA35)', () => {
  it('streams a reply into one bubble with the cursor, then the final text replaces it', async () => {
    await ready()
    play(turnStart(1), f('message.delta', null, { message_id: 'm1', text: 'Olá, ' }), f('message.delta', null, { message_id: 'm1', text: 'mundo' }))
    const streaming = screen.getByRole('article', { name: 'Mensagem de Claude' })
    expect(streaming.querySelector('.v3-chat-prose').textContent.trim()).toBe('Olá, mundo')
    expect(streaming.getAttribute('aria-busy')).toBe('true')
    expect(streaming.getAttribute('aria-live')).toBe('off')
    expect(streaming.querySelector('.v3-chat-cursor')).toBeTruthy()
    expect(screen.queryByText(/Respondendo · turno/)).toBeNull() // the bubble itself shows the activity

    play(assistant(2, 'm1', [{ type: 'text', text: 'Olá, **mundo**' }]))
    const final = screen.getByRole('article', { name: 'Mensagem de Claude' })
    expect(final.querySelector('strong').textContent).toBe('mundo')
    expect(final.getAttribute('aria-busy')).toBeNull()
    expect(final.querySelector('.v3-chat-cursor')).toBeNull()
    expect(screen.getAllByRole('article', { name: 'Mensagem de Claude' })).toHaveLength(1)
  })

  it('shows "Respondendo · turno 0:00" with Interromper in the header AND in the composer while a turn runs', async () => {
    await ready()
    play(turnStart(1))
    expect(screen.getByText('Respondendo · turno 0:00')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Interromper turno' })).toHaveLength(2)
    expect(screen.getByText('Aguardando a resposta. Esc interrompe.')).toBeTruthy()
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Claude está trabalhando. Aviso quando terminar.')).toBe(false) // that is the island's, not the thread's
    play(f('turn.ended', 2, { subtype: 'success', is_error: false, duration_ms: 42000, cost_usd: 0.03 }))
    expect(screen.queryByRole('button', { name: 'Interromper turno' })).toBeNull()
    expect(screen.queryByText(/Respondendo · turno/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeTruthy()
  })

  it('says which tool runs, and after the turn the duration and the cost', async () => {
    await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
    )
    expect(screen.getByText('Usando Bash · turno 0:00')).toBeTruthy()
    play(f('tool.result', 3, { tool_use_id: 't1', is_error: false, content: 'ok' }), assistant(4, 'm2', [{ type: 'text', text: 'pronto' }]))
    play(f('turn.ended', 5, { subtype: 'success', is_error: false, duration_ms: 42000, cost_usd: 0.03 }))
    expect(screen.getByText('Concluído em 42 s · US$ 0,03')).toBeTruthy()
  })

  it('does not announce a turn that was only replayed from the log', async () => {
    await renderScreen()
    open()
    // the thread is already on screen when the rest of the history arrives
    play(turnStart(1))
    play(assistant(2, 'm1', [{ type: 'text', text: 'antiga' }]), f('turn.ended', 3, { subtype: 'success', is_error: false, duration_ms: 1000 }))
    expect(screen.getAllByRole('status').map((node) => node.textContent)).not.toContain('Resposta de Claude concluída.')
    play(f('replay.complete', null, { last_seq: 3 }))
    expect(screen.getByText('antiga')).toBeTruthy()
    expect(screen.getAllByRole('status').map((node) => node.textContent)).not.toContain('Resposta de Claude concluída.')
  })

  it('announces the end of the reply once, politely', async () => {
    await ready()
    play(turnStart(1))
    expect(screen.getAllByRole('status').map((node) => node.textContent)).not.toContain('Resposta de Claude concluída.')
    play(assistant(2, 'm1', [{ type: 'text', text: 'oi' }]), f('turn.ended', 3, { subtype: 'success', is_error: false, duration_ms: 1000 }))
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain('Resposta de Claude concluída.')
    play(turnStart(4, 'outra'))
    expect(screen.getAllByRole('status').map((node) => node.textContent)).not.toContain('Resposta de Claude concluída.')
  })

  it('the thread is a labelled, focusable log', async () => {
    await ready()
    play(turnStart(1))
    const log = screen.getByRole('log', { name: 'Mensagens do chat' })
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(log.getAttribute('aria-relevant')).toBe('additions')
    expect(log.tabIndex).toBe(0)
  })

  it('shows the user message as a right-hand bubble with "Você · hh:mm"', async () => {
    await ready()
    play(turnStart(1, 'faça isso'))
    const mine = screen.getByRole('article', { name: 'Mensagem de Você' })
    expect(within(mine).getByText('faça isso')).toBeTruthy()
    expect(mine.textContent).toMatch(/Você · \d\d:\d\d/)
  })

  it('a turn that ends in error shows the error bubble with a collapsed technical detail', async () => {
    await ready()
    play(turnStart(1), f('turn.ended', 2, { subtype: 'error_during_execution', is_error: true, terminal_reason: 'model_error' }))
    const error = screen.getByRole('group', { name: 'Erro no turno' })
    expect(error.textContent).toContain('A resposta foi interrompida por um erro. Você pode enviar a mensagem de novo.')
    expect(within(error).getByText('Detalhe técnico')).toBeTruthy()
  })

  it('an interruption is a divider, not an error, and the partial bubble says so', async () => {
    await ready()
    play(turnStart(1), f('message.delta', null, { message_id: 'm1', text: 'parcial' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Interromper turno' })[0])
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'interrupt' })
    play(f('turn.ended', 2, { subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' }))
    expect(screen.getByText('Turno interrompido.')).toBeTruthy()
    expect(screen.getByText('(interrompida)')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Erro no turno' })).toBeNull()
  })

  it('system rows: model change, new conversation, imported history', async () => {
    await ready()
    play(
      f('history.imported', 1, { count: 0 }),
      f('model.changed', 2, { model: 'haiku' }),
      f('session.reset', 3),
    )
    expect(screen.getByText('Histórico importado do terminal')).toBeTruthy()
    expect(screen.getByText('Modelo trocado para haiku.')).toBeTruthy()
    expect(screen.getByText('Conversa nova iniciada.')).toBeTruthy()
  })
})

describe('ChatScreen markdown, code and XSS', () => {
  it('renders markdown: lists, tables and inline code', async () => {
    await ready()
    play(turnStart(1), assistant(2, 'm1', [{ type: 'text', text: '- um\n- dois\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nuse `npm test`' }]))
    const bubble = screen.getByRole('article', { name: 'Mensagem de Claude' })
    expect(bubble.querySelectorAll('li')).toHaveLength(2)
    expect(bubble.querySelector('table')).toBeTruthy()
    expect(bubble.querySelector('code').textContent).toBe('npm test')
  })

  it('a code block scrolls inside itself (focusable, named) and is highlighted once the highlighter loads', async () => {
    await ready()
    play(turnStart(1), assistant(2, 'm1', [{ type: 'text', text: '```python\nprint("oi")\nx = 1\n```' }]))
    const block = screen.getByRole('group', { name: 'Bloco de código' })
    expect(block.tagName).toBe('PRE')
    expect(block.tabIndex).toBe(0)
    expect(block.textContent).toContain('print("oi")') // plain first
    await waitFor(() => expect(block.querySelector('code').dataset.highlighted).toBe('true'))
    const spans = block.querySelectorAll('code > span')
    expect(spans).toHaveLength(2)
    expect(spans[0].style.color).toBe('rgb(170, 0, 0)')
    expect(block.textContent).toBe('print("oi")\nx = 1')
  })

  it('does not highlight while the message is still streaming', async () => {
    await ready()
    play(turnStart(1), f('message.delta', null, { message_id: 'm1', text: '```python\nprint(1)\n```' }))
    await act(async () => {})
    expect(document.querySelector('code[data-highlighted]')).toBeNull()
  })

  it('links open in a new tab with rel noopener noreferrer', async () => {
    await ready()
    play(turnStart(1), assistant(2, 'm1', [{ type: 'text', text: '[docs](https://example.com/a)' }]))
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('XSS in the agent text: no script, no event handler, no javascript: link becomes active', async () => {
    await ready()
    const hostile = [
      '<script>window.__pwned = 1</script>',
      '<img src="x" onerror="window.__pwned = 2">',
      '<a href="javascript:window.__pwned=3">clique</a>',
      '[md](javascript:window.__pwned=4)',
      '<div onclick="window.__pwned=5">x</div>',
      '<svg onload="window.__pwned=6"></svg>',
    ].join('\n\n')
    play(turnStart(1), assistant(2, 'm1', [{ type: 'text', text: hostile }]))
    const bubble = screen.getByRole('article', { name: 'Mensagem de Claude' })
    expect(bubble.querySelector('script')).toBeNull()
    expect(bubble.querySelector('img[onerror]')).toBeNull()
    for (const element of bubble.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith('on')).toBe(false)
        if (attribute.name === 'href') expect(attribute.value.toLowerCase().startsWith('javascript:')).toBe(false)
      }
    }
    expect(window.__pwned).toBeUndefined()
  })

  it('XSS in what the user typed and in tool input/result: it is text, never a node', async () => {
    await ready()
    const payload = '<img src=x onerror="window.__pwned=7"><script>window.__pwned=8</script>'
    play(
      turnStart(1, payload),
      assistant(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: payload } }]),
      f('tool.result', 3, { tool_use_id: 't1', is_error: false, content: payload }),
    )
    const mine = screen.getByRole('article', { name: 'Mensagem de Você' })
    expect(mine.textContent).toContain(payload)
    expect(document.querySelector('.v3-chat-thread img, .v3-chat-thread script')).toBeNull()
    const chip = document.querySelector('.v3-chat-chip')
    expect([...chip.querySelectorAll('.v3-chat-chip__block')].map((block) => block.textContent)).toEqual([payload, payload])
    expect(window.__pwned).toBeUndefined()
  })

  it('XSS in the permission card (command, diff, plan, question) is text', async () => {
    await ready()
    const payload = '<img src=x onerror="window.__pwned=9">'
    play(
      card('p1', { input: { command: payload } }),
      card('p2', { tool_name: 'Edit', tool_use_id: 'tool-p2', input: { file_path: '/a.txt', old_string: payload, new_string: `${payload}<script>1</script>` } }),
      card('p3', { kind: 'plan', tool_name: 'ExitPlanMode', tool_use_id: null, input: { plan: payload } }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalhes' })[0])
    expect(document.querySelector('.v3-chat-thread img, .v3-chat-thread script')).toBeNull()
    expect(document.querySelector('.v3-approval__object').textContent).toBe(payload)
    expect(window.__pwned).toBeUndefined()
  })

  it('a `thinking` block is never shown, whatever the event carries', async () => {
    await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [
        { type: 'thinking', thinking: 'SEGREDO-PENSAMENTO', signature: 'SEGREDO-ASSINATURA' },
        { type: 'text', text: 'resposta visível' },
      ]),
      f('message.delta', null, { message_id: 'm2', text: 'delta visível' }),
      f('system.notice', 4, { kind: 'info', text: 'aviso visível' }),
    )
    const text = document.body.textContent
    expect(text).toContain('resposta visível')
    expect(text).toContain('delta visível')
    expect(text).not.toContain('SEGREDO-PENSAMENTO')
    expect(text).not.toContain('SEGREDO-ASSINATURA')
    expect(screen.queryByText(/pensamento/i)).toBeNull()
  })
})

describe('ChatScreen tool chips (CA35)', () => {
  it('every tool is a chip with its state in text: running, done, failed, denied', async () => {
    await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.txt' } },
        { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: '/a/c.txt', old_string: 'a', new_string: 'b' } },
      ]),
    )
    const chips = () => [...document.querySelectorAll('.v3-chat-chip')]
    expect(chips().map((chip) => chip.querySelector('summary').textContent)).toEqual([
      'Rodou `npm test`, em execução',
      'Leu 1 arquivo, em execução',
      'Editou c.txt, em execução',
    ])
    play(
      f('tool.result', 3, { tool_use_id: 't1', is_error: false, content: 'ok' }),
      f('tool.result', 4, { tool_use_id: 't2', is_error: true, content: 'não existe' }),
    )
    expect(chips().map((chip) => chip.querySelector('.v3-chat-chip__state').textContent)).toEqual(['feito', 'falhou', 'em execução'])
  })

  it('opening a chip shows the input and the result as text; a cut result says so', async () => {
    await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat a.txt' } }]),
      f('tool.result', 3, { tool_use_id: 't1', is_error: false, content: 'conteúdo do arquivo', truncated: true }),
    )
    const chip = document.querySelector('.v3-chat-chip')
    fireEvent.click(chip.querySelector('summary'))
    expect(chip.hasAttribute('open')).toBe(true)
    expect(within(chip).getByText('ENTRADA')).toBeTruthy()
    expect(within(chip).getByText('cat a.txt', { selector: 'pre' })).toBeTruthy()
    expect(within(chip).getByText('RESULTADO')).toBeTruthy()
    expect(within(chip).getByText('conteúdo do arquivo')).toBeTruthy()
    expect(within(chip).getByText('Resultado resumido pelo chat.')).toBeTruthy()
  })

  it('a chip waits "aguardando você" while its card is pending and "negado" after a denial', async () => {
    await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [{ type: 'tool_use', id: 'tool-p1', name: 'Bash', input: { command: 'rm -rf x' } }]),
      card('p1', { input: { command: 'rm -rf x' } }),
    )
    expect(document.querySelector('.v3-chat-chip__state').textContent).toBe('aguardando você')
    play(resolved('p1', 'denied', { by: 'rest', scope: 'once' }))
    expect(document.querySelector('.v3-chat-chip__state').textContent).toBe('negado')
  })
})

describe('ChatScreen approvals (CA36, CA37)', () => {
  it('a request shows its card after the message that asked for it, with the pending strip and the island', async () => {
    const view = await ready()
    play(
      turnStart(1),
      assistant(2, 'm1', [{ type: 'tool_use', id: 'tool-p1', name: 'Bash', input: { command: 'npm test' } }]),
      card('p1'),
    )
    const group = screen.getByRole('group', { name: 'Pedido de permissão' })
    expect(within(group).getByText('Claude')).toBeTruthy()
    expect(within(group).getByText('quer rodar')).toBeTruthy()
    expect(within(group).getByText('tn-sandbox')).toBeTruthy()
    const turnBlock = group.closest('.v3-chat-turnblock')
    expect(turnBlock.querySelector('article')).toBeTruthy()
    expect(screen.getByText('1 aprovação pendente', { selector: '.v3-chat-pending__text' })).toBeTruthy()
    expect(view.reports.at(-1)).toMatchObject({ message: 'Claude está esperando você.', state: 'alert', moduleId: 'projects' })
    expect(within(screen.getByRole('link', { name: /Revisar o deploy/ })).getByText('Precisa de você')).toBeTruthy()
  })

  it('"Ver pedido" scrolls to the first pending card and focuses it', async () => {
    await ready()
    play(turnStart(1), card('p1'), card('p2'))
    expect(screen.getByText('2 aprovações pendentes', { selector: '.v3-chat-pending__text' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver pedido' }))
    expect(document.activeElement.getAttribute('data-card-id')).toBe('p1')
    expect(document.activeElement.hasAttribute('data-pending')).toBe(true)
  })

  it('names a pending question and a plan in the strip', async () => {
    await ready()
    play(card('q1', { kind: 'question', tool_name: 'AskUserQuestion', tool_use_id: null, input: { questions: [{ question: 'Qual banco?', options: [{ label: 'SQLite' }] }] } }))
    expect(screen.getByText('Pergunta pendente')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pergunta do agente' })).toBeTruthy()
    cleanup()
    resetSockets()
    await ready()
    play(card('pl1', { kind: 'plan', tool_name: 'ExitPlanMode', tool_use_id: null, input: { plan: 'passo 1' } }))
    expect(screen.getByText('Plano para aprovar', { selector: '.v3-chat-pending__text' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Plano para aprovar' })).toBeTruthy()
  })

  it('Permitir sends the decision, shows "Enviando…", and the resolution turns the card into one line and frees the composer focus', async () => {
    await ready()
    play(turnStart(1), card('p1'))
    const allow = screen.getByRole('button', { name: 'Permitir' })
    allow.focus()
    fireEvent.click(allow)
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'allow', scope: 'once' })
    expect(document.activeElement).toBe(composer())
    expect(screen.getByRole('button', { name: 'Enviando…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => {})
    play(resolved('p1', 'allowed', { by: 'rest', scope: 'once' }))
    const line = screen.getByText('Você permitiu', { exact: false })
    expect(line.closest('[data-status]').getAttribute('data-status')).toBe('allowed')
    expect(screen.queryByRole('button', { name: 'Permitir' })).toBeNull()
    expect(screen.queryByText('1 aprovação pendente')).toBeNull()
  })

  it('"Permitir nesta conversa" exists only when the server allows it', async () => {
    await ready()
    play(card('p1', { allow_session: false }))
    expect(screen.queryByRole('button', { name: 'Permitir nesta conversa' })).toBeNull()
    play(card('p2', { allow_session: true, tool_name: 'Write', tool_use_id: 'tool-p2', input: { file_path: '/a.txt', content: 'x' } }))
    const sessionButtons = screen.getAllByRole('button', { name: 'Permitir nesta conversa' })
    expect(sessionButtons).toHaveLength(1)
    fireEvent.click(sessionButtons[0])
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p2', { behavior: 'allow', scope: 'session' })
  })

  it('never offers "nesta conversa" for a connector, even if the server said so', async () => {
    await ready()
    play(card('p1', { allow_session: true, connector: 'Atlassian', tool_name: 'mcp__claude_ai_Atlassian__search' }))
    expect(screen.queryByRole('button', { name: 'Permitir nesta conversa' })).toBeNull()
    expect(screen.getByText('Conector da sua conta: Atlassian')).toBeTruthy()
  })

  it('"Negar" with a reason, and "Negar e parar", reach the server as designed', async () => {
    await ready()
    play(card('p1'), card('p2'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Negar' })[0])
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'não agora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar negação' }))
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'deny', message: 'não agora', scope: 'once' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Negar e parar' })[1])
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p2', { behavior: 'deny', interrupt: true, scope: 'once' })
  })

  it('a denial with no reason sends no message', async () => {
    await ready()
    play(card('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar negação' }))
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'deny', scope: 'once' })
  })

  it('a decision made elsewhere reads "Decidido em outro dispositivo."; a lost reopening reads "Expirou…"', async () => {
    await ready()
    play(card('p1'), card('p2'))
    play(
      resolved('p1', 'allowed', { by: 'rest', scope: 'once' }),
      resolved('p2', 'expired', { by: 'system' }),
    )
    expect(screen.getByText('Decidido em outro dispositivo.')).toBeTruthy()
    expect(screen.getByText('Expirou ao reabrir a conversa.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Permitir' })).toHaveLength(0)
  })

  it('a failed send of the decision puts the buttons back with the error', async () => {
    chatApi.decidePermission.mockRejectedValue(new Error('down'))
    await ready()
    play(card('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Não foi possível enviar sua decisão. Tente de novo.'))
    expect(screen.getByRole('button', { name: 'Permitir' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('shows the diff of an edit with textual signs, as text', async () => {
    await ready()
    play(card('p1', { tool_name: 'Edit', input: { file_path: '/a/app.py', old_string: 'x = 1', new_string: 'x = 2' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    const diff = screen.getByRole('group', { name: 'Alterações propostas' })
    expect(diff.querySelector('.v3-chat-diff__line--remove').textContent).toContain('−')
    expect(diff.querySelector('.v3-chat-diff__line--remove').textContent).toContain('x = 1')
    expect(diff.querySelector('.v3-chat-diff__line--add').textContent).toContain('+')
    expect(diff.querySelector('.v3-chat-diff__line--add').textContent).toContain('x = 2')
  })
})

describe('ChatScreen status banners (R-REC)', () => {
  const bannerText = () => screen.getByRole('alert').textContent

  it('spawn_failed for a missing claude: exact text, retry, composer blocked with its reason', async () => {
    await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'cli_not_found', detail: 'x' }))
    expect(bannerText()).toContain('Não foi possível iniciar o chat')
    expect(bannerText()).toContain('O claude não foi encontrado ou está desatualizado. Instale ou atualize o claude, ou defina CHAT_CLI_PATH, e tente de novo.')
    expect(composer().getAttribute('placeholder')).toBe('Chat indisponível. Veja o aviso acima.')
    expect(composer().getAttribute('aria-disabled')).toBe('true')
    expect(composer().readOnly).toBe(true)
    expect(composer().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
    expect(screen.queryByRole('button', { name: /Abrir no chat|Abrir no terminal/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(chatApi.openSession).toHaveBeenCalledWith(KEY)
  })

  it('a draft typed before the failure is kept, and the composer says so', async () => {
    await ready()
    fireEvent.change(composer(), { target: { value: 'meu rascunho' } })
    expect(screen.queryByText('Rascunho guardado. O envio volta quando reconectar.')).toBeNull()
    play(f('status', 1, { code: 'spawn_failed', reason: 'cli_not_found' }))
    expect(composer().value).toBe('meu rascunho')
    expect(screen.getByText('Rascunho guardado. O envio volta quando reconectar.')).toBeTruthy()
  })

  it('does not reconnect by itself after a failed start (SP8)', async () => {
    vi.useFakeTimers()
    await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'cli_not_found' }))
    const before = FakeWebSocket.instances.length
    act(() => lastSocket().drop(1006))
    act(() => vi.advanceTimersByTime(60000))
    expect(FakeWebSocket.instances).toHaveLength(before)
  })

  it('spawn_failed for a missing folder', async () => {
    await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'folder_unavailable' }))
    expect(bannerText()).toContain('A pasta do projeto não foi encontrada. Verifique o projeto.')
  })

  it('spawn_failed by an exposed connector: security wording, "Abrir de novo", no promise about connectors', async () => {
    await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'connector_exposed' }))
    expect(bannerText()).toContain('O chat foi encerrado por segurança')
    expect(bannerText()).toContain('Um conector da sua conta que não está liberado apareceu na sessão. Nada foi executado por ele.')
    expect(screen.getByRole('button', { name: 'Abrir de novo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Conectores no chat' })).toBeTruthy()
    expect(bannerText()).not.toMatch(/não carrega/i)
  })

  it('any other spawn failure: generic text with the technical detail folded', async () => {
    await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'process_error', detail: 'connect timed out after 60s' }))
    expect(bannerText()).toContain('Tente de novo em instantes.')
    const details = screen.getByRole('alert').querySelector('details')
    expect(details.textContent).toContain('Detalhe técnico')
    expect(details.textContent).toContain('connect timed out after 60s')
  })

  it('engine_unavailable: no retry', async () => {
    await ready()
    play(f('status', 1, { code: 'engine_unavailable', detail: 'sdk missing' }))
    expect(bannerText()).toContain('O chat ainda não está disponível neste servidor')
    expect(bannerText()).toContain('Falta atualizar as dependências. Peça um deploy normal ou rode pip install -r.')
    expect(within(screen.getByRole('alert')).queryAllByRole('button')).toHaveLength(0)
  })

  it('resume_failed: "Iniciar nova conversa" resets, and the history stays visible', async () => {
    await ready()
    play(turnStart(1, 'antiga'), assistant(2, 'm1', [{ type: 'text', text: 'resposta antiga' }]), f('status', 3, { code: 'resume_failed', detail: 'x' }))
    expect(bannerText()).toContain('Não foi possível retomar esta conversa')
    expect(bannerText()).toContain('O histórico abaixo continua guardado, mas o agente não lembra dele.')
    expect(screen.getByText('resposta antiga')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar nova conversa' }))
    expect(chatApi.resetSession).toHaveBeenCalledWith(KEY)
    await act(async () => {})
    play(f('session.reset', 4))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(composer().getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByText('Conversa nova iniciada.')).toBeTruthy()
  })

  it('a failed history import is an informative note, not an alert, and does not block the composer', async () => {
    await ready()
    play(f('history.import_failed', 1, { reason: 'timeout' }))
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('Não foi possível importar o histórico')
    expect(note.textContent).toContain('Ele continua disponível no terminal.')
    expect(composer().getAttribute('aria-disabled')).toBeNull()
  })

  it('the island says the chat did not open when it failed', async () => {
    const view = await ready()
    play(f('status', 1, { code: 'spawn_failed', reason: 'cli_not_found' }))
    expect(view.reports.at(-1)).toMatchObject({ message: 'Esse chat não abriu. Veja o aviso.', state: 'alert' })
    expect(within(screen.getByRole('heading', { level: 1 }).closest('header')).getByText('Falhou ao iniciar')).toBeTruthy()
  })

  it('a dropped network shows "Reconectando…" and keeps the messages', async () => {
    vi.useFakeTimers()
    await ready()
    play(turnStart(1, 'continua visível'))
    act(() => lastSocket().drop(1006))
    expect(screen.getByText('Reconectando…')).toBeTruthy()
    expect(screen.getByText('Repetindo os eventos que você perdeu. Seu rascunho está guardado.')).toBeTruthy()
    expect(screen.getByText('continua visível')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tentar agora' })).toBeNull()
  })

  it('after 5 failures in a row: "Sem conexão" with "Tentar agora", which reconnects', async () => {
    vi.useFakeTimers()
    await ready()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      act(() => lastSocket().drop(1006))
      if (attempt < 4) act(() => vi.advanceTimersByTime(40000))
    }
    expect(screen.getByText('Sem conexão')).toBeTruthy()
    expect(screen.getByText('Não conseguimos falar com o servidor. Seu rascunho está guardado.')).toBeTruthy()
    const before = FakeWebSocket.instances.length
    fireEvent.click(screen.getByRole('button', { name: 'Tentar agora' }))
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
  })

  it('4429 says too many tabs, with no automatic reconnection', async () => {
    vi.useFakeTimers()
    await ready()
    const before = FakeWebSocket.instances.length
    act(() => lastSocket().drop(4429))
    expect(screen.getByText('Muitas abas abertas nesta conversa')).toBeTruthy()
    act(() => vi.advanceTimersByTime(60000))
    expect(FakeWebSocket.instances).toHaveLength(before)
  })

  it('an action that failed (reset / open) is reported', async () => {
    chatApi.resetSession.mockRejectedValue(new Error('x'))
    await ready()
    play(f('status', 1, { code: 'resume_failed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar nova conversa' }))
    await waitFor(() => expect(screen.getByText('Não foi possível concluir a ação. Tente de novo.')).toBeTruthy())
  })
})

describe('ChatScreen composer and keyboard (CA37)', () => {
  it('Enter sends, Shift+Enter breaks the line, and the draft is cleared', async () => {
    await ready()
    fireEvent.change(composer(), { target: { value: 'primeira' } })
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true })
    expect(lastSocket().sent).toHaveLength(0)
    fireEvent.keyDown(composer(), { key: 'Enter' })
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'send', text: 'primeira' })
    expect(composer().value).toBe('')
    expect(screen.getByText('primeira')).toBeTruthy() // optimistic bubble
  })

  it('the send button is aria-disabled while empty and sends when there is text', async () => {
    await ready()
    const send = screen.getByRole('button', { name: 'Enviar mensagem' })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(send)
    expect(lastSocket().sent).toHaveLength(0)
    fireEvent.change(composer(), { target: { value: 'oi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'send', text: 'oi' })
  })

  it('while a turn runs Enter does not send, but the text stays editable', async () => {
    await ready()
    play(turnStart(1))
    fireEvent.change(composer(), { target: { value: 'próxima' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })
    expect(lastSocket().sent.filter((frame) => frame.type === 'send')).toHaveLength(0)
    expect(composer().value).toBe('próxima')
  })

  it('Esc interrupts a running turn from inside the panel', async () => {
    await ready()
    play(turnStart(1))
    fireEvent.keyDown(composer(), { key: 'Escape' })
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'interrupt' })
    expect(screen.getAllByRole('button', { name: 'Interrompendo turno' })).toHaveLength(2)
    fireEvent.keyDown(composer(), { key: 'Escape' })
    expect(lastSocket().sent.filter((frame) => frame.type === 'interrupt')).toHaveLength(1)
  })

  it('Esc does nothing when no turn runs, and never decides a card', async () => {
    await ready()
    fireEvent.keyDown(composer(), { key: 'Escape' })
    expect(lastSocket().sent).toHaveLength(0)
    play(turnStart(1), card('p1'))
    fireEvent.keyDown(screen.getByRole('group', { name: 'Pedido de permissão' }), { key: 'Escape' })
    expect(chatApi.decidePermission).not.toHaveBeenCalled()
  })

  it('Esc in the denial reason box closes only the box (the turn keeps running)', async () => {
    await ready()
    play(turnStart(1), card('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Negar' }))
    fireEvent.keyDown(screen.getByLabelText('Motivo (opcional)'), { key: 'Escape' })
    expect(screen.queryByLabelText('Motivo (opcional)')).toBeNull()
    expect(lastSocket().sent.filter((frame) => frame.type === 'interrupt')).toHaveLength(0)
  })

  it('a message the server refused is marked "Não enviada" and can be sent again', async () => {
    await ready()
    fireEvent.change(composer(), { target: { value: 'tente' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })
    const { request_id: requestId } = lastSocket().sent.at(-1)
    play(f('command.rejected', null, { request_id: requestId, code: 'capacity_exceeded', message: 'x' }))
    expect(screen.getByText('Não enviada')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de novo' }))
    expect(lastSocket().sent.filter((frame) => frame.type === 'send')).toHaveLength(2)
  })

  it('keeps the draft in memory only (per-chat switching is covered in useChatSession.test)', async () => {
    await ready()
    fireEvent.change(composer(), { target: { value: 'rascunho guardado' } })
    expect(composer().value).toBe('rascunho guardado')
    expect(window.localStorage.length).toBe(0)
  })
})

describe('ChatScreen header actions and the island', () => {
  it('"Interromper" shows only while a turn runs', async () => {
    await ready()
    expect(screen.queryByRole('button', { name: 'Interromper turno' })).toBeNull()
    play(turnStart(1))
    expect(screen.getAllByRole('button', { name: 'Interromper turno' })).toHaveLength(2)
  })

  it('renames the chat from the header menu', async () => {
    const view = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear chat' }))
    const input = screen.getByRole('textbox', { name: 'Novo nome do chat' })
    expect(input.value).toBe('Revisar o deploy')
    fireEvent.change(input, { target: { value: 'Outro nome' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(chatApi.renameSession).toHaveBeenCalledWith(KEY, 'Outro nome'))
    await waitFor(() => expect(view.refresh).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
  })

  it('the menu of the header offers rename, the connectors of the agent and ending the chat', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Renomear chat', 'Conectores do agente…', 'Encerrar chat'])
  })

  it('ending the chat asks first, with the focus on Cancelar, then terminates and goes back to Projects', async () => {
    const view = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar chat' }))
    const dialog = screen.getByRole('dialog', { name: 'Encerrar esta conversa?' })
    expect(within(dialog).getByText('O histórico some da lista.')).toBeTruthy()
    expect(document.activeElement.textContent).toBe('Cancelar')
    expect(chatApi.terminateSession).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }))
    await waitFor(() => expect(chatApi.terminateSession).toHaveBeenCalledWith(KEY))
    await waitFor(() => expect(view.goTo).toHaveBeenCalledWith('/projects'))
  })

  it('cancelling the end dialog terminates nothing', async () => {
    const view = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chatApi.terminateSession).not.toHaveBeenCalled()
    expect(view.goTo).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refused termination keeps the dialog open with the reason', async () => {
    chatApi.terminateSession.mockRejectedValue(new Error('boom'))
    const view = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((node) => node.textContent === 'Não foi possível encerrar. Tente de novo.')).toBe(true))
    expect(view.goTo).not.toHaveBeenCalled()
  })

  it('"Novo chat" opens the dialog for this project; a created chat is registered and opened', async () => {
    chatApi.createSession = vi.fn(async () => ({ session_key: 'Pessoal/tn-sandbox::claude::nova01', status: 'new' }))
    const view = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Novo chat' }))
    const dialog = screen.getByRole('dialog', { name: 'Novo chat' })
    expect(within(dialog).getByText('tn-sandbox')).toBeTruthy()
    await waitFor(() => expect(within(dialog).getByLabelText('Agente').value).toBe('claude'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Iniciar chat' }))
    await waitFor(() => expect(view.openChat).toHaveBeenCalledWith('Pessoal/tn-sandbox::claude::nova01'))
    expect(chatApi.createSession).toHaveBeenCalledWith({ projectRef: 'Pessoal/tn-sandbox', agentId: 'claude' })
    expect(view.registerCreated).toHaveBeenCalledWith('Pessoal/tn-sandbox::claude::nova01')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the island follows the chat: idle, working, waiting for you', async () => {
    const view = await ready()
    const last = () => view.reports.filter(Boolean).at(-1)
    expect(last()).toMatchObject({ message: 'Chat aberto com Claude.', state: 'idle' })
    play(turnStart(1))
    expect(last()).toMatchObject({ message: 'Claude está trabalhando. Aviso quando terminar.', state: 'thinking' })
    play(card('p1'))
    expect(last()).toMatchObject({ message: 'Claude está esperando você.', state: 'alert' })
  })

  it('tells the provider which chat has the focus, and clears it on leaving', async () => {
    const view = await ready()
    expect(view.setFocusedKey).toHaveBeenCalledWith(KEY)
    view.unmount()
    expect(view.setFocusedKey).toHaveBeenLastCalledWith(null)
  })

  it('only this project\'s chats are listed', async () => {
    const other = { ...META, session_key: 'Outro/proj::claude::zz1111', project_ref: 'Outro/proj', display_name: 'De outro projeto' }
    await ready({ chats: [META, other] })
    expect(screen.queryByRole('link', { name: /De outro projeto/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Revisar o deploy/ })).toBeTruthy()
  })
})
