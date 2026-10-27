import { useCallback, useEffect, useMemo, useState } from 'react'
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
import ProjectTabs, { TABPANEL_ID, tabId } from './ProjectTabs.jsx'
import { NO_WORKSPACE_VALUE, workspaceOptions } from './registryIndex.js'
import SessionList from './SessionList.jsx'
import UnassignedBucket from './UnassignedBucket.jsx'
import { useProjectsOverview } from './useProjectsOverview.js'
import WaitingStrip from './WaitingStrip.jsx'
import WorkspaceFilter from './WorkspaceFilter.jsx'
import WorkspaceGroupView, { WorkspaceHead } from './WorkspaceGroupView.jsx'
import './ProjectsScreen.css'

const SKELETON_CARDS = 6

// Projetos e agentes (Kan): the workspace registry with the agents that have a
// session in each project, READ-ONLY. Only GETs; the registry write dialogs, the
// board and the chat arrive later. The shell (AppV3) moves focus to the h1 when
// the module changes; this is the only h1, and it renders in every state.
export default function ProjectsScreen() {
  const [tab, setTab] = useState('agents')
  const [workspaceKey, setWorkspaceKey] = useState('')
  const [onlyWaiting, setOnlyWaiting] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [waitingFocusRequest, setWaitingFocusRequest] = useState(0)

  const { registry, board, sessions, boardSummary, loading, errors, liveAvailable, refetch } = useProjectsOverview({
    workspaceKey,
  })

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
  const emptyWorkspaceName = filteredBoard && workspaceKey && !onlyWaiting
    && filteredBoard.groups.length === 1 && filteredBoard.groups[0].empty
    ? filteredBoard.groups[0].workspace.name
    : null
  const island = projectsIslandMessage({
    loading,
    failed: totalFailure,
    liveAvailable,
    waiting: board ? board.waiting : [],
    running: board ? board.counts.running : 0,
    emptyWorkspaceName,
  })
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

  const showFilters = ready
  const showAside = ready && tab === 'agents' && Boolean(filteredBoard && (filteredBoard.hasContent || filteredBoard.waiting.length > 0))

  return (
    <div className="v3-screen v3-projects">
      <header className="v3-projects__header">
        <h1 tabIndex={-1} className="v3-type-title-lg v3-screen__title">Projetos e agentes</h1>
        <ProjectTabs tab={tab} onSelect={setTab} />
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
              {tab === 'agents' && (
                <AgentsBody filtered={filteredBoard} onlyWaiting={onlyWaiting} onClearFilters={clearFilters} />
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

function AgentsBody({ filtered, onlyWaiting, onClearFilters }) {
  const { waiting, groups, unassigned, unknown, hasContent } = filtered
  return (
    <>
      {waiting.length > 0 && <WaitingStrip cards={waiting} />}
      {!hasContent && waiting.length === 0 && (
        onlyWaiting
          ? <FilterEmpty onClear={onClearFilters} />
          : (
            <div className="v3-state-box">
              <h2 className="v3-type-title-md v3-state-box__title">Nenhum workspace cadastrado</h2>
              <p className="v3-type-body v3-state-box__text">
                Quando houver workspaces e projetos cadastrados, eles aparecem aqui.
              </p>
            </div>
          )
      )}
      {groups.map((group) => <WorkspaceGroupView key={group.workspace.key} group={group} />)}
      {unassigned.length > 0 && (
        <section aria-label="Sem workspace" className="v3-workspace">
          <WorkspaceHead
            name="Sem workspace"
            dot="--v3-ink-faint"
            meta="clientes que a V2 criou depois da migração"
          />
          {unassigned.map((bucket) => (
            <UnassignedBucket key={bucket.clientKey} title={bucket.clientKey} paths={bucket.keys} cards={bucket.cards} />
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
