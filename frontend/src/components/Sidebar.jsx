// frontend/src/components/Sidebar.jsx
// frontend/src/components/Sidebar.jsx
//
// O CRUD de agentes globais saiu daqui: era um modal fullscreen
// (components/AgentSettingsModal.jsx, agora apagado) aberto pelo botão "⚙
// Configurar agentes" deste header. Tudo o que ele fazia — criar/editar/
// excluir agente e escolher a pasta de projetos — vive hoje na tela
// "Configuração" do layout v2 (layouts/v2/ConfiguracaoV2.jsx), com CRUD
// completo em vez de só criação.
//
// O <AppearanceSwitch> que morava no rodapé daquele modal foi movido para o
// rodapé DESTA sidebar, e não para a tela v2: ele é o único caminho de UI de
// quem está no v1 para chegar ao v2. Deixá-lo só do lado v2 transformaria o
// v1 numa armadilha de mão única (sem troca de layout, sem troca de tema),
// recuperável apenas via API/banco.
import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { tabLabels } from '../utils/sessionLabels.js'
import { RenameableLabel } from './RenameableLabel.jsx'
import { AppearanceSwitch } from './AppearanceSwitch.jsx'

const COLLAPSED_WIDTH = '44px'
const EXPANDED_WIDTH = '240px'

const styles = {
  sidebar: (collapsed) => ({
    width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    background: 'var(--bg-surface-2)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    transition: 'width 0.15s, min-width 0.15s',
  }),
  header: (collapsed) => ({
    padding: collapsed ? '10px 6px' : '20px 16px 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'space-between',
    gap: '8px',
  }),
  toggleBtn: {
    width: 'var(--touch-target)',
    height: 'var(--touch-target)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '14px',
  },
  headerActions: {
    display: 'flex',
    gap: '6px',
    flexShrink: 0,
  },
  title: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-muted)',
    marginBottom: '8px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontSize: '11px',
    color: 'var(--accent-green)',
  },
  list: {
    padding: '8px 6px',
    overflowY: 'auto',
    flex: 1,
  },
  sectionLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-very-muted)',
    padding: '8px 10px 4px',
  },
  item: (active, isChild, hasAgents) => ({
    padding: isChild ? '8px 10px 8px 24px' : '10px 10px',
    borderRadius: 'var(--radius-sm)',
    cursor: hasAgents ? 'pointer' : 'default',
    marginBottom: '2px',
    minHeight: 'var(--touch-target)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    background: active ? 'var(--bg-active)' : 'transparent',
    borderLeft: active ? '2px solid var(--accent-green)' : '2px solid transparent',
    transition: 'background 0.15s, opacity 0.15s',
    opacity: hasAgents ? 1 : 0.5,
  }),
  itemName: (active) => ({
    fontSize: '13px',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '3px',
  },
  // Fase 4: toggle segmentado "Chats" / "Projetos"
  toggleWrap: {
    padding: '8px 8px 0',
  },
  toggleTrack: {
    display: 'flex',
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    height: '36px',
    padding: '2px',
    gap: '2px',
  },
  toggleSegment: (active) => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '11px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  }),
  toggleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '8px',
    background: 'var(--state-attention)',
    color: 'var(--bg-base)',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: 1,
  },
  chatRow: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 10px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    marginBottom: '2px',
    minHeight: 'var(--touch-target)',
    background: active ? 'var(--bg-active)' : 'transparent',
    borderLeft: active ? '2px solid var(--accent-green)' : '2px solid transparent',
  }),
  chatLabel: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
  },
  chatProject: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '70px',
  },
  chatCloseBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '15px',
    lineHeight: 1,
    padding: '2px 4px',
    flexShrink: 0,
  },
  emptyState: {
    padding: '24px 12px',
    textAlign: 'center',
  },
  emptyHeading: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  emptyBody: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
}

function AgentBadges({ agentes }) {
  if (!agentes || agentes.length === 0)
    return <span className="badge badge--none">sem agentes</span>
  return agentes.slice(0, 3).map(a => (
    <span key={a.id} className={`badge badge--${a.ia}`}>{a.nome}</span>
  ))
}

