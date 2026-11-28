// The card dialog needs more than the 720px of the base dialog for its two columns: `v3-dialog--wide` is an
// additive modifier (Dialog.jsx already builds `v3-dialog--${size}`). Read from the real CSS, with the rule
// of the base left alone (dialogLayout.test.js keeps guarding it).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'Dialog.css'), 'utf8')
const APP_RESET = readFileSync(path.join(HERE, '../../../../index.css'), 'utf8')

const rule = (selector) => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return code.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? null
}

let styles = []
afterEach(() => {
  styles.forEach((node) => node.remove())
  styles = []
  document.body.innerHTML = ''
})

describe('v3-dialog--wide', () => {
  it('is 960px, never wider than the window minus its margins', () => {
    expect(rule('.v3-dialog--wide')).toMatch(/width:\s*min\(960px,\s*calc\(100vw - 2 \* var\(--v3-space-6\)\)\)/)
  })

  it('only sets the width: it does not touch the base rule or the centring', () => {
    expect(rule('.v3-dialog--wide').replace(/\s+/g, '')).toBe('width:min(960px,calc(100vw-2*var(--v3-space-6)));')
    expect(rule('.v3-dialog')).toMatch(/width:\s*min\(720px/)
    expect(rule('.v3-dialog')).toMatch(/margin:\s*auto/)
  })

  it('comes after the base rule, so the same specificity lets it win', () => {
    expect(CSS.indexOf('.v3-dialog--wide {')).toBeGreaterThan(CSS.indexOf('.v3-dialog {'))
  })

  it('in the cascade the wide dialog keeps the centring margin and is not the 720px one', () => {
    for (const css of [APP_RESET, CSS]) {
      const node = document.createElement('style')
      node.textContent = css
      document.head.appendChild(node)
      styles.push(node)
    }
    document.body.innerHTML = '<dialog class="v3-dialog v3-dialog--wide" open></dialog>'
    const style = getComputedStyle(document.querySelector('dialog'))
    expect(style.marginLeft).toBe('auto')
    expect(style.width).toContain('960px')
  })
})
