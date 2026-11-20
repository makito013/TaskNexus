import { useEffect, useState } from 'react'
import { TERMINAL_BASE_OPTIONS, ansiPaletteFrom } from '../../../../../terminal/xtermDefaults.js'

// xterm theme of the V3 terminal view (Designer 11.1, D-TL3.4).
//   background               = --v3-island          cursor / foreground = --v3-island-ink
//   selectionBackground      = --v3-island-surface
//   the 16 ANSI colours      = ansiPaletteFrom() of src/terminal/xtermDefaults (the SAME function the V2 terminal
//                              uses) fed with the colours the V2 resolves in its dark theme (V2_DARK_TOKENS). The
//                              V3 defines no --v2-* tokens, so reading them from the page would fall back to the
//                              function's vivid defaults (#4ade80...) and the shell colours would differ from the
//                              current TaskNexus. The island is dark in BOTH V3 themes, hence the dark values
//                              (the V2 light ones are dark inks made for a light background).
// Values are read from the CSS (`getComputedStyle`), so no hex is duplicated. A token that is missing (a test
// with no stylesheet) simply does not override: the palette stays.
// The --v2-* tokens ansiPaletteFrom reads, with the values of `:root[data-layout="v2"][data-theme="dark"]`
// (layouts/v2/theme.css). Copied literally; if the V2 palette changes, change them together.
export const V2_DARK_TOKENS = {
  '--v2-bg': 'oklch(0.255 0.012 262)',
  '--v2-surface-2': 'oklch(0.335 0.016 262)',
  '--v2-text': 'oklch(0.93 0.01 262)',
  '--v2-text-faint': 'oklch(0.60 0.014 262)',
  '--v2-accent': 'oklch(0.74 0.065 168)',
  '--v2-accent-strong': 'oklch(0.80 0.07 168)',
  '--v2-accent-2': 'oklch(0.74 0.07 268)',
  '--v2-danger': 'oklch(0.68 0.14 25)',
}

const ISLAND = '--v3-island'
const ISLAND_INK = '--v3-island-ink'
const ISLAND_SURFACE = '--v3-island-surface'
const FONT_MONO = '--v3-font-mono'
export const TERMINAL_FONT_SIZE = 13
export const THEME_ATTRIBUTE = 'data-theme'

function makeReader(root) {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null
  return (token, fallback) => style?.getPropertyValue(token)?.trim() || fallback
}

export function readTerminalTheme(root = document.documentElement) {
  const read = makeReader(root)
  const palette = ansiPaletteFrom((token, fallback) => V2_DARK_TOKENS[token] ?? fallback)
  const island = read(ISLAND, null)
  const ink = read(ISLAND_INK, null)
  const surface = read(ISLAND_SURFACE, null)
  return {
    ...palette,
    ...(island ? { background: island, cursorAccent: island } : {}),
    ...(ink ? { foreground: ink, cursor: ink } : {}),
    ...(surface ? { selectionBackground: surface } : {}),
  }
}

// Constructor options of the terminal: the resolved `--v3-font-mono` (xterm needs the family LIST, never the
// string `var(...)`), 13 px. Mount-time only (the hook reads them once).
export function readTerminalOptions(root = document.documentElement) {
  const fontFamily = makeReader(root)(FONT_MONO, TERMINAL_BASE_OPTIONS.fontFamily)
  return { fontFamily, fontSize: TERMINAL_FONT_SIZE }
}

export function sameTheme(a, b) {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

// The theme object with a STABLE identity (the hook applies a new identity to the live terminal), recomputed
// when the shell switches theme: the V3 writes `data-theme` on <html> (useV3Theme), there is no context to
// subscribe to, so the attribute is watched.
export function useTerminalTheme() {
  const [theme, setTheme] = useState(() => readTerminalTheme())
  useEffect(() => {
    const root = document.documentElement
    // Keeps the previous object when nothing changed: a new identity repaints the live terminal.
    const refresh = () => setTheme((current) => {
      const next = readTerminalTheme(root)
      return sameTheme(current, next) ? current : next
    })
    // The theme may have changed between the first render and this effect.
    refresh()
    if (typeof MutationObserver !== 'function') return undefined
    const observer = new MutationObserver(refresh)
    observer.observe(root, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] })
    return () => observer.disconnect()
  }, [])
  return theme
}
