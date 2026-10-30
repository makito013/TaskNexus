// Layout rules that jsdom cannot show but the real browser does (QA volta 1):
//  B2 - the app reset `* { margin: 0 }` (src/index.css) beat the UA `margin: auto` of
//       dialog:modal, so every dialog opened in the top-left corner;
//  B1 - the discover map (overflow: hidden) is a child of the scrolling flex-column
//       body and was squeezed to ~16px instead of making the body scroll.
// Each rule is checked twice: the cascade in jsdom with the real CSS files (the reset
// included) and the source of the rule.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (relative) => readFileSync(path.join(HERE, relative), 'utf8')
const DIALOG_CSS = read('Dialog.css')
const PROJECT_DIALOG_CSS = read('../../modules/projects/ProjectDialog.css')
const APP_RESET = read('../../../../index.css')

let styles = []
function inject(...sheets) {
  for (const css of sheets) {
    const node = document.createElement('style')
    node.textContent = css
    document.head.appendChild(node)
    styles.push(node)
  }
}
afterEach(() => {
  styles.forEach((node) => node.remove())
  styles = []
  document.body.innerHTML = ''
})

const ruleBody = (source, selector) => {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match ? match[1] : null
}

describe('B2: the dialog is centred, not pinned to the corner', () => {
  it('the app reset really zeroes margins on everything (the premise of the bug)', () => {
    expect(APP_RESET).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*margin:\s*0/)
  })

  it('.v3-dialog declares margin: auto in its own rule', () => {
    expect(ruleBody(DIALOG_CSS, '.v3-dialog')).toMatch(/margin:\s*auto/)
  })

  it('in the cascade, with the app reset loaded, the computed margin is auto and not 0', () => {
    inject(APP_RESET, DIALOG_CSS)
    document.body.innerHTML = '<dialog class="v3-dialog v3-dialog--md" open></dialog>'
    const style = getComputedStyle(document.querySelector('dialog'))
    expect(style.marginTop).toBe('auto')
    expect(style.marginLeft).toBe('auto')
  })
})

describe('B1: children of the dialog body keep their height', () => {
  it('.v3-dialog__body > * does not shrink, and the map says flex: none itself', () => {
    expect(ruleBody(DIALOG_CSS, '.v3-dialog__body > *')).toMatch(/flex-shrink:\s*0/)
    expect(ruleBody(PROJECT_DIALOG_CSS, '.v3-discover')).toMatch(/flex:\s*none/)
  })

  it('in the cascade, a direct child of the body (the map, a callout, the archive zone) has flex-shrink 0', () => {
    inject(DIALOG_CSS, PROJECT_DIALOG_CSS)
    document.body.innerHTML = `
      <div class="v3-dialog__body">
        <div class="v3-discover"></div>
        <div class="v3-callout"></div>
        <div class="v3-danger-zone"></div>
        <div class="v3-field"></div>
      </div>`
    for (const child of document.querySelector('.v3-dialog__body').children) {
      expect(getComputedStyle(child).flexShrink, child.className).toBe('0')
    }
  })

  it('the body is still the scrolling column that makes the non-shrinking children scroll', () => {
    const body = ruleBody(DIALOG_CSS, '.v3-dialog__body')
    expect(body).toMatch(/flex-direction:\s*column/)
    expect(body).toMatch(/overflow:\s*auto/)
  })
})
