import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SURFACE_CHAT, useViewer } from '../../../../hooks/viewerState.jsx'
import { useDockWidth } from '../../../../hooks/useDockWidth.js'
import { useTopModal } from '../../components/Dialog/modalStack.js'
import ViewerDock from './ViewerDock.jsx'
import ViewerDrawer from './ViewerDrawer.jsx'
import ViewerFullscreen, { FULLSCREEN_ATTRIBUTE } from './ViewerFullscreen.jsx'
import { useViewportWidth } from './ViewerShell.jsx'
import { CHAT_DRAWER_MIN_VIEWPORT, resolveChatDock, resolveViewerMode } from './viewerLayout.js'
import './Viewer.css'

// What the shell takes from the viewport when the container cannot be measured (jsdom, first paint): the rail
// and the paddings of the screen. 1280 - 148 = the 1132 of the layout accounts.
const SHELL_CHROME_WIDTH = 148
const LIST_WIDTH = { desktop: 272, tablet: 236 }
const GAP = { desktop: 16, tablet: 12 }

// Gives the focus back after a surface closed, but only if the person is still "nowhere" (on <body>, because the
// element that had the focus left) or still inside what closed: someone who already went to the composer stays there.
export function restoreFocusTo(target, container = null) {
  const active = document.activeElement
  const nowhere = !active || active === document.body || (container && container.contains(active))
  if (nowhere && target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true })
}

