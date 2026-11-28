import { useEffect, useState } from 'react'
import { sessionKeyFromScope } from '../../../../services/viewerApi.js'
import { useViewer } from '../../../../hooks/viewerState.jsx'
import { useViewerContent } from '../../../../hooks/useViewerContent.js'
import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { basenameOf } from '../../../../utils/viewerPaths.js'
import { NO_CONVERSATION_MESSAGE, useViewerShell } from './ViewerShell.jsx'
import ViewerFileMenu from './ViewerFileMenu.jsx'
import ViewerTabs from './ViewerTabs.jsx'
import ViewerToolbar from './ViewerToolbar.jsx'
import { renderBody } from './renderers/index.jsx'

function Skeleton({ label }) {
  return (
    <div className="v3-viewer-skeleton" aria-busy="true">
      <span className="v3-viewer-sr-only" role="status">{label}</span>
      <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
      <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
    </div>
  )
}

function Message({ title, children, actions }) {
  return (
    <div className="v3-viewer-message">
      {title ? <p className="v3-viewer-message__title v3-type-body">{title}</p> : null}
      {children ? <p className="v3-type-body-sm v3-viewer-message__text">{children}</p> : null}
      {actions ? <div className="v3-viewer-message__actions">{actions}</div> : null}
    </div>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4h4v4M8 16H4v-4M16 4l-5 5M4 16l5-5" />
    </svg>
  )
}

// The content of the viewer: tabs, the bar of the file and the body, the same in the dock, the drawer and the
// full screen. It knows a SCOPE (not a session) and reads its tabs from the viewer state.
//   scope, variant 'dock' | 'drawer' | 'fullscreen', onClose, onFullscreen (omitted in the full screen)
//   onOpenLink(path, options, item)   a relative link inside a Markdown; the default opens a tab of the conversation
//   emptyHint                          replaces the second line of the "no files" state
//   panelRef, onKeyDown                for the container that hosts it
export default function ViewerPanel({ scope, variant = 'dock', onClose, onFullscreen, emptyHint, onOpenLink, panelRef, onKeyDown }) {
  const viewer = useViewer()
  const shell = useViewerShell()
  const scopeState = scope && viewer ? viewer.getScope(scope) : null
  const items = scopeState?.items || []
  const activeItem = items.find((item) => item.id === scopeState?.activeId) || items[items.length - 1] || null
  const content = useViewerContent(activeItem)

  // "Mostrar o começo" holds for the tab and the version it was asked on.
  const versionKey = activeItem ? `${activeItem.id}:${activeItem.updated_at}` : null
  const [showAnyway, setShowAnyway] = useState(null)
  useEffect(() => { setShowAnyway(null) }, [versionKey])

  if (!viewer) return null
  const fullscreen = variant === 'fullscreen'
  const sessionKey = sessionKeyFromScope(scope)

  const openLink = (path, options) => {
    if (onOpenLink) return onOpenLink(path, options || {}, activeItem)
    if (!sessionKey || !shell) return undefined
    return shell.openFile(sessionKey, path, { relativeTo: options?.relativoA })
  }

  let body
  let flush = false
  let bodyName = null
  if (!scope) {
    body = <Message title={NO_CONVERSATION_MESSAGE} />
  } else if (items.length === 0 && scopeState?.loading) {
    body = <Skeleton label="Carregando as abas…" />
  } else if (items.length === 0 && scopeState?.error) {
    // While the retry is out the branch above (skeleton) takes over, so the button is never there twice.
    body = (
      <Panel notice="fin" role="alert" className="v3-viewer-notice">
        Não consegui carregar as abas.{' '}
        <Button variant="secondary" size="sm" onClick={() => viewer.loadItems(scope, { force: true })}>
          Tentar de novo
        </Button>
      </Panel>
    )
  } else if (items.length === 0) {
    body = <Message title="Nenhum arquivo aberto.">{emptyHint || 'Quando o agente abrir um arquivo, ele aparece aqui.'}</Message>
  } else {
    bodyName = basenameOf(activeItem.path)
    if (content.status === 'loading' || content.status === 'idle') {
      body = <Skeleton label={`Abrindo ${bodyName}…`} />
    } else if (content.status === 'gone') {
      body = (
        <Message
          title="Esse arquivo não existe mais."
          actions={(
            <>
              <Button variant="text" onClick={() => viewer.closeItem(scope, activeItem.id)}>Fechar aba</Button>
              <Button variant="text" onClick={content.reload}>Tentar de novo</Button>
            </>
          )}
        >
          O agente pode ter movido ou apagado {activeItem.path}.
        </Message>
      )
    } else if (content.status === 'error') {
      body = (
        <Panel notice="fin" role="alert" className="v3-viewer-notice">
          Não consegui abrir o arquivo.{' '}
          <Button variant="secondary" size="sm" onClick={content.reload}>Tentar de novo</Button>
        </Panel>
      )
    } else {
      const rendered = renderBody({
        item: activeItem,
        content: content.data,
        showAnyway: showAnyway === versionKey,
        onShowAnyway: () => setShowAnyway(versionKey),
        onOpenLink: openLink,
      })
      body = rendered.node
      flush = rendered.flush
    }
  }

  return (
    <section
      ref={panelRef}
      className="v3-viewer-panel"
      role={variant === 'drawer' ? 'complementary' : 'region'}
      aria-label="Visualizador de arquivos"
      data-variant={variant}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="v3-viewer-header">
        <ViewerTabs
          items={items}
          activeId={activeItem?.id}
          onSelect={(id) => viewer.setActive(scope, id)}
          onClose={(id) => viewer.closeItem(scope, id)}
        />
        {items.length > 0 ? (
          <ViewerFileMenu
            label="Mais ações dos arquivos"
            items={[{ id: 'close-all', label: 'Fechar todas', tone: 'danger', onSelect: () => viewer.closeAll(scope) }]}
          />
        ) : null}
        <div className="v3-viewer-header__actions">
          {!fullscreen && onFullscreen ? (
            <button type="button" className="v3-viewer-icon-button" aria-label="Tela cheia" title="Tela cheia" onClick={onFullscreen}>
              <ExpandIcon />
            </button>
          ) : null}
          {fullscreen ? (
            <Button variant="secondary" onClick={onClose}>✕ Fechar</Button>
          ) : (
            <button type="button" className="v3-viewer-icon-button" aria-label="Fechar visualizador" title="Fechar visualizador" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
      {activeItem ? (
        <ViewerToolbar
          item={activeItem}
          content={content.status === 'ready' ? content.data : null}
          status={content.status}
          onCloseTab={() => viewer.closeItem(scope, activeItem.id)}
        />
      ) : null}
      {/* `key` by tab: each tab opens from the top. The ONE scroll region of the panel. */}
      {activeItem ? (
        <div
          key={activeItem.id}
          className={`v3-viewer-body${flush ? ' v3-viewer-body--flush' : ''}`}
          role="region"
          aria-label={`Conteúdo de ${bodyName}`}
          tabIndex={0}
          data-viewer-scroll=""
        >
          {body}
        </div>
      ) : (
        <div className="v3-viewer-body" data-viewer-scroll="">{body}</div>
      )}
    </section>
  )
}