// Precedência (04-UI-SPEC.md): running (ciano, pulsante) > idle+needs_attention
// (âmbar) > idle (verde). Por construção (ADR-02), uma sessão nunca é running
// e needs_attention ao mesmo tempo, então não há ambiguidade a resolver.
// `known`: a lista de projetos passa null quando não há sessão nenhuma (não
// mostra dot); a lista global de chats sempre representa uma sessão que
// existe (persistida), então passa known=true mesmo sem PTY vivo agora —
// nesse caso mostra um dot neutro (cinza) em vez de sumir.
function StatusDot({ status, needsAttention, known }) {
  if (!status && !needsAttention && !known) return null
  const color = needsAttention
    ? 'var(--state-attention)'
    : status === 'running'
      ? 'var(--state-running)'
      : status
        ? 'var(--accent-green)'
        : 'var(--text-muted)'
  return (
    <span
      className={`status-dot ${status === 'running' ? 'status-dot--active' : ''}`}
      style={{ background: color, marginRight: '4px' }}
    />
  )
}

/** Best status across ALL sessions of a project (any agent, any instance) —
 * a project can now have several concurrent chats (Claude + Gemini, or
 * several of the same agent), so the dot reflects "is anything happening
 * here", not just the default agent's bare session key. */
function projectStatus(activeSessions, projectId) {
  const prefix = `${projectId}::`
  let hasIdle = false
  for (const key in activeSessions) {
    if (!key.startsWith(prefix)) continue
    if (activeSessions[key]?.status === 'running') return 'running'
    hasIdle = true
  }
  return hasIdle ? 'idle' : null
}

