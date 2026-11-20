import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newPtySessionKey, randomSuffix } from './ptySessionKey.js'

// The V2 reads a session key with `key.split('::')` (components/TerminalContext.jsx: projectId = part 0,
// agentId = part 1) and builds new ones as `<project>::<agent>::<Math.random().toString(36).slice(2, 8)>`.
const v2Parts = (key) => key.split('::')

describe('newPtySessionKey', () => {
  it('has the V2 format: project::agent::suffix, with a base36 suffix', () => {
    const key = newPtySessionKey('Pessoal/tn-sandbox', 'codex')
    expect(key).toMatch(/^Pessoal\/tn-sandbox::codex::[0-9a-z]{6}$/)
  })

  it('is read back by the V2 split as the same project and agent', () => {
    const [projectId, agentId, suffix, ...rest] = v2Parts(newPtySessionKey('podesubir/ymci', 'terminal'))
    expect(projectId).toBe('podesubir/ymci')
    expect(agentId).toBe('terminal')
    expect(suffix).toHaveLength(6)
    expect(rest).toEqual([])
  })

  it('uses the V2 generator expression (read from TerminalContext.jsx) for the suffix, 6 characters long', () => {
    // The V2 line: `${bareKey}::${Math.random().toString(36).slice(2, 8)}`. It is parsed out of the V2 source, so a
    // change of the V2 format breaks this test instead of silently drifting away from the V3 copy.
    const v2Source = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../components/TerminalContext.jsx'), 'utf8')
    const match = /::\$\{Math\.random\(\)\.toString\((\d+)\)\.slice\((\d+), (\d+)\)\}/.exec(v2Source)
    expect(match).not.toBeNull()
    const [, radix, from, to] = match.map(Number)
    expect(radix).toBe(36)
    const draw = 0.123456789
    const v2Suffix = draw.toString(radix).slice(from, to)
    expect(v2Suffix).toHaveLength(6)
    expect(newPtySessionKey('p', 'a', () => draw)).toBe(`p::a::${v2Suffix}`)
  })

  it('always adds the suffix: it is never the bare key of the V2 (that one may resume a saved session)', () => {
    expect(newPtySessionKey('p', 'a')).not.toBe('p::a')
    expect(v2Parts(newPtySessionKey('p', 'a'))).toHaveLength(3)
  })

  it('uses the random source it is given, taking the digits after "0."', () => {
    expect(newPtySessionKey('p', 'a', () => 0.123456789)).toBe(`p::a::${(0.123456789).toString(36).slice(2, 8)}`)
  })

  it('two calls give two keys', () => {
    expect(newPtySessionKey('p', 'a')).not.toBe(newPtySessionKey('p', 'a'))
  })
})

describe('randomSuffix', () => {
  it('is always exactly 6 characters, even when a draw has few digits (the V2 one can be shorter)', () => {
    expect(randomSuffix(() => 0.5)).toHaveLength(6) // 0.5 -> "0.i"
    expect(randomSuffix(() => 0.5)).toMatch(/^[0-9a-z]{6}$/)
  })

  it('terminates on a draw of exactly 0 (no fractional digits)', () => {
    expect(randomSuffix(() => 0)).toBe('000000')
  })
})
