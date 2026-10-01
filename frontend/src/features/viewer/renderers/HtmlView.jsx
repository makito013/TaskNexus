// frontend/src/features/viewer/renderers/HtmlView.jsx
// Fase V-2 (6.5.4): HTML renderizado num <iframe> isolado, com a alternância
// Preview · Código.
//
// ISOLAMENTO (6.3 e 6.10.2, item 4): `sandbox="allow-scripts allow-popups
// allow-popups-to-escape-sandbox"` e NUNCA `allow-same-origin`. Sem ele o
// documento roda numa origem opaca: o script do relatório funciona (gráficos,
// abas, filtros), mas não lê cookies/localStorage do TaskNexus nem chama a API
// com a origem do app. O backend manda o mesmo sandbox no cabeçalho CSP — o
// efetivo é a interseção dos dois. `allow-popups-to-escape-sandbox` existe para
// um link `target=_blank` do relatório abrir o site externo normal, e não um
// site "sandboxed" que quebra.
//
// O iframe aponta para /api/viewer/{item_id}/f/<caminho>: com o caminho no fim
// da URL, o `style.css` e as imagens relativas do HTML resolvem para a mesma
// rota e o backend serve os vizinhos do mesmo projeto.
import { useState } from 'react';
import { fileUrl } from '../viewerApi.js';
import { CodeView } from './CodeView.jsx';

export const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

export function HtmlView({ item, text }) {
  const [mode, setMode] = useState('preview');
  const hasSource = typeof text === 'string';
  return (
    <>
      <div className="vw-subbar">
        <span>HTML isolado (sandbox)</span>
        <div className="vw-segmented" role="group" aria-label="Modo de exibição">
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button>
          <button type="button" aria-pressed={mode === 'code'} onClick={() => setMode('code')} disabled={!hasSource}>Código</button>
        </div>
      </div>
      {mode === 'preview' ? (
        <iframe
          // `key` com a versão: o agente reescreveu o arquivo → recarrega.
          key={`${item.id}:${item.updated_at}`}
          className="vw-iframe"
          title={`Prévia de ${item.path}`}
          src={fileUrl(item, item.path, { version: item.updated_at })}
          sandbox={HTML_SANDBOX}
          referrerPolicy="no-referrer"
          data-testid="viewer-html-iframe"
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <CodeView text={text} language="html" />
        </div>
      )}
    </>
  );
}
