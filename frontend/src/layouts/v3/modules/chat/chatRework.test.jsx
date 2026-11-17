import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act, renderHook, fireEvent, within } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import MarkdownBody from './MarkdownBody.jsx'
import PlanCard from './cards/PlanCard.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'
import { useFirstMessages } from './useFirstMessages.js'
import { resolveProjectName } from './useProjectName.js'

// Stand-in highlighter: the colour it paints says which theme it was asked for.
const codeToTokens = vi.fn(async (code, options) => ({
  tokens: code.replace(/\n$/, '').split('\n').map((line) => [{ content: line, color: options.theme === 'github-dark' ? '#111111' : '#222222', fontStyle: 0 }]),
}))
vi.mock('shiki', () => ({ codeToTokens: (...args) => codeToTokens(...args) }))

installDialogElementStub()

const KEY = '.w5/.p50::claude::k3x9q2'
const OTHER = '.w5/.p50::claude::zzzzzz'
const f = frames(KEY)
const META = {
  session_key: KEY, project_ref: '.w5/.p50', agent_id: 'claude', display_name: 'Revisar o deploy', engine: 'chat', origin: 'v3',
  status: 'idle', live_status: 'idle', pending_permissions: 0, needs_attention: false, model: 'haiku', permission_mode: 'default',
  last_error: null, updated_at: Date.now() / 1000,
}
const REGISTRY = {
  seeded: true,
  workspaces: [{ id: 5, key: '.w5', name: 'QA C4', origin: 'v3', archived: false, projects: [{ id: 50, key: '.w5/.p50', name: 'orq', origin: 'v3', archived: false, folders: [] }] }],
}

