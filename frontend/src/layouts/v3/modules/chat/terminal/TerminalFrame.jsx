import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { encodePtySessionKey } from '../../../../../services/sessionKey.js'
import { useTerminalSurface } from '../../../../../terminal/useTerminalSurface.js'
import { FONTS_READY_TIMEOUT_MS } from '../../../../../terminal/xtermDefaults.js'
import { createFilePathLinkProvider, openWebLink } from '../../../../../utils/filePathLinks.js'
import { parseSessionKey } from '../../projects/agentBoard.js'
import { useViewerShell } from '../../viewer/ViewerShell.jsx'
import { TERMINAL_FONT_SIZE, readTerminalOptions, useTerminalTheme } from './terminalTheme.js'

// The terminal of the chat route (Designer 11.1): a dark frame (`--v3-island` in both themes) with a 40 px bar
// (status dot, "agent · project", "cols×rows") over the xterm surface that `useTerminalSurface` (src/terminal,
// the core the V2 panel composes too) drives. This component only composes the hook; it owns no xterm call.
//
// Hook contract it honours (see the header of useTerminalSurface.js):
//   - the surface <div> has ZERO padding of its own; the padding is on the wrapper (`.v3-term__body`);
//   - `fit()` runs only after the fonts are ready: the surface is MOUNTED only then (the hook fits right after
//     `term.open()`, so a deferred `visible` would not do), with "Conectando ao terminal…" shown meanwhile;
//   - `theme` has a stable identity (useTerminalTheme) and a theme switch repaints the live terminal;
//   - the wrapper has NO `transition` of width, height or padding (nor any ancestor in TerminalView.css): a transition
//     would make fit() measure a size that is still moving;
//   - Reabrir / Tentar de novo remount this component by `key` (the hook's closeSocket only reconnects).
//
// The socket URL is the V2's, unencoded: `/ws/pty/<session_key>`, the project and agent travel in the `init` frame.
//
// Ref: { sendControlByte(bytes), setCtrlArmed(boolean), focus() }, for the phone key bar.
//   sessionKey, agentName, folderLabel
//   onStatusChange(status)   connecting | open | reconnecting | evicted
//   onControlFrame(frame)    spawn_failed | resume_failed | viewer_open (the view decides what each means)
//   onCtrlConsumed()         the armed Ctrl was spent on a key typed in the terminal
//   onLeave()                F6 / Shift+F6 typed in the terminal (the keyboard way out: Tab, Shift+Tab and Esc belong
//                            to the program in the PTY)
//   failed                   the view has a failure strip for this attempt: the bar must not say "Conectado"
//
// Links in the terminal: a file path (`docs/plano.md`, `src/app.py:42`) is underlined and opens in the viewer of this
// conversation (only while the viewer shell exists), and a web link opens in a new tab WITHOUT `opener`
// (openWebLink, always). Both are mount-time options of the hook: the providers live in a `useState` (one identity,
// the terminal is never rebuilt for them) and read the shell and the key through refs.

const STATUS_TEXT = {
  connecting: 'Conectando ao terminal…',
  open: 'Conectado',
  reconnecting: 'Reconectando…',
  evicted: 'Encerrado',
}
const FAILED_TEXT = 'Não abriu'

