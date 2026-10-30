import Chip from '../../components/Chip/Chip.jsx'
import { ProjectActions, projectNameId } from './ProjectGroupView.jsx'

// Projects of a workspace with no session at all, collapsed so a registry of
// ~50 seeded projects does not bury the ones that have agents. Each row has the same
// edit/archive actions as a project with sessions.
export default function SilentProjects({ groups, actions = null }) {
  if (groups.length === 0) return null
  return (
    <details className="v3-silent">
      <summary className="v3-silent__summary v3-type-body-sm">
        <span className="v3-silent__chevron" aria-hidden="true" />
        Sem sessões ({groups.length})
      </summary>
      <ul className="v3-silent__list">
        {groups.map((group) => (
          <li key={group.project.key} className="v3-silent__item">
            <span id={projectNameId(group.project)} className="v3-silent__name v3-type-body-sm">{group.project.name}</span>
            {group.primaryPath && <span className="v3-type-mono-sm v3-silent__path">{group.primaryPath}</span>}
            {!group.exists && <Chip tone="state" accent="danger">pasta não encontrada</Chip>}
            {group.archived && <Chip>arquivado</Chip>}
            {actions && (
              <span className="v3-project__actions">
                <ProjectActions project={group.project} actions={actions} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
