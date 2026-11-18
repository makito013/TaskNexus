import { useCallback, useEffect, useRef, useState } from 'react'
import ApprovalCard from '../../components/ApprovalCard/ApprovalCard.jsx'
import { summarizeTool } from '../../../../utils/toolSummaries.js'
import ApprovalSheet from './ApprovalSheet.jsx'
import { cardStatus } from './chatLabels.js'
import PlanCard from './cards/PlanCard.jsx'
import QuestionCard from './cards/QuestionCard.jsx'

// Binds one permission card of the chat state to the card that shows it: a question and a plan have
// their own cards; every other request is the generic ApprovalCard, whose sentence and details are
// built from the tool input (as text) and whose buttons become decisions for useChatSession.decide().
function DiffView({ diff }) {
  return (
    <div className="v3-chat-diff" role="group" aria-label="Alterações propostas">
      {diff.lines.map((line, index) => (
        <div key={index} className={`v3-chat-diff__line v3-chat-diff__line--${line.type} v3-type-mono-sm`}>
          <span className="v3-chat-diff__sign" aria-hidden="true">{line.type === 'add' ? '+' : '−'}</span>
          <span className="v3-chat-sr-only">{line.type === 'add' ? 'adicionada: ' : 'removida: '}</span>
          <span className="v3-chat-diff__text">{line.text}</span>
        </div>
      ))}
      {diff.truncated ? <p className="v3-type-caption v3-chat-diff__note">Mostrando só o começo das alterações.</p> : null}
    </div>
  )
}

function TextBlock({ children }) {
  return <pre className="v3-chat-details v3-type-mono-sm">{children}</pre>
}

function toolDetails(summary, card) {
  if (summary.diff) return <DiffView diff={summary.diff} />
  // A shell command and a file path are already on the card; anything else shows its input.
  if (summary.command || summary.file) return null
  if (card.input == null && !summary.detail) return null
  return <TextBlock>{summary.detail}</TextBlock>
}

// `phone`: the summary of a generic request becomes a button that opens the approval sheet and the
// decisions are 52px (Designer 10). The question and plan cards stay inline on every width.
export default function PermissionCard({ card, agentName, context, decision, onDecide, focusAfterDecision, phone = false }) {
  const status = cardStatus(card, decision)
  if (card.kind === 'question') {
    return (
      <QuestionCard
        card={card}
        agentName={agentName}
        status={status}
        answered={decision?.answers ?? null}
        onDecide={onDecide}
        focusAfterDecision={focusAfterDecision}
      />
    )
  }
  if (card.kind === 'plan') {
    return (
      <PlanCard
        card={card}
        agentName={agentName}
        status={status}
        note={decision?.note ?? null}
        onDecide={onDecide}
        focusAfterDecision={focusAfterDecision}
      />
    )
  }
  return (
    <ToolPermission
      card={card}
      agentName={agentName}
      context={context}
      status={status}
      decision={decision}
      onDecide={onDecide}
      focusAfterDecision={focusAfterDecision}
      phone={phone}
    />
  )
}

// A request to use a tool: the ApprovalCard, plus (on a phone) the sheet that shows it in full. The
// card and the sheet get the same status and the same decision callbacks; a decision taken in the sheet
// closes it and hands the focus to the composer, a sheet closed without one decides nothing.
function ToolPermission({ card, agentName, context, status, decision, onDecide, focusAfterDecision, phone }) {
  const summaryRef = useRef(null)
  const focusPendingRef = useRef(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const summary = summarizeTool(card.toolName, card.input)
  const details = toolDetails(summary, card)
  const connector = card.connector ?? summary.connector ?? null
  const sheetOnPhone = phone && sheetOpen

  // The sheet closes with a decision: the focus goes to the composer once the dialog has handed it back
  // (its own cleanup returns the focus to the summary button first, so this runs after it). `sheetOpen` is
  // a dependency too: a sheet that stops being a phone surface closes in two steps (phone, then the state).
  useEffect(() => {
    if (sheetOnPhone || !focusPendingRef.current) return
    focusPendingRef.current = false
    focusAfterDecision?.()
  }, [sheetOnPhone, sheetOpen, focusAfterDecision])

  const closeSheet = useCallback(() => setSheetOpen(false), [])
  // The sheet closing WITHOUT the person doing anything (the request was settled on another device, it
  // expired, the device rotated past 767): the focus would fall on <body>, so it goes to the composer
  // like after a decision. Esc / "Fechar" / the scrim are the person's own act and go through closeSheet,
  // which returns the focus to the summary button.
  const settleSheet = useCallback(() => {
    focusPendingRef.current = true
    setSheetOpen(false)
  }, [])
  // Rotating a tablet past 767px: the sheet is a phone-only surface, it must not reopen on the way back.
  useEffect(() => {
    if (!phone && sheetOpen) settleSheet()
  }, [phone, sheetOpen, settleSheet])
  const decideFromSheet = (payload) => {
    if (status === 'sending') return
    focusPendingRef.current = true
    setSheetOpen(false)
    onDecide(card, payload)
  }

  return (
    <>
      <ApprovalCard
        agentName={agentName}
        summary={summary.request}
        context={context}
        connector={connector}
        allowSession={card.allowSession}
        details={details}
        label="Pedido de permissão"
        status={status}
        pendingAction={decision?.kind ?? null}
        denyMessage={card.message}
        onOpenSummary={phone ? () => setSheetOpen(true) : null}
        summaryRef={summaryRef}
        buttonSize={phone ? 'lg' : 'md'}
        onAllow={() => onDecide(card, { behavior: 'allow' })}
        onAllowSession={() => onDecide(card, { behavior: 'allow', scope: 'session' })}
        onDeny={(message) => onDecide(card, { behavior: 'deny', message: message || undefined })}
        onDenyStop={() => onDecide(card, { behavior: 'deny', interrupt: true })}
        focusAfterDecision={focusAfterDecision}
      />
      {sheetOnPhone ? (
        <ApprovalSheet
          agentName={agentName}
          summary={summary.request}
          context={context}
          connector={connector}
          allowSession={card.allowSession}
          details={details}
          hasDiff={Boolean(summary.diff)}
          status={status}
          pendingAction={decision?.kind ?? null}
          returnFocusTo={summaryRef}
          onClose={closeSheet}
          onSettled={settleSheet}
          onAllow={() => decideFromSheet({ behavior: 'allow' })}
          onAllowSession={() => decideFromSheet({ behavior: 'allow', scope: 'session' })}
          onDeny={(message) => decideFromSheet({ behavior: 'deny', message: message || undefined })}
          onDenyStop={() => decideFromSheet({ behavior: 'deny', interrupt: true })}
        />
      ) : null}
    </>
  )
}
