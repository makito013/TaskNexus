import { useState } from 'react'
import { fileUrl } from '../../../../../services/viewerApi.js'
import CodeView from './CodeView.jsx'

// No `allow-same-origin`, ever: the document runs in an opaque origin, so its script works but cannot read the
// app's storage or call the API as the app. The server sends the same sandbox in its CSP (the effective one is
// the intersection). `allow-popups-to-escape-sandbox` lets a report link open the real site.
export const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox'

export default function HtmlView({ item, text }) {
  const [mode, setMode] = useState('preview')
  const hasSource = typeof text === 'string'
  const hasScript = hasSource && /<script[\s>]/i.test(text)
  return (
    <>
      <div className="v3-viewer-subtabs" role="tablist" aria-label="Modo de exibição">
        <button type="button" role="tab" aria-selected={mode === 'preview'} className="v3-viewer-subtab" onClick={() => setMode('preview')}>Preview</button>
        <button type="button" role="tab" aria-selected={mode === 'code'} className="v3-viewer-subtab" disabled={!hasSource} onClick={() => setMode('code')}>Código</button>
      </div>
      {mode === 'preview' ? (
        <>
          {hasScript ? <p className="v3-viewer-note v3-type-caption">O conteúdo roda isolado; links abrem em outra aba.</p> : null}
          <iframe
            key={`${item.id}:${item.updated_at}`}
            className="v3-viewer-iframe"
            title={`Prévia de ${item.title || item.path}`}
            src={fileUrl(item, item.path, { version: item.updated_at })}
            sandbox={HTML_SANDBOX}
            referrerPolicy="no-referrer"
            data-testid="viewer-html-iframe"
          />
        </>
      ) : (
        <div className="v3-viewer-code-pane"><CodeView text={text} language="html" /></div>
      )}
    </>
  )
}
