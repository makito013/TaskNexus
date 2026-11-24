import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// jsdom applies no :focus-visible heuristic, so the ring of the initial focus of the switch dialogs (Designer A2) is
// pinned on the stylesheet: it must not depend on how the dialog was opened.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(HERE, 'ChatScreen.css'), 'utf8')
  .split(String.fromCharCode(13)).join('')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const SELECTOR = ':root[data-layout="v3"] .v3-chat .v3-dialog [data-autofocus]:focus'

describe('initial focus ring of the switch dialogs', () => {
  it('shows the base ring on the button that has the initial focus, whatever opened the dialog', () => {
    const start = css.indexOf(`${SELECTOR} {`)
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toContain('outline: 2px solid var(--v3-ink)')
    expect(block).toContain('outline-offset: 2px')
  })

  it('the primary of "Abrir no terminal?" carries the marker the rule targets', async () => {
    const source = readFileSync(path.join(HERE, 'SwitchEngineDialog.jsx'), 'utf8')
    expect(source).toContain('data-autofocus={toTerminal ? true : undefined}')
  })
})
