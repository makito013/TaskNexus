import { useSyncExternalStore } from 'react'

// The open modal <dialog>s of the V3, oldest first. A modal dialog lives in the
// browser's top layer, so nothing else can be drawn above it (z-index does not
// apply) and everything behind it is inert: the toast must move inside the top
// modal and a "window too narrow" notice must wait for it to close. Dialog.jsx
// registers here; the toast and the notice read.
const stack = []
const listeners = new Set()

function notifyAll() {
  for (const listener of [...listeners]) listener()
}

// Registers an open modal. Returns the function that releases it (idempotent).
export function pushModal(element) {
  stack.push(element)
  notifyAll()
  let released = false
  return () => {
    if (released) return
    released = true
    const index = stack.lastIndexOf(element)
    if (index !== -1) stack.splice(index, 1)
    notifyAll()
  }
}

// The modal that is on top, or null when none is open.
export function topModal() {
  return stack.length > 0 ? stack[stack.length - 1] : null
}

export function subscribeModals(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// React view of the stack: the element on top (null when empty).
export function useTopModal() {
  return useSyncExternalStore(subscribeModals, topModal, () => null)
}