// Waits for the monospace face the terminal will measure with (`document.fonts.load`) and for whatever
// else is loading (`fonts.ready`), bounded by the same timeout the hook uses: a browser where it never
// resolves must not block the terminal. Without the Font Loading API there is nothing to wait for.
export function useFontsReady() {
  const [ready, setReady] = useState(() => typeof document === 'undefined' || !document.fonts?.ready)
  useEffect(() => {
    if (ready) return undefined
    let cancelled = false
    let timer = null
    const loaded = Promise.all([
      document.fonts.load?.(`${TERMINAL_FONT_SIZE}px ${readTerminalOptions().fontFamily}`)?.catch(() => []),
      document.fonts.ready,
    ])
    const bound = new Promise((resolve) => {
      timer = setTimeout(resolve, FONTS_READY_TIMEOUT_MS)
    })
    Promise.race([loaded, bound]).then(() => {
      clearTimeout(timer)
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ready])
  return ready
}

// Ctrl+<key> as the byte a terminal expects, or null when the key has no control byte.
export function controlByteFor(key) {
  if (typeof key !== 'string' || key.length !== 1) return null
  const code = key.toUpperCase().charCodeAt(0)
  if (code >= 0x40 && code <= 0x5f) return code - 0x40 // @ A-Z [ \ ] ^ _
  if (key === ' ') return 0
  return null
}

const TerminalSurface = forwardRef(function TerminalSurface({ sessionKey, onStatus, onControlFrame, onSize, onCtrlConsumed, onLeave }, ref) {
  const containerRef = useRef(null)
  const ctrlArmedRef = useRef(false)
  const consumedRef = useRef(onCtrlConsumed)
  consumedRef.current = onCtrlConsumed
  const leaveRef = useRef(onLeave)
  leaveRef.current = onLeave
  // The key whose keydown already went out as a control byte: the browser may still raise `keypress` for it, and
  // xterm would type the character after the byte (Ctrl+L cleared the screen and left an "l").
  const spentKeyRef = useRef(null)
  const theme = useTerminalTheme()
  const [terminalOptions] = useState(() => readTerminalOptions())
  const viewerShell = useViewerShell()
  const viewerShellRef = useRef(viewerShell)
  viewerShellRef.current = viewerShell
  const sessionKeyRef = useRef(sessionKey)
  sessionKeyRef.current = sessionKey
  const [linkProviders] = useState(() => [
    (term) => createFilePathLinkProvider(
      term,
      (path, line) => {
        viewerShellRef.current?.openFile(sessionKeyRef.current, path, { line })
      },
      () => Boolean(viewerShellRef.current),
    ),
  ])
  const { projectKey, agentId } = parseSessionKey(sessionKey)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const { status, sendControlByte, focus, termRef } = useTerminalSurface({
    containerRef,
    wsUrl: `${protocol}//${window.location.host}/ws/pty/${encodePtySessionKey(sessionKey)}`,
    projectId: projectKey,
    agentId,
    visible: true,
    theme,
    terminalOptions,
    linkProviders,
    onOpenLink: openWebLink,
    onControlFrame,
    onStatusChange: onStatus,
  })

  useImperativeHandle(ref, () => ({
    sendControlByte,
    focus,
    setCtrlArmed: (armed) => {
      ctrlArmedRef.current = Boolean(armed)
    },
  }), [sendControlByte, focus])

  // The size in the bar: read once the terminal exists, then on every resize (fit() or the window).
  useEffect(() => {
    const term = termRef.current
    if (!term) return undefined
    onSize?.({ cols: term.cols, rows: term.rows })
    const subscription = term.onResize?.(({ cols, rows }) => onSize?.({ cols, rows }))
    return () => subscription?.dispose?.()
  }, [status, termRef, onSize])

  // Keyboard handling ahead of xterm (returning false keeps xterm from sending the key to the PTY):
  //   - F6 / Shift+F6 move the focus out of the terminal (to "Sair do terminal"): a keyboard-only user would
  //     otherwise be trapped, because Tab, Shift+Tab and Esc are the program's;
  //   - "Ctrl" of the phone key bar is a sticky modifier: the next single-character key typed in the terminal goes
  //     out as its control byte (Ctrl+D = 0x04) instead of the character. A key with no control byte passes
  //     through and leaves Ctrl armed. The keydown is cancelled and its keypress swallowed, or the browser's own
  //     character would follow the byte.
  useEffect(() => {
    const term = termRef.current
    if (typeof term?.attachCustomKeyEventHandler !== 'function') return
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'F6' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown') {
          event.preventDefault?.()
          leaveRef.current?.()
        }
        return false
      }
      if (event.type === 'keyup') {
        spentKeyRef.current = null
        return true
      }
      if (event.type === 'keypress' && spentKeyRef.current !== null) {
        event.preventDefault?.()
        return false
      }
      if (!ctrlArmedRef.current || event.type !== 'keydown') return true
      const byte = controlByteFor(event.key)
      if (byte === null) return true
      ctrlArmedRef.current = false
      spentKeyRef.current = event.key
      consumedRef.current?.()
      event.preventDefault?.()
      sendControlByte(new Uint8Array([byte]))
      return false
    })
  }, [status, termRef, sendControlByte])

  return <div ref={containerRef} className="v3-term__surface" />
})

const TerminalFrame = forwardRef(function TerminalFrame(
  { sessionKey, agentName, folderLabel = '', failed = false, onStatusChange, onControlFrame, onCtrlConsumed, onLeave },
  ref,
) {
  const fontsReady = useFontsReady()
  const surfaceRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [size, setSize] = useState(null)

  useImperativeHandle(ref, () => ({
    sendControlByte: (bytes) => surfaceRef.current?.sendControlByte(bytes),
    focus: () => surfaceRef.current?.focus(),
    setCtrlArmed: (armed) => surfaceRef.current?.setCtrlArmed(armed),
  }), [])

  const handleStatus = useCallback((next) => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])

  const busy = !failed && (!fontsReady || status === 'connecting')
  // A failure strip (agent missing, resume failed) wins over the socket state: the socket is open, the program is not.
  const statusText = failed ? FAILED_TEXT : fontsReady ? STATUS_TEXT[status] ?? '' : STATUS_TEXT.connecting
  const dot = failed ? 'failed' : busy ? 'connecting' : status
  const label = [agentName, folderLabel].filter(Boolean).join(' · ')

  return (
    <div
      className="v3-term__frame"
      role="group"
      aria-label={`Terminal de ${agentName}`}
      aria-busy={busy ? 'true' : undefined}
      data-status={status}
    >
      <div className="v3-term__bar">
        <span className={`v3-term__dot v3-term__dot--${dot}`} aria-hidden="true" />
        <span className="v3-term__status" role="status">{statusText}</span>
        <span className="v3-term__name">{label}</span>
        {size ? <span className="v3-term__size">{size.cols}×{size.rows}</span> : null}
      </div>
      <div className="v3-term__body">
        {fontsReady ? (
          <TerminalSurface
            ref={surfaceRef}
            sessionKey={sessionKey}
            onStatus={handleStatus}
            onControlFrame={onControlFrame}
            onSize={setSize}
            onCtrlConsumed={onCtrlConsumed}
            onLeave={onLeave}
          />
        ) : null}
      </div>
    </div>
  )
})

export default TerminalFrame
