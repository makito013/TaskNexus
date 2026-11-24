// Chat on a phone and a tablet (Designer 10, C5). jsdom has no layout and applies no CSS, so what is
// proven here is behaviour (which view shows, what the shell writes on #root, what the focus does) and
// the declarations of the stylesheets as text; the pixel measures are the QA's, in a real browser.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { installFakeVisualViewport } from '../../../../test/fakeVisualViewport.js'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { IslandProvider } from '../../IslandContext.jsx'
import AppV3 from '../../AppV3.jsx'
import { INERT_SESSIONS, ProjectsSessionsContext } from '../../sessions/useProjectsSessions.js'
import ChatScreen from './ChatScreen.jsx'
import ChatSessionHost from './ChatSessionHost.jsx'
import { FakeWebSocket, frames, lastSocket, resetSockets } from './chatTestKit.js'
import { useStickToEnd } from './useStickToEnd.js'

installDialogElementStub()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const V3 = path.join(HERE, '..', '..')
const readCss = (relative) => readFileSync(path.join(V3, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const OTHER = 'Pessoal/tn-sandbox::claude::zz9999'
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
const META_OTHER = { ...META, session_key: OTHER, display_name: 'Outro chat' }

// A matchMedia that follows a width the test can change, like a rotating device.
function installMatchMedia(width) {
  const original = window.matchMedia
  const lists = []
  let current = width
  const evaluate = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    return Boolean(max) && current <= Number(max[1])
  }
  window.matchMedia = vi.fn((query) => {
    const listeners = new Set()
    const list = {
      media: query,
      get matches() {
        return evaluate(query)
      },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
      listeners,
    }
    lists.push(list)
    return list
  })
  return {
    resize(next) {
      current = next
      act(() => {
        for (const list of lists) for (const listener of list.listeners) listener({ matches: evaluate(list.media), media: list.media })
      })
    },
    restore() {
      if (original) window.matchMedia = original
      else delete window.matchMedia
    },
  }
}

let media
beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([{ id: 'claude', nome: 'Claude', ia: 'claude' }])
  vi.spyOn(api, 'fetchPersistedSessions').mockResolvedValue({})
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
  vi.spyOn(chatApi, 'decidePermission').mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  media?.restore()
  media = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.getElementById('root')?.remove()
})

async function renderScreen({ width, chats = [META, META_OTHER] }) {
  media = installMatchMedia(width)
  const spies = { goTo: vi.fn(), openChat: vi.fn(), registerCreated: vi.fn(), refresh: vi.fn(), setFocusedKey: vi.fn() }
  const value = { ...INERT_SESSIONS, chats, graceKeys: [], loaded: true, liveAvailable: true, ...spies }
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
  return { ...view, ...spies }
}

const screenElement = () => document.querySelector('.v3-chat')
const BACK = { name: 'Voltar para a lista de chats' }

