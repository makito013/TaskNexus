import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodePtySessionKey, encodeSessionKey, isSafeSessionKey } from './sessionKey.js'
import { chatApi } from './chatApi.js'
import { connect } from './chatSocket.js'

afterEach(() => vi.unstubAllGlobals())

const UNSAFE = [
  '..', '.', '../other::claude::x', 'proj/../other::claude', 'proj/./x::claude', 'proj/..', 'a//b::claude',
  '/proj::claude', 'proj::claude?x=1', 'proj::claude#frag', 'proj\\..\\x::claude',
  'proj::claude\u0000', 'proj::cla\nude', 'proj::cla\tude', '', null, undefined, 42,
]

describe('isSafeSessionKey', () => {
  it.each([
    'meu-projeto::claude', 'Pessoal/tn-sandbox::codex::ab12cd', 'cliente/sub/proj::claude::zz99zz', 'a b::c', 'ação::claude',
    '..a::claude', 'a..::claude', 'proj/.hidden::claude',
  ])('accepts %s', (key) => {
    expect(isSafeSessionKey(key)).toBe(true)
  })

  it.each(UNSAFE)('refuses %j', (key) => {
    expect(isSafeSessionKey(key)).toBe(false)
  })
})

describe('encoding', () => {
  it('encodes each segment on its own and keeps the slashes', () => {
    expect(encodeSessionKey('Pessoal/tn sandbox::codex::ab12cd')).toBe('Pessoal/tn%20sandbox%3A%3Acodex%3A%3Aab12cd')
  })

  it('the terminal form keeps the colons the V2 sends and still encodes the rest', () => {
    expect(encodePtySessionKey('Pessoal/tn-sandbox::codex::ab12cd')).toBe('Pessoal/tn-sandbox::codex::ab12cd')
    expect(encodePtySessionKey('Pessoal/a b%x::codex')).toBe('Pessoal/a%20b%25x::codex')
  })

  it.each(UNSAFE)('both refuse %j instead of building a URL', (key) => {
    expect(() => encodeSessionKey(key)).toThrow('unsafe session key')
    expect(() => encodePtySessionKey(key)).toThrow('unsafe session key')
  })
})

describe('the clients never send a request for an unsafe key', () => {
  it('chatApi refuses before fetch, for the routes that carry the key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const attempts = [
      () => chatApi.terminateSession('../other::claude::x'),
      () => chatApi.resetSession('proj/../other::claude'),
      () => chatApi.fetchEvents('..'),
      () => chatApi.openSession('a//b'),
    ]
    for (const attempt of attempts) {
      // a sync throw or a rejected promise are both a refusal
      await Promise.resolve().then(attempt).catch(() => {})
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chatSocket refuses to open a socket for it', () => {
    const sockets = []
    class FakeSocket {
      constructor(url) { sockets.push(url) }
      close() {}
    }
    expect(() => connect('../other::claude::x', { WebSocketImpl: FakeSocket })).toThrow('unsafe session key')
    expect(sockets).toEqual([])
  })
})
