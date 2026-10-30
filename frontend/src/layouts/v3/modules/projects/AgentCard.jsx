import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { cardMeta, cardStateLabel } from './agentBoard.js'

// Two letters of the agent name, as in the canvas ("Cl", "Co", "Te").
export function agentInitials(name) {
  const text = String(name || '?').trim()
  return text.charAt(0).toUpperCase() + text.charAt(1).toLowerCase()
}

const STATE_CHIP = {
  needs_you: { accent: 'fin', className: '' },
  running: { accent: 'kan', className: '' },
  stopped: { accent: undefined, className: 'v3-projects-state--stopped' },
  free: { accent: undefined, className: 'v3-projects-state--free' },
}

// Session state as a chip. The text is always there (never colour alone).
// `item` is a card or a session row: { state, resumable }.
export function StateChip({ item }) {
  const { accent, className } = STATE_CHIP[item.state] || STATE_CHIP.free
  return (
    <Chip tone="state" accent={accent} className={className}>{cardStateLabel(item)}</Chip>
  )
}

// "Abrir sessão" waits for the chat to reach the v3: aria-disabled, no handler,
// described by the (screen-level) note.
export function OpenSessionButton() {
  return (
    <Button size="sm" aria-disabled="true" aria-describedby="projects-open-note">Abrir sessão</Button>
  )
}

export default function AgentCard({ card }) {
  const stateLabel = cardStateLabel(card)
  const extra = card.sessionCount - 1
  const classes = ['v3-agent-card', card.state === 'needs_you' ? 'v3-agent-card--needs' : ''].filter(Boolean).join(' ')
  return (
    <Panel as="article" className={classes} aria-label={`${card.agentName} em ${card.placeName}: ${stateLabel}`}>
      <div className="v3-agent-card__top">
        <span className="v3-agent-card__avatar" aria-hidden="true">{agentInitials(card.agentName)}</span>
        <div className="v3-agent-card__who">
          <b className="v3-type-body">{card.agentName}</b>
          <span className="v3-type-caption">{card.placeName}</span>
        </div>
        <StateChip item={card} />
      </div>
      <p className="v3-agent-card__task v3-type-body-sm">
        {card.title}
        {extra > 0 && (
          <span className="v3-agent-card__more"> + {extra} {extra > 1 ? 'outras' : 'outra'}</span>
        )}
      </p>
      <div className="v3-type-mono-sm v3-agent-card__meta">{cardMeta(card)}</div>
      <div className="v3-agent-card__foot">
        <OpenSessionButton />
        <span className="v3-type-caption v3-agent-card__note">Disponível quando o chat chegar à V3</span>
      </div>
    </Panel>
  )
}
