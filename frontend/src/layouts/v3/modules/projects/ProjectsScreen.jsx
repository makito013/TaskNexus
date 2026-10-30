import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { useIslandReport } from '../../IslandContext.jsx'
import {
  filterBoard,
  filterSessions,
  hasUnassignedPlaces,
  projectsIslandMessage,
  stateRank,
} from './agentBoard.js'
import BoardSummary from './BoardSummary.jsx'
import ProjectDialog from './ProjectDialog.jsx'
import ProjectTabs, { TABPANEL_ID, tabId } from './ProjectTabs.jsx'
import { describeRequestError } from './folderRules.js'
import { NO_WORKSPACE_VALUE, workspaceOptions } from './registryIndex.js'
import SessionList from './SessionList.jsx'
import UnassignedBucket from './UnassignedBucket.jsx'
import { useProjectsOverview } from './useProjectsOverview.js'
import { useRegistryMutations } from './useRegistryMutations.js'
import WaitingStrip from './WaitingStrip.jsx'
import WorkspaceDialog from './WorkspaceDialog.jsx'
import WorkspaceFilter from './WorkspaceFilter.jsx'
import WorkspaceGroupView, { WorkspaceHead } from './WorkspaceGroupView.jsx'
import './ProjectsScreen.css'

const SKELETON_CARDS = 6

