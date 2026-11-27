// Security guard of the file viewer (and of the board and artifacts folders that share its rules): what a
// reviewer would grep for, as a test, with fixtures that must stay red. HTML only in a sandboxed iframe without
// same-origin, never innerHTML = (an HTML string is read through DOMParser), Markdown only through DOMPurify,
// file URLs only through fileUrl (encoded per segment), a session key checked before it becomes a URL.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from '../../../../test/fixedPositioningScan.js'

const V3 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FOLDERS = ['modules/board', 'modules/artifacts', 'modules/viewer']
const SOURCE = /\.(js|jsx)$/
const TEST_FILE = /\.test\.(js|jsx)$/

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (SOURCE.test(entry) && !TEST_FILE.test(entry)) files.push(full)
  }
  return files
}
const relative = (file) => path.relative(V3, file).split(path.sep).join('/')
const SOURCES = FOLDERS.flatMap((folder) => walk(path.join(V3, folder))).map(relative)
// Test scaffolding is not product code.
const PRODUCT = SOURCES.filter((file) => !/TestKit|Fixtures/.test(file))
const read = (file) => stripComments(readFileSync(path.join(V3, file), 'utf8'))

export const hasInnerHtmlAssignment = (code) => /\.innerHTML\s*(\+|-)?=(?!=)/.test(code) || /\.outerHTML\s*=(?!=)/.test(code) || /insertAdjacentHTML\s*\(/.test(code)
export const usesSrcdoc = (code) => /\bsrcdoc\b/i.test(code)
export const allowsSameOrigin = (code) => /allow-same-origin/.test(code)
export const usesDangerousHtml = (code) => /dangerouslySetInnerHTML/.test(code)
export const hasBlankTargetWithoutNoopener = (code) =>
  [...code.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)].some(([tag]) => !/rel=["'][^"']*noopener/.test(tag))
export const buildsViewerUrlByHand = (code) => /['"`]\/api\/(viewer|artifacts|card-attachments)\//.test(code)

describe('viewer security: what the folders may and may not contain', () => {
  it('scans the folders it should (positive control)', () => {
    expect(PRODUCT).toEqual(expect.arrayContaining([
      'modules/viewer/ViewerShell.jsx',
      'modules/viewer/renderers/HtmlView.jsx',
      'modules/viewer/renderers/MarkdownView.jsx',
      'modules/board/CardFields.jsx',
    ]))
  })

  it('no file allows same-origin, uses srcdoc, or assigns HTML to the DOM', () => {
    for (const file of PRODUCT) {
      const code = read(file)
      expect(allowsSameOrigin(code), `${file} mentions allow-same-origin`).toBe(false)
      expect(usesSrcdoc(code), `${file} uses srcdoc`).toBe(false)
      expect(hasInnerHtmlAssignment(code), `${file} assigns HTML to the DOM`).toBe(false)
    }
  })

  it('dangerouslySetInnerHTML lives only in the card description and the Markdown renderer', () => {
    const users = PRODUCT.filter((file) => usesDangerousHtml(read(file))).sort()
    expect(users).toEqual(['modules/board/CardFields.jsx', 'modules/viewer/renderers/MarkdownView.jsx'])
  })

  it('the Markdown renderer gets its HTML from the sanitising renderer, nothing else', () => {
    const code = read('modules/viewer/renderers/MarkdownView.jsx')
    expect(code).toMatch(/renderViewerMarkdown/)
    expect(code).not.toMatch(/marked\b/)
  })

  it('an iframe exists only in the HTML and PDF renderers; the HTML one has the exact sandbox, the PDF one none', () => {
    const withIframe = PRODUCT.filter((file) => /<iframe\b/.test(read(file))).sort()
    expect(withIframe).toEqual(['modules/viewer/renderers/HtmlView.jsx', 'modules/viewer/renderers/PdfView.jsx'])
    expect(read('modules/viewer/renderers/HtmlView.jsx')).toContain("'allow-scripts allow-popups allow-popups-to-escape-sandbox'")
    expect(read('modules/viewer/renderers/HtmlView.jsx')).toContain('referrerPolicy="no-referrer"')
    expect(read('modules/viewer/renderers/PdfView.jsx')).not.toMatch(/sandbox/)
  })

  it('SVG and any image go through <img>: no <object> or <embed> anywhere', () => {
    for (const file of PRODUCT) expect(/<(object|embed)\b/.test(read(file)), file).toBe(false)
  })

  it('every link that opens a new tab says noopener', () => {
    for (const file of PRODUCT) expect(hasBlankTargetWithoutNoopener(read(file)), file).toBe(false)
    // The menu builds its link from props: its rel is checked on the element.
    expect(read('modules/viewer/ViewerFileMenu.jsx')).toContain('rel="noopener noreferrer"')
  })

  it('no file builds a viewer file URL by hand: fileUrl encodes each segment', () => {
    for (const file of PRODUCT) expect(buildsViewerUrlByHand(read(file)), file).toBe(false)
  })

  it('a session key goes through isSafeSessionKey before it becomes a URL', () => {
    const shell = read('modules/viewer/ViewerShell.jsx')
    expect(shell).toMatch(/isSafeSessionKey\(sessionKey\)/)
    expect(shell).toMatch(/isSafeSessionKey\(activeSessionKey\)/)
  })

  it('the viewer writes only through the actions of the viewer state: no fetch, no storage, no socket here', () => {
    for (const file of PRODUCT.filter((name) => name.startsWith('modules/viewer/'))) {
      const code = read(file)
      expect(/\bfetch\s*\(/.test(code), `${file} calls fetch`).toBe(false)
      expect(/\b(localStorage|sessionStorage)\b/.test(code), `${file} touches web storage`).toBe(false)
      expect(/new WebSocket|chatSocket/.test(code), `${file} opens a socket`).toBe(false)
    }
  })

  it('no alert( or confirm( in the folders', () => {
    for (const file of PRODUCT) expect(/(^|[^.\w])(alert|confirm)\s*\(/.test(read(file)), file).toBe(false)
  })

  it('goes red for the fixtures it exists to catch', () => {
    expect(allowsSameOrigin('sandbox="allow-scripts allow-same-origin"')).toBe(true)
    expect(usesSrcdoc('<iframe srcDoc={html} />')).toBe(true)
    expect(hasInnerHtmlAssignment('el.innerHTML = html')).toBe(true)
    expect(hasInnerHtmlAssignment('el.innerHTML += html')).toBe(true)
    expect(hasInnerHtmlAssignment('el.insertAdjacentHTML("beforeend", html)')).toBe(true)
    expect(hasBlankTargetWithoutNoopener('<a href="x" target="_blank">x</a>')).toBe(true)
    expect(buildsViewerUrlByHand('fetch(`/api/viewer/${id}/f/${path}`)')).toBe(true)
    expect(usesDangerousHtml('<div dangerouslySetInnerHTML={{ __html: x }} />')).toBe(true)
  })

  it('stays green for what is legitimate', () => {
    expect(hasInnerHtmlAssignment('const html = doc.body.innerHTML')).toBe(false)
    expect(hasInnerHtmlAssignment('if (el.innerHTML === "")')).toBe(false)
    expect(hasBlankTargetWithoutNoopener('<a href="x" target="_blank" rel="noopener noreferrer">x</a>')).toBe(false)
    expect(allowsSameOrigin(stripComments('/* never allow-same-origin */ const a = 1'))).toBe(false)
  })
})
