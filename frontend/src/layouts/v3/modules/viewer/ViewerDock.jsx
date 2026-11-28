import { lazy } from 'react'
import { DOCK_MAX_RATIO, DOCK_MIN_WIDTH } from '../../../../hooks/useDockWidth.js'
import { isPlainEscape } from '../../../../utils/plainEscape.js'
import LazyBoundary from '../../components/LazyBoundary/LazyBoundary.jsx'
import { DEFAULT_DOCK_WIDTH } from './viewerLayout.js'

// The panel (and the renderers behind it) is a lazy chunk: the shell pays for it only when a panel is drawn.
export const LazyViewerPanel = lazy(() => import('./ViewerPanel.jsx'))

// Moves the focus to the active tab of a container, now or as soon as the lazy panel has drawn it. Returns the
// cleanup. Only for an opening the person asked for: a file that arrives by itself never takes the focus.
export function focusActiveTab(container) {
  const find = () => container?.querySelector('[role="tab"][aria-selected="true"]')
  const now = find()
  if (now) {
    now.focus({ preventScroll: true })
    return () => {}
  }
  if (!container || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(() => {
    const tab = find()
    if (tab) {
      tab.focus({ preventScroll: true })
      observer.disconnect()
    }
  })
  observer.observe(container, { childList: true, subtree: true })
  return () => observer.disconnect()
}

// The panel docked as the third column of the chat. `handle` is the useDockWidth() of the layout: the
// separator is a DIRECT child of the column (the hook reads handle.parentElement). `hidden` keeps the column
// (the conversation does not reflow, the terminal is not refitted) while the full screen shows the panel.
// Esc closes only with the focus INSIDE (a plain Esc typed in the terminal is the agent's).
export default function ViewerDock({ scope, handle, drawnWidth = null, hidden = false, onClose, onFullscreen, onOpenLink, emptyHint }) {
  const { handleProps, setWidth, width, dragging } = handle
  const drawn = drawnWidth ?? width ?? DEFAULT_DOCK_WIDTH
  const max = Math.max(DOCK_MIN_WIDTH, Math.round(window.innerWidth * DOCK_MAX_RATIO))
  const onKeyDown = (event) => {
    if (event.key === 'Home') {
      event.preventDefault()
      setWidth(DOCK_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(max)
    } else {
      handleProps.onKeyDown(event)
    }
  }
  return (
    <div className={`v3-viewer-dock${dragging ? ' v3-viewer-dock--dragging' : ''}`} data-testid="viewer-dock">
      <div
        {...handleProps}
        className="v3-viewer-dock__handle"
        aria-valuenow={Math.round(drawn)}
        aria-valuemax={max}
        onKeyDown={onKeyDown}
      />
      {hidden ? null : (
        <LazyBoundary label="Carregando o visualizador…">
          <LazyViewerPanel
            scope={scope}
            variant="dock"
            emptyHint={emptyHint}
            onOpenLink={onOpenLink}
            onClose={onClose}
            onFullscreen={onFullscreen}
            onKeyDown={(event) => {
              if (isPlainEscape(event)) {
                event.preventDefault()
                onClose()
              }
            }}
          />
        </LazyBoundary>
      )}
    </div>
  )
}
