import { useEffect, useId, useRef, useState } from 'react'
import ApprovalActions from '../../components/ApprovalCard/ApprovalActions.jsx'
import Dialog from '../../components/Dialog/Dialog.jsx'
import { useContinuesBelow } from './useContinuesBelow.js'
import { SHEET_DIALOG_SIZE } from './viewport.js'

// Statuses in which the request still waits for the user. Any other one means it was settled somewhere
// else (another device, expiry, cancel): the sheet has nothing left to offer and closes itself.
const OPEN_STATUSES = new Set(['pending', 'sending', 'error'])

const TABS = [
  { id: 'summary', label: 'Resumo' },
  { id: 'diff', label: 'Diff' },
]

// The approval sheet of a phone (Designer 10): the full request in a bottom sheet (a <dialog>, so the
// browser gives the top layer, the inert background and the focus trap), the same decision buttons as
// the card (ApprovalActions, 52px) at the end, in the footer, always visible.
//
// Closing it (Esc, "Fechar", the scrim) NEVER decides: it only calls onClose. A decision made here is
// handed to the card's own callbacks, which close the sheet and give the focus to the composer.
//   summary        { verb, object }: the same sentence as the card, with the object in full
//   hasDiff        `details` is a diff (Edit/Write): it gets its own "Diff" tab; otherwise the details
//                  (the tool input) sit under the summary and there is no tab bar
//   details        the node the consumer built (diff or input), rendered as text
//   returnFocusTo  where the focus goes when it closes without a decision (the card's summary button)
//   onSettled      the request stopped waiting for the person (decided elsewhere, expired): the sheet closes
//                  by itself and the parent decides where the focus goes (the composer). Falls back to onClose.
// While the command (or the body of the sheet) continues below the visible area, a notice in the footer
// says so; "Permitir" is never locked by it.
export default function ApprovalSheet({
  agentName = 'O agente',
  summary = { verb: 'usar', object: null },
  context = null,
  connector = null,
  allowSession = false,
  details = null,
  hasDiff = false,
  status = 'pending',
  pendingAction = null,
  returnFocusTo = null,
  onClose,
  onSettled,
  onAllow,
  onAllowSession,
  onDeny,
  onDenyStop,
}) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const requestId = `${baseId}-request`
  const [tab, setTab] = useState('summary')
  const verb = summary?.verb ?? 'usar'
  const object = summary?.object ?? null
  const showTabs = hasDiff && Boolean(details)
  const contentRef = useRef(null)
  // The command box scrolls inside the body of the sheet, and the body scrolls too: both can hide the end.
  const continues = useContinuesBelow(
    () => [contentRef.current?.querySelector('.v3-approval-sheet__object'), contentRef.current?.closest('.v3-dialog__body')],
    tab,
  )

  // The Dialog focuses its first [data-autofocus] (or field) in its own effect, which runs before this
  // one (a child effect runs first): the title is where a screen reader should start (Designer 10).
  useEffect(() => {
    const heading = document.getElementById(titleId)
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [titleId])

  useEffect(() => {
    if (OPEN_STATUSES.has(status)) return
    if (onSettled) onSettled()
    else onClose?.()
  }, [status, onClose, onSettled])

  const onTabKeyDown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = tab === 'summary' ? 'diff' : 'summary'
    setTab(next)
    document.getElementById(`${baseId}-tab-${next}`)?.focus()
  }

  return (
    <Dialog
      open
      size={SHEET_DIALOG_SIZE}
      title="Pedido de permissão"
      titleId={titleId}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      footer={(
        <>
          {/* Outside the scrolling body on purpose: next to the decisions, where it cannot be scrolled away. */}
          <p className="v3-approval-sheet__more v3-type-caption" role="status">
            {continues ? 'O pedido continua. Role para ver tudo.' : ''}
          </p>
          <ApprovalActions
            requestId={requestId}
            allowSession={allowSession}
            connector={connector}
            sending={status === 'sending'}
            pendingAction={pendingAction}
            size="lg"
            onAllow={onAllow}
            onAllowSession={onAllowSession}
            onDeny={onDeny}
            onDenyStop={onDenyStop}
            />
        </>
      )}
    >
      <div ref={contentRef} className="v3-approval-sheet">
        {/* The first thing read when the sheet opens: who asks and what. */}
        <p id={requestId} className="v3-approval-sheet__request">
          <b>{agentName}</b> quer {verb}
          {context ? <span className="v3-approval-sheet__context v3-type-mono-sm">{context}</span> : null}
        </p>

        {showTabs ? (
          <div className="v3-approval-sheet__tabs" role="tablist" aria-label="Detalhes do pedido" onKeyDown={onTabKeyDown}>
            {TABS.map((item) => (
              <button
                key={item.id}
                id={`${baseId}-tab-${item.id}`}
                type="button"
                role="tab"
                className="v3-approval-sheet__tab"
                aria-selected={tab === item.id}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {!showTabs || tab === 'summary' ? (
          <div id={`${baseId}-panel-summary`} role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? `${baseId}-tab-summary` : undefined} className="v3-approval-sheet__panel">
            {object ? <code className="v3-approval-sheet__object v3-type-mono-sm">{object}</code> : null}
            {connector ? <p className="v3-approval__connector v3-type-caption">Conector da sua conta: {connector}</p> : null}
            {!hasDiff && details ? <div className="v3-approval__details v3-approval-sheet__details">{details}</div> : null}
          </div>
        ) : (
          <div id={`${baseId}-panel-diff`} role="tabpanel" aria-labelledby={`${baseId}-tab-diff`} className="v3-approval-sheet__panel">
            <div className="v3-approval__details v3-approval-sheet__details">{details}</div>
          </div>
        )}

        {status === 'error' ? (
          <p className="v3-approval__error v3-type-body-sm" role="alert">
            Não foi possível enviar sua decisão. Tente de novo.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
