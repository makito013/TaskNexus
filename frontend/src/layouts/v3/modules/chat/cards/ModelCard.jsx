import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../../components/Button/Button.jsx'
import { chatApi } from '../../../../../services/chatApi.js'

// "Modelo desta conversa" (Designer 5.4), opened by /model or by the model chip of the header. It reads
// the catalog (GET /api/chat/models, the enabled entries) and asks the conversation to switch with
// `setModel(value)` (the `set_model` frame; it returns the request id, or null when there is no socket).
//
// Vocabulary: the conversation reports the model by the alias the user chose and then by the name the
// CLI resolved ("haiku" then "claude-haiku-4-5-..."). A catalog entry is "the current one" when its
// value equals the reported model or is contained in it. The first change of `currentModel` after an
// apply is the confirmation, and the card shows the NAME OF THE ENTRY that was chosen (never the
// resolved name). A `command.rejected` with the request id of the apply is the error.
//
//   currentModel   state.model of the conversation
//   rejected       state.rejected of the conversation ({ requestId, code, message } | null)
//   disabled       the chat refused (spawn / resume / engine): the card cannot apply anything
//   setModel(value) -> requestId | null
//   onClose()
export function isCurrentModel(entryValue, currentModel) {
  if (!entryValue || !currentModel) return false
  const value = String(entryValue).toLowerCase()
  const current = String(currentModel).toLowerCase()
  return current === value || current.includes(value)
}

function entryName(entry) {
  return entry.display_name || entry.value
}

export default function ModelCard({ currentModel, rejected = null, disabled = false, setModel, onClose }) {
  const [catalog, setCatalog] = useState({ status: 'loading', entries: [] })
  const [attempt, setAttempt] = useState(0)
  // { value, name, requestId, baseline, phase: 'applying' | 'applied' | 'error' }
  const [apply, setApply] = useState(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const itemRefs = useRef([])
  const titleRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setCatalog({ status: 'loading', entries: [] })
    chatApi.fetchModels().then(
      (list) => {
        if (cancelled) return
        const entries = (Array.isArray(list) ? list : []).filter((entry) => entry && entry.enabled !== false && entry.value)
        setCatalog({ status: entries.length > 0 ? 'ready' : 'empty', entries })
      },
      () => {
        if (!cancelled) setCatalog({ status: 'empty', entries: [] })
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // The confirmation and the refusal of an apply in flight.
  useEffect(() => {
    if (!apply || apply.phase !== 'applying') return
    if (rejected && rejected.requestId === apply.requestId) {
      setApply((current) => (current ? { ...current, phase: 'error' } : current))
    } else if (currentModel !== apply.baseline) {
      setApply((current) => (current ? { ...current, phase: 'applied' } : current))
    }
  }, [apply, currentModel, rejected])

  const currentIndex = catalog.entries.findIndex((entry) => isCurrentModel(entry.value, currentModel))
  useEffect(() => {
    setFocusIndex(currentIndex >= 0 ? currentIndex : 0)
  }, [currentIndex, catalog.entries.length])

  const applying = apply?.phase === 'applying'
  const choose = useCallback(
    (entry) => {
      if (disabled || applying || isCurrentModel(entry.value, currentModel)) return
      const requestId = setModel(entry.value)
      if (requestId === null) {
        setApply({ value: entry.value, name: entryName(entry), requestId: null, baseline: currentModel, phase: 'error' })
        return
      }
      setApply({ value: entry.value, name: entryName(entry), requestId, baseline: currentModel, phase: 'applying' })
    },
    [applying, currentModel, disabled, setModel],
  )

  const move = (delta) => {
    const count = catalog.entries.length
    if (count === 0) return
    const next = (focusIndex + delta + count) % count
    setFocusIndex(next)
    itemRefs.current[next]?.focus()
  }
  const onItemKey = (event, entry) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(entry)
    }
  }
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const currentEntry = catalog.entries[currentIndex]
  return (
    <section className="v3-chat-model" role="group" aria-label="Modelo desta conversa" onKeyDown={onKeyDown}>
      <header className="v3-chat-model__head">
        <h2 ref={titleRef} tabIndex={-1} className="v3-chat-model__title">Modelo desta conversa</h2>
        <Button size="sm" variant="text" onClick={onClose}>Fechar</Button>
      </header>
      <p className="v3-chat-model__sub v3-type-caption">A troca vale a partir da próxima resposta. A conversa não reinicia.</p>

      {disabled ? <p className="v3-chat-model__note v3-type-body-sm">O chat está indisponível.</p> : null}

      {catalog.status === 'loading' ? (
        <div role="status" aria-busy="true">
          <span className="v3-chat-sr-only">Carregando modelos…</span>
          {[0, 1, 2].map((item) => <span key={item} className="v3-chat-model__skeleton" aria-hidden="true" />)}
        </div>
      ) : null}

      {catalog.status === 'empty' ? (
        <div className="v3-chat-model__empty">
          <p className="v3-type-body-sm">Nenhum modelo disponível agora.</p>
          <Button size="sm" onClick={() => setAttempt((count) => count + 1)}>Tentar de novo</Button>
        </div>
      ) : null}

      {catalog.status === 'ready' ? (
        <div role="radiogroup" aria-label="Modelos disponíveis" className="v3-chat-model__list">
          {catalog.entries.map((entry, index) => {
            const current = isCurrentModel(entry.value, currentModel)
            const busy = applying && apply.value === entry.value
            return (
              <button
                key={entry.value}
                ref={(node) => { itemRefs.current[index] = node }}
                type="button"
                role="radio"
                aria-checked={current}
                aria-busy={busy ? 'true' : undefined}
                aria-disabled={disabled || (applying && !busy) ? 'true' : undefined}
                tabIndex={index === focusIndex ? 0 : -1}
                className={`v3-chat-model__item${current ? ' v3-chat-model__item--current' : ''}`}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event) => onItemKey(event, entry)}
                onClick={() => choose(entry)}
              >
                <span className="v3-chat-model__radio" aria-hidden="true" />
                <span className="v3-chat-model__text">
                  <span className="v3-chat-model__name">
                    {entryName(entry)}
                    {current ? <span className="v3-chat-model__badge v3-type-caption"> atual</span> : null}
                  </span>
                  {entry.description ? <span className="v3-chat-model__desc v3-type-caption">{entry.description}</span> : null}
                </span>
                {busy ? <span className="v3-type-caption">Aplicando…</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {apply?.phase === 'applied' ? (
        <p className="v3-chat-model__result v3-chat-model__result--ok v3-type-body-sm" role="status">
          Modelo trocado para {apply.name}. Vale a partir da próxima resposta.
        </p>
      ) : null}
      {apply?.phase === 'error' ? (
        <p className="v3-chat-model__result v3-chat-model__result--err v3-type-body-sm" role="alert">
          Não foi possível trocar o modelo. O modelo atual continua {currentEntry ? entryName(currentEntry) : currentModel || 'o mesmo'}.
        </p>
      ) : null}
    </section>
  )
}
