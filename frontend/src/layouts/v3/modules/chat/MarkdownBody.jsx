import { useCallback, useEffect, useMemo, useRef } from 'react'
import { decorateFileLinks, fileTargetOf } from '../viewer/fileLinks.js'
import { renderChatMarkdown } from './chatMarkdown.js'
import { highlightCodeBlocks } from './highlightCode.js'

// The agent's text as markdown. The HTML comes out of chatMarkdown.js (marked + a restricted DOMPurify
// profile of the chat: no style, no form controls, no remote image; links open in a new tab with
// rel="noopener noreferrer"); it is the ONLY place of the chat that sets inner HTML. Code blocks get keyboard scrolling and, once the message is final, syntax colours.
//   rawHtmlAsText: HTML in the text is shown as text (the plan of the permission card)
//   highlight=false while the message is still streaming (no work on every delta)
//   fileLinks: { openPath(path, { line }) } (FileLinkScope) turns the file paths of a FINAL message into buttons and
//     sends a click on one, or on a link with a relative href, to the viewer. Without it (the plan, the permission
//     card, a chat with no viewer) the HTML is exactly the one of renderChatMarkdown and a click does nothing here.
export default function MarkdownBody({ text, highlight = true, rawHtmlAsText = false, fileLinks = null }) {
  // Decorated only once the message is final (the same signal as the syntax highlight): a button rebuilt on every
  // delta would lose the focus. The memo keeps the work to one pass per text.
  const decorate = Boolean(fileLinks) && highlight && !rawHtmlAsText
  const html = useMemo(() => {
    const rendered = renderChatMarkdown(text, { rawHtmlAsText })
    return decorate ? decorateFileLinks(rendered) : rendered
  }, [text, rawHtmlAsText, decorate])
  const rootRef = useRef(null)
  const openPathRef = useRef(fileLinks?.openPath)
  openPathRef.current = fileLinks?.openPath

  const handleClick = useCallback((event) => {
    const openPath = openPathRef.current
    if (!openPath) return
    const target = fileTargetOf(event.target, rootRef.current)
    if (!target) return
    event.preventDefault()
    openPath(target.path, { line: target.line })
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    for (const block of root.querySelectorAll('pre')) {
      block.tabIndex = 0
      block.setAttribute('role', 'group')
      block.setAttribute('aria-label', 'Bloco de código')
    }
    let cancelled = false
    let observer = null
    if (highlight) {
      highlightCodeBlocks(root, () => cancelled)
      // The theme toggle only flips data-theme on <html>: the blocks already on screen are re-coloured
      // without a reload (they keep the colours of the previous theme otherwise).
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => highlightCodeBlocks(root, () => cancelled))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      }
    }
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [html, highlight])

  return (
    <div
      ref={rootRef}
      className="v3-prose v3-chat-prose"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
