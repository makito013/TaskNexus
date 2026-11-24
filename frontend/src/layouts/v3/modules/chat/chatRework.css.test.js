import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Layout measures cannot be taken in jsdom (no layout engine): the contract of V4-03, V4-15 and Bug 10 is
// pinned on the declarations of the stylesheet, which the browser measures were derived from.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(HERE, 'ChatScreen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = readFileSync(path.join(HERE, '../../theme/tokens.css'), 'utf8')

function declarations(selector) {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').map((item) => item.trim()).includes(selector))
    .map(([, , body]) => body)
  const found = {}
  for (const body of blocks) {
    for (const [, name, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) found[name] = value.trim()
  }
  return found
}

const token = (name) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokens)[1])

describe('V4-03: inline code has a border (Bug 6)', () => {
  it('inline code in the chat prose declares a 1px border and code inside a block does not', () => {
    expect(declarations(':root[data-layout="v3"] .v3-chat-prose code').border).toBe('1px solid var(--v3-line)')
    expect(declarations(':root[data-layout="v3"] .v3-chat-prose pre code').border).toBe('0')
  })
})

describe('V4-15: touch targets (Bug 7)', () => {
  it('the model chip of the header is at least 36px tall', () => {
    expect(declarations('.v3-chat-model-chip').height).toBe('var(--v3-control-sm)')
    expect(token('--v3-control-sm')).toBeGreaterThanOrEqual(36)
  })

  it('the composer textarea is at least 44px tall', () => {
    expect(declarations('.v3-chat-composer__input')['min-height']).toBe('var(--v3-control)')
    expect(token('--v3-control')).toBeGreaterThanOrEqual(44)
  })
})

describe('Bug 10: the options of a question card draw their own marks', () => {
  it('radios and checkboxes do not use the native look (white disc on the dark theme)', () => {
    const input = declarations('.v3-chat-q__option input')
    expect(input.appearance).toBe('none')
    expect(input['background-color']).toBe('var(--v3-surface)')
    expect(input.border).toContain('var(--v3-ink-muted)')
  })

  it('the checked state is a filled mark that differs from the unchecked one, from tokens only', () => {
    const checked = declarations('.v3-chat-q__option input:checked')
    expect(checked['background-color']).toBe('var(--v3-kan-deep)')
    expect(checked['box-shadow']).toContain('var(--v3-surface)')
    expect(css).not.toMatch(/\.v3-chat-q__option input[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/)
  })
})

describe('M1: the composer shows a single focus ring (the container one)', () => {
  it('the textarea outline reset outranks the global focus-visible rule', () => {
    const globalRule = readFileSync(path.join(HERE, '../../theme/base.css'), 'utf8')
    expect(globalRule).toContain(':root[data-layout="v3"] :focus-visible')
    expect(declarations(':root[data-layout="v3"] .v3-chat-composer__input:focus-visible').outline).toBe('0')
    expect(declarations('.v3-chat-composer__box:focus-within').outline).toBe('2px solid var(--v3-ink)')
  })
})

describe('M2: chat row layout (title alone on line 1)', () => {
  it('the row is at least 72px tall and has no shared title/chip line', () => {
    expect(declarations('.v3-chat-row__link')['min-height']).toBe('72px')
    expect(css).not.toContain('.v3-chat-row__top')
  })

  it('the title truncates with an ellipsis and the chip never shrinks', () => {
    const title = declarations('.v3-chat-row__title')
    expect(title['text-overflow']).toBe('ellipsis')
    expect(title['white-space']).toBe('nowrap')
    expect(declarations('.v3-chat-row__meta > .v3-chip').flex).toBe('none')
  })

  it('the detail truncates with an ellipsis, from tokens only, without fixed positioning', () => {
    const detail = declarations('.v3-chat-row__detail')
    expect(detail['text-overflow']).toBe('ellipsis')
    expect(detail['min-width']).toBe('0')
    const rowRules = css.slice(css.indexOf('.v3-chat-row {'), css.indexOf('/* ---- menu ---- */'))
    expect(rowRules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rowRules).not.toContain('position: fixed')
  })
})