describe('phone: two views of one screen', () => {
  it('opens on the conversation, with a back button and no chat list in view', async () => {
    await renderScreen({ width: 390 })
    expect(screenElement().getAttribute('data-view')).toBe('chat')
    expect(screen.getByRole('button', BACK)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar para a lista de chats' }).closest('.v3-chat-header')).toBeTruthy()
  })

  it('"Voltar" shows the list and does NOT touch the socket; the list link of the open chat comes back', async () => {
    await renderScreen({ width: 390 })
    const socket = lastSocket()
    const sockets = FakeWebSocket.instances.length
    fireEvent.click(screen.getByRole('button', BACK))
    expect(screenElement().getAttribute('data-view')).toBe('list')
    expect(document.activeElement.textContent).toBe('Chats')
    const link = within(screen.getByRole('navigation', { name: 'Chats do projeto' })).getByRole('link', { name: /Revisar o deploy/ })
    fireEvent.click(link)
    expect(screenElement().getAttribute('data-view')).toBe('chat')
    expect(document.activeElement.tagName).toBe('H1')
    expect(FakeWebSocket.instances.length).toBe(sockets)
    expect(socket.closeCalls).toBe(0)
    expect(socket.readyState).toBe(1)
  })

  it('choosing ANOTHER chat in the list navigates (the route changes, the view is not flipped)', async () => {
    const view = await renderScreen({ width: 390 })
    fireEvent.click(screen.getByRole('button', BACK))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Chats do projeto' })).getByRole('link', { name: /Outro chat/ }))
    expect(view.openChat).toHaveBeenCalledWith(OTHER)
    expect(screenElement().getAttribute('data-view')).toBe('list')
  })

  it('the list view is the way out: "Voltar para Projetos" leaves the chat route', async () => {
    const view = await renderScreen({ width: 390 })
    fireEvent.click(screen.getByRole('button', BACK))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Projetos' }))
    expect(view.goTo).toHaveBeenCalledWith('/projects')
  })

  it('"Novo chat" is reachable from the list view', async () => {
    await renderScreen({ width: 390 })
    fireEvent.click(screen.getByRole('button', BACK))
    expect(screen.getByRole('button', { name: 'Novo chat' })).toBeTruthy()
  })

  it('the connectors dialog is a bottom sheet on a phone and narrow on a tablet', async () => {
    vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ known: [] })
    await renderScreen({ width: 390 })
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conectores do agente…' }))
    expect(screen.getByRole('dialog').className).toContain('v3-dialog--sheet')
    cleanup()
    media.restore()
    await renderScreen({ width: 820 })
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do chat' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conectores do agente…' }))
    expect(screen.getByRole('dialog').className).toContain('v3-dialog--narrow')
    expect(screen.getByRole('dialog').className).not.toContain('v3-dialog--sheet')
  })

  it('a phone that turns into a tablet drops the back button and the way out', async () => {
    const view = await renderScreen({ width: 390 })
    expect(screen.getByRole('button', BACK)).toBeTruthy()
    media.resize(900)
    expect(screen.queryByRole('button', BACK)).toBeNull()
    expect(view.container.querySelector('.v3-chat-list__leave')).toBeNull()
  })
})

