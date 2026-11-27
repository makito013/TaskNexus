import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// jsdom has no layout engine: the hit-area contract (D-23, D-24) is pinned on the stylesheet declarations.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(HERE, 'FileLinks.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const coarseStart = css.indexOf('@media (pointer: coarse)')
const base = css.slice(0, coarseStart)
const coarse = css.slice(coarseStart).replace(/^@media[^{]*{/, '')

const rulesOf = (text, selectorRe) => [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter((m) => selectorRe.test(m[1].trim()))
  .map((m) => m[2])
const afterRules = (text) => rulesOf(text, /::after\s*$/)
const insetValues = (rule) => [...rule.matchAll(/inset:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/))

describe('file link hit area does not cross neighbouring lines or paths (D-23, D-24)', () => {
  it('has a coarse-pointer media block', () => {
    expect(coarseStart).toBeGreaterThan(0)
  })

  it('the link is the positioned ancestor of its ::after', () => {
    const [rule] = rulesOf(base, /^\.v3-file-link$/)
    expect(rule).toMatch(/position:\s*relative\s*;/)
  })

  it('with a fine pointer the ::after stays inside its own inline box', () => {
    const rules = afterRules(base)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatch(/inset:\s*0\s*;/)
    expect(insetValues(rules[0])).toEqual([['0']])
    expect(rules[0]).not.toMatch(/height|margin|top:|bottom:|left:|right:|--v3-control/)
  })

  it('with a coarse pointer the vertical growth is at most 2px per side', () => {
    const rules = afterRules(coarse)
    expect(rules.length).toBeGreaterThan(0)
    const insets = rules.flatMap(insetValues)
    expect(insets.length).toBeGreaterThan(0)
    for (const values of insets) {
      const nums = values.map((v) => Number.parseFloat(v))
      expect(nums.length).toBeLessThanOrEqual(2)
      expect(Math.abs(nums[0])).toBeLessThanOrEqual(2)
    }
    for (const rule of rules) expect(rule).not.toMatch(/height|top:|bottom:|--v3-control/)
  })

  it('with a coarse pointer a later path never grows left over the previous path', () => {
    const rules = rulesOf(coarse, /^\.v3-file-link\s*\+\s*\.v3-file-link::after$/)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatch(/left:\s*0\s*;/)
  })

  it('keeps the visible focus ring', () => {
    expect(css).toMatch(/\.v3-file-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--v3-kan\)/)
  })
})