export function Sidebar({
  onSelectProject, selectedId, activeSessions, collapsed, onToggleCollapsed,
  persistedSessions, activeSessionKey, onSelectChat, onCloseChat, onRenameChat,
  projects = [], initialAppearance,
}) {
  // `projects` comes from the parent (App.jsx's MainLayout) — a single
  // source of truth shared with the "start new chat" surfaces (StartChatCTA/
  // SessionTabs). Sidebar used to fetch its own independent copy here, which
  // meant registering a global agent refreshed the sidebar's badges but left
  // the start-chat buttons (fed by App.jsx's separate copy) stale until a
  // full page reload. Agents can no longer be registered from the v1 layout
  // at all (that moved to the v2 "Configuração" screen), but the single
  // source of truth stays — it is what keeps the two surfaces consistent.
  const [online, setOnline] = useState(false)
  // Fase 4 (UI-SPEC): toggle segmentado — default "projetos" (comportamento
  // atual inalterado até o usuário optar por ver os chats abertos).
  const [segment, setSegment] = useState('projetos')

  useEffect(() => {
    api.fetchStatus()
      .then(() => setOnline(true))
      .catch(() => setOnline(false))
  }, [])

  // Fase 4 (ADR-01): "Chats Abertos" vem de persistedSessions (sessions.db via
  // /api/sessions/persisted) — sobrevive a reload/dias/PTY morto, não do
  // estado local de terminais montados. session_key é sempre
  // "{projectId}::{agentId}" ou "{projectId}::{agentId}::{sufixo}" (instância
  // extra); os dois primeiros segmentos bastam para reabrir via startSession.
  const openChats = Object.keys(persistedSessions || {}).map((sessionKey) => {
    const [projectId, agentId] = sessionKey.split('::')
    return { sessionKey, projectId, agentId, display_name: persistedSessions[sessionKey]?.display_name }
  })
  const attentionCount = openChats.filter((s) => persistedSessions?.[s.sessionKey]?.needs_attention).length
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]))
  const labeledChats = tabLabels(openChats, (s) => {
    const proj = projectsById[s.projectId]
    return (proj?.agentes || []).find((a) => a.id === s.agentId)
  })

  // Sem mais o modal de agentes pendurado ao lado, o retorno é só a sidebar
  // em si — os dois ramos (colapsada/expandida) dispensam o fragmento.
  return (
    <>
      {collapsed ? (
        <div style={styles.sidebar(true)}>
          <div style={styles.header(true)}>
            <button
              style={styles.toggleBtn}
              onClick={onToggleCollapsed}
              title="Mostrar projetos"
              aria-label="Mostrar barra lateral"
            >
              ☰
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.sidebar(false)}>
          <div style={styles.header(false)}>
            <div>
              <div style={styles.title}>TaskNexus</div>
              <div style={styles.statusRow}>
                <span className={`status-dot ${online ? 'status-dot--active' : ''}`}
                      style={{ background: online ? 'var(--accent-green)' : 'var(--text-muted)' }} />
                {online ? 'Tailscale conectado' : 'Backend offline'}
              </div>
            </div>
            <div style={styles.headerActions}>
              <button
                style={styles.toggleBtn}
                onClick={onToggleCollapsed}
                title="Esconder barra lateral"
                aria-label="Esconder barra lateral"
              >
                ‹
              </button>
            </div>
          </div>

          <div style={styles.toggleWrap}>
            <div style={styles.toggleTrack} role="tablist">
              <button
                role="tab"
                aria-selected={segment === 'chats'}
                style={styles.toggleSegment(segment === 'chats')}
                onClick={() => setSegment('chats')}
              >
                Chats
                {attentionCount > 0 && <span style={styles.toggleBadge}>{attentionCount}</span>}
              </button>
              <button
                role="tab"
                aria-selected={segment === 'projetos'}
                style={styles.toggleSegment(segment === 'projetos')}
                onClick={() => setSegment('projetos')}
              >
                Projetos
              </button>
            </div>
          </div>

          <div style={styles.list}>
            {segment === 'projetos' ? (
              <>
                <div style={styles.sectionLabel}>Projetos</div>
                {projects.map(p => {
                  const isChild = p.id.includes('/')
                  const hasAgents = p.agentes && p.agentes.length > 0
                  const status = projectStatus(activeSessions, p.id)

                  return (
                    <div
                      key={p.id}
                      style={styles.item(selectedId === p.id, isChild, hasAgents)}
                      onClick={() => onSelectProject(p)}
                    >
                      <div style={styles.itemName(selectedId === p.id)} title={p.nome}>
                        <StatusDot status={status} />
                        {isChild ? `↳ ${p.nome}` : p.nome}
                      </div>
                      <div style={styles.badges}>
                        <AgentBadges agentes={p.agentes} />
                      </div>
                    </div>
                  )
                })}
              </>
            ) : openChats.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyHeading}>Nenhum chat aberto</div>
                <div style={styles.emptyBody}>Toque em "Projetos" para iniciar uma conversa com um agente.</div>
              </div>
            ) : (
              <>
                <div style={styles.sectionLabel}>Chats Abertos</div>
                {labeledChats.map((s) => {
                  // status ao vivo vem de activeSessions (só existe com PTY rodando);
                  // needs_attention vem de persistedSessions (sobrevive sem PTY vivo).
                  const live = activeSessions?.[s.sessionKey]
                  const needsAttention = persistedSessions?.[s.sessionKey]?.needs_attention
                  const proj = projectsById[s.projectId]
                  return (
                    <div
                      key={s.sessionKey}
                      style={styles.chatRow(s.sessionKey === activeSessionKey)}
                      onClick={() => onSelectChat(s)}
                    >
                      <StatusDot status={live?.status} needsAttention={needsAttention} known />
                      <RenameableLabel
                        value={s.label}
                        onRename={(name) => onRenameChat(s.sessionKey, name)}
                        style={styles.chatLabel}
                        ariaLabel={`Renomear ${s.label}`}
                      />
                      <span style={styles.chatProject} title={proj?.nome || s.projectId}>{proj?.nome || s.projectId}</span>
                      <button
                        style={styles.chatCloseBtn}
                        title="Encerrar este chat"
                        aria-label={`Encerrar ${s.label}`}
                        onClick={(e) => { e.stopPropagation(); onCloseChat(s.sessionKey) }}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* Rodapé fixo: `styles.list` acima é flex:1 dentro de uma coluna
              flex, então este bloco assenta no fim da sidebar sem precisar de
              margin-top:auto. Só no ramo expandido — na sidebar colapsada
              (44px) não cabe, e o próprio toggle já é o caminho para
              reexpandir e chegar aqui. */}
          <AppearanceSwitch initialAppearance={initialAppearance} />
        </div>
      )}
    </>
  )
}
