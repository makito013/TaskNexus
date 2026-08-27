// frontend/src/layouts/v2/ChatSidebarV2.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 14): coluna de conversas do
// v2 (280px) — consome DIRETAMENTE os mesmos dados/handlers que Sidebar.jsx
// (v1) já usa para sua aba "Chats Abertos": persistedSessions/activeSessions
// (via useTerminal(), repassados por AppV2), onSelectChat/onRenameChat/
// onCloseChat = selectSession+startSession/renameSession/terminateSession já
// existentes, e tabLabels (utils/sessionLabels.js) para o texto exibido —
// SEM estado novo próprio para a lista em si.
//
// Anel de "pensando/processando": mesmo campo de status que Sidebar.jsx v1 já
// lê (activeSessions[key]?.status === 'running'), só o visual muda — ver
// .v2-chat-avatar--running em layouts/v2/theme.css.
//
// Feature Clientes na sidebar v2 (Bloco D): substitui o agrupamento por
// PROJETO por agrupamento por CLIENTE (`clienteIdFromProjetoId`,
// utils/clientes.js), espelhando a mudança da coluna da esquerda
// (SidebarV2.jsx agora lista clientes, não projetos):
//   - Cliente específico selecionado (`selectedClienteId != null`): lista
//     ÚNICA (sem sub-agrupamento por sub-projeto) só com as sessões daquele
//     cliente, cada linha mostrando em qual sub-projeto/raiz ela vive
//     ("Raiz" quando o chat está no próprio cliente, nome do sub-projeto
//     senão).
//   - "Todos" (`selectedClienteId == null`): TODAS as sessões, agrupadas por
//     cliente (cabeçalho = nome do cliente) — mesma lógica de agrupamento de
//     antes, só trocando a chave de agrupamento de `projectId` pra
//     `clienteIdFromProjetoId(projectId)`.
//
// Lookup de agente: trocado de `project.agentes` (por projeto) pra
// `useAgentSettings()` (registro GLOBAL de /api/agents) — chats agora podem
// ser criados com QUALQUER agente cadastrado (ver NewChatSheet.jsx), não só
// os configurados no `.escritorio/agents.yaml` do projeto específico, então o
// lookup por projeto ficaria incompleto/desatualizado. Fallback pro
// `agentId` cru quando não encontrado, mesmo contrato de antes.
//
// "+ Novo chat" não abre mais um dropdown inline de agente nem spawna direto
// quando o projeto tem só 1 agente — sempre abre o NewChatSheet (bottom
// sheet). Em "Todos" o sheet abre do mesmo jeito, só que
// com um select extra de CLIENTE como primeiro campo (ver NewChatSheet.jsx)
// — só fica desabilitado quando o cliente selecionado é órfão (não existe
// mais em `projects`), caso em que não há como montar um sheet coerente.
//
// Etapa 7 (plano de fix, RF02): coluna vira recolhível pra um "rail" estreito
// — mesmo padrão 240px<->68px (aqui 280px<->68px) que SidebarV2 já usa hoje,
// escondendo o header ("+ Novo chat") quando `collapsed`. Largura e transição
// vêm de collapseLayout.js (fonte única compartilhada com SidebarV2) — ver
// comentário lá sobre por que a duração não pode divergir.
//
// Retrabalho pontual (pedido literal do Bruno): a LISTA em si (ChatList) não
// some mais completamente quando `collapsed` — ver ChatList.jsx — cada chat
// continua visível como avatar clicável (nome/meta/botão de fechar é que
// somem), mesmo padrão do NavTabs.jsx pro nav de telas.
//
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 9): a lista de
// chats (renderChatRow/resolveRowMeta/listContent) foi extraída para
// ChatList.jsx (reaproveitada por MobileChatSheet.jsx, que NÃO passa
// `collapsed` — visual do modal mobile não muda) — este arquivo agora só
// cuida do header ("+ Novo chat" + toggle de colapso) e do NewChatSheet,
// delegando a lista propriamente dita.