// The presentation of the chat's viewer: which container (dock, drawer, full screen), whether the dock column
// exists, whether the list of conversations folds away and how wide the dock is drawn. Null without the shell.
// Written into the screen: data-viewer-dock / data-list-collapsed on the grid and --v3-viewer-dock-width.
export function useChatViewerLayout(screenRef) {
  const viewer = useViewer()
  const dock = useDockWidth()
  const viewportWidth = useViewportWidth()
  const [contentWidth, setContentWidth] = useState(null)
  const previousModeRef = useRef(null)
  const phoneRef = useRef(viewportWidth < CHAT_DRAWER_MIN_VIEWPORT)

  const surface = viewer ? viewer.getSurface(SURFACE_CHAT) : { open: false, fullscreen: false }

  useEffect(() => {
    const element = screenRef.current
    if (!element) return undefined
    const measure = () => setContentWidth(element.clientWidth || null)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [screenRef])

  const tablet = viewportWidth < 1280
  // While the handle is dragged the dock stays a dock: a column that turned into a drawer would unmount the
  // handle under the pointer and lose the pointerup that saves the width.
  const frozen = dock.dragging && previousModeRef.current === 'dock'
  const baseMode = frozen ? 'dock' : resolveViewerMode({ surface: SURFACE_CHAT, viewportWidth, fullscreen: false })
  let layoutMode = baseMode
  let collapseList = false
  let width = null
  if (baseMode === 'dock') {
    const resolved = resolveChatDock({
      contentWidth: contentWidth ?? viewportWidth - SHELL_CHROME_WIDTH,
      listWidth: tablet ? LIST_WIDTH.tablet : LIST_WIDTH.desktop,
      gap: tablet ? GAP.tablet : GAP.desktop,
      dockWidth: dock.width,
      dragging: dock.dragging,
      previousMode: previousModeRef.current,
    })
    layoutMode = resolved.mode
    collapseList = resolved.collapseList
    width = resolved.width
  }
  useEffect(() => {
    previousModeRef.current = layoutMode === 'fullscreen' ? previousModeRef.current : layoutMode
  })

  // A full screen that came from a phone is switched off when the window grows past it (the expand button's own
  // choice cannot be told apart, and a full screen the person did not ask for on a desktop is the worse error).
  const setFullscreen = viewer?.setFullscreen
  useEffect(() => {
    const phone = viewportWidth < CHAT_DRAWER_MIN_VIEWPORT
    if (phoneRef.current && !phone && surface.fullscreen) setFullscreen?.(SURFACE_CHAT, false)
    phoneRef.current = phone
  }, [viewportWidth, surface.fullscreen, setFullscreen])

  if (!viewer) return null
  const mode = surface.fullscreen ? 'fullscreen' : layoutMode
  const dockColumn = surface.open && layoutMode === 'dock'
  return {
    surface,
    mode,
    layoutMode,
    dockColumn,
    collapseList: dockColumn && collapseList,
    width,
    dock,
    phone: viewportWidth < CHAT_DRAWER_MIN_VIEWPORT,
    sectionProps: {
      ...(dockColumn ? { 'data-viewer-dock': '' } : {}),
      ...(dockColumn && collapseList ? { 'data-list-collapsed': '' } : {}),
    },
    sectionStyle: dockColumn ? { '--v3-viewer-dock-width': `${width ?? 420}px` } : undefined,
  }
}

// Draws the viewer of one surface in the container the layout chose. Dock and drawer are SIBLINGS of the chat
// panel (in the React tree too, so a key pressed inside never reaches the panel's "Esc interrupts").
//   layout          from useChatViewerLayout
//   surfaceName     the viewer surface this draws
//   scope           the tabs it shows
//   ignoreModals    a surface that opens over a modal on purpose (card attachments)
//   returnFocusTo() the element that gets the focus back when the surface closes
export default function ViewerSurface({ layout, surfaceName = SURFACE_CHAT, scope, onOpenLink, emptyHint, ignoreModals = false, returnFocusTo }) {
  const viewer = useViewer()
  const topModal = useTopModal()
  const shownRef = useRef(false)
  const containerRef = useRef(null)
  const state = viewer && layout ? layout.surface : { open: false, fullscreen: false }

  // An opening that finds a modal on screen (an approval sheet) waits for it to close: the tabs and the seal
  // already updated. Once drawn it stays; the full screen's own dialog does not count as "another modal".
  const modeIsOverlay = layout?.mode === 'drawer' || layout?.mode === 'fullscreen'
  const blocked = modeIsOverlay && !ignoreModals && topModal !== null && !topModal.hasAttribute(FULLSCREEN_ATTRIBUTE)
  const visible = Boolean(state.open) && (!blocked || shownRef.current)
  const drawn = visible && (layout?.mode !== 'dock' || layout?.dockColumn)

  const previousDrawn = useRef(false)
  const lastActive = useRef(null)
  // Remembered in a layout effect: the container moves the focus into itself in a passive effect that runs
  // before this component's own passive effects.
  useLayoutEffect(() => {
    if (drawn && !previousDrawn.current) lastActive.current = document.activeElement
  }, [drawn])
  useEffect(() => {
    if (!drawn && previousDrawn.current) {
      const target = (returnFocusTo && returnFocusTo()) || lastActive.current
      restoreFocusTo(target, containerRef.current)
    }
    previousDrawn.current = drawn
    shownRef.current = drawn
  }, [drawn, returnFocusTo])

  const close = useCallback(() => viewer?.setOpen(surfaceName, false), [viewer, surfaceName])
  const leaveFullscreen = useCallback(() => {
    if (layout?.phone) viewer?.setOpen(surfaceName, false)
    else viewer?.setFullscreen(surfaceName, false)
  }, [viewer, surfaceName, layout])
  const expand = useCallback(() => viewer?.setFullscreen(surfaceName, true), [viewer, surfaceName])

  if (!viewer || !layout) return null
  return (
    <div ref={containerRef} className="v3-viewer-surface" data-surface={surfaceName} style={{ display: 'contents' }}>
      {layout.dockColumn ? (
        <ViewerDock
          scope={scope}
          handle={layout.dock}
          drawnWidth={layout.width}
          hidden={layout.mode === 'fullscreen'}
          onClose={close}
          onFullscreen={expand}
          onOpenLink={onOpenLink}
          emptyHint={emptyHint}
        />
      ) : null}
      {drawn && layout.mode === 'drawer' ? (
        <ViewerDrawer
          scope={scope}
          onClose={close}
          onFullscreen={expand}
          onOpenLink={onOpenLink}
          emptyHint={emptyHint}
        />
      ) : null}
      {drawn && layout.mode === 'fullscreen' ? (
        <ViewerFullscreen
          scope={scope}
          alwaysFocus={layout.phone}
          onClose={leaveFullscreen}
          onOpenLink={onOpenLink}
          emptyHint={emptyHint}
        />
      ) : null}
    </div>
  )
}
