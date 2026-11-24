import { useId, useRef, useState } from 'react'
import ApprovalActions from './ApprovalActions.jsx'
import { INVISIBLE_CHARS_NOTICE, hasInvisibleChars, markInvisibleChars } from '../../../../utils/visibleControlChars.js'
import './ApprovalCard.css'

// "Esperando você" card (DS ApprovalCard + Designer 5.1). It executes nothing: it only calls the
// callbacks. The consumer owns the decision and tells the card how it stands through `status`.
//
//   agentName      who asks ("Claude")
//   summary        { verb, object }: "{agentName} quer {verb} {object}"; `object` (a command, a path)
//                  is shown in full (3 lines, then "Ver comando completo")
//   context        short text at the right of the first line (folder, project)
//   connector      name of the account connector behind the request, or null
//   allowSession   the server allows a session-wide permission for this request (never for a connector)
//   details        content of "Ver detalhes" (diff, input), rendered by the consumer as text
//   status         pending | sending | error | allowed | allowed_session | denied | denied_stop
//                  | elsewhere | expired | cancelled
//   pendingAction  which button is busy while status is "sending": allow | allowSession | deny | denyStop
//   denyMessage    the reason the user gave, shown on a denied card
//   label          aria-label of the group ("Pedido de permissão", "Pergunta do agente"...)
//   onOpenSummary  phone: when given, the summary (who asks + what) is ONE button of its own that calls
//                  it (the screen opens the approval sheet); the decision buttons stay beside it, never
//                  inside it. Without it (desktop, tablet) the summary is plain text, as before.
//   summaryRef     ref of that button (the sheet gives the focus back to it)
//   buttonSize     Button size of the decisions ("lg" = 52px on a phone)
//   onAllow(), onAllowSession(), onDeny(message), onDenyStop()
//   focusAfterDecision()  called when a decision is sent from inside the card, so the focus does
//                  not stay on a button that is about to disappear (the consumer focuses the composer)
//
// Esc never decides: inside the reason box it only closes the box.
const LONG_LINES = 3
const LONG_CHARS = 200
const SUMMARY_MAX = 80

const RESOLVED_TEXT = {
  allowed: 'Você permitiu',
  allowed_session: 'Você permitiu nesta conversa',
  denied: 'Você negou',
  denied_stop: 'Você negou e parou o turno',
  elsewhere: 'Decidido em outro dispositivo.',
  expired: 'Expirou ao reabrir a conversa.',
  cancelled: 'Pedido cancelado.',
}
const DECIDED_HERE = new Set(['allowed', 'allowed_session', 'denied', 'denied_stop'])

