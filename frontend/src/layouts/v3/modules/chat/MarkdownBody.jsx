import { useEffect, useMemo, useRef } from 'react'
import { renderChatMarkdown } from './chatMarkdown.js'
import { highlightCodeBlocks } from './highlightCode.js'

// The agent's text as markdown. The HTML comes out of chatMarkdown.js (marked + a restricted DOMPurify
// profile of the chat: no style, no form controls, no remote image; links open in a new tab with
// rel="noopener noreferrer"); it is the ONLY place of the chat that sets inner HTML. Code blocks get keyboard scrolling and, once the message is final, syntax colours.
//   rawHtmlAsText: HTML in the text is shown as text (the plan of the permission card)
//   highlight=false while the message is still streaming (no work on every delta)
export default function MarkdownBody({ text, highlight = true, rawHtmlAsText = false }) {
  const html = useMemo(() => renderChatMarkdown(text, { rawHtmlAsText }), [text, rawHtmlAsText])
  const rootRef = useRef(null)

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

  return <div ref={rootRef} className="v3-prose v3-chat-prose" dangerouslySetInnerHTML={{ __html: html }} />
}