// Projetos e agentes (Kan): the workspace registry with the agents that have a
// session in each project, and the dialogs that register workspaces and projects
// (the only writes, all through useRegistryMutations). The board and the chat
// arrive later. The shell (AppV3) moves focus to the h1 when the module changes;
// this is the only h1, and it renders in every state.
export default function ProjectsScreen() {
  const [tab, setTab] = useState('agents')
  const [workspaceKey, setWorkspaceKey] = useState('')
  const [onlyWaiting, setOnlyWaiting] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [waitingFocusRequest, setWaitingFocusRequest] = useState(0)
  // The open registration dialog: { type: 'workspace', adoptKey?, name?, trigger } |
  // { type: 'project', mode: 'create' | 'edit' | 'register', ..., trigger }. It is
  // mounted only while open, so its form starts clean every time.
  const [dialog, setDialog] = useState(null)
  const [busyProjectId, setBusyProjectId] = useState(null)
  const [busyWorkspaceId, setBusyWorkspaceId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [restoreFocus, setRestoreFocus] = useState(null)
  const h1Ref = useRef(null)

  const { registry, board, sessions, boardSummary, loading, errors, liveAvailable, refetch } = useProjectsOverview({
    workspaceKey,
  })
  const mutations = useRegistryMutations({ onDone: refetch })

  useEffect(() => {
    document.title = 'Projetos · TaskNexus'
  }, [])

  const totalFailure = !loading && !registry && Boolean(errors.workspaces)
  const ready = !loading && Boolean(registry && board)

  const options = useMemo(
    () => (ready ? workspaceOptions(registry, { hasUnassigned: hasUnassignedPlaces(board), showArchived }) : []),
    [ready, registry, board, showArchived],
  )
  // A selected workspace that left the options (archived rows hidden again, the
  // last session outside any workspace gone) falls back to "all".
  useEffect(() => {
    if (options.length > 0 && !options.some((option) => option.value === workspaceKey)) setWorkspaceKey('')
  }, [options, workspaceKey])

  const view = useMemo(
    () => ({ workspaceKey, onlyWaiting, showArchived }),
    [workspaceKey, onlyWaiting, showArchived],
  )
  const filteredBoard = useMemo(() => (board ? filterBoard(board, view) : null), [board, view])
  const visibleSessions = useMemo(() => filterSessions(sessions, view), [sessions, view])

  // "Ver quem espera": the strip follows the workspace filter while the island
  // counts everything, so the action clears the workspace filter, goes to the
  // Agentes tab and only then moves focus to the strip.
  const showWaiting = useCallback(() => {
    setTab('agents')
    setWorkspaceKey('')
    setWaitingFocusRequest((count) => count + 1)
  }, [])
  useEffect(() => {
    if (waitingFocusRequest > 0) document.getElementById('waiting')?.focus()
  }, [waitingFocusRequest])

  const waitingCount = board ? board.waiting.length : 0
  const emptyGroup = filteredBoard && workspaceKey && !onlyWaiting
    && filteredBoard.groups.length === 1 && filteredBoard.groups[0].empty
    ? filteredBoard.groups[0]
    : null
  // "Empty" with archived projects behind it is not "no projects": the island says so
  // here because its phrase for the truly empty workspace lives in agentBoard.js.
  const emptyAllArchived = Boolean(emptyGroup && emptyGroup.workspace.projects.length > 0)
  const emptyWorkspaceName = emptyGroup && !emptyAllArchived ? emptyGroup.workspace.name : null
  const baseIsland = projectsIslandMessage({
    loading,
    failed: totalFailure,
    liveAvailable,
    waiting: board ? board.waiting : [],
    running: board ? board.counts.running : 0,
    emptyWorkspaceName,
  })
  const island = emptyAllArchived && !loading && !totalFailure
    ? {
      text: `O workspace ${emptyGroup.workspace.name} só tem projetos arquivados. Marque "Mostrar arquivados" ou adicione um projeto novo.`,
      state: 'idle',
    }
    : baseIsland
  const islandContent = useMemo(() => {
    let actions = []
    if (totalFailure) actions = [{ label: 'Tentar de novo', onClick: refetch }]
    else if (!loading && waitingCount > 0) actions = [{ label: 'Ver quem espera', onClick: showWaiting }]
    return { message: island.text, state: island.state, actions }
  }, [island.text, island.state, totalFailure, loading, waitingCount, refetch, showWaiting])
  useIslandReport('projects', islandContent)

  const clearFilters = () => {
    setWorkspaceKey('')
    setOnlyWaiting(false)
  }

  let scopeLabel = 'todos os workspaces'
  if (workspaceKey === NO_WORKSPACE_VALUE) scopeLabel = 'Sem workspace'
  else if (workspaceKey && registry) scopeLabel = registry.workspaceByKey.get(workspaceKey)?.name ?? workspaceKey

  // ---- registration ----------------------------------------------------------
  // Focus goes back to the button that opened a dialog; when that button is gone
  // (its row moved or was archived) it goes to the h1.
  const returnFocusTo = (trigger) => () => (trigger && trigger.isConnected ? trigger : h1Ref.current)
  const closeDialog = useCallback(() => setDialog(null), [])

  const actions = useMemo(() => {
    const openProject = (spec, trigger) => setDialog({ type: 'project', ...spec, trigger })
    return {
      busyProjectId,
      busyWorkspaceId,
      onNewWorkspace: (trigger) => setDialog({ type: 'workspace', trigger }),
      onAddProject: (workspace, trigger) => openProject({ mode: 'create', workspaceId: workspace ? workspace.id : null }, trigger),
      onEditProject: (project, trigger) => openProject({ mode: 'edit', project }, trigger),
      onRegisterBucket: (bucket, workspace, trigger) => openProject({ mode: 'register', bucketKey: bucket.key, workspaceId: workspace.id }, trigger),
      onCreateWorkspaceFrom: (clientKey, trigger) => setDialog({ type: 'workspace', adoptKey: clientKey, name: clientKey, trigger }),
      onSetArchived: async (project, archived, trigger) => {
        if (busyProjectId !== null) return
        setBusyProjectId(project.id)
        setActionError(null)
        try {
          await mutations.updateProject(project.id, { archived })
          setRestoreFocus({ trigger })
        } catch (error) {
          setActionError({ name: project.name, archived, message: describeRequestError(error) })
        } finally {
          setBusyProjectId(null)
        }
      },
      onSetWorkspaceArchived: async (workspace, archived, trigger) => {
        if (busyWorkspaceId !== null) return
        setBusyWorkspaceId(workspace.id)
        setActionError(null)
        try {
          await mutations.updateWorkspace(workspace.id, { archived })
          setRestoreFocus({ trigger })
        } catch (error) {
          setActionError({ name: workspace.name, archived, message: describeRequestError(error) })
        } finally {
          setBusyWorkspaceId(null)
        }
      },
    }
  }, [busyProjectId, busyWorkspaceId, mutations])

  // After an archive the row may be gone with the refetched registry: look at the
  // DOM once the render is committed.
  useEffect(() => {
    if (!restoreFocus) return
    const { trigger } = restoreFocus
    const target = trigger && trigger.isConnected ? trigger : h1Ref.current
    target?.focus()
    setRestoreFocus(null)
  }, [restoreFocus])

  const showFilters = ready
  const showAside = ready && tab === 'agents' && Boolean(filteredBoard && (filteredBoard.hasContent || filteredBoard.waiting.length > 0))

  return (
    <div className="v3-screen v3-projects">
      <header className="v3-projects__header">
        <h1 ref={h1Ref} tabIndex={-1} className="v3-type-title-lg v3-screen__title">Projetos e agentes</h1>
        <ProjectTabs tab={tab} onSelect={setTab} />
        {ready && (
          <div className="v3-projects__actions">
            <Button variant="secondary" onClick={(event) => actions.onNewWorkspace(event.currentTarget)}>Novo workspace</Button>
            <Button
              variant="primary"
              onClick={(event) => actions.onAddProject(registry.workspaceByKey.get(workspaceKey) ?? null, event.currentTarget)}
            >
              Adicionar projeto
            </Button>
          </div>
        )}
      </header>

      {showFilters && (
        <WorkspaceFilter
          options={options}
          workspaceKey={workspaceKey}
          onWorkspaceChange={setWorkspaceKey}
          onlyWaiting={onlyWaiting}
          onOnlyWaitingChange={setOnlyWaiting}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
        />
      )}

      <span id="projects-open-note" className="v3-projects__sr-only">
        Abrir sessão fica disponível quando o chat chegar à V3.
      </span>

      <div role="tabpanel" id={TABPANEL_ID} aria-labelledby={tabId(tab)} className="v3-projects__layout">
        <div className="v3-projects__main">
          {loading && <LoadingState />}
          {totalFailure && <TotalFailure error={errors.workspaces} onRetry={refetch} />}
          {ready && (
            <>
              <PartialNotices errors={errors} liveAvailable={liveAvailable} />
              {actionError && (
                <Panel notice="fin" role="alert">
                  <b>Não foi possível {actionError.archived ? 'arquivar' : 'desarquivar'} {actionError.name}.</b> {actionError.message}
                </Panel>
              )}
              {tab === 'agents' && (
                <AgentsBody
                  filtered={filteredBoard}
                  onlyWaiting={onlyWaiting}
                  onClearFilters={clearFilters}
                  registry={registry}
                  actions={actions}
                />
              )}
              {tab === 'sessions' && <SessionsBody filtered={filteredBoard} rows={visibleSessions} />}
            </>
          )}
        </div>
        {showAside && (
          <aside aria-label="Resumo" className="v3-projects__aside">
            <BoardSummary summary={boardSummary} scopeLabel={scopeLabel} unavailable={Boolean(errors.cards)} />
          </aside>
        )}
      </div>

      {dialog && dialog.type === 'workspace' && (
        <WorkspaceDialog
          mutations={mutations}
          onClose={closeDialog}
          initialName={dialog.name || ''}
          adoptLegacyKey={dialog.adoptKey || null}
          returnFocusTo={returnFocusTo(dialog.trigger)}
        />
      )}
      {dialog && dialog.type === 'project' && registry && (
        <ProjectDialog
          mode={dialog.mode}
          mutations={mutations}
          workspaces={registry.workspaces}
          project={dialog.project || null}
          workspaceId={dialog.workspaceId ?? null}
          bucketKey={dialog.bucketKey || null}
          onClose={closeDialog}
          returnFocusTo={returnFocusTo(dialog.trigger)}
        />
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div role="status" aria-busy="true">
      <span className="v3-projects__sr-only">Carregando projetos e agentes…</span>
      <div className="v3-workspace__head v3-projects__loading-head">
        <span className="v3-workspace__dot v3-workspace__dot--muted" aria-hidden="true" />
        <h2 className="v3-workspace__name v3-type-title-sm">Carregando projetos…</h2>
      </div>
      <div className="v3-projects__cards" aria-hidden="true">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <div key={index} className="v3-skeleton">
            <i className="v3-skeleton__bar v3-skeleton__bar--wide" />
            <i className="v3-skeleton__bar" />
            <i className="v3-skeleton__bar v3-skeleton__bar--short" />
          </div>
        ))}
      </div>
    </div>
  )
}

