import { useEffect, useRef } from 'react'
import { useViewer, useViewerActions } from '../../../../hooks/viewerState.jsx'
import { useToast } from '../../components/Toast/toastContext.js'

// The viewer's own toast slot (viewerState.toast) becomes a shell toast. A toast id is handled once: React runs
// effects twice in development (and a StrictMode double effect would otherwise show the same message twice).
//   an error     -> an alert toast with the message in pt-BR
//   an opening   -> "<agent> abriu <file>." with "Ver", for a conversation that was not on screen: "Ver" takes the
//                   person there (route, tab, panel) and, on a phone that was showing the list, back to the chat.
//                   The toast never takes the focus.
//   anything else -> an info toast
//   localize(message) -> the pt-BR text of a message that may carry the browser's own wording
//   requestChatView() -> asks the chat screen to show the conversation itself (the shell owns it)
export default function ViewerToast({ localize, requestChatView }) {
  const viewer = useViewer()
  const actions = useViewerActions()
  const { push } = useToast()
  const handledRef = useRef(new Set())
  const toast = viewer?.toast ?? null
  const dismissToast = actions?.dismissToast
  const revealToast = actions?.revealToast

  useEffect(() => {
    if (!toast || handledRef.current.has(toast.id)) return
    handledRef.current.add(toast.id)
    if (toast.kind === 'open') {
      push({
        text: `${toast.text}.`,
        kind: 'info',
        action: {
          label: 'Ver',
          onSelect: () => {
            revealToast?.(toast)
            requestChatView?.()
          },
        },
      })
    } else {
      push({ text: localize(toast.text), kind: toast.kind === 'error' ? 'error' : 'info' })
    }
    dismissToast?.(toast.id)
  }, [toast, push, dismissToast, revealToast, localize, requestChatView])

  return null
}
