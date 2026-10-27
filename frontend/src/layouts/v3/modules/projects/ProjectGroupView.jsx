import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import AgentCard from './AgentCard.jsx'

export const projectNameId = (project) => `project-name-${project.id}`

// "Editar" and "Arquivar" / "Desarquivar" of one registered project, shared with the
// "Sem sessões" list. `actions` comes from ProjectsScreen; without it nothing renders.
// "Editar" and "Desarquivar" are described by the project name (many rows share the
// same label); "Arquivar" carries the name in its own accessible name.
export function ProjectActions({ project, actions }) {
  if (!actions) return null
  const busy = actions.busyProjectId === project.id
  const busyProps = busy ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : null
  return (
    <>
      <Button size="sm" aria-describedby={projectNameId(project)} onClick={(event) => actions.onEditProject(project, event.currentTarget)}>
        Editar
      </Button>
      {project.archived ? (
        <Button
          size="sm"
          aria-label={`Desarquivar projeto ${project.name}`}
          aria-describedby={projectNameId(project)}
          {...(busyProps || { onClick: (event) => actions.onSetArchived(project, false, event.currentTarget) })}
        >
          Desarquivar
        </Button>
      ) : (
        <Button
          size="sm"
          aria-label={`Arquivar ${project.name}`}
          {...(busyProps || { onClick: (event) => actions.onSetArchived(project, true, event.currentTarget) })}
        >
          Arquivar
        </Button>
      )}
    </>
  )
}

// One registered project that has at least one session: header (name, archived
// and missing-folder badges, primary path, edit/archive actions), its agent cards
// and the line of the agents that have no session here.
export default function ProjectGroupView({ group, actions = null }) {
  const { project } = group
  return (
    <section aria-label={project.name} className="v3-project">
      <div className="v3-project__head">
        <h3 id={projectNameId(project)} className="v3-project__name v3-type-body">{project.name}</h3>
        {group.archived && <Chip>arquivado</Chip>}
        {group.primaryPath && <span className="v3-project__path v3-type-mono-sm">{group.primaryPath}</span>}
        {!group.exists && <Chip tone="state" accent="danger">pasta não encontrada</Chip>}
        {actions && (
          <span className="v3-project__actions">
            <ProjectActions project={project} actions={actions} />
          </span>
        )}
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
