import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { chatApi } from '../../../../services/chatApi.js'
import { FakeWebSocket, frames, lastSocket, liveSockets, resetSockets } from './chatTestKit.js'
import { useChatSession } from './useChatSession.js'

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const OTHER = 'Pessoal/tn-sandbox::claude::zz9988'
const frame = frames(KEY)

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(chatApi, 'decidePermission').mockResolvedValue({})
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
  vi.spyOn(chatApi, 'resetSession').mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const serve = (...events) => act(() => events.forEach((event) => lastSocket().receive(event)))
const connected = () => act(() => lastSocket().open())

describe('useChatSession socket ownership', () => {
  it('opens the conversation socket with since=0 and reports the connection', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(lastSocket().url).toMatch(/\/ws\/chat\/Pessoal\/tn-sandbox%3A%3Aclaude%3A%3Ak3x9q2\?since=0$/)
    expect(result.current.connection.state).toBe('connecting')
    connected()
    expect(result.current.connection.state).toBe('open')
  })

  it('StrictMode (mount, cleanup, mount) leaves exactly ONE live socket', () => {
    renderHook(() => useChatSession(KEY), { wrapper: StrictMode })
    expect(liveSockets()).toHaveLength(1)
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1)
    // every socket that is not the live one was closed, exactly once
    for (const socket of FakeWebSocket.instances.filter((candidate) => candidate.readyState === 3)) {
      expect(socket.closeCalls).toBe(1)
    }
  })

  it('unmount closes the live socket once, and a second cleanup is harmless', () => {
    const { unmount } = renderHook(() => useChatSession(KEY), { wrapper: StrictMode })
    const live = liveSockets()[0]
    unmount()
    expect(liveSockets()).toHaveLength(0)
    expect(live.closeCalls).toBe(1)
    expect(() => cleanup()).not.toThrow()
    expect(live.closeCalls).toBe(1)
  })

  it('a null key opens nothing and stays idle', () => {
    const { result } = renderHook(() => useChatSession(null))
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(result.current.connection.state).toBe('idle')
    expect(result.current.send('oi')).toBe(false)
  })

  it('changing the key closes the old socket, opens one for the new key and drops the old state', () => {
    const { result, rerender } = renderHook(({ sessionKey }) => useChatSession(sessionKey), {
      initialProps: { sessionKey: KEY },
    })
    connected()
    serve(frame('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' }))
    expect(result.current.state.messages).toHaveLength(1)
    const first = lastSocket()
    rerender({ sessionKey: OTHER })
    expect(first.readyState).toBe(3)
    expect(liveSockets()).toHaveLength(1)
    expect(lastSocket().url).toContain('zz9988')
    expect(result.current.state.messages).toHaveLength(0)
  })

  it('ignores what a socket that was already closed says', () => {
    const { result, rerender } = renderHook(({ sessionKey }) => useChatSession(sessionKey), {
      initialProps: { sessionKey: KEY },
    })
    const stale = lastSocket()
    rerender({ sessionKey: OTHER })
    act(() => stale.receive(frame('message.user', 1, { client_msg_id: 'late', text: 'atrasada', origin: 'ui' })))
    expect(result.current.state.messages).toHaveLength(0)
  })
})

