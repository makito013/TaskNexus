import { useId, useRef, useState } from 'react'
import Button from '../../../components/Button/Button.jsx'
import { CardHead, ResolvedRow, SHARED_RESOLVED, oneLine } from './CardParts.jsx'

// "{Agente} tem uma pergunta" (Designer 5.2): the AskUserQuestion of the agent. Every piece of the
// question (statement, options, descriptions) is tool input and is rendered as TEXT. The answer goes
// back as `answers: { [question]: "label" }` (G0.10 proved the model receives it); the labels of a
// multi-select question are joined with ", " (assumption: G0.10 only proved a single choice).
// "Não responder" is a denial with a message. Esc never decides.
//
//   card                the reducer's card ({ input: { questions: [{ question, header, options, multiSelect }] } })
//   status              cardStatus(): pending | sending | error | allowed | denied | elsewhere | expired | cancelled
//   answered            { [question]: text } this client sent (to show it back), or null
//   onDecide(card, choice)   useChatSession().decide
//   focusAfterDecision()     the consumer moves the focus off the card once it collapses
export const DECLINE_MESSAGE = 'The user chose not to answer this question.'
const OTHER = '__other__'
const EMPTY_CHOICE = { labels: [], other: '' }

function questionsOf(card) {
  const list = Array.isArray(card.input?.questions) ? card.input.questions : []
  return list
    .map((entry) => ({
      question: String(entry?.question ?? ''),
      header: String(entry?.header ?? ''),
      multi: Boolean(entry?.multiSelect),
      options: (Array.isArray(entry?.options) ? entry.options : []).map((option) => ({
        label: String(option?.label ?? ''),
        description: String(option?.description ?? ''),
      })),
    }))
    .filter((entry) => entry.question !== '')
}

// The text of an answer: the chosen labels and/or what was typed, in order.
export function answerText(choice) {
  const labels = choice.labels.filter((label) => label !== OTHER)
  const typed = choice.labels.includes(OTHER) ? choice.other.trim() : ''
  return [...labels, ...(typed ? [typed] : [])].join(', ')
}

function QuestionBlock({ entry, index, choice, disabled, onChange, groupName }) {
  const legendId = `${groupName}-q${index}`
  const type = entry.multi ? 'checkbox' : 'radio'
  const toggle = (value) => {
    if (disabled) return
    if (entry.multi) {
      const labels = choice.labels.includes(value) ? choice.labels.filter((item) => item !== value) : [...choice.labels, value]
      onChange({ ...choice, labels })
    } else {
      onChange({ ...choice, labels: [value] })
    }
  }
  const options = [...entry.options.map((option) => ({ value: option.label, ...option })), { value: OTHER, label: 'Outra resposta…', description: '' }]
  return (
    <div className="v3-chat-q">
      <p id={legendId} className="v3-chat-q__text v3-type-body-sm">
        {entry.header ? <span className="v3-chat-q__header v3-type-caption">{entry.header}</span> : null}
        {entry.question}
      </p>
      <div role={entry.multi ? 'group' : 'radiogroup'} aria-labelledby={legendId} className="v3-chat-q__options">
        {options.map((option) => {
          const checked = choice.labels.includes(option.value)
          return (
            <label key={option.value} className={`v3-chat-q__option${checked ? ' v3-chat-q__option--on' : ''}`}>
              <input
                type={type}
                name={`${groupName}-${index}`}
                checked={checked}
                aria-disabled={disabled ? 'true' : undefined}
                onChange={() => toggle(option.value)}
              />
              <span className="v3-chat-q__label">
                <span className="v3-type-body-sm">{option.label}</span>
                {option.description ? <span className="v3-chat-q__desc v3-type-caption">{option.description}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
      {choice.labels.includes(OTHER) ? (
        <input
          type="text"
          className="v3-input v3-chat-q__other"
          aria-label={`Outra resposta: ${oneLine(entry.question, 60)}`}
          value={choice.other}
          readOnly={disabled}
          onChange={(event) => onChange({ ...choice, other: event.target.value })}
        />
      ) : null}
    </div>
  )
}

export default function QuestionCard({ card, agentName, status, answered = null, onDecide, focusAfterDecision }) {
  const rootRef = useRef(null)
  const groupName = useId()
  const questions = questionsOf(card)
  const [choices, setChoices] = useState(() => questions.map(() => EMPTY_CHOICE))

  if (status === 'allowed' || status === 'allowed_session') {
    const text = answered ? Object.values(answered).map((value) => oneLine(value, 60)).join(' · ') : ''
    return <ResolvedRow status={status}>{text ? `Você respondeu: ${text}` : 'Você respondeu.'}</ResolvedRow>
  }
  if (status === 'denied' || status === 'denied_stop') return <ResolvedRow status={status}>Você não respondeu.</ResolvedRow>
  if (SHARED_RESOLVED[status]) return <ResolvedRow status={status}>{SHARED_RESOLVED[status]}</ResolvedRow>

  const sending = status === 'sending'
  const choiceAt = (index) => choices[index] ?? EMPTY_CHOICE
  const complete = questions.length > 0 && questions.every((_entry, index) => answerText(choiceAt(index)) !== '')

  const release = () => {
    if (rootRef.current?.contains(document.activeElement)) focusAfterDecision?.()
  }
  const respond = () => {
    if (sending || !complete) return
    const answers = {}
    questions.forEach((entry, index) => {
      answers[entry.question] = answerText(choiceAt(index))
    })
    onDecide(card, { behavior: 'allow', answers })
    release()
  }
  const decline = () => {
    if (sending) return
    onDecide(card, { behavior: 'deny', message: DECLINE_MESSAGE })
    release()
  }

  return (
    <div ref={rootRef} className="v3-approval v3-chat-question" role="group" aria-label="Pergunta do agente" data-status={status}>
      <CardHead agentName={agentName}>tem uma pergunta</CardHead>
      {questions.map((entry, index) => (
        <QuestionBlock
          key={entry.question}
          entry={entry}
          index={index}
          groupName={groupName}
          choice={choiceAt(index)}
          disabled={sending}
          onChange={(next) => setChoices((current) => questions.map((_item, at) => (at === index ? next : (current[at] ?? EMPTY_CHOICE))))}
        />
      ))}
      <div className="v3-approval__actions">
        <Button
          variant="primary"
          aria-disabled={!complete || sending ? 'true' : undefined}
          aria-busy={sending ? 'true' : undefined}
          onClick={respond}
        >
          {sending ? 'Enviando…' : 'Responder'}
        </Button>
        <button type="button" className="v3-approval__text-button" aria-disabled={sending ? 'true' : undefined} onClick={decline}>
          Não responder
        </button>
      </div>
      {status === 'error' ? (
        <p className="v3-approval__error v3-type-body-sm" role="alert">
          Não foi possível enviar sua resposta. Tente de novo.
        </p>
      ) : null}
    </div>
  )
}
