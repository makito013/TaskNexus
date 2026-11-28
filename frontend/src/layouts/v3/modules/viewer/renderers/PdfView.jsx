import { fileUrl } from '../../../../../services/viewerApi.js'
import { basenameOf } from '../../../../../utils/viewerPaths.js'

// The PDF reader of the browser does not render a sandboxed document, so this iframe has no sandbox: it is
// chosen only when the SERVER says the kind is pdf. "Abrir" and "Baixar" are always above it (the iPad shows page 1).
export default function PdfView({ item }) {
  const name = basenameOf(item.path)
  return (
    <>
      <div className="v3-viewer-pdfbar">
        <p className="v3-callout v3-callout--info v3-viewer-callout">
          No iPad o PDF pode aparecer só na primeira página. Use Abrir para ver tudo.
        </p>
        <div className="v3-viewer-pdfbar__actions">
          <a className="v3-button v3-button--secondary v3-button--md" href={fileUrl(item)} target="_blank" rel="noopener noreferrer">Abrir</a>
          <a className="v3-button v3-button--primary v3-button--md" href={fileUrl(item, item.path, { download: true })} download={name}>Baixar</a>
        </div>
      </div>
      <iframe
        key={`${item.id}:${item.updated_at}`}
        className="v3-viewer-iframe"
        title={`PDF ${name}`}
        src={fileUrl(item, item.path, { version: item.updated_at })}
        data-testid="viewer-pdf-iframe"
      />
    </>
  )
}
