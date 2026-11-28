import { findFilePathLinks } from '../../../../utils/filePathLinks.js'
import { isExternalHref, splitHref } from '../../../../utils/viewerPaths.js'

// File paths in the agent's text as buttons that open the viewer (US25, US26).
//
// decorateFileLinks(html) takes the HTML of renderChatMarkdown, which is ALREADY sanitised, and returns it with
// every path found in a text node (outside <a>, <pre> and <button>; inline <code> counts) wrapped in
//   <button type="button" class="v3-file-link" data-file-path data-file-line aria-label="Abrir <caminho> no visualizador">
// The rules of "what is a path" are the terminal's (utils/filePathLinks.js): `docs/plano.md`, `src/app.py:42`,
// `./x`, `/abs/x.md`, a bare name with a known extension; a URL, a folder and `v1.2` stay text.
//
// The text of the message never becomes markup here: the HTML is parsed by DOMParser (an inert document, nothing
// runs or loads), the buttons are made with createElement/textContent/setAttribute, and the result is READ back
// from `body.innerHTML`. Nothing is assigned to innerHTML.

const SHOW_TEXT = 4 // NodeFilter.SHOW_TEXT: a parsed document has no window, so the constant is spelled out
const SKIPPED_ANCESTORS = 'a, pre, button, summary'

function buttonFor(doc, link) {
  const button = doc.createElement('button')
  button.setAttribute('type', 'button')
  button.setAttribute('class', 'v3-file-link')
  button.setAttribute('data-file-path', link.path)
  if (link.line !== null) button.setAttribute('data-file-line', String(link.line))
  button.setAttribute('aria-label', `Abrir ${link.text} no visualizador`)
  button.textContent = link.text
  return button
}

function decorateTextNode(doc, node) {
  const links = findFilePathLinks(node.data)
  if (links.length === 0) return false
  const fragment = doc.createDocumentFragment()
  let cursor = 0
  for (const link of links) {
    if (link.start > cursor) fragment.append(node.data.slice(cursor, link.start))
    fragment.append(buttonFor(doc, link))
    cursor = link.end
  }
  if (cursor < node.data.length) fragment.append(node.data.slice(cursor))
  node.replaceWith(fragment)
  return true
}

export function decorateFileLinks(html) {
  if (typeof html !== 'string' || html === '') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT)
  const textNodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(SKIPPED_ANCESTORS)) textNodes.push(node)
  }
  let changed = false
  for (const node of textNodes) changed = decorateTextNode(doc, node) || changed
  return changed ? doc.body.innerHTML : html
}

// The path a relative link of the text points at, or null when the link is not for the viewer: `#section` (no path
// before the hash) stays where it is, `https:`/`mailto:`/`//host` are the browser's, an empty href has nothing to
// open. A `#L10` fragment
// is kept (the server reads the line from it); the percent-escapes of the path are undone because the server wants
// the file name, not the URL.
export function relativeLinkPath(href) {
  const raw = String(href ?? '').trim()
  if (raw === '' || isExternalHref(raw)) return null
  const { path, hash } = splitHref(raw)
  if (path === '') return null
  let decoded = path
  try {
    decoded = decodeURI(path)
  } catch {
    // an invalid %-escape: the raw text goes to the server, which answers "not found"
  }
  return hash ? `${decoded}#${hash}` : decoded
}

// What a click inside the rendered text means, or null when it is none of ours:
//   { path, line }   a decorated button
//   { path, line: null }   a link with a relative href
export function fileTargetOf(clickTarget, root) {
  const element = clickTarget instanceof Element ? clickTarget : null
  if (!element) return null
  const button = element.closest('button[data-file-path]')
  if (button && root.contains(button)) {
    const line = Number(button.getAttribute('data-file-line'))
    return { path: button.getAttribute('data-file-path'), line: Number.isInteger(line) && line >= 1 ? line : null }
  }
  const anchor = element.closest('a[href]')
  if (anchor && root.contains(anchor)) {
    const path = relativeLinkPath(anchor.getAttribute('href'))
    if (path) return { path, line: null }
  }
  return null
}
