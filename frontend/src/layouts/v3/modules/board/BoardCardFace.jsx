import { copyTextToClipboard } from '../../../../utils/clipboard.js'
import {
  CARD_TIPO_LABELS,
  CARD_PRIORIDADE_LABELS,
  formatCardId,
  formatPrazo,
  isPrazoAtrasado,
} from '../../../../utils/cardMeta.js'
import { countPendingQuestions } from '../../../../utils/cardQuestions.js'
import Chip from '../../components/Chip/Chip.jsx'
import { useToast } from '../../components/Toast/toastContext.js'
import { placeOf } from './boardScope.js'
import PriorityBars from './PriorityBars.jsx'

const BADGE_KIND = { bug: 'bug', hotfix: 'hotfix', historia: 'story' }

// Two letters for the person or agent that last touched the card
// ("bruno" -> BR, "agente:claude" -> CL), as the V2 does.
export function avatarInitials(updatedBy) {
  if (!updatedBy || updatedBy === 'bruno') return 'BR'
  const id = updatedBy.startsWith('agente:') ? updatedBy.slice('agente:'.length) : updatedBy
  return (id || '?').slice(0, 2).toUpperCase()
}

// The description as one line of plain text for the face: the Markdown marks
// are dropped, never rendered (the face shows no HTML at all).
export function plainDescription(markdown) {
  return String(markdown || '')
    .replace(/```[a-z0-9]*\n?/gi, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function pendingLabel(count) {
  return count === 1 ? '1 pergunta' : `${count} perguntas`
}

// The face of a card in a column. The title is text (opening the card comes with the editing).
// The controls are the one that copies the number and, when the column hands it over, the
// "Mover" select in the foot (`moveSelect`, an element: the face does not know how to move).
export default function BoardCardFace({ card, registry, doneSlug, hideProject = false, moveSelect = null, today = new Date() }) {
  const toast = useToast()
  const place = placeOf(card.projeto_id, registry)
  const pending = countPendingQuestions(card.questions)
  const overdue = isPrazoAtrasado(card.prazo, card.status, doneSlug, today)
  const description = plainDescription(card.descricao)

  const copyId = async () => {
    const ok = await copyTextToClipboard(String(card.id))
    toast.push(ok ? { text: 'Copiado.' } : { text: 'Não consegui copiar.', kind: 'error' })
  }

  const summary = [
    card.prioridade ? `Prioridade ${CARD_PRIORIDADE_LABELS[card.prioridade]}` : null,
    card.prazo ? `prazo ${formatPrazo(card.prazo, today)}${overdue ? ', atrasado' : ''}` : null,
    pending > 0 ? pendingLabel(pending) : null,
  ].filter(Boolean).join(', ')
  const summaryId = `board-card-${card.id}-summary`

  return (
    <article className="v3-board-card" aria-labelledby={`board-card-${card.id}-title`} aria-describedby={summary ? summaryId : undefined}>
      <div className="v3-board-card__meta">
        <button
          type="button"
          className="v3-board-card__id v3-type-mono-sm"
          aria-label={`Copiar número do card ${card.id}`}
          title={`Copiar número do card ${card.id}`}
          onClick={copyId}
        >
          {formatCardId(card.id)}
        </button>
        <Chip tone="neutral">{place.workspace}</Chip>
        {place.project && place.project !== place.workspace && !hideProject && <Chip tone="neutral">{place.project}</Chip>}
        {pending > 0 && <Chip tone="state" accent="fin">{pendingLabel(pending)}</Chip>}
        <PriorityBars prioridade={card.prioridade} />
        {card.tipo && CARD_TIPO_LABELS[card.tipo] && (
          <Chip tone="badge" kind={BADGE_KIND[card.tipo]}>{CARD_TIPO_LABELS[card.tipo]}</Chip>
        )}
      </div>

      <h4 id={`board-card-${card.id}-title`} className="v3-board-card__title v3-type-body">{card.titulo}</h4>
      {description && <p className="v3-board-card__description v3-type-body-sm">{description}</p>}
      {summary && <span id={summaryId} className="v3-board-card__summary">{summary}</span>}

      <div className="v3-board-card__foot">
        <span
          className="v3-board-card__avatar v3-type-mono-sm"
          title={card.ultima_atualizacao_por || 'bruno'}
          aria-hidden="true"
        >
          {avatarInitials(card.ultima_atualizacao_por)}
        </span>
        {card.prazo && (
          <span
            className={`v3-board-card__due v3-type-mono-sm${overdue ? ' v3-board-card__due--overdue' : ''}`}
            aria-label={`Prazo ${formatPrazo(card.prazo, today)}${overdue ? ', atrasado' : ''}`}
          >
            {overdue && (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" className="v3-board-card__clock">
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
            {formatPrazo(card.prazo, today)}
          </span>
        )}
        {moveSelect}
      </div>
    </article>
  )
}
