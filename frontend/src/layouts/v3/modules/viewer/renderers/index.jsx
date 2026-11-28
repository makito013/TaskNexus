import './renderers.css'
import BinaryView from './BinaryView.jsx'
import CodeView from './CodeView.jsx'
import HtmlView from './HtmlView.jsx'
import ImageView from './ImageView.jsx'
import MarkdownView from './MarkdownView.jsx'
import PdfView from './PdfView.jsx'

// Picks the renderer by the `kind` the SERVER answered in /content (fresher than the item's, and the only one
// that is trusted): never by the extension seen here.
// Returns { node, flush }: `flush` = the renderer fills the body and scrolls by itself (an iframe).
export function renderBody({ item, content, showAnyway, onShowAnyway, onOpenLink }) {
  const kind = content?.kind || item.kind
  const text = typeof content?.text === 'string' ? content.text : null
  // HTML is out: its iframe loads the whole file by the `f/` route; only its code tab would show the cut text.
  const truncated = content?.truncated && text !== null && kind !== 'html'

  if (truncated && !showAnyway) {
    return { node: <BinaryView item={item} content={content} reason="large" onShowAnyway={onShowAnyway} />, flush: false }
  }
  if (truncated && showAnyway) {
    return {
      node: (
        <>
          <p className="v3-callout v3-callout--info v3-viewer-callout">Mostrando só o primeiro 1 MB. Baixe para ver o arquivo inteiro.</p>
          <CodeView text={text} language="text" />
        </>
      ),
      flush: false,
    }
  }

  switch (kind) {
    case 'markdown':
      if (text === null) break
      return { node: <MarkdownView item={item} text={text} onOpenLink={onOpenLink} />, flush: false }
    case 'code':
      if (text === null) break
      return {
        node: <CodeView item={item} text={text} language={content?.language || item.language} line={item.line} flashKey={item.updated_at} />,
        flush: false,
      }
    case 'html':
      return { node: <HtmlView item={item} text={text} />, flush: true }
    case 'image':
      return { node: <ImageView item={item} />, flush: false }
    case 'pdf':
      return { node: <PdfView item={item} />, flush: true }
    case 'video':
      return { node: <BinaryView item={item} content={content} reason="video" />, flush: false }
    default:
      break
  }
  return { node: <BinaryView item={item} content={content} reason="binary" />, flush: false }
}