describe('tablet and desktop keep the C4 structure', () => {
  it.each([820, 1440])('at %ipx there is no back button and no way-out button', async (width) => {
    await renderScreen({ width })
    expect(screen.queryByRole('button', BACK)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Voltar para Projetos' })).toBeNull()
    expect(screenElement().getAttribute('data-view')).toBe('chat')
  })
})

describe('"Enviar de novo" is locked while it could duplicate the message', () => {
  const send = (text) => {
    const input = screen.getByRole('combobox', { name: 'Mensagem para o agente' })
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
    return lastSocket().sent.at(-1).request_id
  }

  it('is offered once the conversation is settled', async () => {
    await renderScreen({ width: 1440 })
    const requestId = send('tente')
    act(() => lastSocket().receive(f('command.rejected', null, { request_id: requestId, code: 'capacity_exceeded', message: 'x' })))
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toBeTruthy()
  })

  it('is not offered while a turn runs', async () => {
    await renderScreen({ width: 1440 })
    const requestId = send('tente')
    act(() => lastSocket().receive(f('command.rejected', null, { request_id: requestId, code: 'capacity_exceeded', message: 'x' })))
    act(() => lastSocket().receive(f('session.state', 5, { turn: 'running' })))
    expect(screen.getByText('Não enviada')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar de novo' })).toBeNull()
    act(() => lastSocket().receive(f('session.state', 6, { turn: 'idle' })))
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toBeTruthy()
  })

  it('stays locked after the socket reopens until the replay of that connection ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderScreen({ width: 1440 })
    send('tente')
    act(() => lastSocket().drop())
    act(() => { vi.advanceTimersByTime(1500) })
    act(() => lastSocket().open())
    expect(screen.getByText('Não enviada')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar de novo' })).toBeNull()
    act(() => lastSocket().receive(f('replay.complete', null, { last_seq: 0 })))
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toBeTruthy()
  })

  it('is not offered while the socket is down or reconnecting, and comes back with the connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderScreen({ width: 1440 })
    send('tente')
    // The frame was handed to a socket that dies: the message is "Não enviada" (connection_lost), but the
    // replay of the next connection may still echo it back, so it cannot be sent again yet.
    act(() => lastSocket().drop())
    expect(screen.getByText('Não enviada')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar de novo' })).toBeNull()
    act(() => { vi.advanceTimersByTime(1500) })
    act(() => lastSocket().open())
    act(() => lastSocket().receive(f('replay.complete', null, { last_seq: 0 })))
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toBeTruthy()
  })
})

describe('a "Novo chat" cancelled while its request is out does not navigate (C4 review L2#5)', () => {
  it('registers and lists the chat, but stays where it is', async () => {
    let finish
    chatApi.createSession = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const view = await renderScreen({ width: 1440 })
    fireEvent.click(screen.getByRole('button', { name: 'Novo chat' }))
    const dialog = screen.getByRole('dialog', { name: 'Novo chat' })
    await waitFor(() => expect(within(dialog).getByLabelText('Agente').value).toBe('claude'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Iniciar chat' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => finish({ session_key: 'Pessoal/tn-sandbox::claude::nova01', status: 'new' }))
    expect(view.openChat).not.toHaveBeenCalled()
    expect(view.registerCreated).toHaveBeenCalledWith('Pessoal/tn-sandbox::claude::nova01')
    expect(view.refresh).toHaveBeenCalled()
  })
})

describe('the composer placeholder fits whole on a narrow shell (Designer C5, A1)', () => {
  const composerBox = () => screen.getByRole('combobox', { name: 'Mensagem para o agente' })

  it.each([390, 768, 1279])('is the short text at %ipx (phone and iPad)', async (width) => {
    await renderScreen({ width })
    expect(composerBox().getAttribute('placeholder')).toBe('Mensagem ou / para comandos')
    expect(composerBox().getAttribute('aria-label')).toBe('Mensagem para o agente')
  })

  it.each([1280, 1440])('keeps the long text at %ipx', async (width) => {
    await renderScreen({ width })
    expect(composerBox().getAttribute('placeholder')).toBe('Mensagem para o agente, ou / para comandos')
  })

  it('follows the width when the device rotates', async () => {
    await renderScreen({ width: 1440 })
    media.resize(390)
    expect(composerBox().getAttribute('placeholder')).toBe('Mensagem ou / para comandos')
  })
})

describe('a "Novo chat" answer belongs to the opening that asked (Revisor C5, ressalva 1)', () => {
  const openDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Novo chat' }))
    const dialog = screen.getByRole('dialog', { name: 'Novo chat' })
    await waitFor(() => expect(within(dialog).getByLabelText('Agente').value).toBe('claude'))
    return dialog
  }

  it('the late answer of a cancelled dialog neither navigates nor closes the next dialog', async () => {
    const finishers = []
    vi.spyOn(chatApi, 'createSession').mockImplementation(() => new Promise((resolve) => { finishers.push(resolve) }))
    const view = await renderScreen({ width: 1440 })

    const first = await openDialog()
    fireEvent.click(within(first).getByRole('button', { name: 'Iniciar chat' }))
    fireEvent.click(within(first).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await openDialog()
    await act(async () => finishers[0]({ session_key: 'Pessoal/tn-sandbox::claude::velho1', status: 'new' }))

    // The second dialog is still there, untouched, and nothing was opened.
    expect(screen.getByRole('dialog', { name: 'Novo chat' })).toBeTruthy()
    expect(view.openChat).not.toHaveBeenCalled()
    expect(view.registerCreated).toHaveBeenCalledWith('Pessoal/tn-sandbox::claude::velho1')
    expect(view.refresh).toHaveBeenCalled()
  })

  it('the answer of the dialog that is still open navigates and closes it', async () => {
    const finishers = []
    vi.spyOn(chatApi, 'createSession').mockImplementation(() => new Promise((resolve) => { finishers.push(resolve) }))
    const view = await renderScreen({ width: 1440 })

    const first = await openDialog()
    fireEvent.click(within(first).getByRole('button', { name: 'Cancelar' }))
    const second = await openDialog()
    fireEvent.click(within(second).getByRole('button', { name: 'Iniciar chat' }))
    await act(async () => finishers[0]({ session_key: 'Pessoal/tn-sandbox::claude::novo02', status: 'new' }))

    expect(view.openChat).toHaveBeenCalledWith('Pessoal/tn-sandbox::claude::novo02')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the shell of the chat route (AppV3)', () => {
  const CHAT_PATH = `/projects/chat/${encodeURIComponent(KEY)}`
  let viewport
  let originalInnerHeight

  beforeEach(() => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    window.localStorage.clear()
    window.history.replaceState({}, '', CHAT_PATH)
    originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true })
    vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
    vi.spyOn(api, 'fetchActiveSessions').mockResolvedValue({})
    vi.spyOn(workspacesApi, 'fetchWorkspaces').mockResolvedValue({ seeded: null, workspaces: [] })
    vi.spyOn(chatApi, 'listLiveSessions').mockResolvedValue({})
    vi.spyOn(chatApi, 'listSessions').mockResolvedValue([])
    vi.spyOn(chatApi, 'health').mockResolvedValue({})
    viewport = installFakeVisualViewport({ width: 390, height: 844 })
  })
  afterEach(() => {
    viewport.restore()
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true, writable: true })
    window.history.replaceState({}, '', '/')
  })

  const rootElement = () => document.getElementById('root')
  const mountApp = () => render(<AppV3 initialTheme="light" />, { container: rootElement() })

  it('writes the route attribute on #root and takes it away on leaving the chat', async () => {
    media = installMatchMedia(1440)
    mountApp()
    expect(rootElement().dataset.v3Route).toBe('chat')
    fireEvent.click(screen.getByRole('button', { name: 'Projetos e agentes' }))
    await waitFor(() => expect(rootElement().dataset.v3Route).toBeUndefined())
    expect(rootElement().hasAttribute('data-v3-route')).toBe(false)
  })

  it('never makes #root fixed on a desktop width', () => {
    media = installMatchMedia(1440)
    mountApp()
    expect(rootElement().style.position).toBe('')
  })

  it('anchors #root to the visual viewport on a phone, only for as long as the chat is open', async () => {
    media = installMatchMedia(390)
    mountApp()
    const root = rootElement()
    expect(root.style.position).toBe('fixed')
    expect(root.style.width).toBe('100%')
    expect(root.style.height).toBe('100%')

    // The soft keyboard opens: the visible height falls to 400 of 844.
    act(() => {
      viewport.vv.set({ height: 400 })
      viewport.vv.fire('resize')
    })
    expect(root.dataset.v3Keyboard).toBe('open')
    expect(root.style.getPropertyValue('--v3-visible-height')).toBe('400px')
    await waitFor(() => expect(root.style.height).toBe('400px'))

    // ...and closes again.
    act(() => {
      viewport.vv.set({ height: 844 })
      viewport.vv.fire('resize')
    })
    expect(root.dataset.v3Keyboard).toBeUndefined()

    // Leaving the chat takes every trace of the fixed shell away.
    act(() => {
      viewport.vv.set({ height: 400 })
      viewport.vv.fire('resize')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Projetos e agentes' }))
    await waitFor(() => expect(root.dataset.v3Route).toBeUndefined())
    expect(root.style.position).toBe('')
    expect(root.style.left).toBe('')
    expect(root.style.height).toBe('')
    expect(root.dataset.v3Keyboard).toBeUndefined()
    expect(root.style.getPropertyValue('--v3-visible-height')).toBe('')
    expect(viewport.vv.listenerCount('resize')).toBe(0)
  })

  it('survives StrictMode (effects mounted, unmounted and mounted again in development)', () => {
    media = installMatchMedia(390)
    render(<StrictMode><AppV3 initialTheme="light" /></StrictMode>, { container: rootElement() })
    expect(rootElement().dataset.v3Route).toBe('chat')
    expect(rootElement().style.position).toBe('fixed')
    expect(rootElement().style.height).toBe('100%')
    // Mounting the chat does not grab the focus (only a change of view does).
    expect(document.activeElement).toBe(document.body)
  })

  it('a tablet turned wide drops the fixed shell without leaving the chat', () => {
    media = installMatchMedia(900)
    mountApp()
    expect(rootElement().style.position).toBe('fixed')
    media.resize(1440)
    expect(rootElement().style.position).toBe('')
    expect(rootElement().dataset.v3Route).toBe('chat')
  })
})

describe('the thread keeps its end in view when the first message turns an empty chat into a conversation', () => {
  it('attaches the observer to the thread that appears, and re-anchors on a resize', async () => {
    const watched = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback
      }
      observe(target) {
        watched.push({ target, callback: this.callback })
      }
      disconnect() {}
    })
    await renderScreen({ width: 390, chats: [META] })
    expect(document.querySelector('.v3-chat-thread')).toBeNull()
    act(() => lastSocket().receive(f('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' })))
    const thread = document.querySelector('.v3-chat-thread')
    const entry = watched.find((item) => item.target === thread)
    expect(entry).toBeTruthy()
    Object.defineProperty(thread, 'scrollHeight', { value: 1000, configurable: true })
    entry.callback()
    expect(thread.scrollTop).toBe(1000)
  })
})