beforeEach(() => {
  resetSockets()
  document.documentElement.dataset.theme = 'light'
  codeToTokens.mockClear()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue(REGISTRY)
  vi.spyOn(chatApi, 'fetchEvents').mockResolvedValue({ events: [], last_seq: 0, has_more: false })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

async function renderScreen(chats) {
  const value = { ...INERT_SESSIONS, chats, loaded: true, liveAvailable: true, registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn(), openChat: vi.fn(), goTo: vi.fn() }
  const view = render(
    <IslandProvider value={() => {}}>
      <ProjectsSessionsContext.Provider value={value}>
        <ChatSessionHost activeKey={KEY}>
          <ChatScreen sessionKey={KEY} />
        </ChatSessionHost>
      </ProjectsSessionsContext.Provider>
    </IslandProvider>,
  )
  await act(async () => {})
  act(() => lastSocket().open())
  act(() => lastSocket().receive(f('replay.complete', null, { last_seq: 0 })))
  return view
}

describe('Bug 1: a theme switch re-colours the code that is already on screen', () => {
  const FENCE = '```js\nconst a = 1\n```'
  const colourOf = (container) => container.querySelector('pre > code span')?.style.color

  it('highlights with the theme of the page, then again after data-theme flips, without a remount', async () => {
    document.documentElement.dataset.theme = 'dark'
    const { container } = render(<MarkdownBody text={FENCE} />)
    await waitFor(() => expect(colourOf(container)).toBe('rgb(17, 17, 17)'))
    expect(codeToTokens.mock.calls.at(-1)[1].theme).toBe('github-dark')

    act(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await waitFor(() => expect(colourOf(container)).toBe('rgb(34, 34, 34)'))
    expect(codeToTokens.mock.calls.at(-1)[1].theme).toBe('github-light')
    expect(container.querySelector('pre > code').textContent).toBe('const a = 1')
  })

  it('does not highlight again when the theme did not change', async () => {
    const { container } = render(<MarkdownBody text={FENCE} />)
    await waitFor(() => expect(colourOf(container)).toBe('rgb(34, 34, 34)'))
    const calls = codeToTokens.mock.calls.length
    act(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await act(async () => {})
    expect(codeToTokens.mock.calls.length).toBe(calls)
  })

  it('stops watching the theme once the block is gone', async () => {
    const { container, unmount } = render(<MarkdownBody text={FENCE} />)
    await waitFor(() => expect(colourOf(container)).toBeTruthy())
    unmount()
    const calls = codeToTokens.mock.calls.length
    document.documentElement.dataset.theme = 'dark'
    await act(async () => {})
    expect(codeToTokens.mock.calls.length).toBe(calls)
  })
})

describe('Bug 3: the project name is the registry name, not the last segment of the key', () => {
  it('resolves a project key, falls back to the key label, and never shows a minted ".pNN"', () => {
    const index = buildRegistryIndex(REGISTRY)
    expect(resolveProjectName('.w5/.p50', index)).toBe('orq')
    expect(resolveProjectName('Pessoal/tn-sandbox', index)).toBe('tn-sandbox')
    expect(resolveProjectName('.w5/.p50', null)).toBe('')
    expect(resolveProjectName('Pessoal/tn-sandbox', null)).toBe('tn-sandbox')
  })

  it('the header chip and the "Novo chat" dialog show "orq"', async () => {
    await renderScreen([META])
    const header = screen.getByRole('heading', { level: 1 }).closest('header')
    await waitFor(() => expect(within(header).getByText('orq')).toBeTruthy())
    expect(screen.queryByText('.p50')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Novo chat' }))
    expect(within(screen.getByRole('dialog')).getByText('orq')).toBeTruthy()
  })

  it('without the registry the chip is simply absent for a minted key', async () => {
    workspacesApi.fetchWorkspaces.mockRejectedValue(new Error('down'))
    await renderScreen([META])
    const header = screen.getByRole('heading', { level: 1 }).closest('header')
    expect(within(header).queryByText('.p50')).toBeNull()
  })
})

describe('Bug 4: chats with no name show their first message in the list', () => {
  const unnamed = { ...META, session_key: OTHER, display_name: null }

  it('reads the start of the log of an unnamed chat that is not open, once', async () => {
    chatApi.fetchEvents.mockResolvedValue({
      events: [{ seq: 1, kind: 'session.started', payload: {} }, { seq: 2, kind: 'message.user', payload: { text: 'Revise o pipeline de deploy', origin: 'ui' } }],
      last_seq: 2, has_more: false,
    })
    await renderScreen([META, unnamed])
    await waitFor(() => expect(screen.getByRole('link', { name: /Revise o pipeline de deploy/ })).toBeTruthy())
    expect(chatApi.fetchEvents).toHaveBeenCalledTimes(1)
    expect(chatApi.fetchEvents).toHaveBeenCalledWith(OTHER, expect.objectContaining({ since: 0 }))
  })

  it('does not ask for named chats nor for the open chat; a failed read leaves "Nova conversa"', async () => {
    chatApi.fetchEvents.mockRejectedValue(new Error('down'))
    await renderScreen([{ ...META, display_name: null }, unnamed, { ...META, session_key: `${OTHER}2`, display_name: null }])
    await act(async () => {})
    expect(chatApi.fetchEvents.mock.calls.map((call) => call[0]).sort()).toEqual([OTHER, `${OTHER}2`])
    expect(screen.getAllByText('Nova conversa').length).toBeGreaterThan(0)
  })

  it('the hook keeps an answer that arrives after the list was polled again', async () => {
    let answer
    chatApi.fetchEvents.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const { result, rerender } = renderHook(({ chats }) => useFirstMessages(chats, KEY), { initialProps: { chats: [unnamed] } })
    rerender({ chats: [{ ...unnamed }] })
    await act(async () => answer({ events: [{ seq: 1, kind: 'message.user', payload: { text: 'primeira' } }] }))
    expect(result.current[OTHER]).toBe('primeira')
    expect(chatApi.fetchEvents).toHaveBeenCalledTimes(1)
  })
})

describe('Bug 9: the bubble does not stay "Enviando…" when the chat cannot start', () => {
  it('shows "Não enviada" with "Enviar de novo" after resume_failed', async () => {
    await renderScreen([META])
    const input = screen.getByRole('combobox', { name: 'Mensagem para o agente' })
    fireEvent.change(input, { target: { value: 'olá' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Você · Enviando…')).toBeTruthy()
    act(() => lastSocket().receive(f('status', 3, { code: 'resume_failed', detail: 'x' })))
    expect(screen.queryByText('Você · Enviando…')).toBeNull()
    expect(screen.getByText('Não enviada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toBeTruthy()
  })
})

describe('Bug 12: the plan is safe markdown', () => {
  const setup = (plan) => render(<PlanCard card={{ id: 'p1', kind: 'plan', input: { plan } }} agentName="Claude" status="pending" onDecide={() => {}} />)

  it('renders headings, lists, bold and code through the shared prose path', () => {
    setup('## Contexto\n\n- passo **um**\n- passo `dois`\n')
    const region = screen.getByRole('region', { name: 'Plano proposto' })
    expect(region.querySelector('.v3-prose h2').textContent).toBe('Contexto')
    expect(region.querySelectorAll('li')).toHaveLength(2)
    expect(region.querySelector('strong').textContent).toBe('um')
    expect(region.textContent).not.toContain('##')
    expect(region.textContent).not.toContain('`')
    expect(region.tabIndex).toBe(0)
  })

  it('raw HTML in the plan is text, never a node', () => {
    const { container } = setup('<img src=x onerror="window.__pwned=1"> e <script>window.__pwned = 2</script>')
    expect(container.querySelector('img, script')).toBeNull()
    expect(screen.getByRole('region', { name: 'Plano proposto' }).textContent).toContain('<script>window.__pwned = 2</script>')
    expect(window.__pwned).toBeUndefined()
  })

  it('keeps code spans and fenced blocks as code, and a lone < or > as text', () => {
    setup(['use `<div>` aqui <b>x</b>', '```html', '<p>y</p>', '```', '', '2 < 3 e 4 > 1'].join(String.fromCharCode(10)))
    const region = screen.getByRole('region', { name: 'Plano proposto' })
    expect(region.querySelector('b')).toBeNull()
    expect(region.querySelector('p code').textContent).toBe('<div>')
    expect(region.querySelector('pre code').textContent).toContain('<p>y</p>')
    expect(region.textContent).toContain('<b>x</b>')
    expect(region.textContent).toContain('2 < 3 e 4 > 1')
  })
})
