import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import ChatList from './ChatList.jsx'

afterEach(() => cleanup())

const NOW = Date.now() / 1000
const row = (key, extra = {}) => ({
  session_key: key,
  project_ref: 'Pessoal/tn',
  agent_id: 'claude',
  display_name: null,
  engine: 'chat',
  origin: 'v3',
  status: 'idle',
  live_status: null,
  pending_permissions: 0,
  needs_attention: false,
  last_error: null,
  updated_at: NOW - 300,
  ...extra,
})

const NEEDS = row('Pessoal/tn::claude::needs1', { display_name: 'Aprovar deploy', live_status: 'awaiting_permission', pending_permissions: 2, updated_at: NOW - 900 })
const RUNNING = row('Pessoal/tn::claude::run001', { display_name: 'Refatorar', live_status: 'running' })
const STOPPED = row('Pessoal/tn::claude::stop01', { display_name: 'Ocioso', live_status: 'idle' })
const RESUMABLE = row('Pessoal/tn::claude::res001', { display_name: 'Antigo', status: 'stopped', updated_at: NOW - 7200 })
const FAILED = row('Pessoal/tn::claude::fail01', {
  display_name: 'Quebrou', status: 'failed', last_error: { code: 'spawn_failed', reason: 'cli_not_found' },
})

function makeActions(overrides = {}) {
  return {
    busyKey: null,
    renameError: null,
    endError: null,
    renameChat: vi.fn(async () => true),
    endChat: vi.fn(async () => true),
    clearRenameError: vi.fn(),
    ...overrides,
  }
}

function setup(props = {}) {
  const handlers = { onOpen: vi.fn(), onNewChat: vi.fn(), onEnd: vi.fn(), onRetry: vi.fn() }
  const actions = props.actions ?? makeActions()
  const view = render(
    <ChatList chats={[]} loaded available {...handlers} {...props} actions={actions} />,
  )
  return { ...handlers, actions, ...view }
}

const titlesInOrder = () => screen.getAllByRole('link').map((link) => within(link).getAllByText(/./)[0].textContent)

