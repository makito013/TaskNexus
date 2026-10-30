import { useEffect, useRef } from 'react'
import './Dialog.css'

const INITIAL_FOCUS = '[data-autofocus], .v3-dialog__body input:not([disabled]), .v3-dialog__body select:not([disabled])'

const ICON_PATHS = {
  info: <><circle cx="10" cy="10" r="7.25" /><path d="M10 9v4.5M10 6.5v.01" /></>,
  alert: <><path d="M10 3.5l7 12.5H3z" /><path d="M10 8.5v3.5M10 14v.01" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 016 0V9" /></>,
  folder: <path d="M2.75 6.5a1.5 1.5 0 011.5-1.5h3.2l1.6 1.75h6.7a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H4.25a1.5 1.5 0 01-1.5-1.5z" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  search: <><circle cx="9" cy="9" r="5.25" /><path d="M13 13l3.5 3.5" /></>,
}

// Small stroked icons for the dialog content; always decorative (the text next to
// them carries the meaning).
export function DialogIcon({ name, size = 18 }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="v3-dialog__icon"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// returnFocusTo: an element, a ref, or a function returning either. It is read when
// the dialog closes, so a function can fall back to another element when the trigger
// is gone (an "Arquivar" that removed its own row).
function resolveElement(target) {
  const value = typeof target === 'function' ? target() : target
  const element = value && 'current' in value ? value.current : value
  return element && element.isConnected && typeof element.focus === 'function' ? element : null
}

// Native <dialog> opened with showModal(): the browser gives the top layer, the
// inert background, the focus trap and the ::backdrop. The component adds what the
// browser does not: a controlled `open`, the Escape/backdrop/Fechar routes through
// onClose, the initial focus on the first field and the focus returned to the
// trigger. Nothing is rendered inside the dialog while it is closed.
//
// size: 'md' (720px) | 'narrow' (520px).
export default function Dialog({
  open,
  title,
  titleId,
  onClose,
  children,
  footer = null,
  size = 'md',
  returnFocusTo = null,
}) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const openRef = useRef(open)
  const returnFocusRef = useRef(returnFocusTo)
  const pressStartedOnBackdropRef = useRef(false)
  onCloseRef.current = onClose
  openRef.current = open
  returnFocusRef.current = returnFocusTo

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return undefined
    const previouslyFocused = document.activeElement
    if (!dialog.open) dialog.showModal()
    dialog.querySelector(INITIAL_FOCUS)?.focus()
    return () => {
      if (dialog.open) dialog.close()
      const target = resolveElement(returnFocusRef.current)
        || (previouslyFocused && previouslyFocused.isConnected ? previouslyFocused : null)
      if (target && typeof target.focus === 'function') target.focus()
    }
  }, [open])

  // Escape: keep the dialog open until the parent says otherwise (it unmounts or
  // flips `open`, and the effect above closes the native element).
  const handleCancel = (event) => {
    event.preventDefault()
    onCloseRef.current?.()
  }
  // A native close that was not ours (e.g. a <form method="dialog">) still reaches
  // the parent; the close() of the effect above runs with `open` already false.
  const handleClose = () => {
    if (openRef.current) onCloseRef.current?.()
  }
  // Only a press AND a release on the backdrop close it (selecting text inside and
  // letting go outside must not).
  const handleMouseDown = (event) => {
    pressStartedOnBackdropRef.current = event.target === event.currentTarget
  }
  const handleClick = (event) => {
    const startedOnBackdrop = pressStartedOnBackdropRef.current
    pressStartedOnBackdropRef.current = false
    if (event.target === event.currentTarget && startedOnBackdrop) onCloseRef.current?.()
  }

  return (
    <dialog
      ref={dialogRef}
      className={`v3-dialog v3-dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClose={handleClose}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {open && (
        <div className="v3-dialog__panel">
          <header className="v3-dialog__header">
            <h2 id={titleId} className="v3-dialog__title">{title}</h2>
            <button type="button" className="v3-dialog__close" aria-label="Fechar" onClick={() => onCloseRef.current?.()}>
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="v3-dialog__body">{children}</div>
          {footer && <footer className="v3-dialog__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
