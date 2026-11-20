import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { useProjectsSessions } from '../../sessions/useProjectsSessions.js'
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

// The session a card opens. A card that needs the user opens the session that needs the user (a live
// one first): the card's state is the best of its rows, so the first live row may be a quiet one.
// Otherwise the one its title comes from (a live one first, else the first).
export function cardSessionKey(card) {
  const rows = card.sessions ?? []
  const waiting = rows.filter((row) => row.state === 'needs_you')
  const pool = waiting.length > 0 ? waiting : rows
  return (pool.find((row) => row.live) ?? pool[0])?.key ?? null
}

// "Abrir sessão": every agent opens its session on the chat route (openChat of the sessions context); the
// route decides the view: the conversation for a Claude chat, the terminal view for everything else (C6).
// Only a card with no session to open stays aria-disabled (nothing to point at; "Novo chat" starts one).
export function OpenSessionButton({ sessionKey = null }) {
  const { openChat } = useProjectsSessions()
  if (sessionKey) {
    return <Button size="sm" onClick={() => openChat(sessionKey)}>Abrir sessão</Button>
  }
  return <Button size="sm" aria-disabled="true">Abrir sessão</Button>
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
        <OpenSessionButton sessionKey={cardSessionKey(card)} />
      </div>
    </Panel>
  )
}
