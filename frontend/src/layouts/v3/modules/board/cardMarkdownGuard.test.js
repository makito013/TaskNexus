// Markdown becomes HTML in ONE place of the board: CardFields.jsx (renderMarkdown, sanitized by DOMPurify).
// Any other file of modules/board that renders HTML from text would be a hole in the sanitizing.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const OWNER = 'CardFields.jsx'

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

export function htmlSinks(source) {
  const code = stripComments(source)
  const found = []
  if (/dangerouslySetInnerHTML/.test(code)) found.push('dangerouslySetInnerHTML')
  if (/\binnerHTML\s*=/.test(code)) found.push('innerHTML =')
  if (/\bmarkdown\.js\b|\bmarked\b|\bDOMPurify\b/.test(code)) found.push('markdown pipeline')
  return found
}

const SOURCES = readdirSync(HERE).filter((name) => /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name))

describe('where the board turns text into HTML', () => {
  it('scans the real files, the owner included (positive control)', () => {
    expect(SOURCES).toContain(OWNER)
    expect(SOURCES).toContain('BoardCardFace.jsx')
  })

  it('the owner really renders the sanitized Markdown (the rule has something to guard)', () => {
    expect(htmlSinks(readFileSync(path.join(HERE, OWNER), 'utf8'))).toEqual(['dangerouslySetInnerHTML', 'markdown pipeline'])
  })

  it.each(SOURCES.filter((name) => name !== OWNER))('%s renders no HTML from text', (name) => {
    expect(htmlSinks(readFileSync(path.join(HERE, name), 'utf8'))).toEqual([])
  })

  it('goes red for fixtures', () => {
    expect(htmlSinks('<div dangerouslySetInnerHTML={{ __html: x }} />')).toContain('dangerouslySetInnerHTML')
    expect(htmlSinks('node.innerHTML = x')).toContain('innerHTML =')
    expect(htmlSinks("import { renderMarkdown } from '../../../../utils/markdown.js'")).toContain('markdown pipeline')
    expect(htmlSinks('// dangerouslySetInnerHTML in a comment')).toEqual([])
  })
})
