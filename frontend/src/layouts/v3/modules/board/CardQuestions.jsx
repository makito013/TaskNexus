import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { formatDateTime } from '../../../../utils/cardMeta.js'
import { countPendingQuestions } from '../../../../utils/cardQuestions.js'
import Button from '../../components/Button/Button.jsx'
import { useToast } from '../../components/Toast/toastContext.js'
import { cardErrorText } from './cardForm.js'

const ANSWER_FALLBACK = 'Não consegui salvar a resposta.'
const DELETE_FALLBACK = 'Não consegui excluir a pergunta.'

function agentLabel(askedBy) {
  return String(askedBy || '').replace(/^agente:/, '') || 'agente'
}

// The questions an agent left on the card, answered here. Each answer saves on its own, independent of
// the card's "Salvar": on leaving the field, with Ctrl/Cmd+Enter, with the "Responder" button, and what is
// still typed when the dialog goes away. An empty answer puts the question back to pending.
//   questions  [{ id, question, answer, asked_by, created_at }]
//   onAnswer   (questionId, text) => Promise        onDelete  (questionId) => Promise
//
// Rules per trigger: a request for a question is never sent while another for it is out; leaving the field
// with the SAME answer that was just refused sends nothing (the failure would only repeat on every tab
// stop); Ctrl/Cmd+Enter, the button and the flush on closing are explicit and send it again; a different
// text brings the blur back. Nothing is `disabled` (the focus must stay where the person is).
export default function CardQuestions({ questions, onAnswer, onDelete }) {
  const headingId = useId()
  const toast = useToast()
  const [drafts, setDrafts] = useState({})
  const [status, setStatus] = useState({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const questionsRef = useRef(questions)
  questionsRef.current = questions
  const onAnswerRef = useRef(onAnswer)
  onAnswerRef.current = onAnswer
  const toastRef = useRef(toast)
  toastRef.current = toast
  const mountedRef = useRef(true)
  const inFlightRef = useRef(new Map())
  const refusedRef = useRef(new Map())
  const deletingRef = useRef(new Set())
  const sectionRef = useRef(null)
  const headingRef = useRef(null)
  const containerRef = useRef(null)
  const [refocus, setRefocus] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const dirty = (question, draft) => draft !== undefined && draft.trim() !== (question.answer || '')

  const save = useCallback(async (question, { explicit }) => {
    const draft = draftsRef.current[question.id]
    if (!dirty(question, draft)) return
    if (inFlightRef.current.has(question.id)) return
    const text = draft.trim()
    if (!explicit && refusedRef.current.get(question.id) === text) return
    const promise = onAnswerRef.current(question.id, text)
    inFlightRef.current.set(question.id, promise)
    if (mountedRef.current) setStatus((current) => ({ ...current, [question.id]: { kind: 'saving' } }))
    try {
      await promise
      refusedRef.current.delete(question.id)
      // also in the ref: after the dialog is gone no render updates it, and the flush must not send it again
      if (draftsRef.current[question.id] === draft) {
        const rest = { ...draftsRef.current }
        delete rest[question.id]
        draftsRef.current = rest
      }
      if (mountedRef.current) {
        // a draft changed while the request was out stays; the one that was sent goes away
        setDrafts((current) => {
          if (current[question.id] !== draft) return current
          const next = { ...current }
          delete next[question.id]
          return next
        })
        setStatus((current) => ({ ...current, [question.id]: undefined }))
      }
    } catch (error) {
      refusedRef.current.set(question.id, text)
      if (mountedRef.current) setStatus((current) => ({ ...current, [question.id]: { kind: 'error', text: cardErrorText(error, ANSWER_FALLBACK) } }))
    } finally {
      inFlightRef.current.delete(question.id)
    }
  }, [])

  // What is still typed when the dialog goes away (Esc and Close do not blur). A request still out is waited
  // for; a failure here has no field to sit in, so it becomes a toast.
  useEffect(() => () => {
    for (const question of questionsRef.current) {
      const flush = async () => {
        const pending = inFlightRef.current.get(question.id)
        if (pending) await Promise.resolve(pending).catch(() => {})
        const draft = draftsRef.current[question.id]
        // the "refused" rule is only for the blur: closing is explicit, so a refused text goes out again
        if (!dirty(question, draft)) return
        try {
          await onAnswerRef.current(question.id, draft.trim())
        } catch {
          toastRef.current.push({ text: 'Não consegui salvar uma resposta. Abra o card e tente de novo.', kind: 'error' })
        }
      }
      if (dirty(question, draftsRef.current[question.id])) flush()
    }
  }, [])

  // A deleted question takes the pressed button with it: the focus goes to the heading of the section (or, when
  // it was the last question, to the panel that held it), but only if it was lost.
  useEffect(() => {
    if (refocus === 0) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = headingRef.current ?? containerRef.current
    target?.focus()
  }, [refocus, questions])

  const remove = async (question) => {
    if (deletingRef.current.has(question.id)) return
    deletingRef.current.add(question.id)
    setStatus((current) => ({ ...current, [question.id]: undefined }))
    try {
      await onDelete(question.id)
      containerRef.current = sectionRef.current?.closest('[data-autofocus]') ?? sectionRef.current?.closest('dialog') ?? null
      if (mountedRef.current) setRefocus((count) => count + 1)
    } catch (error) {
      if (mountedRef.current) setStatus((current) => ({ ...current, [question.id]: { kind: 'error', text: cardErrorText(error, DELETE_FALLBACK) } }))
    } finally {
      deletingRef.current.delete(question.id)
    }
  }

  if (!questions || questions.length === 0) return null
  const pending = countPendingQuestions(questions)

  return (
    <section ref={sectionRef} role="region" aria-labelledby={headingId} className="v3-card-questions">
      <h3 ref={headingRef} tabIndex={-1} id={headingId} className="v3-card-section__title v3-type-label">
        Perguntas do agente{pending > 0 && <> (<span className="v3-type-mono-sm">{pending}</span> sem resposta)</>}
      </h3>
      <ul className="v3-card-questions__list">
        {questions.map((question) => {
          const draft = drafts[question.id]
          const rowStatus = status[question.id]
          const inputId = `${headingId}-q${question.id}`
          const isDirty = dirty(question, draft)
          return (
            <li key={question.id} className="v3-card-question">
              <label htmlFor={inputId} className="v3-card-question__text v3-type-body-sm">{question.question}</label>
              <span className="v3-card-question__meta v3-type-caption">
                {agentLabel(question.asked_by)} · <span className="v3-type-mono-sm">{formatDateTime(question.created_at)}</span>
                {question.answer ? ' · respondida' : ' · aguardando resposta'}
              </span>
              <textarea
                id={inputId}
                className="v3-input v3-card-question__input"
                rows={3}
                value={draft ?? question.answer ?? ''}
                placeholder="Sua resposta"
                onChange={(event) => {
                  const text = event.target.value
                  setDrafts((current) => ({ ...current, [question.id]: text }))
                  setStatus((current) => (current[question.id]?.kind === 'error' ? { ...current, [question.id]: undefined } : current))
                }}
                onBlur={() => save(question, { explicit: false })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    // the card's own "save" lives on the dialog: this press is for the answer only
                    event.preventDefault()
                    event.stopPropagation()
                    save(question, { explicit: true })
                  }
                }}
              />
              <div className="v3-card-question__foot">
                {isDirty && (
                  <Button variant="secondary" onClick={() => save(question, { explicit: true })}>Responder</Button>
                )}
                <Button variant="text" aria-label={`Excluir pergunta ${question.question}`} onClick={() => remove(question)}>Excluir pergunta</Button>
                {rowStatus?.kind === 'saving' && <span role="status" className="v3-type-caption">Salvando…</span>}
              </div>
              {rowStatus?.kind === 'error' && <p className="v3-msg v3-msg--err" role="alert">{rowStatus.text}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
