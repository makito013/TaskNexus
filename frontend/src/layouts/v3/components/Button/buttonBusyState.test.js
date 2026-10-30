// A busy button (aria-busy) that also carries aria-disabled - the "Salvando..."
// state of the Tarefas screen - must NOT look disabled. Button.css styles
// [aria-disabled="true"] globally (for the Projetos buttons), so the rule has to
// exclude the busy state. Two checks: the cascade in jsdom with the real CSS, and
// a source check that every aria-disabled rule keeps the exclusion.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import Button from './Button.jsx'

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'Button.css'), 'utf8')

let styleNode
function injectButtonCss() {
  styleNode = document.createElement('style')
  styleNode.textContent = CSS
  document.head.appendChild(styleNode)
}

afterEach(() => {
  cleanup()
  styleNode?.remove()
  styleNode = null
})

const computed = (element) => {
  const style = getComputedStyle(element)
  return { cursor: style.cursor, background: style.backgroundColor, color: style.color }
}

describe('Button.css: busy is not disabled', () => {
  it('a busy + aria-disabled module button keeps the progress cursor and its fill and text colours', () => {
    injectButtonCss()
    render(createElement(Button, { variant: 'module', module: 'tiq', 'aria-busy': 'true', 'aria-disabled': 'true' }, 'Salvando'))
    const busyOnly = computed(screen.getByRole('button', { name: 'Salvando' }))
    cleanup()
    render(createElement(Button, { variant: 'module', module: 'tiq', 'aria-busy': 'true' }, 'Salvando'))
    const reference = computed(screen.getByRole('button', { name: 'Salvando' }))

    expect(reference.cursor).toBe('progress')
    expect(busyOnly).toEqual(reference)
    expect(busyOnly.background).not.toContain('surface-2')
    expect(busyOnly.color).not.toContain('ink-muted')
  })

  it('positive control: an aria-disabled button that is not busy still looks disabled', () => {
    injectButtonCss()
    render(createElement(Button, { variant: 'secondary', 'aria-disabled': 'true' }, 'Abrir sessao'))
    const disabled = computed(screen.getByRole('button', { name: 'Abrir sessao' }))
    expect(disabled.cursor).toBe('not-allowed')
    expect(disabled.background).toContain('surface-2')
    expect(disabled.color).toContain('ink-muted')
  })

  it('every selector that targets aria-disabled excludes the busy state', () => {
    const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{').slice(0, -1)
      .flatMap((chunk) => chunk.split('}').pop().split(','))
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes('[aria-disabled="true"]'))
    expect(selectors.length).toBeGreaterThanOrEqual(3) // control: the three disabled rules were found
    for (const selector of selectors) expect(selector, selector).toContain(':not([aria-busy="true"])')
  })
})
