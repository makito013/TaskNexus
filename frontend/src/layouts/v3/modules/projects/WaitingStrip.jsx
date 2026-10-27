import Chip from '../../components/Chip/Chip.jsx'
import { OpenSessionButton, agentInitials } from './AgentCard.jsx'

// "Esperando você": every session that needs the user, on top of both tabs. No
// Permitir/Negar - there is no backend for it yet, so the strip only warns.
// tabIndex=-1 so the island action "Ver quem espera" can move focus here.
export default function WaitingStrip({ cards }) {
  return (
    <section id="waiting" tabIndex={-1} aria-label="Esperando você" className="v3-waiting">
      <h2 className="v3-waiting__title v3-type-body">
        Esperando você
        <span className="v3-projects__count v3-type-mono-sm">{cards.length}</span>
      </h2>
      <ul className="v3-waiting__list">
        {cards.map((card) => (
          <li key={card.id} className="v3-waiting__item">
            <span className="v3-agent-card__avatar" aria-hidden="true">{agentInitials(card.agentName)}</span>
            <div className="v3-waiting__who">
              <div className="v3-waiting__line1 v3-type-body-sm">
                {card.agentName} · {card.placeName}
                {card.archived && <> <Chip>arquivado</Chip></>}
              </div>
              <div className="v3-waiting__line2 v3-type-caption">{card.location} · {card.title}</div>
            </div>
            <Chip tone="state" accent="fin">{card.resumable ? 'retomável' : 'sessão viva'}</Chip>
            <OpenSessionButton />
          </li>
        ))}
      </ul>
      <p className="v3-type-caption v3-waiting__foot">
        Permitir e Negar chegam junto com o chat. Por enquanto esta faixa só avisa.
      </p>
    </section>
  )
}
