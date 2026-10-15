import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTokensCss } from '../../../../scripts/generate-v3-tokens.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const readTheme = (name) => readFileSync(path.join(here, name), 'utf8')
const tokens = JSON.parse(readTheme('./tokens.json'))
const committedCss = readTheme('./tokens.css')

const REGENERATE_HINT = 'tokens.css is out of date: run `node scripts/generate-v3-tokens.mjs` from frontend/'

// Returns the declaration body of the first block whose selector equals `selector`.
function blockBody(css, selector) {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

// A CRLF checkout (core.autocrlf=true) must not be reported as drift.
const normalizeEol = (css) => css.replace(/\r\n/g, '\n')

function assertNoDrift(css) {
  const expected = generateTokensCss(tokens)
  if (normalizeEol(css) !== normalizeEol(expected)) throw new Error(REGENERATE_HINT)
}

const LIGHT = ':root[data-layout="v3"][data-theme="light"]'
const DARK = ':root[data-layout="v3"][data-theme="dark"]'

describe('v3 generated tokens', () => {
  it('tokens.css matches the generator output for tokens.json', () => {
    expect(() => assertNoDrift(committedCss)).not.toThrow()
  })

  it('does not report drift when tokens.css has CRLF line endings', () => {
    const crlf = generateTokensCss(tokens).replace(/\n/g, '\r\n')
    expect(crlf).toContain('\r\n')
    expect(() => assertNoDrift(crlf)).not.toThrow()
  })

  it('defines every color token in both theme blocks', () => {
    const light = blockBody(committedCss, LIGHT)
    const dark = blockBody(committedCss, DARK)
    for (const token of tokens.color.tokens) {
      expect(light, `${token.name} in light`).toContain(`--v3-${token.name}: ${token.value.light.toLowerCase()};`)
      expect(dark, `${token.name} in dark`).toContain(`--v3-${token.name}: ${token.value.dark.toLowerCase()};`)
    }
  })

  it('emits island name colors derived from the dark ink values', () => {
    const unthemed = blockBody(committedCss, ':root[data-layout="v3"]')
    expect(unthemed).toContain('--v3-island-name-bit: #39b8d8;')
    expect(unthemed).toContain('--v3-island-name-tiq: #9db0ff;')
    expect(unthemed).toContain('--v3-island-name-fin: #f2b85c;')
    expect(unthemed).toContain('--v3-island-name-kan: #c4b5fd;')
    expect(unthemed).toContain('--v3-island-name-navi: #7fd6b4;')
  })

  it('ground is #f3f4f1 in light and #0f1114 in dark', () => {
    expect(blockBody(committedCss, LIGHT)).toContain('--v3-ground: #f3f4f1;')
    expect(blockBody(committedCss, DARK)).toContain('--v3-ground: #0f1114;')
  })

  it('emits themed shadows and unthemed scale, size and motion tokens', () => {
    const unthemed = blockBody(committedCss, ':root[data-layout="v3"]')
    expect(unthemed).toContain('--v3-space-5: 20px;')
    expect(unthemed).toContain('--v3-radius-island: 28px;')
    expect(unthemed).toContain('--v3-rail: 84px;')
    expect(unthemed).toContain('--v3-pet-front: 60px;')
    expect(unthemed).toContain('--v3-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);')
    expect(unthemed).toContain('--v3-pet-alert: 1200ms;')
    expect(blockBody(committedCss, LIGHT)).toContain('--v3-shadow-island: 0 16px 36px rgba(20,23,26,0.22);')
    expect(blockBody(committedCss, DARK)).toContain('--v3-shadow-island: 0 16px 36px rgba(0,0,0,0.5);')
  })

  it('emits one type class per typography style', () => {
    const styles = tokens.type.groups.flatMap((group) => group.styles.map((style) => style.name))
    expect(styles.length).toBeGreaterThan(0)
    for (const name of styles) {
      expect(committedCss).toContain(`.v3-type-${name} {`)
      expect(committedCss).toContain(`--v3-type-${name}-size:`)
    }
    expect(blockBody(committedCss, '.v3-type-eyebrow')).toContain('text-transform: uppercase;')
    expect(blockBody(committedCss, '.v3-type-title-lg')).toContain('letter-spacing: var(--v3-type-title-lg-tracking);')
    expect(blockBody(committedCss, '.v3-type-body')).not.toContain('letter-spacing')
  })

  it('fails with a hint to rerun the generator when tokens.css is edited by hand', () => {
    const edited = committedCss.replace('--v3-ground: #f3f4f1;', '--v3-ground: #ffffff;')
    expect(edited).not.toBe(committedCss)
    expect(() => assertNoDrift(edited)).toThrow(/node scripts\/generate-v3-tokens\.mjs/)
  })
})