function oneLine(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function isLong(text) {
  return text.split('\n').length > LONG_LINES || text.length > LONG_CHARS
}

export default function ApprovalCard({
  agentName = 'O agente',
  summary = { verb: 'usar', object: null },
  context = null,
  connector = null,
  allowSession = false,
  details = null,
  status = 'pending',
  pendingAction = null,
  denyMessage = null,
  label = 'Pedido de permissão',
  onOpenSummary = null,
  summaryRef = null,
  buttonSize = 'md',
  onAllow,
  onAllowSession,
  onDeny,
  onDenyStop,
  focusAfterDecision,
}) {
  const rootRef = useRef(null)
  const baseId = useId()
  const requestId = `${baseId}-request`
  const detailsId = `${baseId}-details`
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [fullOpen, setFullOpen] = useState(false)

  const verb = summary?.verb ?? 'usar'
  const rawObject = summary?.object ?? null
  // What decides the request is shown with the invisible and reordering characters made visible (stage 10, Y1).
  const object = rawObject ? markInvisibleChars(rawObject) : null
  const shortSummary = oneLine(object ? `${verb} ${object}` : verb, SUMMARY_MAX)
  const resolved = status in RESOLVED_TEXT

  if (resolved) {
    const elsewhere = status === 'elsewhere'
    const classes = ['v3-approval', 'v3-approval--resolved', elsewhere ? 'v3-approval--elsewhere' : ''].filter(Boolean).join(' ')
    return (
      <div className={classes} role="status" data-status={status}>
        <span className="v3-approval__dot v3-approval__dot--quiet" aria-hidden="true" />
        <div className="v3-approval__resolved-text">
          <span>
            <span>{RESOLVED_TEXT[status]}</span>
            <span className="v3-approval__resolved-summary">
              {DECIDED_HERE.has(status) ? ` · ${shortSummary}` : ` ${shortSummary}`}
            </span>
          </span>
          {status.startsWith('denied') && denyMessage ? (
            <span className="v3-approval__reason-line">Motivo: {denyMessage}</span>
          ) : null}
        </div>
      </div>
    )
  }

  const sending = status === 'sending'
  const objectText = object ?? ''
  const long = isLong(objectText)

  // A decision sent from inside the card releases the focus first (see focusAfterDecision).
  const decide = (callback, ...args) => {
    if (sending || typeof callback !== 'function') return
    const hadFocus = rootRef.current?.contains(document.activeElement)
    callback(...args)
    if (hadFocus) focusAfterDecision?.()
  }

  const phoneSummary = typeof onOpenSummary === 'function'
  const objectNode = object ? (
    <span
      className={`v3-approval__object v3-type-mono-sm${(long && !fullOpen) || phoneSummary ? ' v3-approval__object--clamped' : ''}`}
    >
      <code className="v3-approval__object-text">{objectText}</code>
    </span>
  ) : null

  return (
    <div ref={rootRef} className="v3-approval" role="group" aria-label={label} data-status={status}>
      {phoneSummary ? (
        <button
          ref={summaryRef}
          type="button"
          className="v3-approval__summary"
          aria-haspopup="dialog"
          aria-label={`Ver pedido completo: ${agentName} quer ${shortSummary}`}
          onClick={onOpenSummary}
        >
          <span className="v3-approval__head">
            <span className="v3-approval__dot" aria-hidden="true" />
            <b className="v3-approval__who">{agentName}</b>
            <span className="v3-approval__quer">quer {verb}</span>
            {context ? <span className="v3-approval__context v3-type-mono-sm">{context}</span> : null}
          </span>
          {objectNode}
          <span className="v3-approval__summary-more v3-type-caption">Ver pedido completo</span>
        </button>
      ) : (
        <div className="v3-approval__head">
          <span className="v3-approval__dot" aria-hidden="true" />
          <b className="v3-approval__who">{agentName}</b>
          <span className="v3-approval__quer">quer {verb}</span>
          {context ? <span className="v3-approval__context v3-type-mono-sm">{context}</span> : null}
        </div>
      )}
      <span id={requestId} className="v3-approval__sr-only">
        {agentName} quer {shortSummary}
      </span>

      {phoneSummary ? null : objectNode}
      {hasInvisibleChars(rawObject) ? (
        <p className="v3-approval__connector v3-type-caption" role="note">{INVISIBLE_CHARS_NOTICE}</p>
      ) : null}
      {connector ? (
        <p className="v3-approval__connector v3-type-caption">Conector da sua conta: {connector}</p>
      ) : null}

      {long && !phoneSummary ? (
        <button
          type="button"
          className="v3-approval__text-button"
          aria-expanded={fullOpen}
          onClick={() => setFullOpen((open) => !open)}
        >
          {fullOpen ? 'Ocultar comando completo' : 'Ver comando completo'}
        </button>
      ) : null}

      <ApprovalActions
        requestId={requestId}
        allowSession={allowSession}
        connector={connector}
        sending={sending}
        pendingAction={pendingAction}
        size={buttonSize}
        onAllow={() => decide(onAllow)}
        onAllowSession={() => decide(onAllowSession)}
        onDeny={(message) => decide(onDeny, message)}
        onDenyStop={() => decide(onDenyStop)}
      >
        {details && !phoneSummary ? (
          <button
            type="button"
            className="v3-approval__text-button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
          </button>
        ) : null}
      </ApprovalActions>

      {status === 'error' ? (
        <p className="v3-approval__error v3-type-body-sm" role="alert">
          Não foi possível enviar sua decisão. Tente de novo.
        </p>
      ) : null}

      {details && detailsOpen && !phoneSummary ? (
        <div id={detailsId} className="v3-approval__details">{details}</div>
      ) : null}
    </div>
  )
}
