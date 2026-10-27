import Chip from '../../components/Chip/Chip.jsx'
import AgentCard from './AgentCard.jsx'
import ProjectGroupView from './ProjectGroupView.jsx'
import SilentProjects from './SilentProjects.jsx'
import UnregisteredBucket from './UnregisteredBucket.jsx'

// Dot colour of the workspaces the DS already names; any other gets the faint ink.
const CLIENT_DOT = {
  podesubir: '--v3-client-podesubir',
  RD_Station: '--v3-client-rd',
  Pessoal: '--v3-client-pessoal',
  recycle: '--v3-client-recycle',
}

export function WorkspaceHead({ name, dot, meta, archived = false }) {
  return (
    <div className="v3-workspace__head">
      <span className="v3-workspace__dot" style={{ backgroundColor: `var(${dot})` }} aria-hidden="true" />
      <h2 className="v3-workspace__name v3-type-title-sm">{name}</h2>
      {archived && <Chip>arquivado</Chip>}
      <span className="v3-workspace__meta v3-type-caption">{meta}</span>
    </div>
  )
}

// A workspace: its projects with sessions, the buckets of unregistered folders,
// the cards of the workspace itself and the collapsed list of silent projects.
// `group` comes from filterBoard (projectCount / empty are already resolved).
export default function WorkspaceGroupView({ group }) {
  const { workspace } = group
  const count = group.projectCount
  return (
    <section aria-label={`Workspace ${workspace.name}`} className="v3-workspace">
      <WorkspaceHead
        name={workspace.name}
        dot={CLIENT_DOT[workspace.key] || '--v3-ink-faint'}
        meta={`${count} ${count === 1 ? 'projeto' : 'projetos'}`}
        archived={workspace.archived}
      />
      {group.empty && (
        <div className="v3-state-box">
          <h3 className="v3-type-title-md v3-state-box__title">{workspace.name} ainda não tem projetos</h3>
          <p className="v3-type-body v3-state-box__text">
            Um projeto junta uma ou mais pastas e aparece aqui com os agentes que já têm sessão.
          </p>
        </div>
      )}
      {group.projects.map((entry) => <ProjectGroupView key={entry.project.key} group={entry} />)}
      {group.workspaceLevel.length > 0 && (
        <section aria-label="Do workspace" className="v3-project">
          <h3 className="v3-project__name v3-type-body">Do workspace</h3>
          <div className="v3-projects__cards">
            {group.workspaceLevel.map((card) => <AgentCard key={card.id} card={card} />)}
          </div>
        </section>
      )}
      {group.unregistered.map((bucket) => <UnregisteredBucket key={bucket.key} bucket={bucket} />)}
      <SilentProjects groups={group.silent} />
    </section>
  )
}
