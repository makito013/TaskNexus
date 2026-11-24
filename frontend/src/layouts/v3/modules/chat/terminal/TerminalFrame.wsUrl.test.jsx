import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const surface = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../../../../terminal/useTerminalSurface.js', () => ({
  useTerminalSurface: (options) => {
    surface.calls.push(options)
    return { status: 'connecting', sendControlByte: () => {}, focus: () => {}, termRef: { current: null } }
  },
}))

import TerminalFrame from './TerminalFrame.jsx'

afterEach(() => {
  cleanup()
  surface.calls.length = 0
})

const wsUrlOf = (sessionKey) => {
  render(<TerminalFrame sessionKey={sessionKey} agentName="Codex" />)
  return surface.calls.at(-1).wsUrl
}

describe('TerminalFrame wsUrl (stage 10, Y3)', () => {
  it('keeps the key exactly as the V2 sends it when it has nothing to encode', () => {
    expect(wsUrlOf('Pessoal/tn-sandbox::codex::ab12cd')).toBe(`ws://${window.location.host}/ws/pty/Pessoal/tn-sandbox::codex::ab12cd`)
  })

  it('encodes what would change the meaning of the path', () => {
    expect(wsUrlOf('Pessoal/a b%x::codex::ab12cd')).toBe(`ws://${window.location.host}/ws/pty/Pessoal/a%20b%25x::codex::ab12cd`)
  })

  it('never builds the URL of an unsafe key', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TerminalFrame sessionKey="../chat/other::claude::x" agentName="Codex" />)).toThrow('unsafe session key')
    expect(surface.calls.some((call) => String(call.wsUrl).includes('..'))).toBe(false)
    quiet.mockRestore()
  })
})
