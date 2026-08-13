// frontend/src/layouts/v2/ChatV2.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 14): coluna de chat do v2 —
// monta o MESMO <TerminalPanel> real (xterm.js + WebSocket PTY) que
// layouts/v1/AppV1.jsx já usa, com as MESMAS props (sessionKey/projectId/
// agentId/visible — conferidas em AppV1.jsx). Decisão já fechada do TL: SEM
// bolhas de mensagem mockadas, SEM textarea/composer decorativo separado — o
// TerminalPanel ocupa sozinho o espaço de mensagens+composer combinadas.
//
// Todas as sessões MONTADAS (prop `sessions`, o array de useTerminal(), não
// persistedSessions) ficam sempre no DOM, com display:none quando inativas —
// mesma decisão de AppV1.jsx (evita desmontar/reconectar uma sessão de fundo
// já viva ao trocar de chat ativo).

import { useState } from 'react';
import { TerminalPanel } from '../../components/TerminalPanel.jsx';
import { TaskQuickCreatePopover } from './TaskQuickCreatePopover.jsx';
import { TerminalShortcutsFab } from './TerminalShortcutsFab.jsx';

const styles = {
  column: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--v2-bg)',
  },
  header: {
    // Container externo: centraliza verticalmente (não mais baseline) e empurra
    // o "+ Tarefa" pro canto direito via space-between (Tarefa 8, Designer).
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '6px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface)',
    flexShrink: 0,
  },
  headerInner: {
    // Sub-grupo (nome do agente + nome do projeto) mantém o alinhamento
    // baseline entre si que o header tinha antes.
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    minWidth: 0,
  },
  taskButton: {
    // Ação Tier 2 (secundária, baixa frequência): altura FIXA (não minHeight —
    // não pode inflar com métricas de fonte), pílula transparente em repouso.
    flexShrink: 0,
    height: '24px',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text)',
    cursor: 'pointer',
  },
  headerName: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  headerProject: {
    fontSize: '12px',
    color: 'var(--v2-text-faint)',
  },
  content: {
    flex: 1,
    display: 'flex',
    position: 'relative',
    overflow: 'hidden',
  },
  empty: {
    margin: 'auto',
    color: 'var(--v2-text-faint)',
    fontSize: '13px',
    textAlign: 'center',
    maxWidth: '280px',
    padding: '0 24px',
  },
};

export function ChatV2({ sessions = [], activeSessionKey, projects = [], onCreateTask, activePanelRef }) {
  const [taskPopoverOpen, setTaskPopoverOpen] = useState(false);
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const activeSession = sessions.find((s) => s.sessionKey === activeSessionKey) || null;
  const activeProject = activeSession ? projectsById[activeSession.projectId] : null;
  const activeAgent = (activeProject?.agentes || []).find((a) => a.id === activeSession?.agentId) || null;

  return (
    <div style={styles.column}>
      {activeSession && (
        <div style={styles.header}>
          <div style={styles.headerInner}>
            <span style={styles.headerName}>{activeAgent?.nome || activeSession.agentId}</span>
            <span style={styles.headerProject}>{activeProject?.nome || activeSession.projectId}</span>
          </div>
          <button
            type="button"
            style={styles.taskButton}
            onClick={() => setTaskPopoverOpen(true)}
          >
            + Tarefa
          </button>
        </div>
      )}

      {/* Mesmo gate do header acima, e pelo mesmo motivo: sem sessão ativa não
          há painel/PTY pra receber os bytes de atalho, então o FAB não tem em
          quem atuar. Onde ele aparece na árvore não importa mais pro layout —
          o FAB e o painel que ele abre são `position: fixed`, overlays que não
          ocupam espaço em fluxo (era o problema da barra fixa que ele
          substituiu, que comia ~56px de altura do terminal permanentemente).
          Continua aqui, e NÃO num portal pro document.body, de propósito: ver a
          armadilha do `display: none` documentada em TerminalShortcutsFab.jsx. */}
      {activeSession && (
        <TerminalShortcutsFab terminalRef={activePanelRef} sessionKey={activeSession.sessionKey} />
      )}

      <TaskQuickCreatePopover
        open={taskPopoverOpen}
        onClose={() => setTaskPopoverOpen(false)}
        sessionKey={activeSession?.sessionKey}
        projects={projects}
        onCreateTask={onCreateTask}
      />

      <div style={styles.content}>
        {sessions.map((session) => {
          const isActive = session.sessionKey === activeSessionKey;
          return (
            <div
              key={session.sessionKey}
              data-session-key={session.sessionKey}
              style={{
                display: isActive ? 'flex' : 'none',
                flexDirection: 'column',
                flex: 1,
                width: '100%',
                height: '100%',
              }}
            >
              <TerminalPanel
                ref={(el) => {
                  // NOTE: activePanelRef is updated ONLY here in the ref callback
                  // (React runs this after commit) — mutating a ref during render
                  // is unsafe under StrictMode/concurrent rendering, same guard
                  // already followed by layouts/v1/AppV1.jsx's activePanelRef.
                  if (isActive && activePanelRef) activePanelRef.current = el;
                }}
                sessionKey={session.sessionKey}
                projectId={session.projectId}
                agentId={session.agentId}
                visible={isActive}
              />
            </div>
          );
        })}

        {!activeSession && (
          <div style={styles.empty}>Selecione um chat na lista ao lado ou inicie uma nova conversa.</div>
        )}
      </div>
    </div>
  );
}
