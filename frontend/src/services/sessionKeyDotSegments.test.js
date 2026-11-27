import { describe, it, expect } from 'vitest'
import { encodeSessionKey, isSafeSessionKey } from './sessionKey.js'

describe('isSafeSessionKey: dot-segments hidden behind %2e', () => {
  it.each(['a/%2e%2e/b', 'a/%2E./b', 'a/.%2e/b', 'a/%2e/b', 'a/%2E%2E/b', 'a/%2e%2E/b', '%2e%2e/a', 'a/%2e%2e'])(
    'refuses %s',
    (key) => {
      expect(isSafeSessionKey(key)).toBe(false)
      expect(() => encodeSessionKey(key)).toThrow('unsafe session key')
    },
  )

  it('keeps accepting real keys and segments that merely contain %2e or dots', () => {
    expect(isSafeSessionKey('Pessoal/tn-sandbox::claude::k3x9q2')).toBe(true)
    expect(isSafeSessionKey('a/b.c/d')).toBe(true)
    expect(isSafeSessionKey('a/x%2ey/b')).toBe(true)
    expect(isSafeSessionKey('a/..b/c')).toBe(true)
  })

  it('still refuses the literal dot-segments', () => {
    expect(isSafeSessionKey('a/../b')).toBe(false)
    expect(isSafeSessionKey('a/./b')).toBe(false)
  })
})
