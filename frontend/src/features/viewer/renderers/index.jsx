// frontend/src/features/viewer/renderers/index.jsx
// Fase V-2 (6.2, tabela "Estados"): escolhe o renderer pelo `kind` que o
// backend devolveu em /content (mais fresco que o do item: o arquivo pode ter
// mudado de natureza desde que a aba foi aberta).
import { MarkdownView } from './MarkdownView.jsx';
import { CodeView } from './CodeView.jsx';
import { BinaryView } from './BinaryView.jsx';
import { HtmlView } from './HtmlView.jsx';
import { ImageView } from './ImageView.jsx';
import { PdfView } from './PdfView.jsx';

/**
 * @returns {{ node: import('react').ReactNode, flush: boolean }} `flush` = o
 *   renderer ocupa o corpo inteiro e cuida da própria rolagem (iframe).
 */
export function renderBody({ item, content, showAnyway, onShowAnyway, onOpenPath }) {
  const kind = content?.kind || item.kind;
  const text = typeof content?.text === 'string' ? content.text : null;
  // HTML fica fora: o iframe carrega o arquivo inteiro pela rota `f/`; só o
  // modo Código dele mostraria o texto cortado.
  const truncatedNotice = content?.truncated && text !== null && kind !== 'html';

  // > 1 MB: o backend manda só o primeiro 1 MB (6.10.2, item 3). Primeiro o
  // cartão de download; o começo do arquivo, como texto puro, só se pedido.
  if (truncatedNotice && !showAnyway) {
    return { node: <BinaryView item={item} content={content} reason="large" onShowAnyway={onShowAnyway} />, flush: false };
  }
  if (truncatedNotice && showAnyway) {
    return {
      node: (
        <>
          <div className="vw-banner">Mostrando só o primeiro 1 MB. Baixe para ver o arquivo inteiro.</div>
          <CodeView text={text} language="text" />
        </>
      ),
      flush: false,
    };
  }

  switch (kind) {
    case 'markdown':
      if (text === null) break;
      return { node: <MarkdownView item={item} text={text} onOpenPath={onOpenPath} />, flush: false };
    case 'code':
      if (text === null) break;
      return {
        node: <CodeView text={text} language={content?.language || item.language} line={item.line} flashKey={item.updated_at} />,
        flush: false,
      };
    case 'html':
      return { node: <HtmlView item={item} text={text} />, flush: true };
    case 'image':
      return { node: <ImageView item={item} />, flush: false };
    case 'pdf':
      return { node: <PdfView item={item} />, flush: true };
    case 'video':
      return { node: <BinaryView item={item} content={content} reason="video" />, flush: false };
    default:
      break;
  }
  return { node: <BinaryView item={item} content={content} reason="binary" />, flush: false };
}
