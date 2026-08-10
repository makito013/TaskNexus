// frontend/src/layouts/v1/AppV1.jsx
//
// Milestone 1 (plano Layout v2, 05-TL.md): extração LITERAL do antigo
// `MainLayout` (que vivia dentro de App.jsx) para este arquivo próprio —
// App.jsx virou um composition root fino que escolhe entre este layout (v1)
// e o v2 (layouts/v2/AppV2.jsx, real a partir do Milestone 2).
//
// Deliberadamente NÃO reorganizado/limpo ao mover: o Arquiteto e o TL
// avisaram que há uma dependência sutil de CSS entre `.app-root` (definida
// em index.css) e `.app-shell-routed-content` (definida inline em App.jsx)
// que já causou um bug de layout cortado no passado (ver comentário na
// Tarefa 17 em App.jsx) — qualquer alteração na estrutura de containers ao
// mover este código arrisca reintroduzir esse bug. A estrutura de divs/CSS
// abaixo é idêntica à versão anterior, só os imports relativos mudaram
// (agora um nível a mais de profundidade: layouts/v1/ em vez de raiz de src/).

import { useRef, useCallback } from 'react';
import { Sidebar } from '../../components/Sidebar.jsx';
import { useTerminal } from '../../components/TerminalContext.jsx';
import { TerminalPanel } from '../../components/TerminalPanel.jsx';
import { IpadToolbar } from '../../components/IpadToolbar.jsx';
import { StartChatCTA } from '../../components/StartChatCTA.jsx';
import { SessionTabs } from '../../components/SessionTabs.jsx';
import { TasksDrawer } from '../../components/TasksDrawer.jsx';
import { useTasks } from '../../hooks/useTasks.js';
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 12): useProjects/
// useSidebarCollapsed foram extraídos daqui para módulos compartilhados em
// hooks/ para que layouts/v2/AppV2.jsx os reaproveite sem duplicar a lógica
// de fetch de projetos / persistência do colapso da sidebar. Comportamento
// idêntico ao anterior — só a localização do código mudou.
import { useProjects } from '../../hooks/useProjects.js';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed.js';

