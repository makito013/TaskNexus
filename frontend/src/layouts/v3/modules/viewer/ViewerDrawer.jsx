import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { isPlainEscape } from '../../../../utils/plainEscape.js'
import LazyBoundary from '../../components/LazyBoundary/LazyBoundary.jsx'
import { LazyViewerPanel, focusActiveTab } from './ViewerDock.jsx'
import { useViewerShell } from './ViewerShell.jsx'

// One of the three named `position: fixed` exceptions of the V3 (with the toast region and the artifact menu).
// It is declared HERE, in inline styles, so the exception names this file and not the whole stylesheet. The
// drawer is a leaf reached by a portal into <body>: no ancestor of it creates a containing block.
const styles = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'color-mix(in srgb, var(--v3-scrim) 72%, transparent)',
  },
  panel: {
    position: 'fixed',
    inset: '0 0 0 auto',
    width: 'min(calc(var(--v3-panel) + var(--v3-sidebar)), 90vw)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  },
}

// The panel over the conversation, not modal: a scrim that closes, Esc only with the focus inside. It focuses
// the active tab when the opening was a user gesture (the shell's focus request) - never when a file arrives by itself.
export default function ViewerDrawer({ scope, onClose, onFullscreen, onOpenLink, emptyHint }) {
  const containerRef = useRef(null)
  const shell = useViewerShell()
  const wantsFocusRef = useRef(null)

  useEffect(() => {
    // Asked once: React runs this effect twice in development and the request is handed out once.
    if (wantsFocusRef.current === null) wantsFocusRef.current = Boolean(shell?.consumePanelFocus())
    if (!wantsFocusRef.current) return undefined
    return focusActiveTab(containerRef.current)
    // Only the moment of opening matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div ref={containerRef} className="v3-viewer-drawer" data-testid="viewer-drawer">
      <div className="v3-viewer-drawer__scrim" style={styles.scrim} data-testid="viewer-drawer-scrim" onClick={onClose} />
      <div
        className="v3-viewer-drawer__panel"
        style={styles.panel}
        onKeyDown={(event) => {
          if (isPlainEscape(event)) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <LazyBoundary label="Carregando o visualizador…">
          <LazyViewerPanel
            scope={scope}
            variant="drawer"
            emptyHint={emptyHint}
            onOpenLink={onOpenLink}
            onClose={onClose}
            onFullscreen={onFullscreen}
          />
        </LazyBoundary>
      </div>
    </div>,
    document.body,
  )
}
