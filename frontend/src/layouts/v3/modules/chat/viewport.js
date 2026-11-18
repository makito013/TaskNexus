// Breakpoints of the chat route (Designer 10). The v3 shell had no media query before the chat, so these
// are the first ones; they only take effect on the chat route (the stylesheets scope them by the
// `data-v3-route="chat"` attribute that AppV3 writes on #root, or by a chat-only class).
//   phone    <= 767     one column, two views (list | conversation), approval as a sheet
//   tablet   768-1279   rail + list (236px) | conversation, approval inline
//   desktop  >= 1280    the C4 layout, untouched
export const PHONE_QUERY = '(max-width: 767px)'
export const NARROW_SHELL_QUERY = '(max-width: 1279px)'

// The soft keyboard is "open" when the visible height falls below this share of the layout height.
export const KEYBOARD_VISIBLE_RATIO = 0.75

// Dialog size that renders the bottom sheet (`.v3-dialog--sheet`, a modifier of Dialog.css that only
// has an effect <= 767). Anywhere else the same dialogs keep their narrow size.
export const SHEET_DIALOG_SIZE = 'sheet'
export const dialogSizeFor = (phone) => (phone ? SHEET_DIALOG_SIZE : 'narrow')
