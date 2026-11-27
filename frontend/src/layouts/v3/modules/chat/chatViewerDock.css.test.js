// The stylesheet of the chat only gets a block for the docked viewer, and every rule of it hangs from the
// attribute the screen writes while the dock exists. jsdom has no layout: the contract is the text of the file.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(path.join(HERE, 'ChatScreen.css'), 'utf8')
const MARKER = '/* ---- file viewer docked beside the conversation'

const start = raw.indexOf(MARKER)
const block = raw.slice(start).replace(/\/\*[\s\S]*?\*\//g, '')
const outside = raw.slice(0, start).replace(/\/\*[\s\S]*?\*\//g, '')
const selectorsOf = (css) => [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(([, selector]) => selector.trim())

describe('ChatScreen.css: the docked viewer block', () => {
  it('exists, at the end of the file', () => {
    expect(start).toBeGreaterThan(0)
    expect(raw.indexOf(MARKER, start + 1)).toBe(-1)
  })

  it('every rule of the block starts at the grid with the dock attribute', () => {
    const selectors = selectorsOf(block)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^\.v3-chat\[data-viewer-dock\]/)
    }
  })

  it('nothing outside the block mentions the new attributes or the width property', () => {
    expect(outside).not.toMatch(/data-viewer-dock|data-list-collapsed|--v3-viewer-dock-width/)
  })

  it('has no transition and no animation (the terminal measures its box in the middle of one)', () => {
    expect(block).not.toMatch(/transition|animation/)
  })

  it('declares only the grid columns, and creates no containing block', () => {
    expect(block).toMatch(/grid-template-columns/)
    expect(block).not.toMatch(/transform|filter|will-change|contain\s*:|perspective|backdrop-filter|position\s*:\s*fixed/)
  })

  it('folds the list column away only together with the collapse attribute', () => {
    const collapsed = selectorsOf(block).filter((selector) => selector.includes('data-list-collapsed'))
    expect(collapsed).toEqual(['.v3-chat[data-viewer-dock][data-list-collapsed]'])
  })
})