import { useState } from 'react';
import { NewChatSheet } from './NewChatSheet.jsx';
import { ChatList } from './ChatList.jsx';
import { COLLAPSED_WIDTH, SIDEBAR_TRANSITION } from './collapseLayout.js';
import { isClienteId } from '../../utils/clientes.js';

const EXPANDED_WIDTH = '280px';

const styles = {
  column: (collapsed) => ({
    width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    borderRight: '1px solid var(--v2-border)',
    background: 'var(--v2-surface)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    transition: SIDEBAR_TRANSITION,
  }),
  header: (collapsed) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'space-between',
    gap: '8px',
    padding: collapsed ? '14px 8px' : '14px 14px 10px',
    flexShrink: 0,
  }),
  toggleBtn: {
    width: 'var(--touch-target, 44px)',
    height: 'var(--touch-target, 44px)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--v2-border)',
    borderRadius: '8px',
    color: 'var(--v2-text-dim)',
    cursor: 'pointer',
    fontSize: '14px',
  },
  newChatBtn: (disabled) => ({
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    minHeight: 'var(--touch-target, 44px)',
  }),
};

export function ChatSidebarV2({
  projects = [],
  activeSessionKey,
  activeSessions,
  persistedSessions,
  selectedClienteId,
  onSelectChat,
  onRenameChat,
  onCloseChat,
  onStartNewChat,
  collapsed = false,
  onToggleCollapsed,
}) {
  const [newChatSheetOpen, setNewChatSheetOpen] = useState(false);
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const clientes = projects.filter((p) => isClienteId(p.id));

  const selectedCliente = selectedClienteId != null ? (projectsById[selectedClienteId] || null) : null;

  // Cliente "órfão": selectedClienteId aponta pra um id que não existe (mais)
  // em `projects` — pode acontecer porque useProjects() só busca uma vez no
  // mount, sem refetch, então a lista pode ficar desatualizada em relação à
  // seleção. Sem essa checagem, `selectedCliente` fica null e o sheet abre
  // sem cliente válido (handleSubmit do NewChatSheet faz `cliente.id`, que
  // derrubaria a árvore inteira com TypeError). Achado do QA. "Todos"
  // (`noClienteSelecionado`) NÃO conta mais como desabilitado — vira o modo
  // "escolher cliente dentro do sheet".
  const noClienteSelecionado = selectedClienteId == null;
  const clienteOrfao = !noClienteSelecionado && !selectedCliente;
  const newChatDisabled = clienteOrfao;

  const handleNewChatClick = () => {
    if (newChatDisabled) return;
    setNewChatSheetOpen(true);
  };

  return (
    <div style={styles.column(collapsed)}>
      <div style={styles.header(collapsed)}>
        {!collapsed && (
          <button
            type="button"
            style={styles.newChatBtn(newChatDisabled)}
            onClick={handleNewChatClick}
            disabled={newChatDisabled}
            title={
              clienteOrfao
                ? 'Cliente selecionado não encontrado em projects'
                : noClienteSelecionado
                ? 'Novo chat — escolha o cliente'
                : `Novo chat em ${selectedCliente?.nome || selectedClienteId}`
            }
          >
            + Novo chat
          </button>
        )}
        <button
          type="button"
          style={styles.toggleBtn}
          onClick={onToggleCollapsed}
          title={collapsed ? 'Mostrar conversas' : 'Esconder conversas'}
          aria-label={collapsed ? 'Mostrar conversas' : 'Esconder conversas'}
        >
          {collapsed ? '☰' : '‹'}
        </button>
      </div>

      <ChatList
        projects={projects}
        activeSessionKey={activeSessionKey}
        activeSessions={activeSessions}
        persistedSessions={persistedSessions}
        selectedClienteId={selectedClienteId}
        onSelectChat={onSelectChat}
        onRenameChat={onRenameChat}
        onCloseChat={onCloseChat}
        selectedCliente={selectedCliente}
        collapsed={collapsed}
      />

      {!clienteOrfao ? (
        <NewChatSheet
          open={newChatSheetOpen}
          onClose={() => setNewChatSheetOpen(false)}
          cliente={selectedCliente}
          clientes={clientes}
          onSubmit={onStartNewChat}
        />
      ) : null}
    </div>
  );
}