// `initialAppearance` é repassado até Sidebar.jsx só para alimentar o
// <AppearanceSwitch> do rodapé de lá — AppV1 em si não lê esse valor para
// nada além de repassar adiante. (Antes ele descia um nível a mais, até o
// AgentSettingsModal.jsx; esse modal foi aposentado junto com a tela v1 de
// agentes, e o AppearanceSwitch subiu para a própria sidebar — ver o
// cabeçalho de Sidebar.jsx.)
export function AppV1({ initialAppearance }) {
  const {
    sessions,
    activeSessionKey,
    selectedProjectId,
    selectProject,
    startSession,
    startNewInstance,
    terminateSession,
    renameSession,
    activeSessions,
    persistedSessions,
  } = useTerminal();

  // Só a lista: o refetch (2º elemento de useProjects) existia aqui para
  // reagir a mutações de agente feitas no modal do v1. Sem esse modal, o v1
  // não muta mais nada de /api/projects — quem faz isso é a tela
  // "Configuração" do v2, que tem seu próprio refetch (AppV2.jsx passa
  // `refreshProjects` como `onAgentsChanged`).
  const [projects] = useProjects();
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();

  const {
    tasksBySession,
    pendingCounts,
    drawerOpen: tasksDrawerOpen,
    openDrawer: openTasksDrawer,
    closeDrawer: closeTasksDrawer,
    createTask,
    completeTask,
    uncompleteTask,
    continueSession,
  } = useTasks(activeSessionKey);

  const handleToggleTasks = () => (tasksDrawerOpen ? closeTasksDrawer() : openTasksDrawer());

  // activePanelRef: always points to the currently active TerminalPanel instance
  const activePanelRef = useRef(null);

  // Per-session refs map so we can attach forwardRefs to each TerminalPanel
  const panelRefsMap = useRef({});
  const getPanelRef = useCallback((sessionKey) => {
    if (!panelRefsMap.current[sessionKey]) {
      panelRefsMap.current[sessionKey] = { current: null };
    }
    return panelRefsMap.current[sessionKey];
  }, []);

  const handleSelectProject = (proj) => selectProject(proj.id);

  const handleStartAgent = (agentId) => {
    if (!selectedProjectId) return;
    startNewInstance(selectedProjectId, agentId);
  };

  const handleCloseTab = async (key) => {
    if (window.confirm('Encerrar esta sessão? O processo PTY será terminado no servidor.')) {
      await terminateSession(key);
    }
  };

  /** Fase 4: seleção a partir da lista global "Chats Abertos" (fonte:
   * persistedSessions — pode incluir chats sem PTY vivo agora). Pode vir de
   * um projeto diferente do atualmente selecionado, então também troca o
   * projeto selecionado (SessionTabs/start-buttons do painel principal
   * dependem disso). startSession reconecta via --resume se o PTY já morreu. */
  const handleSelectChat = (session) => {
    selectProject(session.projectId);
    startSession(session.sessionKey, session.projectId, session.agentId);
  };

  /** Switching tabs reuses startSession — it's a no-op mount for an already-
   * mounted session (see startSession's own dedupe check), so this only
   * flips activeSessionKey without touching the PTY. */
  const handleSelectTab = (key) => {
    const s = projectSessions.find((ps) => ps.sessionKey === key);
    if (s) startSession(s.sessionKey, s.projectId, s.agentId);
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectSessions = sessions.filter((s) => s.projectId === selectedProjectId);

  return (
    <div className="app-root" style={{ display: 'flex', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      <Sidebar
        onSelectProject={handleSelectProject}
        selectedId={selectedProjectId}
        activeSessions={activeSessions}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        persistedSessions={persistedSessions}
        activeSessionKey={activeSessionKey}
        onSelectChat={handleSelectChat}
        onCloseChat={handleCloseTab}
        onRenameChat={renameSession}
        projects={projects}
        initialAppearance={initialAppearance}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {selectedProjectId && projectSessions.length > 0 && (
          <>
            <SessionTabs
              project={selectedProject}
              projectSessions={projectSessions}
              activeSessionKey={activeSessionKey}
              activeSessions={activeSessions}
              persistedSessions={persistedSessions}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onAddInstance={handleStartAgent}
              onRenameTab={renameSession}
              pendingTaskCounts={pendingCounts}
              tasksDrawerOpen={tasksDrawerOpen}
              onToggleTasks={handleToggleTasks}
            />
            {/* iPad toolbar — renders only on touch devices (D-09) */}
            <IpadToolbar panelRef={activePanelRef} />
          </>
        )}

        {/* Tarefas drawer (Designer decision 1). Note: TasksDrawer's panel and
            backdrop use position:fixed, so they're viewport-relative — WHERE
            this is mounted in the tree has no layout effect either way. The
            drawer PANEL avoids the Sidebar simply by being right-aligned and
            narrow (max ~420px / 90vw). The tap-to-close BACKDROP intentionally
            dims the full viewport, including the Sidebar — standard overlay
            UX, and decision 1 only requires backdrop-tap-to-close, not that
            the dimming itself be scoped. */}
        <TasksDrawer
          open={tasksDrawerOpen}
          sessionKey={activeSessionKey}
          tasks={activeSessionKey ? (tasksBySession[activeSessionKey] || []) : []}
          onClose={closeTasksDrawer}
          onCreateTask={createTask}
          onCompleteTask={completeTask}
          onUncompleteTask={uncompleteTask}
          onContinue={continueSession}
        />

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', background: 'var(--bg-surface)', overflow: 'hidden' }}>
          {!selectedProjectId ? (
            /* No project selected */
            <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '16px' }}>🖥️</div>
              <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                Nenhum projeto selecionado
              </div>
              Selecione um projeto na barra lateral.
            </div>
          ) : (
            /* Terminal panels ALWAYS render, regardless of which project is
               selected or whether it has any session yet, so switching
               projects never tears down an unrelated, already-mounted
               background session (see
               .planning/debug/blank-terminal-on-return.md CO-CAUSE A). Each
               entry's own display:none/flex toggle below already hides inactive
               sessions without unmounting them. StartChatCTA overlays as an
               ADDITIONAL sibling — never a replacement — only when the
               selected project has no session yet. */
            <>
              {sessions.map((session) => {
                const panelRef = getPanelRef(session.sessionKey);
                const isActive = session.sessionKey === activeSessionKey;
                // NOTE: activePanelRef is updated ONLY in the ref callback below
                // (which React runs after commit). Mutating a ref during render
                // is unsafe under StrictMode/concurrent rendering — see 03-REVIEW WR-01.

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
                        panelRef.current = el;
                        if (isActive) activePanelRef.current = el;
                      }}
                      sessionKey={session.sessionKey}
                      projectId={session.projectId}
                      agentId={session.agentId}
                      visible={isActive}
                    />
                  </div>
                );
              })}
              {projectSessions.length === 0 && (
                <StartChatCTA
                  project={selectedProject}
                  activeSessions={activeSessions}
                  onStartAgent={handleStartAgent}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
