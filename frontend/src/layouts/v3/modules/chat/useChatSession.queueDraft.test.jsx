// queueDraft: "Citar no chat" puts text at the end of the draft of ANY conversation (D-05). Memory only; it
// never sends, never stores, and a path it leaves behind never opens the "/" menu of the composer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatApi } from '../../../../services/chatApi.js'
import Composer from './Composer.jsx'
import { FakeWebSocket, resetSockets } from './chatTestKit.js'
import { useChatSession } from './useChatSession.js'

const KEY = 'Pessoal/tn-sandbox::claude::k3x9q2'
const OTHER = 'Pessoal/tn-sandbox::claude::zz9988'
const PATH = '/Users/bruno/projects/tn/docs/q3.md'

beforeEach(() => {
  resetSockets()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(chatApi, 'openSession').mockResolvedValue({ status: 'idle' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

const frames = () => FakeWebSocket.instances.flatMap((socket) => socket.sent ?? [])

describe('queueDraft on the open conversation', () => {
  it('puts the text in the draft, with a space after it', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.queueDraft(KEY, PATH))
    expect(result.current.draft).toBe(`${PATH} `)
  })

  it('appends to what was typed after ONE space, and leaves a space at the end', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.setDraft('olha esse arquivo'))
    act(() => result.current.queueDraft(KEY, PATH))
    expect(result.current.draft).toBe(`olha esse arquivo ${PATH} `)
  })

  it('does not double the space when the draft already ends with one (or a new line)', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.setDraft('veja '))
    act(() => result.current.queueDraft(KEY, PATH))
    expect(result.current.draft).toBe(`veja ${PATH} `)
    act(() => result.current.setDraft('linha\n'))
    act(() => result.current.queueDraft(KEY, PATH))
    expect(result.current.draft).toBe(`linha\n${PATH} `)
  })

  it('two citations in a row stay apart', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.queueDraft(KEY, '/a/one.md'))
    act(() => result.current.queueDraft(KEY, '/a/two.md'))
    expect(result.current.draft).toBe('/a/one.md /a/two.md ')
  })

  it('never sends: no frame goes out and no message card appears', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    // a live socket: a send would reach it
    act(() => FakeWebSocket.instances[FakeWebSocket.instances.length - 1].open())
    const before = frames().length
    act(() => result.current.queueDraft(KEY, PATH))
    expect(frames().length).toBe(before)
    expect(result.current.state.cards.length).toBe(0)
  })

  it('an empty text or no key does nothing', () => {
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.queueDraft(KEY, ''))
    act(() => result.current.queueDraft(null, PATH))
    act(() => result.current.queueDraft(KEY, null))
    expect(result.current.draft).toBe('')
  })
})

describe('queueDraft on ANOTHER conversation', () => {
  it('leaves the open draft alone and the other one is found when it opens', () => {
    const { result, rerender } = renderHook(({ key }) => useChatSession(key), { initialProps: { key: KEY } })
    act(() => result.current.setDraft('rascunho aberto'))
    act(() => result.current.queueDraft(OTHER, PATH))
    expect(result.current.draft).toBe('rascunho aberto')
    rerender({ key: OTHER })
    expect(result.current.draft).toBe(`${PATH} `)
    rerender({ key: KEY })
    expect(result.current.draft).toBe('rascunho aberto')
  })

  it('a conversation that was never opened still gets the draft', () => {
    const { result, rerender } = renderHook(({ key }) => useChatSession(key, { enabled: false }), { initialProps: { key: null } })
    act(() => result.current.queueDraft(OTHER, PATH))
    rerender({ key: OTHER })
    expect(result.current.draft).toBe(`${PATH} `)
  })
})

describe('what queueDraft leaves behind', () => {
  it('a POSIX path with its trailing space does not open the "/" menu of the composer; without it, it would', () => {
    const { rerender } = render(<Composer value="/Users/bruno/tn/q3.md" onChange={() => {}} />)
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('true')
    rerender(<Composer value="/Users/bruno/tn/q3.md " onChange={() => {}} />)
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false')
  })

  it('uses no web storage at all: the draft is memory', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useChatSession(KEY))
    act(() => result.current.queueDraft(KEY, PATH))
    expect(setItem).not.toHaveBeenCalled()
    const here = path.dirname(fileURLToPath(import.meta.url))
    const code = readFileSync(path.join(here, 'useChatSession.js'), 'utf8')
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })
})
