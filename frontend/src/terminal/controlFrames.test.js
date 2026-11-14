import { describe, it, expect } from 'vitest'
import { CONTROL_FRAME_TYPES, isControlFrame } from './controlFrames.js'

describe('isControlFrame', () => {
  it('accepts every type in the allowlist and returns the parsed frame', () => {
    expect([...CONTROL_FRAME_TYPES].sort()).toEqual(['resume_failed', 'spawn_failed', 'viewer_open'])
    for (const type of CONTROL_FRAME_TYPES) {
      expect(isControlFrame(JSON.stringify({ type, extra: 1 }))).toEqual({ type, extra: 1 })
    }
  })

  it('returns null for invalid JSON', () => {
    expect(isControlFrame('plain terminal output')).toBeNull()
    expect(isControlFrame('{"type":')).toBeNull()
  })

  it('returns null for an object without type', () => {
    expect(isControlFrame(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('returns null for a type outside the allowlist', () => {
    expect(isControlFrame(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(isControlFrame(null)).toBeNull()
    expect(isControlFrame(undefined)).toBeNull()
    expect(isControlFrame(42)).toBeNull()
    expect(isControlFrame({ type: 'resume_failed' })).toBeNull()
  })

  it('returns null for JSON that is not an object', () => {
    expect(isControlFrame('[1,2,3]')).toBeNull()
    expect(isControlFrame('null')).toBeNull()
    expect(isControlFrame('"resume_failed"')).toBeNull()
  })
})
