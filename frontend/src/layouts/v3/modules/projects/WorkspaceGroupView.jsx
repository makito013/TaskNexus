import { useEffect, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
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

export function WorkspaceHead({ name, dot, meta, archived = false, children = null }) {
  return (
    <div className="v3-workspace__head">
      <span className="v3-workspace__dot" style={{ backgroundColor: `var(${dot})` }} aria-hidden="true" />
      <h2 className="v3-workspace__name v3-type-title-sm">{name}</h2>
      {archived && <Chip>arquivado</Chip>}
      <span className="v3-workspace__meta v3-type-caption">{meta}</span>
      {children}
    </div>
  )
}

// "Arquivar" (with an inline confirmation: it takes every project of the workspace
// out of the agents' write targets) / "Desarquivar" in the workspace header.
function WorkspaceArchiveControls({ workspace, actions }) {
  const [confirming, setConfirming] = useState(false)
  // The trigger is swapped for the confirmation (and back): keep the focus with it.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    document.getElementById(confirming ? `ws-archive-confirm-${workspace.id}` : `ws-archive-ask-${workspace.id}`)?.focus()
  }, [confirming, workspace.id])
  const busy = actions.busyWorkspaceId === workspace.id
  const busyProps = busy ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : null
  if (workspace.archived) {
    return (
      <span className="v3-workspace__actions">
        <Button
          size="sm"
          aria-label={`Desarquivar workspace ${workspace.name}`}
          {...(busyProps || { onClick: (event) => actions.onSetWorkspaceArchived(workspace, false, event.currentTarget) })}
        >
          Desarquivar
        </Button>
      </span>
    )
  }
  if (confirming) {
    return (
      <span className="v3-workspace__actions" role="group" aria-label={`Arquivar workspace ${workspace.name}`}>
        <span className="v3-workspace__ask v3-type-label">
          Arquivar o workspace &quot;{workspace.name}&quot;? Os projetos dele saem da lista e deixam de receber escrita dos agentes.
        </span>
        <Button
          size="sm"
          id={`ws-archive-confirm-${workspace.id}`}
          className="v3-button--danger-outline"
          {...(busyProps || {
            onClick: (event) => {
              setConfirming(false)
              actions.onSetWorkspaceArchived(workspace, true, event.currentTarget)
            },
          })}
        >
          Sim, arquivar
        </Button>
        <Button size="sm" onClick={() => setConfirming(false)}>Voltar</Button>
      </span>
    )
  }
  return (
    <span className="v3-workspace__actions">
      <Button
        size="sm"
        id={`ws-archive-ask-${workspace.id}`}
        aria-label={`Arquivar workspace ${workspace.name}`}
        onClick={() => setConfirming(true)}
      >
        Arquivar
      </Button>
    </span>
  )
}

// Nothing visible in the workspace. Two different truths, two different texts:
// no project at all (the plan's copy), or projects that are all archived and hidden
// by the "Mostrar arquivados" filter. The CTA only exists in an active workspace
// (an archived one answers 409 to a new project).
function EmptyWorkspace({ workspace, actions }) {
  const onlyArchived = workspace.projects.length > 0
  return (
    <div className="v3-state-box">
      {onlyArchived ? (
        <>
          <h3 className="v3-type-title-md v3-state-box__title">{workspace.name} só tem projetos arquivados</h3>
          <p className="v3-type-body v3-state-box__text">
            Marque &quot;Mostrar arquivados&quot; para vê-los ou adicione um projeto novo.
          </p>
        </>
      ) : (
        <>
          <h3 className="v3-type-title-md v3-state-box__title">{workspace.name} ainda não tem projetos</h3>
          <p className="v3-type-body v3-state-box__text">
            Um projeto junta uma ou mais pastas e aparece aqui com os agentes que já têm sessão.
          </p>
        </>
      )}
      {actions && !workspace.archived && (
        <Button variant="primary" onClick={(event) => actions.onAddProject(workspace, event.currentTarget)}>
          Adicionar projeto
        </Button>
      )}
    </div>
  )
}

// A workspace: its projects with sessions, the buckets of unregistered folders,
// the cards of the workspace itself and the collapsed list of silent projects.
// `group` comes from filterBoard (projectCount / empty are already resolved).
export default function WorkspaceGroupView({ group, actions = null }) {
  const { workspace } = group
  const count = group.projectCount
  return (
    <section aria-label={`Workspace ${workspace.name}`} className="v3-workspace">
      <WorkspaceHead
        name={workspace.name}
        dot={CLIENT_DOT[workspace.key] || '--v3-ink-faint'}
        meta={`${count} ${count === 1 ? 'projeto' : 'projetos'}`}
        archived={workspace.archived}
      >
        {actions && <WorkspaceArchiveControls workspace={workspace} actions={actions} />}
      </WorkspaceHead>
      {group.empty && <EmptyWorkspace workspace={workspace} actions={actions} />}
      {group.projects.map((entry) => <ProjectGroupView key={entry.project.key} group={entry} actions={actions} />)}
      {group.workspaceLevel.length > 0 && (
        <section aria-label="Do workspace" className="v3-project">
          <h3 className="v3-project__name v3-type-body">Do workspace</h3>
          <div className="v3-projects__cards">
            {group.workspaceLevel.map((card) => <AgentCard key={card.id} card={card} />)}
          </div>
        </section>
      )}
      {group.unregistered.map((bucket) => (
        <UnregisteredBucket key={bucket.key} bucket={bucket} workspace={workspace} actions={actions} />
      ))}
      <SilentProjects groups={group.silent} actions={actions} />
    </section>
  )
}
