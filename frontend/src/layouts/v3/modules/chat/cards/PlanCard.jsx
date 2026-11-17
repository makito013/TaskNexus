import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../../components/Button/Button.jsx'
import MarkdownBody from '../MarkdownBody.jsx'
import { CardHead, ResolvedRow, SHARED_RESOLVED } from './CardParts.jsx'

// "{Agente} propõe um plano" (Designer 5.3): the ExitPlanMode of the agent. The plan is markdown, shown
// through the same safe path as the agent's messages (MarkdownBody: marked + DOMPurify, .v3-prose).
// Raw HTML in it is shown as TEXT (turned into text from the lexer tokens, see chatMarkdown.js), never as markup. "Aprovar plano"
// allows; "Continuar planejando" denies, with the optional "O que mudar?" as the message (G0.10 proved
// the model then revises the plan). Without a comment a neutral message tells the model not to start
// implementing. Esc closes the comment box and never decides.
//
//   card, status, onDecide(card, choice), focusAfterDecision()   as in QuestionCard
//   note                 the comment this client typed (shown back on the resolved line), or null

export const KEEP_PLANNING_MESSAGE = 'The user wants to keep planning. Revise the plan and do not start implementing.'

export default function PlanCard({ card, agentName, status, note = null, onDecide, focusAfterDecision }) {
  const rootRef = useRef(null)
  const noteRef = useRef(null)
  const baseId = useId()
  const [revising, setRevising] = useState(false)
  const [comment, setComment] = useState('')
  const [expanded, setExpanded] = useState(false)
  const plan = typeof card.input?.plan === 'string' ? card.input.plan : ''

  useEffect(() => {
    if (revising) noteRef.current?.focus()
  }, [revising])

  if (status === 'allowed' || status === 'allowed_session') return <ResolvedRow status={status}>Você aprovou o plano.</ResolvedRow>
  if (status === 'denied' || status === 'denied_stop') {
    return (
      <ResolvedRow status={status} extra={note ? `Comentário: ${note}` : null}>
        Você pediu para continuar planejando.
      </ResolvedRow>
    )
  }
  if (SHARED_RESOLVED[status]) return <ResolvedRow status={status}>{SHARED_RESOLVED[status]}</ResolvedRow>

  const sending = status === 'sending'
  const release = () => {
    if (rootRef.current?.contains(document.activeElement)) focusAfterDecision?.()
  }
  const approve = () => {
    if (sending) return
    onDecide(card, { behavior: 'allow' })
    release()
  }
  const keepPlanning = () => {
    if (sending) return
    const typed = comment.trim()
    onDecide(card, { behavior: 'deny', message: typed || KEEP_PLANNING_MESSAGE, note: typed || undefined })
    setRevising(false)
    release()
  }
  const onNoteKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setRevising(false)
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      keepPlanning()
    }
  }

  return (
    <div ref={rootRef} className="v3-approval v3-chat-plan" role="group" aria-label="Plano para aprovar" data-status={status}>
      <CardHead agentName={agentName}>propõe um plano</CardHead>
      {plan ? (
        <div
          className={`v3-chat-plan__body v3-type-body-sm${expanded ? ' v3-chat-plan__body--open' : ''}`}
          tabIndex={0}
          role="region"
          aria-label="Plano proposto"
        >
          <MarkdownBody text={plan} rawHtmlAsText />
        </div>
      ) : null}
      {plan ? (
        <button
          type="button"
          className="v3-approval__text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Ocultar plano completo' : 'Ver plano completo'}
        </button>
      ) : null}

      {revising ? (
        <div className="v3-approval__reason">
          <label className="v3-field__label" htmlFor={`${baseId}-note`}>O que mudar?</label>
          <textarea
            id={`${baseId}-note`}
            ref={noteRef}
            className="v3-input v3-approval__reason-input"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={onNoteKey}
          />
          <div className="v3-approval__actions">
            <Button size="sm" onClick={keepPlanning}>Confirmar</Button>
            <Button size="sm" variant="text" onClick={() => setRevising(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="v3-approval__actions">
          <Button
            variant="primary"
            aria-disabled={sending ? 'true' : undefined}
            aria-busy={sending ? 'true' : undefined}
            onClick={approve}
          >
            {sending ? 'Enviando…' : 'Aprovar plano'}
          </Button>
          <Button aria-disabled={sending ? 'true' : undefined} onClick={() => !sending && setRevising(true)}>
            Continuar planejando
          </Button>
        </div>
      )}

      {status === 'error' ? (
        <p className="v3-approval__error v3-type-body-sm" role="alert">
          Não foi possível enviar sua decisão. Tente de novo.
        </p>
      ) : null}
    </div>
  )
}
