import { useEffect, useId, useRef, useState } from 'react'
import Button from '../Button/Button.jsx'
import './ApprovalCard.css'

// The four decisions of a permission request (Permitir, Permitir nesta conversa, Negar, Negar e parar)
// and the "Negar" reason box. ONE component for the inline card and for the phone sheet (Designer 10:
// "botões do cartão e da folha são o mesmo componente"): both render this with the same props, so the
// busy/disabled/aria state cannot drift between them. It decides nothing and sends nothing: it only
// calls the callbacks it is given, which already guard against a decision that is out.
//
//   requestId       id of the element that says what is being asked (aria-describedby of every button)
//   allowSession    the server allows a session-wide permission for this request
//   connector       name of the account connector behind the request (it never gets "nesta conversa")
//   sending         a decision is out: the buttons are aria-disabled (still focusable and announced)
//   pendingAction   which button is busy while `sending`: allow | allowSession | deny | denyStop
//   size            Button size (the sheet uses "lg", 52px)
//   onAllow(), onAllowSession(), onDeny(message), onDenyStop()
//   children        extra controls at the end of the row (the card's "Ver detalhes")
export default function ApprovalActions({
  requestId,
  allowSession = false,
  connector = null,
  sending = false,
  pendingAction = null,
  size = 'md',
  onAllow,
  onAllowSession,
  onDeny,
  onDenyStop,
  children = null,
}) {
  const baseId = useId()
  const reasonRef = useRef(null)
  const sessionHintId = `${baseId}-session-hint`
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (denying) reasonRef.current?.focus()
  }, [denying])

  const confirmDeny = () => {
    onDeny?.(reason.trim())
    setDenying(false)
  }

  // Esc inside the reason box only closes the box: it never decides, and it never reaches the panel (which
  // would interrupt the turn) nor the sheet (a <dialog> only skips its own cancel when keydown is prevented).
  const onReasonKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDenying(false)
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      confirmDeny()
    }
  }

  // aria-disabled (not disabled) keeps the button focusable and announced while a decision is out.
  const busyProps = (action) => ({
    'aria-disabled': sending ? 'true' : undefined,
    'aria-busy': sending && pendingAction === action ? 'true' : undefined,
    'aria-describedby': requestId,
  })
  const labelOf = (action, text) => (sending && pendingAction === action ? 'Enviando…' : text)

  if (denying) {
    return (
      <div className="v3-approval__reason">
        <label className="v3-field__label" htmlFor={`${baseId}-reason`}>Motivo (opcional)</label>
        <textarea
          id={`${baseId}-reason`}
          ref={reasonRef}
          className="v3-input v3-approval__reason-input"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={onReasonKey}
        />
        <div className="v3-approval__actions">
          <Button size={size === 'lg' ? 'lg' : 'sm'} onClick={confirmDeny}>Confirmar negação</Button>
          <Button size={size === 'lg' ? 'lg' : 'sm'} variant="text" onClick={() => setDenying(false)}>Cancelar</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="v3-approval__actions">
      <Button variant="primary" size={size} onClick={onAllow} {...busyProps('allow')}>
        {labelOf('allow', 'Permitir')}
      </Button>
      {allowSession && !connector ? (
        <span className="v3-approval__session">
          <Button
            size={size}
            onClick={onAllowSession}
            {...busyProps('allowSession')}
            aria-describedby={`${requestId} ${sessionHintId}`}
          >
            {labelOf('allowSession', 'Permitir nesta conversa')}
          </Button>
          <span id={sessionHintId} className="v3-approval__hint v3-type-caption">
            Vale só até encerrar esta conversa.
          </span>
        </span>
      ) : null}
      <Button size={size} onClick={() => !sending && setDenying(true)} {...busyProps('deny')}>
        {labelOf('deny', 'Negar')}
      </Button>
      <Button size={size} className="v3-approval__danger" onClick={onDenyStop} {...busyProps('denyStop')}>
        {labelOf('denyStop', 'Negar e parar')}
      </Button>
      {children}
    </div>
  )
}