describe('useChatSession events and commands', () => {
  it('folds server frames into the chat state', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(
      frame('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' }),
      frame('message.assistant', 2, { message_id: 'm1', blocks: [{ type: 'text', text: 'olá' }] }),
      frame('replay.complete', null, { last_seq: 2 }),
    )
    expect(result.current.state.messages.map((item) => item.text)).toEqual(['oi', 'olá'])
    expect(result.current.state.replayComplete).toBe(true)
    expect(result.current.state.lastSeq).toBe(2)
  })

  it('send puts an optimistic bubble first, then sends the frame with the same ids', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    let accepted
    act(() => {
      accepted = result.current.send('  faça algo  ')
    })
    expect(accepted).toBe(true)
    const sent = lastSocket().sent.at(-1)
    expect(sent).toMatchObject({ type: 'send', text: '  faça algo  ' })
    expect(sent.client_msg_id).toBeTruthy()
    expect(sent.request_id).toBeTruthy()
    const bubble = result.current.state.messages[0]
    expect(bubble).toMatchObject({ kind: 'user', status: 'sending', clientMsgId: sent.client_msg_id, requestId: sent.request_id })
    // the server echo replaces the bubble by client_msg_id
    serve(frame('message.user', 1, { client_msg_id: sent.client_msg_id, text: '  faça algo  ', origin: 'ui' }))
    expect(result.current.state.messages).toHaveLength(1)
    expect(result.current.state.messages[0].status).toBe('sent')
  })

  it('send refuses an empty message and sends nothing', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    let accepted
    act(() => {
      accepted = result.current.send('   ')
    })
    expect(accepted).toBe(false)
    expect(lastSocket().sent).toHaveLength(0)
    expect(result.current.state.messages).toHaveLength(0)
  })

  it('a rejected send marks the bubble as failed', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    act(() => result.current.send('oi'))
    const { request_id: requestId } = lastSocket().sent.at(-1)
    serve(frame('command.rejected', null, { request_id: requestId, code: 'capacity_exceeded', message: 'x' }))
    expect(result.current.state.messages[0].status).toBe('failed')
  })

  it('send before the socket opens is queued and leaves when it opens', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.send('cedo'))
    expect(lastSocket().sent).toHaveLength(0)
    connected()
    expect(lastSocket().sent).toHaveLength(1)
  })

  it('interrupt marks the turn as interrupting and sends the frame', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(frame('message.user', 1, { client_msg_id: 'c1', text: 'oi', origin: 'ui' }))
    act(() => result.current.interrupt())
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'interrupt' })
    expect(result.current.state.turn.interrupting).toBe(true)
    serve(frame('turn.ended', 2, { subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' }))
    expect(result.current.state.messages.some((item) => item.kind === 'divider' && item.variant === 'interrupted')).toBe(true)
    expect(result.current.state.messages.some((item) => item.kind === 'error')).toBe(false)
  })

  it('setModel sends set_model', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    act(() => result.current.setModel('haiku'))
    expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'set_model', model: 'haiku' })
  })
})

describe('useChatSession decisions', () => {
  const pendingCard = frame('permission.request', 3, {
    id: 'p1', kind: 'tool', tool_name: 'Bash', tool_use_id: 't1', input: { command: 'npm test' }, allow_session: false,
  })

  it('records the local decision BEFORE the REST call: a resolution that races the response is still "by me"', async () => {
    // The server publishes permission.resolved before the HTTP response comes back.
    chatApi.decidePermission.mockImplementation(async () => {
      lastSocket().receive(frame('permission.resolved', 4, { id: 'p1', status: 'allowed', by: 'rest', scope: 'once' }))
    })
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(pendingCard)
    await act(async () => {
      await result.current.decide(result.current.state.cards[0], { behavior: 'allow' })
    })
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'allow', scope: 'once' })
    expect(result.current.state.localDecisions.p1).toMatchObject({ behavior: 'allow', scope: 'once' })
    expect(result.current.state.cards[0].status).toBe('allowed')
    expect(result.current.state.cards[0].decidedElsewhere).toBe(false)
  })

  it('without a local decision the same resolution is "another device"', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(pendingCard, frame('permission.resolved', 4, { id: 'p1', status: 'allowed', by: 'rest', scope: 'once' }))
    expect(result.current.state.cards[0].decidedElsewhere).toBe(true)
  })

  it('tracks the phase of a decision: sending, then sent', async () => {
    let release
    chatApi.decidePermission.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(pendingCard)
    let pending
    act(() => {
      pending = result.current.decide(result.current.state.cards[0], { behavior: 'deny', message: 'não', interrupt: true })
    })
    expect(result.current.decisions.p1).toEqual({ phase: 'sending', kind: 'denyStop' })
    await act(async () => {
      release({})
      await pending
    })
    expect(result.current.decisions.p1).toEqual({ phase: 'sent', kind: 'denyStop' })
    expect(chatApi.decidePermission).toHaveBeenCalledWith('p1', { behavior: 'deny', message: 'não', interrupt: true, scope: 'once' })
  })

  it('a failed decision shows an error phase and does not throw', async () => {
    chatApi.decidePermission.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(pendingCard)
    await act(async () => {
      await result.current.decide(result.current.state.cards[0], { behavior: 'allow', scope: 'session' })
    })
    expect(result.current.decisions.p1).toEqual({ phase: 'error', kind: 'allowSession' })
  })

  it('undoes the local decision when the request fails: another device resolving it is told apart', async () => {
    chatApi.decidePermission.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(pendingCard)
    await act(async () => {
      await result.current.decide(result.current.state.cards[0], { behavior: 'allow' })
    })
    expect(result.current.state.localDecisions.p1).toBeUndefined()
    expect(result.current.state.cards[0].status).toBe('pending')
    serve(frame('permission.resolved', 4, { id: 'p1', status: 'allowed', by: 'rest', scope: 'once' }))
    expect(result.current.state.cards[0].decidedElsewhere).toBe(true)
  })
})

