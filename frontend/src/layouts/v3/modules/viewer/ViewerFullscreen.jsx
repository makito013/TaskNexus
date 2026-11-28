import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import LazyBoundary from '../../components/LazyBoundary/LazyBoundary.jsx'
import { pushModal } from '../../components/Dialog/modalStack.js'
import { LazyViewerPanel, focusActiveTab } from './ViewerDock.jsx'
import { useViewerShell } from './ViewerShell.jsx'
import './Viewer.css'

export const FULLSCREEN_ATTRIBUTE = 'data-viewer-fullscreen'

// The full-screen panel: a <dialog> of its own, opened with showModal() AFTER whatever is open, so the browser
// stacks it on top (z-index does not apply in the top layer). It is portalled into <body>, never inside another
// dialog: its Esc and clicks must not reach the dialog below (the card). Esc closes only this one. The
// `cancel` is refused (the parent closes it) and the native `close` is handled too: a second Esc can skip `cancel`.
// It registers in the modal stack, so toasts move inside it and the width notice waits for it.
//   onClose           ✕ Fechar and Esc
export default function ViewerFullscreen({ scope, alwaysFocus = false, onClose, onOpenLink, emptyHint }) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const unmountingRef = useRef(false)
  const shell = useViewerShell()
  const wantsFocusRef = useRef(null)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    unmountingRef.current = false
    if (!dialog.open) dialog.showModal()
    const release = pushModal(dialog)
    if (wantsFocusRef.current === null) wantsFocusRef.current = Boolean(shell?.consumePanelFocus())
    const stopFocusing = wantsFocusRef.current || alwaysFocus ? focusActiveTab(dialog) : () => {}
    return () => {
      stopFocusing()
      // Closing the element because the surface goes away is not a request to close the surface.
      unmountingRef.current = true
      release()
      if (dialog.open) dialog.close()
    }
    // Opened once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <dialog
      ref={dialogRef}
      className="v3-viewer-fullscreen"
      aria-label="Visualizador em tela cheia"
      {...{ [FULLSCREEN_ATTRIBUTE]: '' }}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
      }}
      onClose={(event) => {
        event.stopPropagation()
        // A native close that was not ours (a second Esc) still closes the surface.
        if (!unmountingRef.current) onCloseRef.current?.()
      }}
    >
      <LazyBoundary label="Carregando o visualizador…">
        <LazyViewerPanel scope={scope} variant="fullscreen" emptyHint={emptyHint} onOpenLink={onOpenLink} onClose={onClose} />
      </LazyBoundary>
    </dialog>,
    document.body,
  )
}