function TotalFailure({ error, onRetry }) {
  return (
    <div className="v3-state-box v3-state-box--error" role="alert">
      <h2 className="v3-type-title-md v3-state-box__title">Não foi possível carregar o cadastro de projetos</h2>
      <p className="v3-type-body v3-state-box__text">
        Sem o cadastro não dá para agrupar os agentes por workspace e projeto. Nada foi alterado.
      </p>
      <span className="v3-projects__code v3-type-mono-sm">GET /api/workspaces → {error?.status ?? 'sem resposta'}</span>
      <Button variant="secondary" onClick={onRetry}>Tentar de novo</Button>
    </div>
  )
}

function PartialNotices({ errors, liveAvailable }) {
  return (
    <>
      {!liveAvailable && (
        <Panel notice="fin" role="alert">
          <b>Estado ao vivo indisponível.</b> Não consegui ler as sessões ativas. Mostrando só o que está salvo;
          &quot;rodando&quot; e &quot;parado&quot; não aparecem até o próximo tick.
        </Panel>
      )}
      {errors.persisted && (
        <Panel notice="fin" role="status">
          <b>Sessões salvas indisponíveis.</b> Não consegui ler as sessões salvas; &quot;precisa de você&quot; pode estar
          desatualizado até o próximo tick.
        </Panel>
      )}
      {errors.agents && (
        <Panel notice="fin" role="status">Não consegui ler os agentes. Os nomes aparecem como o id de cada um.</Panel>
      )}
    </>
  )
}

