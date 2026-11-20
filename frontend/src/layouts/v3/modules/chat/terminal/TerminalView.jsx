import { useCallback, useRef, useState } from 'react'
import Button from '../../../components/Button/Button.jsx'
import TerminalFrame from './TerminalFrame.jsx'
import TerminalKeysBar from './TerminalKeysBar.jsx'
import './TerminalView.css'

// Tab, Shift+Tab and Esc belong to the program in the PTY (Shift+Tab is Claude Code's own mode switch), so the way
// out for the keyboard is F6 (the browsers' "switch pane" key), handled by TerminalFrame.
const SHORTCUT_HINT = 'F6 sai do terminal'
const EXIT_ATTRIBUTE = 'data-terminal-exit'
const ROLE = { danger: 'alert', fin: 'status', tiq: 'note' }

// A banner over the terminal, in the anatomy of the chat banners (same classes, ChatScreen.css).
function Strip({ tone, title, children, actions = null, detail = null, id, info = false }) {
  return (
    <div id={id} className={`v3-chat-banner v3-chat-banner--${tone} v3-term__strip${info ? ' v3-term__strip--info' : ''}`} role={ROLE[tone]}>
      <span className="v3-chat-banner__dot" aria-hidden="true" />
      <div className="v3-chat-banner__body">
        <p className="v3-chat-banner__text v3-type-body-sm">
          {title ? <b className="v3-chat-banner__title v3-term__strip-title">{title}</b> : null}
          {children}
        </p>
        {detail ? (
          <details className="v3-chat-banner__detail">
            <summary>Detalhe técnico</summary>
            <pre className="v3-type-mono-sm">{detail}</pre>
          </details>
        ) : null}
      </div>
      {actions ? <div className="v3-chat-banner__actions">{actions}</div> : null}
    </div>
  )
}

// The terminal view of the chat route (Designer 11.1): what a conversation that is NOT a chat looks like (codex,
// agy, the plain terminal) and a claude conversation that was sent to the terminal ("Abrir no terminal").
// Over the frame, in this order: the info strip (with "Sair do terminal", a button that is a tab stop BEFORE the
// frame so the keyboard always has a way out), then the state strip when there is one. Under it, on a phone, the
// key bar.
//   kind            'shell' (codex / agy / terminal) | 'claude' (a chat conversation opened in the terminal)
//   onOpenChat()    claude only: "Abrir no chat" (the screen opens the R-AV dialog)
//   onExit()        "Sair do terminal": gets the focus out of the terminal, to the chat list
//   phone           shows the key bar
// The states of the Designer 11.1 that live here: conectando / conectado / reconectando (the bar of the frame),
// encerrado (the session was opened somewhere else: "Reabrir"), erro and agente ausente ("Tentar de novo"). Both
// retries remount the frame by `key`: the hook's closeSocket only reconnects, and a remount is a clean attach.
export default function TerminalView({ sessionKey, agentName, folderLabel = '', kind = 'shell', phone = false, onOpenChat, onExit }) {
  const frameRef = useRef(null)
  const notesRef = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('connecting')
  const [failure, setFailure] = useState(null) // null | { kind: 'spawn_failed', detail } | { kind: 'resume_failed' }
  const [ctrlArmed, setCtrlArmed] = useState(false)

  // A fresh connection either gets a working PTY or a new failure frame, so a failure of the previous one is stale
  // the moment the socket opens (same rule as the V2 panel).
  const handleStatus = useCallback((next) => {
    setStatus(next)
    if (next === 'open') setFailure(null)
  }, [])
  const handleControlFrame = useCallback((frame) => {
    if (frame.type === 'spawn_failed') setFailure({ kind: 'spawn_failed', detail: frame.detail || null })
    else if (frame.type === 'resume_failed') setFailure({ kind: 'resume_failed', detail: null })
  }, [])
  const handleCtrlConsumed = useCallback(() => setCtrlArmed(false), [])

  const remount = () => {
    setStatus('connecting')
    setFailure(null)
    setCtrlArmed(false)
    setAttempt((count) => count + 1)
  }
  // F6 typed in the terminal: the focus goes to "Sair do terminal" (the strip is a tab stop before the frame).
  const focusExit = useCallback(() => {
    notesRef.current?.querySelector(`[${EXIT_ATTRIBUTE}]`)?.focus()
  }, [])
  const toggleCtrl = () => {
    const next = !ctrlArmed
    setCtrlArmed(next)
    frameRef.current?.setCtrlArmed(next)
  }

  // What the state strip says (null: nothing to say). The same button serves both: it remounts the frame.
  let state = null
  if (failure?.kind === 'spawn_failed') {
    state = { tone: 'danger', title: `O ${agentName} não está instalado neste computador.`, detail: failure.detail, retry: 'Tentar de novo' }
  } else if (failure?.kind === 'resume_failed') {
    state = { tone: 'danger', title: 'Não foi possível abrir o terminal.', retry: 'Tentar de novo' }
  } else if (status === 'evicted') {
    state = { tone: 'fin', title: 'Sessão encerrada.', text: ' Ela foi aberta em outra aba ou dispositivo.', retry: 'Reabrir' }
  }

  // An agent that is itself called "terminal" would read "O terminal roda em terminal".
  const isPlainTerminal = agentName.trim().toLowerCase() === 'terminal'

  return (
    <div className="v3-term" data-kind={kind}>
      <div className="v3-term__notes" ref={notesRef}>
        <Strip
          tone="tiq"
          info
          actions={(
            <>
              {kind === 'claude' ? <Button onClick={onOpenChat}>Abrir no chat</Button> : null}
              <Button onClick={onExit} title={SHORTCUT_HINT} aria-keyshortcuts="F6" {...{ [EXIT_ATTRIBUTE]: 'true' }}>
                Sair do terminal
              </Button>
            </>
          )}
        >
          {kind === 'claude' ? (
            'Esta conversa está no terminal. O chat fica fechado enquanto o terminal estiver aberto.'
          ) : (
            <>
              <b className="v3-term__strip-title">Visão de terminal.</b>
              {' '}{isPlainTerminal ? 'O terminal' : `O ${agentName} roda em terminal e`} não tem conversa em bolhas, cartões nem comandos / do chat.
            </>
          )}
        </Strip>
        {state ? (
          <Strip
            id="terminal-state"
            tone={state.tone}
            title={state.title}
            detail={state.detail}
            actions={<Button onClick={remount}>{state.retry}</Button>}
          >
            {state.text}
          </Strip>
        ) : null}
      </div>
      <TerminalFrame
        key={attempt}
        ref={frameRef}
        sessionKey={sessionKey}
        agentName={agentName}
        folderLabel={folderLabel}
        failed={Boolean(failure)}
        onLeave={focusExit}
        onStatusChange={handleStatus}
        onControlFrame={handleControlFrame}
        onCtrlConsumed={handleCtrlConsumed}
      />
      {phone ? (
        <TerminalKeysBar
          onSend={(bytes) => frameRef.current?.sendControlByte(bytes)}
          ctrlArmed={ctrlArmed}
          onToggleCtrl={toggleCtrl}
        />
      ) : null}
    </div>
  )
}