describe('ChatList states and order', () => {
  it('orders needs-you, running, stopped, resumable, failed regardless of the input order', () => {
    setup({ chats: [FAILED, RESUMABLE, STOPPED, RUNNING, NEEDS] })
    expect(titlesInOrder()).toEqual(['Aprovar deploy', 'Refatorar', 'Ocioso', 'Antigo', 'Quebrou'])
  })

  it('inside one state the most recent comes first', () => {
    const older = row('Pessoal/tn::claude::a', { display_name: 'Mais velho', updated_at: NOW - 5000 })
    const newer = row('Pessoal/tn::claude::b', { display_name: 'Mais novo', updated_at: NOW - 100 })
    setup({ chats: [older, newer] })
    expect(titlesInOrder()).toEqual(['Mais novo', 'Mais velho'])
  })

  it('shows a text chip and a detail for each of the five states', () => {
    setup({ chats: [NEEDS, RUNNING, STOPPED, RESUMABLE, FAILED] })
    const link = (name) => screen.getByRole('link', { name: new RegExp(name) })
    expect(within(link('Aprovar deploy')).getByText('Precisa de você')).toBeTruthy()
    expect(within(link('Aprovar deploy')).getByText('2 aprovações pendentes')).toBeTruthy()
    expect(within(link('Refatorar')).getByText('Rodando')).toBeTruthy()
    expect(within(link('Refatorar')).getByText('Respondendo…')).toBeTruthy()
    expect(within(link('Ocioso')).getByText('Parado')).toBeTruthy()
    expect(within(link('Ocioso')).getByText('Aguardando sua mensagem')).toBeTruthy()
    expect(within(link('Antigo')).getByText('Retomável')).toBeTruthy()
    expect(within(link('Antigo')).getByText('Última atividade há 2 h')).toBeTruthy()
    expect(within(link('Quebrou')).getByText('Falhou ao iniciar')).toBeTruthy()
    expect(within(link('Quebrou')).getByText('claude não encontrado')).toBeTruthy()
  })

  it('one pending request reads "1 aprovação pendente"; a finished turn that needs attention reads "Turno concluído"', () => {
    const single = row('Pessoal/tn::claude::one', { display_name: 'Um', live_status: 'awaiting_permission', pending_permissions: 1 })
    const done = row('Pessoal/tn::claude::done', { display_name: 'Pronto', live_status: 'idle', needs_attention: true })
    setup({ chats: [single, done] })
    expect(screen.getByText('1 aprovação pendente')).toBeTruthy()
    expect(screen.getByText('Turno concluído')).toBeTruthy()
  })

  it('the open conversation knows better than the poll (overrides)', () => {
    const open = row('Pessoal/tn::claude::open1', { display_name: 'Aberto', live_status: 'idle', needs_attention: true })
    setup({
      chats: [open],
      activeKey: open.session_key,
      overrides: { [open.session_key]: { pendingCount: 0, running: true, tool: 'Bash', attentionSeen: true } },
    })
    expect(screen.getByText('Rodando')).toBeTruthy()
    expect(screen.getByText('Usando Bash')).toBeTruthy()
  })

  it('titles fall back to the first message, then to "Nova conversa"', () => {
    const unnamed = row('Pessoal/tn::claude::u1')
    const blank = row('Pessoal/tn::claude::u2', { updated_at: NOW - 9000 })
    setup({ chats: [unnamed, blank], fallbackTitles: { [unnamed.session_key]: 'Me ajude com o deploy\ndo app' } })
    expect(screen.getByText('Me ajude com o deploy do app')).toBeTruthy()
    expect(screen.getByText('Nova conversa')).toBeTruthy()
  })

  it('marks a chat imported from the terminal with a seal', () => {
    setup({ chats: [row('Pessoal/tn::claude::imp', { display_name: 'Veio do PTY', origin: 'imported_from_pty' })] })
    expect(screen.getByText('importado do terminal')).toBeTruthy()
  })

  it('marks only the open chat with aria-current', () => {
    setup({ chats: [NEEDS, RUNNING], activeKey: RUNNING.session_key })
    expect(screen.getByRole('link', { name: /Refatorar/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: /Aprovar deploy/ }).getAttribute('aria-current')).toBeNull()
  })

  it('labels the navigation and the heading', () => {
    setup({ chats: [RUNNING] })
    expect(screen.getByRole('navigation', { name: 'Chats do projeto' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Chats' })).toBeTruthy()
  })
})

describe('ChatList opening and creating', () => {
  it('a link keeps its address and opens in place without a page load', () => {
    const { onOpen } = setup({ chats: [RUNNING] })
    const link = screen.getByRole('link', { name: /Refatorar/ })
    expect(link.getAttribute('href')).toBe('/projects/chat/Pessoal%2Ftn%3A%3Aclaude%3A%3Arun001')
    const notCancelled = fireEvent.click(link)
    expect(notCancelled).toBe(false) // preventDefault
    expect(onOpen).toHaveBeenCalledWith(RUNNING.session_key)
  })

  it('"Novo chat" is in the header', () => {
    const { onNewChat } = setup({ chats: [RUNNING] })
    fireEvent.click(screen.getByRole('button', { name: 'Novo chat' }))
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })
})

describe('ChatList loading, empty and failure', () => {
  it('shows skeleton rows and a polite status while loading, and no rows', () => {
    setup({ loaded: false })
    expect(screen.getByRole('status').textContent).toBe('Carregando chats…')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('an empty project says so and offers "Novo chat"', () => {
    const { onNewChat } = setup({ chats: [] })
    expect(screen.getByText('Nenhum chat neste projeto ainda.')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Novo chat' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })

  it('a total failure (nothing loaded, poll down) offers "Tentar de novo"', () => {
    const { onRetry } = setup({ chats: [], available: false })
    expect(screen.getByText('Não foi possível carregar os chats.')).toBeTruthy()
    expect(screen.queryByText('Nenhum chat neste projeto ainda.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('a partial failure keeps the last list and warns above it', () => {
    setup({ chats: [RUNNING], available: false })
    expect(screen.getByText('Estado ao vivo indisponível.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Refatorar/ })).toBeTruthy()
    expect(screen.queryByText('Não foi possível carregar os chats.')).toBeNull()
  })

  it('shows when ending a chat failed', () => {
    setup({ chats: [RUNNING], actions: makeActions({ endError: RUNNING.session_key }) })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível encerrar. Tente de novo.')
  })
})

describe('ChatList row menu', () => {
  const openMenu = (title) => fireEvent.click(screen.getByRole('button', { name: `Ações do chat ${title}` }))

  it('the button is named after the chat and announces a menu', () => {
    setup({ chats: [RUNNING] })
    const button = screen.getByRole('button', { name: 'Ações do chat Refatorar' })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens with Abrir, Renomear and Encerrar, focusing the first item', () => {
    setup({ chats: [RUNNING] })
    openMenu('Refatorar')
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual(['Abrir', 'Renomear', 'Encerrar'])
    expect(document.activeElement.textContent).toBe('Abrir')
  })

  it('arrows move (with wrap), Home and End jump', () => {
    setup({ chats: [RUNNING] })
    openMenu('Refatorar')
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Renomear')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Encerrar')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Abrir')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement.textContent).toBe('Encerrar')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement.textContent).toBe('Abrir')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement.textContent).toBe('Encerrar')
  })

  it('Esc closes the menu, returns the focus to the button and does not bubble', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ChatList chats={[RUNNING]} loaded available actions={makeActions()} onOpen={vi.fn()} onNewChat={vi.fn()} onEnd={vi.fn()} onRetry={vi.fn()} />
      </div>,
    )
    openMenu('Refatorar')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ações do chat Refatorar' }))
    expect(outer).not.toHaveBeenCalled()
  })

  it('a press outside closes the menu', () => {
    setup({ chats: [RUNNING] })
    openMenu('Refatorar')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"Abrir" opens the chat; "Encerrar" hands the row to the screen (it owns the confirmation)', () => {
    const { onOpen, onEnd } = setup({ chats: [RUNNING] })
    openMenu('Refatorar')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir' }))
    expect(onOpen).toHaveBeenCalledWith(RUNNING.session_key)
    openMenu('Refatorar')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar' }))
    expect(onEnd).toHaveBeenCalledWith(RUNNING)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ChatList inline rename', () => {
  const startRename = (title) => {
    fireEvent.click(screen.getByRole('button', { name: `Ações do chat ${title}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }))
    return screen.getByRole('textbox', { name: `Novo nome do chat ${title}` })
  }

  it('swaps the row for an input with the current name selected and focused', () => {
    setup({ chats: [RUNNING] })
    const input = startRename('Refatorar')
    expect(input.value).toBe('Refatorar')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('link', { name: /Refatorar/ })).toBeNull()
  })

  it('Enter saves a trimmed name and returns the row', async () => {
    const { actions } = setup({ chats: [RUNNING] })
    const input = startRename('Refatorar')
    fireEvent.change(input, { target: { value: '  Novo nome  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(actions.renameChat).toHaveBeenCalledWith(RUNNING.session_key, 'Novo nome'))
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })

  it('an empty name is not saved', () => {
    const { actions } = setup({ chats: [RUNNING] })
    const input = startRename('Refatorar')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.renameChat).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('Esc cancels without saving and does not bubble', () => {
    const outer = vi.fn()
    const actions = makeActions()
    render(
      <div onKeyDown={outer}>
        <ChatList chats={[RUNNING]} loaded available actions={actions} onOpen={vi.fn()} onNewChat={vi.fn()} onEnd={vi.fn()} onRetry={vi.fn()} />
      </div>,
    )
    const input = startRename('Refatorar')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(actions.renameChat).not.toHaveBeenCalled()
    expect(actions.clearRenameError).toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
  })

  it('a refused rename keeps the field open with the error', async () => {
    const actions = makeActions({ renameChat: vi.fn(async () => false), renameError: RUNNING.session_key })
    setup({ chats: [RUNNING], actions })
    const input = startRename('Refatorar')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(actions.renameChat).toHaveBeenCalled())
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível renomear. Tente de novo.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('ChatList row structure (M2)', () => {
  it('puts the title alone on line 1 and the chip plus detail together on line 2', () => {
    setup({ chats: [row('Pessoal/tn::claude::imp001', { display_name: 'Titulo muito longo para a linha', origin: 'imported_from_pty' })] })
    const link = screen.getByRole('link')
    const title = link.querySelector('.v3-chat-row__title')
    const meta = link.querySelector('.v3-chat-row__meta')
    expect(title.textContent).toBe('Titulo muito longo para a linha')
    expect(title.closest('.v3-chat-row__meta')).toBeNull()
    expect(meta.querySelector('.v3-chip--state')).not.toBeNull()
    expect(meta.querySelector('.v3-chat-row__detail')).not.toBeNull()
    expect(link.querySelector('.v3-chat-row__seal').textContent).toBe('importado do terminal')
    expect(link.querySelector('.v3-chat-row__top')).toBeNull()
  })
})
