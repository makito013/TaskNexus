import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Markdown of the AGENT in the chat, as safe HTML. A restricted profile of its own, on purpose: the
// text comes from a model that reads pages, files and tool output, so it can carry an injected
// payload, and the permission card sits on the same page. The text may format itself, nothing more:
// no style (a <style> tag or a style attribute reaches the whole page), no form controls, no frames
// or media (they fetch on render), no ids or classes (they hit the app's own CSS and DOM).
// utils/markdown.js (the V2 pipeline) is NOT touched.
//
// Remote images are never loaded on their own (a GET on render is a channel out of the permission
// mode): `![alt](https://host/x.png)` is shown as a link whose text is the alt (or the address), and
// the user decides to open it. An image that is not http(s) is shown as its alt text.
const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'b', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'class', 'colspan', 'rowspan', 'align', 'start', 'open']
const CODE_LANGUAGE_CLASS = /^language-[\w+#-]+$/
const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const REMOTE_SRC = /^(?:https?:)?\/\//i

const PROFILE = { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false }

function replaceImage(image) {
  const src = (image.getAttribute('src') ?? '').trim()
  const alt = image.getAttribute('alt') ?? ''
  if (REMOTE_SRC.test(src)) {
    const link = document.createElement('a')
    link.setAttribute('href', src)
    link.textContent = alt || src
    image.replaceWith(link)
  } else {
    image.replaceWith(document.createTextNode(alt))
  }
}

function postProcess(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  root.querySelectorAll('img').forEach(replaceImage)
  root.querySelectorAll('[class]').forEach((element) => {
    const keep = element.tagName === 'CODE' && CODE_LANGUAGE_CLASS.test(element.getAttribute('class'))
    if (!keep) element.removeAttribute('class')
  })
  root.querySelectorAll('a[href]').forEach((link) => {
    if (EXTERNAL_HREF.test(link.getAttribute('href').trim())) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  })
  return template.innerHTML
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])

// Parses with the raw HTML turned into text: the lexer tells what is HTML from what is code (indented
// and ~~~ blocks, code spans, link destinations), so the plan shows `<div>` inside code as code and
// `<style>` outside it as visible text, whatever backticks or brackets surround it.
function parseRawHtmlAsText(markdown) {
  const tokens = marked.lexer(markdown)
  marked.walkTokens(tokens, (token) => {
    if (token.type !== 'html') return
    token.type = 'text'
    token.text = escapeHtml(token.raw)
    token.escaped = true
    delete token.tokens
  })
  return marked.parser(tokens)
}

//   rawHtmlAsText: the plan of ExitPlanMode shows HTML as text; the agent's messages let the profile
//   above decide what survives.
export function renderChatMarkdown(markdown, { rawHtmlAsText = false } = {}) {
  const raw = rawHtmlAsText ? parseRawHtmlAsText(markdown || '') : marked.parse(markdown || '')
  return postProcess(DOMPurify.sanitize(raw, PROFILE))
}
