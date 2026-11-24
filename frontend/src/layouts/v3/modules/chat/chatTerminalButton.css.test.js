import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Layout cannot be measured in jsdom: the tablet rule of the "Abrir no terminal" header button (Designer 4.1)
// is pinned on the stylesheet declarations.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(HERE, 'ChatScreen.css'), 'utf8')
  .split(String.fromCharCode(13)).join('')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const LABEL = '.v3-chat .v3-chat-header__actions .v3-chat-terminal-button__label'

// The text of the body of every `@media <query> { ... }` whose query matches.
function mediaBodies(query) {
  const bodies = []
  let from = 0
  for (;;) {
    const start = css.indexOf(`@media ${query}`, from)
    if (start === -1) return bodies
    const open = css.indexOf('{', start)
    let depth = 1
    let index = open + 1
    while (depth > 0 && index < css.length) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
      index += 1
    }
    bodies.push(css.slice(open + 1, index - 1))
    from = index
  }
}

describe('"Abrir no terminal" of the header on a tablet', () => {
  const tablet = mediaBodies('(min-width: 768px) and (max-width: 1279px)').join('\n')

  it('hides the label (icon only) between 768 and 1279, scoped to the chat route', () => {
    expect(tablet).toContain(`${LABEL} {\n    display: none;`)
  })

  it('does not hide the label anywhere else', () => {
    const everywhereElse = css.replace(tablet, '')
    expect(everywhereElse).not.toContain('v3-chat-terminal-button__label')
  })

  it('keeps a touch-sized icon button', () => {
    expect(tablet).toMatch(/\.v3-chat-terminal-button\.v3-button\s*\{[^}]*min-width: var\(--v3-control\)/)
  })
})