function FilterEmpty({ onClear }) {
  return (
    <div className="v3-state-box">
      <h2 className="v3-type-title-md v3-state-box__title">Nenhum agente espera você neste filtro</h2>
      <p className="v3-type-body v3-state-box__text">
        Tire o filtro &quot;Só quem espera você&quot; ou troque de workspace para ver as outras mesas.
      </p>
      <Button variant="secondary" onClick={onClear}>Limpar filtros</Button>
    </div>
  )
}

function AgentsBody({ filtered, onlyWaiting, onClearFilters, registry, actions }) {
  const { waiting, groups, unassigned, unknown, hasContent } = filtered
  const allArchived = registry.workspaces.length > 0 && registry.workspaces.every((workspace) => workspace.archived)
  return (
    <>
      {waiting.length > 0 && <WaitingStrip cards={waiting} />}
      {!hasContent && waiting.length === 0 && (
        onlyWaiting
          ? <FilterEmpty onClear={onClearFilters} />
          : allArchived
            ? (
              <div className="v3-state-box">
                <h2 className="v3-type-title-md v3-state-box__title">Todos os workspaces estão arquivados</h2>
                <p className="v3-type-body v3-state-box__text">
                  Marque &quot;Mostrar arquivados&quot; para vê-los ou crie um workspace novo.
                </p>
                <Button variant="primary" onClick={(event) => actions.onNewWorkspace(event.currentTarget)}>Novo workspace</Button>
              </div>
            )
            : (
              <div className="v3-state-box">
                <h2 className="v3-type-title-md v3-state-box__title">Nenhum workspace cadastrado</h2>
                <p className="v3-type-body v3-state-box__text">
                  Quando houver workspaces e projetos cadastrados, eles aparecem aqui.
                </p>
                <Button variant="primary" onClick={(event) => actions.onNewWorkspace(event.currentTarget)}>Novo workspace</Button>
              </div>
            )
      )}
      {groups.map((group) => <WorkspaceGroupView key={group.workspace.key} group={group} actions={actions} />)}
      {unassigned.length > 0 && (
        <section aria-label="Sem workspace" className="v3-workspace">
          <WorkspaceHead
            name="Sem workspace"
            dot="--v3-ink-faint"
            meta="clientes que a V2 criou depois da migração"
          />
          {unassigned.map((bucket) => (
            <UnassignedBucket
              key={bucket.clientKey}
              title={bucket.clientKey}
              paths={bucket.keys}
              cards={bucket.cards}
              actions={actions}
            />
          ))}
        </section>
      )}
      {unknown.length > 0 && (
        <section aria-label="Projeto não encontrado" className="v3-workspace">
          <WorkspaceHead name="Projeto não encontrado" dot="--v3-ink-faint" meta="chaves que não estão no cadastro" />
          {unknown.map((bucket) => (
            <UnassignedBucket key={bucket.key} title={bucket.key} cards={bucket.cards} variant="unknown" />
          ))}
        </section>
      )}
    </>
  )
}

function SessionsBody({ filtered, rows }) {
  const byState = (a, b) => stateRank(a.state) - stateRank(b.state)
  const active = rows.filter((row) => row.live).sort(byState)
  const saved = rows.filter((row) => !row.live).sort(byState)
  return (
    <>
      <Panel notice="tiq">Abrir e retomar sessões chega com o chat da V3. Esta lista só mostra o estado.</Panel>
      {filtered.waiting.length > 0 && <WaitingStrip cards={filtered.waiting} />}
      <SessionList id="projects-sessions-active" title="Ativas" rows={active} />
      <SessionList id="projects-sessions-saved" title="Salvas (retomáveis)" rows={saved} />
    </>
  )
}
