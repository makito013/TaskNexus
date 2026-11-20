import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { FakeWebSocket, lastSocket, resetSockets } from './chatTestKit.js'
import { ProjectsSessionsContext, INERT_SESSIONS } from '../../sessions/useProjectsSessions.js'
import { useChatSession } from './useChatSession.js'

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'

let chats
let focusedKey
let clearAttention

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  chats = [{ session_key: KEY, needs_attention: true }]
  focusedKey = KEY
  clearAttention = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(options) {
  const wrapper = ({ children }) => (
    <ProjectsSessionsContext.Provider value={{ ...INERT_SESSIONS, chats, focusedKey, clearAttention }}>
      {children}
    </ProjectsSessionsContext.Provider>
  )
  return renderHook(() => useChatSession(KEY, options), { wrapper })
}
const acks = () => lastSocket().sent.filter((frame) => frame.type === 'ack')
const connected = () => act(() => lastSocket().open())

describe('useChatSession ack (CA49)', () => {
  it('sends ack once the socket is open for the focused conversation that needs attention, and clears the local mark', () => {
    setup()
    expect(acks()).toHaveLength(0) // socket still connecting
    connected()
    expect(acks()).toHaveLength(1)
    expect(clearAttention).toHaveBeenCalledWith(KEY)
  })

  it('does not ack a conversation that is not the one on screen', () => {
    focusedKey = null
    setup()
    connected()
    expect(acks()).toHaveLength(0)
    expect(clearAttention).not.toHaveBeenCalled()
  })

  it('does not ack when nothing needs attention', () => {
    chats = [{ session_key: KEY, needs_attention: false }]
    setup()
    connected()
    expect(acks()).toHaveLength(0)
  })

  it('does not ack while an approval is pending', () => {
    chats = [{ session_key: KEY, needs_attention: true, pending_permissions: 1 }]
    setup()
    connected()
    expect(acks()).toHaveLength(0)
  })

  it('does not ack on a hidden tab and acks when it becomes visible again', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    setup()
    connected()
    expect(acks()).toHaveLength(0)
    visibility.mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(acks()).toHaveLength(1)
  })

  it('acks on window focus when the tab was hidden', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    setup()
    connected()
    visibility.mockReturnValue('visible')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(acks()).toHaveLength(1)
  })

  it('opens no socket and sends no ack when the conversation is shown as the terminal', () => {
    setup({ enabled: false })
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(clearAttention).not.toHaveBeenCalled()
  })

  it('acks again if the mark comes back after the poll (lost ack)', () => {
    const { rerender } = setup()
    connected()
    expect(acks()).toHaveLength(1)
    chats = [{ session_key: KEY, needs_attention: false }]
    rerender()
    chats = [{ session_key: KEY, needs_attention: true }]
    rerender()
    expect(acks()).toHaveLength(2)
  })
})
