// frontend/src/features/viewer/ViewerPanel.jsx
// Fase V-2 (6.5.1/6.5.3): o conteúdo do visualizador — abas, barra do arquivo e
// corpo — igual nos três contêineres (ViewerDock encaixado, ViewerDrawer por
// cima, ViewerFullscreen). Não sabe em que contêiner está além do `variant`
// (que só muda os botões do cabeçalho) e não sabe de sessão: recebe um ESCOPO
// e lê as abas dele no ViewerContext. É isso que a Fase A reaproveita com
// `scope="artefatos"`.
import { useEffect, useState } from 'react';
import './viewer.css';
import { useViewer, surfaceForScope } from './ViewerContext.jsx';
import { useViewerContent } from './useViewerContent.js';
import { ViewerTabs } from './ViewerTabs.jsx';
import { ViewerToolbar } from './ViewerToolbar.jsx';
import { renderBody } from './renderers/index.jsx';

function Skeleton() {
  return (
    <div className="vw-skeleton" aria-busy="true" aria-label="Carregando">
      <span /><span /><span /><span /><span />
    </div>
  );
}

function StateMessage({ title, children, actions }) {
  return (
    <div className="vw-center">
      <div className="vw-state" role="status">
        {title && <div className="vw-state-title">{title}</div>}
        {children}
        {actions && <div className="vw-state-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string|null} props.scope       escopo das abas (`session:<sk>` ou `artefatos`)
 * @param {'dock'|'drawer'|'fullscreen'} props.variant
 * @param {() => void} props.onClose      ✕ do cabeçalho (fecha o painel; na
 *                                        tela cheia, sai dela)
 * @param {() => void} [props.onFullscreen] ⤢ (omitido na própria tela cheia)
 * @param {string} [props.emptyHint]      texto do estado vazio (a Fase A troca)
 * @param {(caminho: string, options: object, item: object) => void} [props.onOpenPath]
 *   link relativo dentro de um arquivo aberto. Padrão: `openByPath` do escopo
 *   (só existe em escopo de conversa). A Fase A passa o próprio tratamento,
 *   porque um escopo local (`artefatos`) não tem sessão para pedir a aba.
 */
export function ViewerPanel({ scope, variant = 'dock', onClose, onFullscreen, emptyHint, onOpenPath, panelRef, onKeyDown }) {
  const viewer = useViewer();
  const scopeState = scope && viewer ? viewer.getScope(scope) : null;
  const items = scopeState?.items || [];
  const activeItem = items.find((i) => i.id === scopeState?.activeId) || items[items.length - 1] || null;
  const content = useViewerContent(activeItem);

  // "Mostrar o começo" de um arquivo truncado vale só para a aba em que foi
  // pedido (e para a versão dela): trocar de aba ou o agente reabrir volta ao
  // cartão de download.
  const versionKey = activeItem ? `${activeItem.id}:${activeItem.updated_at}` : null;
  const [showAnyway, setShowAnyway] = useState(null);
  useEffect(() => { setShowAnyway(null); }, [versionKey]);

  const fullscreen = variant === 'fullscreen';
  const surface = surfaceForScope(scope);

  const openPath = (caminho, options) => (onOpenPath
    ? onOpenPath(caminho, options || {}, activeItem)
    : viewer?.openByPath(scope, caminho, options));

  let body;
  let flush = false;
  if (!scope) {
    body = <StateMessage title="Nenhuma conversa aberta">Abra um chat para ver os arquivos que o agente mostrar.</StateMessage>;
  } else if (items.length === 0 && scopeState?.loading) {
    body = <Skeleton />;
  } else if (items.length === 0 && scopeState?.error) {
    body = (
      <StateMessage
        title="Não consegui carregar as abas"
        actions={<button type="button" className="vw-btn" onClick={() => viewer.loadItems(scope, { force: true })}>Tentar de novo</button>}
      >
        {scopeState.error}
      </StateMessage>
    );
  } else if (items.length === 0) {
    body = (
      <StateMessage title="Nenhum arquivo aberto ainda">
        {emptyHint || <>Peça ao agente: <em>abre o README no visualizador</em>.</>}
      </StateMessage>
    );
  } else if (content.status === 'loading' || content.status === 'idle') {
    body = <Skeleton />;
  } else if (content.status === 'gone') {
    body = (
      <StateMessage
        title="Este arquivo não existe mais"
        actions={(
          <>
            <button type="button" className="vw-btn" onClick={() => viewer.closeItem(scope, activeItem.id)}>Fechar aba</button>
            <button type="button" className="vw-btn vw-btn--quiet" onClick={content.reload}>Tentar de novo</button>
          </>
        )}
      >
        O agente pode ter movido ou apagado <em>{activeItem.path}</em>.
      </StateMessage>
    );
  } else if (content.status === 'error') {
    body = (
      <StateMessage
        title="Não consegui carregar o arquivo"
        actions={<button type="button" className="vw-btn" onClick={content.reload}>Tentar de novo</button>}
      >
        {content.error}
      </StateMessage>
    );
  } else {
    const rendered = renderBody({
      item: activeItem,
      content: content.data,
      showAnyway: showAnyway === versionKey,
      onShowAnyway: () => setShowAnyway(versionKey),
      onOpenPath: openPath,
    });
    body = rendered.node;
    flush = rendered.flush;
  }

  return (
    <section
      ref={panelRef}
      className="vw-panel"
      data-testid={`viewer-panel-${variant}`}
      data-viewer-surface={surface}
      aria-label="Visualizador de arquivos"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="vw-header">
        <ViewerTabs
          items={items}
          activeId={activeItem?.id}
          onSelect={(id) => viewer.setActive(scope, id)}
          onClose={(id) => viewer.closeItem(scope, id)}
        />
        <div className="vw-header-actions">
          {!fullscreen && onFullscreen && (
            <button
              type="button"
              className="vw-btn vw-btn--icon vw-btn--quiet"
              onClick={onFullscreen}
              aria-label="Tela cheia"
              title="Tela cheia"
            >
              ⤢
            </button>
          )}
          {fullscreen ? (
            <button type="button" className="vw-btn" onClick={onClose} style={{ height: '44px' }}>
              ✕ Fechar
            </button>
          ) : (
            <button
              type="button"
              className="vw-btn vw-btn--icon vw-btn--quiet"
              onClick={onClose}
              aria-label="Fechar visualizador"
              title="Fechar visualizador"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {activeItem && (
        <ViewerToolbar
          item={activeItem}
          content={content.status === 'ready' ? content.data : null}
          onCloseAll={() => viewer.closeAll(scope)}
        />
      )}
      {/* `key` pela aba: trocar de aba começa do topo. Sem isso a rolagem do
          corpo (o mesmo nó) passava de um arquivo para o outro — abrir o
          README depois de um código rolado até a linha 300 caía no meio dele. */}
      <div key={activeItem?.id || 'vazio'} className={`vw-body${flush ? ' vw-body--flush' : ''}`} data-testid="viewer-body">
        {body}
      </div>
    </section>
  );
}
