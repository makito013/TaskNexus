import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTopModal } from '../Dialog/modalStack.js'
import { ToastContext } from './toastContext.js'
import './Toast.css'

export const MAX_TOASTS = 3
export const DEFAULT_TOAST_MS = 6000

function Toast({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  // The timer runs only while the pointer and the focus are away; resuming
  // starts a fresh period so a toast is never cut short right after the pause.
  useEffect(() => {
    if (paused) return undefined
    const timer = setTimeout(() => onDismissRef.current(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [paused, toast.id, toast.durationMs])

  const handleBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
  }

  return (
    <div
      className={`v3-toast v3-toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={handleBlur}
    >
      <span className="v3-toast__text v3-type-body-sm">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="v3-toast__action v3-type-body-sm"
          onClick={() => {
            toast.action.onSelect()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="v3-toast__close" aria-label="Dispensar aviso" onClick={() => onDismiss(toast.id)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// One toast region for the whole shell. It renders NOTHING while empty (no live
// region, no role="status"), so a screen that looks for its own status keeps
// finding exactly one. The toasts go to document.body, or inside the modal that
// is on top (a modal dialog makes everything behind it inert).
export default function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])
  const nextIdRef = useRef(1)
  const topModal = useTopModal()

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(({ text, kind = 'info', action = null, durationMs = DEFAULT_TOAST_MS }) => {
    const id = nextIdRef.current
    nextIdRef.current += 1
    setToasts((current) => [...current, { id, text, kind, action, durationMs }].slice(-MAX_TOASTS))
    return id
  }, [])

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss])
  const target = topModal || (typeof document !== 'undefined' ? document.body : null)

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && target && createPortal(
        <div className="v3-toast-region">
          {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </div>,
        target,
      )}
    </ToastContext.Provider>
  )
}
