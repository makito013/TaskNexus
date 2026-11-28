import { useEffect, useMemo, useRef } from 'react'
import { HEADING_ID_PREFIX, renderViewerMarkdown } from '../../../../../utils/markdown.js'
import { copyTextToClipboard } from '../../../../../utils/clipboard.js'
import { fillCodeElement, highlightToTokens } from '../../../../../utils/syntaxHighlight.js'
import { fileUrl } from '../../../../../services/viewerApi.js'
import { resolveRelativeTo, splitHref } from '../../../../../utils/viewerPaths.js'
import { scrollContainerTo } from './CodeView.jsx'
import { useThemeName } from './useThemeName.js'

const COPY_FEEDBACK_MS = 2000

function languageOf(codeElement) {
  const match = /(?:^|\s)language-([\w#+.-]+)/.exec(codeElement.className || '')
  return match ? match[1] : ''
}

// Gives every <pre><code> a header ("py · Copiar") and asks for the highlight. The HTML of the Markdown is not a
// React tree, so this is DOM code: only textContent, never innerHTML. Idempotent (the header is built once, the
// highlight is asked again for every block still uncoloured), because StrictMode runs the effect twice.
function enhanceCodeBlocks(root, theme) {
  const cleanups = []
  root.querySelectorAll('pre > code').forEach((codeElement) => {
    const pre = codeElement.parentElement
    const language = languageOf(codeElement)
    if (codeElement.dataset.source === undefined) codeElement.dataset.source = codeElement.textContent || ''
    const source = codeElement.dataset.source

    if (!pre.parentElement?.classList.contains('v3-viewer-codeblock')) {
      const doc = root.ownerDocument
      const wrapper = doc.createElement('div')
      wrapper.className = 'v3-viewer-codeblock'
      const head = doc.createElement('div')
      head.className = 'v3-viewer-codeblock__head'
      const label = doc.createElement('span')
      label.className = 'v3-viewer-codeblock__label'
      label.textContent = language || 'texto'
      const copy = doc.createElement('button')
      copy.type = 'button'
      copy.className = 'v3-viewer-codeblock__copy'
      copy.textContent = 'Copiar'
      copy.setAttribute('aria-label', `Copiar código${language ? ` (${language})` : ''}`)
      let timer = null
      copy.addEventListener('click', async (event) => {
        event.preventDefault()
        let ok = false
        try {
          ok = await copyTextToClipboard(source)
        } catch {
          ok = false
        }
        if (!copy.isConnected) return
        copy.textContent = ok ? 'Copiado' : 'Não consegui copiar'
        clearTimeout(timer)
        timer = setTimeout(() => { copy.textContent = 'Copiar' }, COPY_FEEDBACK_MS)
      })
      head.append(label, copy)
      pre.replaceWith(wrapper)
      wrapper.append(head, pre)
    }

    // The colours follow the theme: a block coloured for the other theme is coloured again.
    if (language && codeElement.dataset.highlighted !== theme) {
      let cancelled = false
      Promise.resolve()
        .then(() => highlightToTokens(source.replace(/\n$/, ''), language))
        .then((lines) => {
          if (cancelled || !lines || !codeElement.isConnected) return
          fillCodeElement(codeElement, lines)
          codeElement.dataset.highlighted = theme
        })
        .catch(() => {})
      cleanups.push(() => { cancelled = true })
    }
  })
  return () => cleanups.forEach((fn) => fn())
}

// Markdown of a file "like on GitHub": GFM sanitised by DOMPurify (utils/markdown.js), code blocks with a header,
// a relative link opens ANOTHER tab (onOpenLink), an anchor scrolls inside the panel, an external link opens in a
// new tab (markdown.js already gave it noopener noreferrer). Relative images resolve to the folder of the file.
export default function MarkdownView({ item, text, onOpenLink }) {
  const containerRef = useRef(null)
  const theme = useThemeName()

  const html = useMemo(
    () => renderViewerMarkdown(text, {
      resolveAssetUrl: (src) => {
        const resolved = resolveRelativeTo(item.path, src)
        return resolved ? fileUrl(item, resolved) : null
      },
    }),
    [text, item],
  )

  useEffect(() => {
    if (!containerRef.current) return undefined
    return enhanceCodeBlocks(containerRef.current, theme)
  }, [html, theme])

  const handleClick = (event) => {
    const anchor = event.target.closest?.('a')
    const container = containerRef.current
    if (!anchor || !container?.contains(anchor)) return
    const anchorId = anchor.getAttribute('data-viewer-anchor')
    if (anchorId !== null) {
      event.preventDefault()
      let decoded = anchorId
      try { decoded = decodeURIComponent(anchorId) } catch { /* stays raw */ }
      const wanted = [HEADING_ID_PREFIX + decoded, decoded]
      const target = Array.from(container.querySelectorAll('[id]')).find((element) => wanted.includes(element.id))
      if (target) {
        scrollContainerTo(container, target)
        target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      }
      return
    }
    const href = anchor.getAttribute('data-viewer-path')
    if (href === null) return
    event.preventDefault()
    if (!onOpenLink) return
    // `/docs/x.md` is the root of the PROJECT (like GitHub), the rest is relative to this file.
    const { path, hash } = splitHref(href)
    let caminho = path
    try { caminho = decodeURI(path) } catch { /* stays raw */ }
    const full = hash ? `${caminho}#${hash}` : caminho
    if (caminho.startsWith('/')) onOpenLink(full.replace(/^\/+/, ''), {}, item)
    else onOpenLink(full, { relativoA: item.path }, item)
  }

  return (
    <div
      ref={containerRef}
      className="v3-prose v3-viewer-markdown"
      data-testid="viewer-markdown"
      onClick={handleClick}
      // The HTML was sanitised by DOMPurify in utils/markdown.js: this file is one of the two allowed to use it.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