describe('useStickToEnd: the end stays in view when the thread gets shorter', () => {
  let observer
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback
        observer = this
      }
      observe() {}
      disconnect() {
        this.disconnected = true
      }
    })
  })

  function Thread({ element }) {
    useStickToEnd({ current: element }, 'k')
    return null
  }
  function thread({ scrollTop, scrollHeight = 1000, clientHeight = 400 }) {
    const element = document.createElement('div')
    element.scrollTop = scrollTop
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
    return element
  }

  it('re-anchors a reader who was at the end', () => {
    const element = thread({ scrollTop: 600 })
    render(<Thread element={element} />)
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    observer.callback()
    expect(element.scrollTop).toBe(1000)
  })

  it('leaves alone a reader who scrolled up to older messages', () => {
    const element = thread({ scrollTop: 100 })
    render(<Thread element={element} />)
    fireEvent.scroll(element)
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    observer.callback()
    expect(element.scrollTop).toBe(100)
  })

  it('stops observing on unmount', () => {
    const { unmount } = render(<Thread element={thread({ scrollTop: 600 })} />)
    unmount()
    expect(observer.disconnected).toBe(true)
  })
})

describe('the responsive stylesheets (declarations, since jsdom applies no CSS)', () => {
  const blocks = (css) => [...css.matchAll(/@media\s*([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map(([, query, body]) => ({ query: query.trim(), body }))
  const selectorsOf = (body) => [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, selector]) => selector.split(',').map((item) => item.trim()))
  const ROUTE = ':root[data-layout="v3"] #root[data-v3-route="chat"]'

  it('no stylesheet of the shell or the chat declares position: fixed (the fixed root is a mounted inline style)', () => {
    for (const file of ['AppV3.css', 'components/Island/Island.css', 'components/Dialog/Dialog.css', 'modules/chat/ChatScreen.css', 'modules/chat/ChatLeaf.css', 'components/ApprovalCard/ApprovalCard.css']) {
      expect(readCss(file), file).not.toMatch(/position:\s*fixed/)
    }
  })

  it('every selector the shell stylesheets add inside a media query is scoped to the chat route', () => {
    for (const file of ['AppV3.css', 'components/Island/Island.css']) {
      const queries = blocks(readCss(file))
      expect(queries.length, file).toBeGreaterThan(0)
      for (const { query, body } of queries.filter(({ query: text }) => /max-width/.test(text))) {
        for (const selector of selectorsOf(body)) expect(selector.startsWith(ROUTE), `${file} @media ${query}: ${selector}`).toBe(true)
      }
    }
  })

  it('the sheet modifier of the dialog only exists inside max-width 767 and leaves the base rule alone', () => {
    const css = readCss('components/Dialog/Dialog.css')
    const outside = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '')
    expect(outside).not.toContain('v3-dialog--sheet')
    const inside = blocks(css).filter(({ body }) => body.includes('v3-dialog--sheet'))
    expect(inside.length).toBeGreaterThan(0)
    for (const { query } of inside.filter(({ query: text }) => /max-width/.test(text))) expect(query).toBe('(max-width: 767px)')
  })

  it('the keyboard hides the pill, the pill is 52px and the rail is gone, all on the route only', () => {
    const island = readCss('components/Island/Island.css')
    expect(island).toContain(`${ROUTE}[data-v3-keyboard="open"] .v3-island`)
    expect(island).toMatch(/height:\s*var\(--v3-control-lg\)/)
    expect(island).toMatch(/border-radius:\s*var\(--v3-radius-island\)/)
    expect(readCss('AppV3.css')).toMatch(/\.v3-rail\s*\{\s*display:\s*none/)
  })

  it('the tablet list is 236px, kept as a constant local to the chat route', () => {
    const css = readCss('modules/chat/ChatScreen.css')
    expect(css).toMatch(/--chat-list-width-tablet:\s*236px/)
    expect(css).toMatch(/grid-template-columns:\s*var\(--chat-list-width-tablet\)/)
    expect(readCss('theme/tokens.css')).not.toContain('chat-list-width')
  })

  it('phone controls: 52px decisions and rows, 44px targets from tablet down', () => {
    const approval = readCss('components/ApprovalCard/ApprovalCard.css')
    expect(approval).toMatch(/@media \(max-width: 767px\)[\s\S]*#root\[data-v3-route="chat"\] \.v3-approval__actions \.v3-button\s*\{[^}]*min-height:\s*var\(--v3-control-lg\)/)
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/\.v3-chat \.v3-button--sm\s*\{[^}]*min-height:\s*var\(--v3-control\)/)
    expect(chat).toMatch(/\.v3-chat-chip \.v3-chat-chip__summary\s*\{[^}]*min-height:\s*var\(--v3-control\)/)
    expect(chat).toMatch(/\.v3-chat-menu__popup \.v3-chat-menu__item\s*\{[^}]*min-height:\s*var\(--v3-control-lg\)/)
  })

  it('QA v2 bug 2: the island pill never shrinks below its 52px', () => {
    const island = readCss('components/Island/Island.css')
    expect(island).toMatch(/#root\[data-v3-route="chat"\] \.v3-island\s*\{[^}]*flex:\s*none;[^}]*height:\s*var\(--v3-control-lg\)/)
  })

  it('B1: the sheet notice sits in the footer row at full width and is hidden while empty', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/\.v3-dialog--sheet \.v3-dialog__footer > \.v3-approval-sheet__more\s*\{[^}]*flex:\s*1 1 100%/)
    expect(chat).toMatch(/\.v3-approval-sheet__more:empty\s*\{[^}]*display:\s*none/)
  })

  it('QA v2 bug 3: the decisions of the sheet footer take the whole width', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/\.v3-dialog--sheet \.v3-dialog__footer > \.v3-approval__actions[^{]*\{[^}]*flex:\s*1 1 100%/)
  })

  it('QA v2 bug 4 (Designer A1): the placeholder never relies on text-overflow, which does nothing on ::placeholder', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    // Kept as a safety net: one line, never a clipped 2nd line.
    expect(chat).toMatch(/@media \(max-width: 1279px\)\s*\{\s*[^@]*\.v3-chat-composer__input::placeholder\s*\{[^}]*white-space:\s*nowrap[^}]*\}/)
    // A claim of an ellipsis that never happens is worse than none: the fit is the short text of Composer.
    const placeholderRules = [...chat.matchAll(/[^{}]*::placeholder\s*\{[^}]*\}/g)].map(([rule]) => rule)
    expect(placeholderRules.length).toBeGreaterThan(0)
    for (const rule of placeholderRules) expect(rule).not.toMatch(/text-overflow/)
  })

  it('A2: the "/" menu never scrolls sideways (no grey bar at its foot, no unthemed corner)', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/\.v3-chat-slash\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/)
    expect(chat).toMatch(/@media \(max-width: 1279px\)[\s\S]*\.v3-chat-composer \.v3-chat-slash\s*\{[^}]*overflow-x:\s*hidden/)
  })

  it('A3: the headings of a message have a real line height and a margin, so h1 never overlaps its paragraph', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    const rule = chat.match(/\.v3-chat-prose h1,\s*:root\[data-layout="v3"\] \.v3-chat-prose h2,\s*:root\[data-layout="v3"\] \.v3-chat-prose h3\s*\{([^}]*)\}/)
    expect(rule, 'h1, h2 and h3 of .v3-chat-prose share one rule').not.toBeNull()
    expect(rule[1]).toMatch(/line-height:\s*1\.2/)
    expect(rule[1]).toMatch(/margin:\s*0 0 var\(--v3-space-2\)/)
  })

  it('A4: in the tablet list the row detail drops to its own line instead of being cut beside the chip', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    const tablet = chat.match(/@media \(min-width: 768px\) and \(max-width: 1279px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/)
    expect(tablet).not.toBeNull()
    expect(tablet[1]).toMatch(/\.v3-chat-row__meta\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(tablet[1]).toMatch(/\.v3-chat-row__detail\s*\{[^}]*flex-basis:\s*100%/)
  })

  it('ressalva 3: the phone rule of the approval actions only exists under the chat route', () => {
    const approval = readCss('components/ApprovalCard/ApprovalCard.css')
    const phone = blocks(approval).filter(({ query }) => /max-width:\s*767px/.test(query))
    expect(phone.length).toBeGreaterThan(0)
    for (const { query, body } of phone) {
      const selectors = selectorsOf(body)
      expect(selectors.length, query).toBeGreaterThan(0)
      for (const selector of selectors) expect(selector.startsWith(ROUTE), `ApprovalCard.css @media ${query}: ${selector}`).toBe(true)
    }
  })

  it('QA v2 bug 5: the line clamp sits on an unpadded inner box, not on the padded <code>', () => {
    const approval = readCss('components/ApprovalCard/ApprovalCard.css')
    expect(approval).toMatch(/\.v3-approval__object--clamped > \.v3-approval__object-text\s*\{[^}]*-webkit-line-clamp:\s*3[^}]*overflow:\s*hidden/)
    expect(approval).not.toMatch(/\.v3-approval__object--clamped\s*\{/)
  })

  it('QA v2 bug 6: the tablet header hides the secondary chips (agent and state stay)', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/@media \(min-width: 768px\) and \(max-width: 1279px\)\s*\{\s*[^@]*\.v3-chat-header__chips \.v3-chat-chip-secondary\s*\{\s*display:\s*none/)
  })

  it('the phone views: the list and the conversation exclude each other', () => {
    const chat = readCss('modules/chat/ChatScreen.css')
    expect(chat).toMatch(/\.v3-chat\[data-view="chat"\] \.v3-chat-list,\s*\.v3-chat\[data-view="list"\] \.v3-chat-panel\s*\{\s*display:\s*none/)
  })
})