describe('useChatSession messages handed to a dying socket', () => {
  const send = (result, text) => act(() => {
    result.current.send(text)
  })

  it('a message already handed to a socket that drops becomes "Não enviada"; the echo after the replay heals it', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useChatSession(KEY))
      connected()
      send(result, 'oi')
      const sent = lastSocket().sent.at(-1)
      act(() => lastSocket().drop())
      expect(result.current.state.messages[0]).toMatchObject({ status: 'failed', errorCode: 'connection_lost' })
      act(() => vi.advanceTimersByTime(1000))
      connected()
      serve(frame('message.user', 1, { client_msg_id: sent.client_msg_id, text: 'oi', origin: 'ui' }), frame('replay.complete', null))
      expect(result.current.state.messages).toHaveLength(1)
      expect(result.current.state.messages[0].status).toBe('sent')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a message still queued while reconnecting stays "Enviando…" and leaves on the next socket', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useChatSession(KEY))
      connected()
      act(() => lastSocket().drop())
      send(result, 'depois')
      expect(result.current.state.messages[0].status).toBe('sending')
      act(() => vi.advanceTimersByTime(1000))
      connected()
      expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'send', text: 'depois' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a chat that closed (status closed) reconnects after a drop and the conversation operates again', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useChatSession(KEY))
      connected()
      serve(frame('status', 1, { code: 'closed', reason: 'idle' }))
      act(() => lastSocket().drop())
      expect(result.current.connection.state).toBe('reconnecting')
      act(() => vi.advanceTimersByTime(1000))
      expect(FakeWebSocket.instances).toHaveLength(2)
      connected()
      expect(result.current.connection.state).toBe('open')
      send(result, 'volta')
      expect(lastSocket().sent.at(-1)).toMatchObject({ type: 'send', text: 'volta' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useChatSession recovery actions', () => {
  it('resume_failed: "Iniciar nova conversa" calls reset, and session.reset clears the banner', async () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    serve(frame('status', 5, { code: 'resume_failed', detail: 'x' }))
    expect(result.current.state.banner.kind).toBe('resume_failed')
    await act(async () => {
      await result.current.reset()
    })
    expect(chatApi.resetSession).toHaveBeenCalledWith(KEY)
    serve(frame('session.reset', 6))
    expect(result.current.state.banner).toBeNull()
  })

  it('open asks the server to start the conversation again and retries the socket', async () => {
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    await act(async () => {
      await result.current.open()
    })
    expect(chatApi.openSession).toHaveBeenCalledWith(KEY)
  })

  it('a failed open or reset is reported, not swallowed', async () => {
    chatApi.openSession.mockRejectedValue(new Error('boom'))
    chatApi.resetSession.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useChatSession(KEY))
    connected()
    await act(async () => {
      await result.current.open()
    })
    expect(result.current.actionError).toMatchObject({ action: 'open' })
    await act(async () => {
      await result.current.reset()
    })
    expect(result.current.actionError).toMatchObject({ action: 'reset' })
  })

  it('retryNow reconnects a socket that gave up', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useChatSession(KEY))
      connected()
      for (let index = 0; index < 5; index += 1) {
        act(() => lastSocket().drop())
        if (index < 4) act(() => vi.advanceTimersByTime(40000))
      }
      expect(result.current.connection.state).toBe('offline')
      const before = FakeWebSocket.instances.length
      act(() => result.current.retryNow())
      expect(FakeWebSocket.instances.length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useChatSession draft', () => {
  it('keeps one draft per chat in memory only', () => {
    const { result, rerender } = renderHook(({ sessionKey }) => useChatSession(sessionKey), {
      initialProps: { sessionKey: KEY },
    })
    act(() => result.current.setDraft('rascunho A'))
    expect(result.current.draft).toBe('rascunho A')
    rerender({ sessionKey: OTHER })
    expect(result.current.draft).toBe('')
    act(() => result.current.setDraft('rascunho B'))
    rerender({ sessionKey: KEY })
    expect(result.current.draft).toBe('rascunho A')
    rerender({ sessionKey: OTHER })
    expect(result.current.draft).toBe('rascunho B')
    expect(window.localStorage.length).toBe(0)
  })

  it('clearing the draft forgets it', () => {
    const { result, rerender } = renderHook(({ sessionKey }) => useChatSession(sessionKey), {
      initialProps: { sessionKey: KEY },
    })
    act(() => result.current.setDraft('x'))
    act(() => result.current.setDraft(''))
    rerender({ sessionKey: OTHER })
    rerender({ sessionKey: KEY })
    expect(result.current.draft).toBe('')
  })
})
