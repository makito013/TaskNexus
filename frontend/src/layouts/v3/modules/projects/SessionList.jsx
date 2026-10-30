import Chip from '../../components/Chip/Chip.jsx'
import { StateChip, agentInitials } from './AgentCard.jsx'

// One block of the Sessões tab ("Ativas" / "Salvas (retomáveis)"): an ARIA table
// with a row per session. Read-only - opening or resuming arrives with the chat.
export default function SessionList({ id, title, rows }) {
  return (
    <section className="v3-sessions" aria-labelledby={id}>
      <h2 id={id} className="v3-sessions__title v3-type-body">
        {title}
        <span className="v3-projects__count v3-projects__count--muted v3-type-mono-sm">{rows.length}</span>
      </h2>
      <div role="table" aria-labelledby={id}>
        <div role="row" className="v3-sessions__row v3-sessions__row--head v3-type-caption">
          <span role="columnheader">Sessão</span>
          <span role="columnheader">Workspace › projeto</span>
          <span role="columnheader">Agente</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Origem</span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row.key} className="v3-sessions__row">
            <div role="cell" className="v3-sessions__cell-title v3-type-body-sm"><b>{row.label}</b>{row.archived && <> <Chip>arquivado</Chip></>}</div>
            <div role="cell" className="v3-type-label">{row.location}</div>
            <div role="cell" className="v3-sessions__agent v3-type-body-sm">
              <span className="v3-agent-card__avatar v3-agent-card__avatar--small" aria-hidden="true">
                {agentInitials(row.agentName)}
              </span>
              {row.agentName}
            </div>
            <div role="cell"><StateChip item={row} /></div>
            <div role="cell" className="v3-sessions__origin v3-type-mono-sm">{row.live ? 'ao vivo' : 'salva'}</div>
          </div>
        ))}
        {rows.length === 0 && <p className="v3-sessions__empty v3-type-body-sm">Nenhuma sessão aqui.</p>}
      </div>
    </section>
  )
}
