import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { ansiPaletteFrom } from '../../../../../terminal/xtermDefaults.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TERMINAL_FONT_SIZE, V2_DARK_TOKENS, readTerminalOptions, readTerminalTheme, sameTheme, useTerminalTheme } from './terminalTheme.js'

const TOKENS = {
  light: { '--v3-island': '#14171a', '--v3-island-ink': '#ffffff', '--v3-island-surface': '#22272e', '--v3-font-mono': '"IBM Plex Mono", ui-monospace, monospace' },
  dark: { '--v3-island': '#050608', '--v3-island-ink': '#f1f1f1', '--v3-island-surface': '#101216', '--v3-font-mono': '"IBM Plex Mono", ui-monospace, monospace' },
}

const root = document.documentElement
function applyTokens(tokens) {
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
}
function clearTokens() {
  for (const name of Object.keys(TOKENS.light)) root.style.removeProperty(name)
  for (const name of ['--v2-bg', '--v2-text', '--v2-accent', '--v2-danger']) root.style.removeProperty(name)
  root.removeAttribute('data-theme')
}
const readV2Dark = (token, fallback) => V2_DARK_TOKENS[token] ?? fallback

afterEach(() => {
  cleanup()
  clearTokens()
})

describe('readTerminalTheme', () => {
  it('takes background, foreground, cursor and selection from the island tokens', () => {
    applyTokens(TOKENS.light)
    const theme = readTerminalTheme()
    expect(theme.background).toBe('#14171a')
    expect(theme.cursorAccent).toBe('#14171a')
    expect(theme.foreground).toBe('#ffffff')
    expect(theme.cursor).toBe('#ffffff')
    expect(theme.selectionBackground).toBe('#22272e')
  })

  it('the 16 ANSI colours are the ones of ansiPaletteFrom (the V2 function) fed with the V2 dark palette', () => {
    applyTokens(TOKENS.light)
    const theme = readTerminalTheme()
    const ansi = ansiPaletteFrom(readV2Dark)
    for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']) {
      expect(theme[name], name).toBe(ansi[name])
    }
    // The EFFECTIVE colours of the current TaskNexus (V2 dark), not the function's vivid fallbacks.
    expect(theme.green).toBe('oklch(0.74 0.065 168)')
    expect(theme.blue).toBe('oklch(0.74 0.07 268)')
    expect(theme.red).toBe('oklch(0.68 0.14 25)')
    for (const vivid of ['#4ade80', '#60a5fa', '#ff3333']) expect(Object.values(theme)).not.toContain(vivid)
  })

  it('V2_DARK_TOKENS are literally the values of the V2 dark theme block (parity with the current TaskNexus)', () => {
    const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../v2/theme.css'), 'utf8')
    const dark = css.match(/:root\[data-layout="v2"\]\[data-theme="dark"\]\s*\{([^}]*)\}/)[1]
    for (const [token, value] of Object.entries(V2_DARK_TOKENS)) {
      const declared = dark.match(new RegExp(`${token}:\\s*([^;]+);`))[1].trim()
      expect(value, token).toBe(declared)
    }
  })

  it('the palette is the same in both V3 themes (the island is dark in both)', () => {
    applyTokens(TOKENS.light)
    const light = readTerminalTheme()
    applyTokens(TOKENS.dark)
    const dark = readTerminalTheme()
    for (const name of ['red', 'green', 'blue', 'white', 'black']) expect(light[name], name).toBe(dark[name])
  })

  it('without the island tokens it is exactly the V2 dark palette, nothing is overridden', () => {
    const theme = readTerminalTheme()
    expect(theme).toEqual(ansiPaletteFrom(readV2Dark))
    expect(theme.background).toBe(V2_DARK_TOKENS['--v2-bg'])
    expect(theme.foreground).toBe(V2_DARK_TOKENS['--v2-text'])
  })

  it('a token that is missing only skips ITS override', () => {
    root.style.setProperty('--v3-island', '#0a0a0a')
    const theme = readTerminalTheme()
    expect(theme.background).toBe('#0a0a0a')
    expect(theme.foreground).toBe(V2_DARK_TOKENS['--v2-text']) // the V2 palette stays
  })

  it('follows the tokens of the other theme', () => {
    applyTokens(TOKENS.light)
    const light = readTerminalTheme()
    applyTokens(TOKENS.dark)
    const dark = readTerminalTheme()
    expect(dark.background).toBe('#050608')
    expect(dark.foreground).toBe('#f1f1f1')
    expect(sameTheme(light, dark)).toBe(false)
  })
})

describe('readTerminalOptions', () => {
  it('uses the RESOLVED --v3-font-mono list (never the string var(...)) at 13 px', () => {
    applyTokens(TOKENS.light)
    const options = readTerminalOptions()
    expect(options.fontFamily).toBe('"IBM Plex Mono", ui-monospace, monospace')
    expect(options.fontFamily).not.toContain('var(')
    expect(options.fontSize).toBe(13)
    expect(TERMINAL_FONT_SIZE).toBe(13)
  })

  it('falls back to the V2 font stack when the token is missing', () => {
    expect(readTerminalOptions().fontFamily).toContain('Consolas')
  })
})

describe('sameTheme', () => {
  it('compares values, not identity, and sees a different key set', () => {
    expect(sameTheme({ a: 1 }, { a: 1 })).toBe(true)
    expect(sameTheme({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameTheme({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('useTerminalTheme', () => {
  let seen
  function Probe() {
    seen.push(useTerminalTheme())
    return null
  }

  it('gives the theme of the tokens and repaints (a NEW object) when data-theme switches, with no remount', async () => {
    seen = []
    applyTokens(TOKENS.light)
    root.setAttribute('data-theme', 'light')
    render(<Probe />)
    const first = seen.at(-1)
    expect(first.background).toBe('#14171a')

    applyTokens(TOKENS.dark)
    await act(async () => {
      root.setAttribute('data-theme', 'dark')
      await Promise.resolve()
    })
    const second = seen.at(-1)
    expect(second.background).toBe('#050608')
    expect(second).not.toBe(first)
  })

  it('keeps the SAME object while nothing changed (a new identity would repaint the live terminal)', async () => {
    seen = []
    applyTokens(TOKENS.light)
    const { rerender } = render(<Probe />)
    rerender(<Probe />)
    await act(async () => {
      root.setAttribute('data-theme', 'light') // the attribute is written, the tokens are the same
      await Promise.resolve()
    })
    expect(new Set(seen).size).toBe(1)
  })

  it('stops watching on unmount', async () => {
    seen = []
    applyTokens(TOKENS.light)
    const { unmount } = render(<Probe />)
    unmount()
    const calls = seen.length
    applyTokens(TOKENS.dark)
    await act(async () => {
      root.setAttribute('data-theme', 'dark')
      await Promise.resolve()
    })
    expect(seen.length).toBe(calls)
  })
})
