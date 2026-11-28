import { createContext, useContext } from 'react'

// push({ text, kind: 'info' | 'error', action?: { label, onSelect }, durationMs = 6000 }) -> id
// dismiss(id)
// Outside a <ToastHost> both are no-ops: a screen that reports through a toast
// still renders (and is testable) without the host.
const NOOP = Object.freeze({ push: () => null, dismiss: () => {} })

export const ToastContext = createContext(NOOP)

export function useToast() {
  return useContext(ToastContext)
}
