import Chip from '../../components/Chip/Chip.jsx'
import AgentCard from './AgentCard.jsx'

// One registered project that has at least one session: header (name, archived
// and missing-folder badges, primary path), its agent cards and the line of the
// agents that have no session here.
export default function ProjectGroupView({ group }) {
  const { project } = group
  return (
    <section aria-label={project.name} className="v3-project">
      <div className="v3-project__head">
        <h3 className="v3-project__name v3-type-body">{project.name}</h3>
        {group.archived && <Chip>arquivado</Chip>}
        {group.primaryPath && <span className="v3-project__path v3-type-mono-sm">{group.primaryPath}</span>}
        {!group.exists && <Chip tone="state" accent="danger">pasta não encontrada</Chip>}
      </div>
      <div className="v3-projects__cards">
        {group.agentCards.map((card) => <AgentCard key={card.id} card={card} />)}
      </div>
      {group.freeAgents.length > 0 && (
        <div className="v3-project__free v3-type-label">
          <b>livre:</b> {group.freeAgents.map((agent) => agent.name).join(' · ')}
        </div>
      )}
    </section>
  )
}
