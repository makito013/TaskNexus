import ApprovalCard from '../../components/ApprovalCard/ApprovalCard.jsx'
import { summarizeTool } from '../../../../utils/toolSummaries.js'
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

export default function PermissionCard({ card, agentName, context, decision, onDecide, focusAfterDecision }) {
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
  const summary = summarizeTool(card.toolName, card.input)
  return (
    <ApprovalCard
      agentName={agentName}
      summary={summary.request}
      context={context}
      connector={card.connector ?? summary.connector ?? null}
      allowSession={card.allowSession}
      details={toolDetails(summary, card)}
      label="Pedido de permissão"
      status={status}
      pendingAction={decision?.kind ?? null}
      denyMessage={card.message}
      onAllow={() => onDecide(card, { behavior: 'allow' })}
      onAllowSession={() => onDecide(card, { behavior: 'allow', scope: 'session' })}
      onDeny={(message) => onDecide(card, { behavior: 'deny', message: message || undefined })}
      onDenyStop={() => onDecide(card, { behavior: 'deny', interrupt: true })}
      focusAfterDecision={focusAfterDecision}
    />
  )
}
