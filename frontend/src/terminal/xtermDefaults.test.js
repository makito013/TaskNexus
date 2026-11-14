import { describe, it, expect } from 'vitest'
import { ansiPaletteFrom, FONTS_READY_TIMEOUT_MS, TERMINAL_BASE_OPTIONS } from './xtermDefaults.js'

// Literal copied from resolveTerminalTheme() of TerminalPanel.jsx at c4c5dee,
// evaluated with no --v2-* tokens defined (every token falls back).
const LEGACY_PALETTE_WITHOUT_TOKENS = {
  background: '#111111',
  foreground: '#e0e0e0',
  cursor: '#4ade80',
  cursorAccent: '#111111',
  selectionBackground: 'rgba(255, 255, 255, 0.15)',
  black: '#111111',
  red: '#ff3333',
  green: '#4ade80',
  yellow: '#4ade80',
  blue: '#60a5fa',
  magenta: '#60a5fa',
  cyan: '#4ade80',
  white: '#e0e0e0',
  brightBlack: '#e0e0e0',
  brightRed: '#ff3333',
  brightGreen: '#4ade80',
  brightYellow: '#4ade80',
  brightBlue: '#60a5fa',
  brightMagenta: '#60a5fa',
  brightCyan: '#4ade80',
  brightWhite: '#e0e0e0',
}

describe('ansiPaletteFrom', () => {
  it('equals the legacy palette when no token is defined', () => {
    expect(ansiPaletteFrom((token, fallback) => fallback)).toEqual(LEGACY_PALETTE_WITHOUT_TOKENS)
  })

  it('maps the tokens the way the legacy resolver did', () => {
    const tokens = {
      '--v2-bg': '#010101',
      '--v2-text': '#020202',
      '--v2-accent': '#030303',
      '--v2-accent-strong': '#040404',
      '--v2-accent-2': '#050505',
      '--v2-danger': '#060606',
      '--v2-surface-2': '#070707',
      '--v2-text-faint': '#080808',
    }
    const palette = ansiPaletteFrom((token, fallback) => tokens[token] || fallback)
    expect(palette).toEqual({
      background: '#010101',
      foreground: '#020202',
      cursor: '#030303',
      cursorAccent: '#010101',
      selectionBackground: 'rgba(255, 255, 255, 0.15)',
      black: '#070707',
      red: '#060606',
      green: '#030303',
      yellow: '#040404',
      blue: '#050505',
      magenta: '#050505',
      cyan: '#030303',
      white: '#020202',
      brightBlack: '#080808',
      brightRed: '#060606',
      brightGreen: '#030303',
      brightYellow: '#040404',
      brightBlue: '#050505',
      brightMagenta: '#050505',
      brightCyan: '#030303',
      brightWhite: '#020202',
    })
  })

  it('derives the dependent tokens from the ones that are defined', () => {
    const palette = ansiPaletteFrom((token, fallback) => (token === '--v2-accent' ? '#abcdef' : fallback))
    expect(palette.yellow).toBe('#abcdef')
    expect(palette.black).toBe('#111111')
    expect(palette.brightBlack).toBe('#e0e0e0')
  })
})

describe('terminal constants', () => {
  it('keeps the constructor options and the fonts timeout of the V2 panel', () => {
    expect(TERMINAL_BASE_OPTIONS).toEqual({
      cursorBlink: true,
      fontFamily: 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
    })
    expect(FONTS_READY_TIMEOUT_MS).toBe(500)
  })
})
