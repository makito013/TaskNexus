// frontend/src/components/SessionTabs.jsx
// Tab strip for a project's open chat sessions. Supports several simultaneous
// sessions of the SAME agent (e.g. two Claude chats) as well as one tab per
// different configured agent (Claude, Gemini, ...). The small "+ {agente}"
// buttons at the end always start a NEW session for that agent — reusing the
// bare projectId::agentId key if it isn't already an open tab, or a fresh
// instance key otherwise (see TerminalContext.startNewInstance).

import { tabLabels } from '../utils/sessionLabels.js'
import { RenameableLabel } from './RenameableLabel.jsx'

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    background: 'var(--bg-surface-2)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    // Bar itself no longer scrolls as a whole — only the tabs zone below does,
    // so the fixed "Tarefas" zone stays put outside the horizontal scroll.
    overflow: 'hidden',
  },
  scrollZone: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
  },
  fixedZone: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: '8px',
    paddingLeft: '8px',
    borderLeft: '1px solid var(--border)',
  },
  tasksBtn: (open) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: open ? '1px solid var(--border-strong)' : '1px solid transparent',
    background: open ? 'var(--bg-active)' : 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  }),
  tasksBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '999px',
    background: 'var(--state-attention)',
    color: 'var(--bg-base)',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: 1,
  },
  tabBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '15px',
    height: '15px',
    padding: '0 3px',
    borderRadius: '999px',
    background: 'var(--bg-surface-3)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-secondary)',
    fontSize: '9px',
    fontWeight: 700,
    lineHeight: 1,
  },
  tab: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px 6px 12px',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--bg-active)' : 'transparent',
    border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: '12px',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  }),
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: 1,
    padding: '2px 4px',
  },
  addBtn: {
    flexShrink: 0,
    fontSize: '11px',
    padding: '5px 9px',
    borderRadius: 'var(--radius-sm)',
    border: '1px dashed var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
}

export function SessionTabs({ project, projectSessions, activeSessionKey, activeSessions, persistedSessions, onSelectTab, onCloseTab, onAddInstance, onRenameTab, pendingTaskCounts, tasksDrawerOpen, onToggleTasks }) {
  const agentesById = Object.fromEntries((project?.agentes || []).map((a) => [a.id, a]))
  // Fase 4 (D-08): display_name vem de persistedSessions — mesma fonte de
  // verdade usada por Sidebar.jsx, para que o nome renomeado apareça idêntico
  // nas duas superfícies (UI-SPEC seção 2, "mesmo componente/hook").
  const withNames = projectSessions.map((s) => ({
    ...s, display_name: persistedSessions?.[s.sessionKey]?.display_name,
  }))
  const labeled = tabLabels(withNames, (s) => agentesById[s.agentId])
  // Badge só existe para sessões cujas tarefas já foram carregadas ao menos
  // uma vez (drawer aberto nelas) — polling de tarefas só roda com o drawer
  // aberto, então uma sessão nunca visitada simplesmente não tem contagem.
  const activePendingCount = pendingTaskCounts?.[activeSessionKey] || 0

  return (
    <div style={styles.bar}>
      <div style={styles.scrollZone}>
        {labeled.map((s) => {
          const meta = activeSessions?.[s.sessionKey]
          const status = meta?.status
          const isActive = s.sessionKey === activeSessionKey
          // Precedência (04-UI-SPEC.md): running (ciano, pulsante) > idle+needs_attention (âmbar) > idle (verde)
          const dotColor = status === 'running'
            ? 'var(--state-running)'
            : status && meta?.needs_attention
              ? 'var(--state-attention)'
              : status
                ? 'var(--accent-green)'
                : 'var(--text-muted)'
          const tabPending = pendingTaskCounts?.[s.sessionKey] || 0
          return (
            <div key={s.sessionKey} style={styles.tab(isActive)} onClick={() => onSelectTab(s.sessionKey)}>
              <span
                className={`status-dot ${status === 'running' ? 'status-dot--active' : ''}`}
                style={{ background: dotColor }}
              />
              <RenameableLabel
                value={s.label}
                onRename={(name) => onRenameTab(s.sessionKey, name)}
                ariaLabel={`Renomear ${s.label}`}
              />
              {tabPending > 0 && (
                <span style={styles.tabBadge} title={`${tabPending} tarefa(s) pendente(s)`}>{tabPending}</span>
              )}
              <button
                style={styles.closeBtn}
                title="Encerrar este chat"
                aria-label={`Encerrar ${s.label}`}
                onClick={(e) => { e.stopPropagation(); onCloseTab(s.sessionKey) }}
              >
                ×
              </button>
            </div>
          )
        })}
        {(project?.agentes || []).map((agent) => (
          <button
            key={agent.id}
            style={styles.addBtn}
            onClick={() => onAddInstance(agent.id)}
            title={`Iniciar novo chat ${agent.nome}`}
          >
            + {agent.nome}
          </button>
        ))}
      </div>
      {activeSessionKey && (
        <div style={styles.fixedZone}>
          <button
            style={styles.tasksBtn(tasksDrawerOpen)}
            onClick={onToggleTasks}
            aria-label="Tarefas"
            title="Tarefas"
          >
            📋 Tarefas
            {activePendingCount > 0 && (
              <span style={styles.tasksBadge}>{activePendingCount}</span>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