describe('Esc inside a dialog of the chat never reaches the panel (QA v2 bug 1)', () => {
  const composer = () => screen.getByRole('combobox', { name: 'Mensagem para o agente' })
  const interrupts = () => lastSocket().sent.filter((frame) => frame.type === 'interrupt')
  const startTurnWithRequest = () => act(() => {
    lastSocket().receive(f('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' }))
    lastSocket().receive(f('permission.request', 2, {
      id: 'p1', kind: 'tool', tool_name: 'Bash', tool_use_id: 'tool-p1', input: { command: 'npm test' }, allow_session: false, connector: null,
    }))
  })

  it('Esc in the approval sheet closes only the sheet: no interrupt frame, no decision', async () => {
    await renderScreen({ width: 390 })
    startTurnWithRequest()
    fireEvent.click(screen.getByRole('button', { name: /Ver pedido completo/ }))
    const sheet = screen.getByRole('dialog')
    expect(sheet.className).toContain('v3-dialog--sheet')
    fireEvent.keyDown(within(sheet).getByRole('heading', { name: 'Pedido de permissão' }), { key: 'Escape' })
    expect(interrupts()).toHaveLength(0)
    expect(chatApi.decidePermission).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The turn is still running and the panel handles Esc again once the dialog is gone.
    fireEvent.keyDown(composer(), { key: 'Escape' })
    expect(interrupts()).toHaveLength(1)
  })

  it('Esc from a control inside the sheet footer is not an interrupt either', async () => {
    await renderScreen({ width: 390 })
    startTurnWithRequest()
    fireEvent.click(screen.getByRole('button', { name: /Ver pedido completo/ }))
    const deny = within(screen.getByRole('dialog')).getByRole('button', { name: 'Negar' })
    fireEvent.keyDown(deny, { key: 'Escape' })
    expect(interrupts()).toHaveLength(0)
    expect(chatApi.decidePermission).not.toHaveBeenCalled()
  })
})
