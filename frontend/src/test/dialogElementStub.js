// Test scaffold for the native <dialog> modal API, which jsdom does not implement
// (HTMLDialogElement has the `open` attribute but no show/showModal/close).
//
// This file is NOT a suite (its name does not match Vitest's default include), the
// same precedent as fakeVisualViewport.js. Only tests import it.
//
// What it fakes, per ADR-28 / TL-3:
//   showModal()  sets `open`, moves focus to [autofocus] or the first focusable
//                descendant, and listens for Escape on the dialog itself.
//   Escape       fires a cancelable `cancel` event; unless a handler calls
//                preventDefault() the dialog closes, like the browser does.
//   close(value) removes `open`, keeps `returnValue` and fires `close`.
//   show()       sets `open` without the modal behaviour.
//
// What it CANNOT prove (checked in a real browser by the QA instead): the top layer,
// the inert background, the native focus trap, the ::backdrop, the real Esc and the
// browser's own focus restoration on close (the Dialog component restores focus itself).
const INSTALLED = Symbol.for('tasknexus.dialogElementStub')

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusInitial(dialog) {
  const target = dialog.querySelector('[autofocus]') || dialog.querySelector(FOCUSABLE)
  if (target && typeof target.focus === 'function') target.focus()
}

// Only the top-most modal reacts to Escape (the browser closes one dialog per press).
const modalStack = []

function onEscape(event) {
  if (event.key !== 'Escape') return
  const dialog = event.currentTarget
  if (modalStack[modalStack.length - 1] !== dialog) return
  const cancel = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  if (!cancel.defaultPrevented) dialog.close()
}

export function installDialogElementStub() {
  const proto = globalThis.HTMLDialogElement?.prototype
  if (!proto || proto[INSTALLED]) return

  Object.defineProperty(proto, INSTALLED, { value: true })

  proto.showModal = function showModal() {
    if (this.hasAttribute('open')) throw new DOMException('The dialog is already open', 'InvalidStateError')
    this.setAttribute('open', '')
    this.returnValue = ''
    modalStack.push(this)
    this.addEventListener('keydown', onEscape)
    focusInitial(this)
  }

  proto.show = function show() {
    if (this.hasAttribute('open')) return
    this.setAttribute('open', '')
  }

  proto.close = function close(returnValue) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    if (returnValue !== undefined) this.returnValue = String(returnValue)
    const index = modalStack.indexOf(this)
    if (index !== -1) modalStack.splice(index, 1)
    this.removeEventListener('keydown', onEscape)
    this.dispatchEvent(new Event('close'))
  }
}

// For tests that want a clean slate between cases.
export function resetDialogElementStubState() {
  modalStack.length = 0
}
