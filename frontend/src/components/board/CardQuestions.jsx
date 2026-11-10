// frontend/src/components/board/CardQuestions.jsx
// Questions an agent left on a card (MCP tool `perguntar_card`), answered
// right here in the card's edit modal. The agent reads the answers back with
// `ver_card`, so "seguir" in the chat needs no re-typing.
//
// Each answer is saved on its own, independent of the modal's "Salvar":
// on blur, on Ctrl/Cmd+Enter, on the row's button, and — for whatever is
// still unsaved — when the modal closes (Esc or ×). Typing an answer and
// closing the card must never silently drop it.
//
// "Dumb" like CardAttachments: `onAnswer(questionId, answer)` and
// `onDelete(questionId)` come already bound to the card by the parent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../utils/cardMeta.js';

export function countPendingQuestions(questions) {
  return (questions || []).filter((q) => !q.answer).length;
}

function agentLabel(askedBy) {
  return String(askedBy || '').replace(/^agente:/, '') || 'agente';
}

const styles = {
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  item: (pending) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px',
    borderRadius: '8px',
    border: `1px solid ${pending ? 'var(--v2-warn)' : 'var(--v2-border)'}`,
    background: 'var(--v2-surface-2)',
  }),
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  question: {
    flex: 1,
    minWidth: 0,
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  remove: {
    flexShrink: 0,
    width: '26px',
    height: '26px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '16px',
    cursor: 'pointer',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
  },
  chip: (pending) => ({
    padding: '1px 6px',
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: 700,
    background: pending ? 'var(--v2-warn-soft)' : 'var(--v2-accent-2-soft)',
    color: pending ? 'var(--v2-warn)' : 'var(--v2-accent-2)',
  }),
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '56px',
    resize: 'vertical',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface)',
    color: 'var(--v2-text)',
    font: 'inherit',
    fontSize: '13px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '28px',
  },
  save: {
    height: '28px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid var(--v2-accent)',
    background: 'var(--v2-accent)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  note: (danger) => ({
    fontSize: '11px',
    color: danger ? 'var(--v2-danger)' : 'var(--v2-text-faint)',
  }),
};

export function CardQuestions({ cardId, questions, onAnswer, onDelete }) {
  const list = questions || [];
  // Only questions the user has typed into carry a draft; the rest show the
  // saved answer, so a poll refreshing `questions` never clobbers typing.
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState({}); // id -> 'saving' | 'saved' | 'error'

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const listRef = useRef(list);
  listRef.current = list;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;

  const isDirty = useCallback((question, draft) => (
    draft !== undefined && draft.trim() !== (question.answer || '')
  ), []);

  // id -> the draft currently being saved. Blur fires right before the
  // "Salvar resposta" click; without this both would send the same PATCH.
  const inFlightRef = useRef({});

  const save = useCallback(async (question) => {
    const draft = draftsRef.current[question.id];
    if (!isDirty(question, draft) || inFlightRef.current[question.id] === draft) return;
    inFlightRef.current[question.id] = draft;
    setStatus((s) => ({ ...s, [question.id]: 'saving' }));
    try {
      await onAnswerRef.current(question.id, draft.trim());
      setDrafts((d) => {
        // Keep a draft the user changed again while the request was in flight.
        if (d[question.id] !== draft) return d;
        const next = { ...d };
        delete next[question.id];
        return next;
      });
      setStatus((s) => ({ ...s, [question.id]: 'saved' }));
    } catch {
      setStatus((s) => ({ ...s, [question.id]: 'error' }));
    } finally {
      if (inFlightRef.current[question.id] === draft) delete inFlightRef.current[question.id];
    }
  }, [isDirty]);

  // Flush unsaved answers when the modal goes away (Esc / × do not blur).
  useEffect(() => () => {
    for (const question of listRef.current) {
      const draft = draftsRef.current[question.id];
      if (isDirty(question, draft) && inFlightRef.current[question.id] !== draft) {
        Promise.resolve(onAnswerRef.current(question.id, draft.trim())).catch(() => {});
      }
    }
  }, [isDirty]);

  if (list.length === 0) return null;

  return (
    <ul style={styles.list} data-testid={`card-questions-${cardId}`}>
      {list.map((question) => {
        const draft = drafts[question.id];
        const value = draft ?? question.answer ?? '';
        const pending = !question.answer;
        const dirty = isDirty(question, draft);
        const rowStatus = status[question.id];
        const inputId = `card-question-${question.id}`;
        return (
          <li key={question.id} style={styles.item(pending)} data-testid={`card-question-${question.id}`}>
            <div style={styles.head}>
              <label htmlFor={inputId} style={styles.question}>{question.question}</label>
              <button
                type="button"
                style={styles.remove}
                onClick={() => onDelete(question.id)}
                aria-label={`Remover pergunta: ${question.question}`}
                title="Remover pergunta"
              >
                ×
              </button>
            </div>
            <div style={styles.meta}>
              <span style={styles.chip(pending)}>{pending ? 'Aguardando resposta' : 'Respondida'}</span>
              <span>{agentLabel(question.asked_by)} · {formatDateTime(question.created_at)}</span>
            </div>
            <textarea
              id={inputId}
              style={styles.textarea}
              value={value}
              placeholder="Sua resposta…"
              onChange={(e) => {
                const text = e.target.value;
                setDrafts((d) => ({ ...d, [question.id]: text }));
                setStatus((s) => ({ ...s, [question.id]: undefined }));
              }}
              onBlur={() => save(question)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  save(question);
                }
              }}
            />
            <div style={styles.footer}>
              {dirty && rowStatus !== 'saving' && (
                <button type="button" style={styles.save} onClick={() => save(question)}>
                  Salvar resposta
                </button>
              )}
              {rowStatus === 'saving' && <span style={styles.note(false)}>Salvando…</span>}
              {rowStatus === 'saved' && !dirty && <span style={styles.note(false)}>Resposta salva</span>}
              {rowStatus === 'error' && (
                <span role="alert" style={styles.note(true)}>Não foi possível salvar. Tente de novo.</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
