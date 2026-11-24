import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, act, cleanup } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { ProjectsSessionsContext, INERT_SESSIONS } from '../../sessions/useProjectsSessions.js'
import ChatSessionHost, { useChatSessionContext } from './ChatSessionHost.jsx'
import { useChatSession } from './useChatSession.js'

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const CODEX = 'Pessoal/tn-sandbox::codex'

let context
let hidden
let clearAttention

beforeEach(() => {
  hidden = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'))
  vi.spyOn(api, 'ackSession').mockResolvedValue({})
  clearAttention = vi.fn()
  context = { chats: [{ session_key: KEY, needs_attention: true, engine: 'pty' }], ptyPersisted: {}, focusedKey: KEY }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const wrapper = ({ children }) => (
  <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, ...context, clearAttention }}>{children}</ProjectsSessionsContext.Provider>
)
const setup = (key, active = true) => renderHook(() => useChatSession(key, { enabled: false, terminal: active }), { wrapper })

describe('useChatSession terminal ack (the terminal view acks over REST)', () => {
  it('acks a focused, visible Claude conversation shown as the terminal, and drops the local mark', () => {
    setup(KEY)
    expect(api.ackSession).toHaveBeenCalledTimes(1)
    expect(api.ackSession).toHaveBeenCalledWith(KEY)
    expect(clearAttention).toHaveBeenCalledWith(KEY)
  })

  it('acks a terminal session that has no chat row (codex, agy, the plain terminal)', () => {
    context = { chats: [], ptyPersisted: { [CODEX]: { needs_attention: true } }, focusedKey: CODEX }
    setup(CODEX)
    expect(api.ackSession).toHaveBeenCalledWith(CODEX)
  })

  it('does not ack while an approval is pending', () => {
    context.chats = [{ session_key: KEY, needs_attention: true, pending_permissions: 1 }]
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
    expect(clearAttention).not.toHaveBeenCalled()
  })

  it('does not ack an awaiting_permission conversation', () => {
    context.chats = [{ session_key: KEY, needs_attention: true, live_status: 'awaiting_permission' }]
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
  })

  it('does not ack when the tab is hidden', () => {
    hidden = true
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
  })

  it('does not ack a conversation that is not the one on screen', () => {
    context.focusedKey = null
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
  })

  it('does not ack when the key is not shown as the terminal', () => {
    setup(KEY, false)
    expect(api.ackSession).not.toHaveBeenCalled()
  })

  it('does not ack when nothing needs attention', () => {
    context.chats = [{ session_key: KEY, needs_attention: false }]
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
  })

  it('acks again when the tab becomes visible again with the mark still on', () => {
    hidden = true
    setup(KEY)
    expect(api.ackSession).not.toHaveBeenCalled()
    hidden = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(api.ackSession).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed request (the next poll brings the mark back and the ack is sent again)', async () => {
    api.ackSession.mockRejectedValue(new Error('down'))
    const view = setup(KEY)
    await act(async () => {})
    context = { ...context, chats: [{ session_key: KEY, needs_attention: false }] }
    view.rerender()
    context = { ...context, chats: [{ session_key: KEY, needs_attention: true }] }
    view.rerender()
    expect(api.ackSession).toHaveBeenCalledTimes(2)
  })
})

describe('ChatSessionHost wiring', () => {
  function Reporter({ vision }) {
    const host = useChatSessionContext()
    useEffect(() => host.reportVision(KEY, vision), [host.reportVision, vision])
    return null
  }
  const mountHost = (vision) => render(
    <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, ...context, clearAttention }}>
      <ChatSessionHost activeKey={KEY}>
        <Reporter vision={vision} />
      </ChatSessionHost>
    </ProjectsSessionsContext.Provider>,
  )

  it('acks over REST once the screen reported the terminal view', () => {
    mountHost('terminal')
    expect(api.ackSession).toHaveBeenCalledWith(KEY)
  })

  it('does not ack over REST while the screen shows the chat (the socket acks there)', () => {
    class Socket { constructor() { this.readyState = 0 } send() {} close() {} }
    vi.stubGlobal('WebSocket', Socket)
    try {
      mountHost('chat')
      expect(api.ackSession).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
