import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useViewer, useViewerActions, useViewerHost, ViewerProvider } from '../../../../hooks/viewerState.jsx'
import { sessionScope } from '../../../../services/viewerApi.js'
import { isSafeSessionKey } from '../../../../services/sessionKey.js'
import { useToast } from '../../components/Toast/toastContext.js'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'
import { CHAT_DRAWER_MIN_VIEWPORT } from './viewerLayout.js'

export const NO_CONVERSATION_MESSAGE = 'Abra uma conversa para ver arquivos do projeto.'
export const CONNECTION_MESSAGE = 'Sem conexão com o servidor. Tente de novo.'
const OPEN_FAILED_MESSAGE = 'Não consegui abrir o arquivo.'

// The browser's own wording for a request that never reached the server (fetch rejects with a TypeError
// whose message is English and differs per engine). Everything the user reads must be pt-BR (D-19).
const NETWORK_FAILURE = /^(failed to fetch|networkerror|load failed|network request failed|fetch failed)/i

// Backend messages are pt-BR already ("Arquivo não encontrado: ..."); only the engine's own wording is
// replaced. An empty message gets the fallback.
export function localizeViewerMessage(message, fallback = OPEN_FAILED_MESSAGE) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return fallback
  return NETWORK_FAILURE.test(text) ? CONNECTION_MESSAGE : text
}

// ONE source for the viewport width: the layout rules and the host both read it, so the dock, the drawer
// and the phone flag always agree (a matchMedia `min-width` and `innerWidth` could disagree in a test).
export function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

// What a screen asks of the viewer shell, or null when the shell is absent (an isolated ChatScreen test):
//   openFile(sessionKey, path, { line, relativeTo }) -> Promise<{ ok, error? }>
//   setChatContentVisible(bool)    whether the conversation itself is on screen (a phone shows the list apart)
//   requestPanelFocus()            the next opening of a drawer/fullscreen moves the focus into it (a user gesture)
//   consumePanelFocus() -> bool
const ViewerShellContext = createContext(null)

export function useViewerShell() {
  return useContext(ViewerShellContext)
}

// The viewer's own toast slot (viewerState.toast) becomes a shell toast. A toast id is handled once: React
// runs effects twice in development, and a second push would show the same message twice.
function ViewerToastBridge() {
  const viewer = useViewer()
  const { push } = useToast()
  const handledRef = useRef(new Set())
  const toast = viewer?.toast ?? null
  const dismissToast = viewer?.dismissToast

  useEffect(() => {
    if (!toast || handledRef.current.has(toast.id)) return
    handledRef.current.add(toast.id)
    const error = toast.kind === 'error'
    push({ text: localizeViewerMessage(toast.text), kind: error ? 'error' : 'info' })
    dismissToast?.(toast.id)
  }, [toast, push, dismissToast])

  return null
}

function ShellInner({ activeSessionKey, children }) {
  const actions = useViewerActions()
  const { openChat } = useProjectsSessions()
  const viewportWidth = useViewportWidth()
  const [chatContentVisible, setChatContentVisible] = useState(true)
  const inflightRef = useRef(new Map())
  const focusRequestRef = useRef(false)

  // A key out of the address bar goes into a URL path: a refused key is "no conversation".
  const safeKey = isSafeSessionKey(activeSessionKey) ? activeSessionKey : null
  useViewerHost({
    activeSessionKey: safeKey,
    chatVisible: safeKey !== null && chatContentVisible,
    isMobile: viewportWidth < CHAT_DRAWER_MIN_VIEWPORT,
    onShowSession: openChat,
  })

  const openFile = useCallback(
    (sessionKey, path, { line = null, relativeTo = null } = {}) => {
      if (!isSafeSessionKey(sessionKey)) {
        actions.showToast(NO_CONVERSATION_MESSAGE, 'error')
        return Promise.resolve({ ok: false, error: NO_CONVERSATION_MESSAGE })
      }
      // The same request twice (a double click on a link) is ONE request and one answer.
      const id = JSON.stringify([sessionKey, path, line, relativeTo])
      const pending = inflightRef.current.get(id)
      if (pending) return pending
      const request = actions
        .openByPath(sessionScope(sessionKey), path, { linha: line ?? undefined, relativoA: relativeTo ?? undefined })
        .then((result) => (result.ok ? result : { ok: false, error: localizeViewerMessage(result.error) }))
        .catch((error) => {
          const message = localizeViewerMessage(error?.message)
          actions.showToast(message, 'error')
          return { ok: false, error: message }
        })
        .finally(() => {
          inflightRef.current.delete(id)
        })
      inflightRef.current.set(id, request)
      return request
    },
    [actions],
  )

  const value = useMemo(
    () => ({
      openFile,
      setChatContentVisible,
      requestPanelFocus: () => {
        focusRequestRef.current = true
      },
      consumePanelFocus: () => {
        const wanted = focusRequestRef.current
        focusRequestRef.current = false
        return wanted
      },
    }),
    [openFile],
  )

  return (
    <ViewerShellContext.Provider value={value}>
      <ViewerToastBridge />
      {children}
    </ViewerShellContext.Provider>
  )
}

// The shell of the file viewer: the shared state (tabs per scope, open/fullscreen per surface), the
// toast bridge and what the screens call. It sits inside ChatSessionHost and above <main>, so the tabs,
// the content cache and the open/closed state survive a trip to another screen.
//   activeSessionKey  the conversation on the route (null on any other route)
export default function ViewerShell({ activeSessionKey = null, children }) {
  return (
    <ViewerProvider>
      <ShellInner activeSessionKey={activeSessionKey}>{children}</ShellInner>
    </ViewerProvider>
  )
}
