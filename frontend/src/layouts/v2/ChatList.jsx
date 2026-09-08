// frontend/src/layouts/v2/ChatList.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 9): extraído de
// ChatSidebarV2.jsx — SÓ `renderChatRow` + `resolveRowMeta` + a árvore
// `listContent` (3 variantes: cliente específico / "Todos" agrupado / vazio
// total) + estilos de lista/row/group. NÃO inclui o header ("+ Novo chat" +
// botão de colapsar) nem o NewChatSheet — isso continua em ChatSidebarV2.jsx,
// que passa a delegar `listContent` para <ChatList {...props} />.
//
// Reaproveitado por MobileChatSheet.jsx (Tarefa 10) via o prop opcional
// `renderEmptyState`, necessário porque o modal mobile precisa de um estado
// vazio visualmente diferente (ícone 💬 + botão "+ Novo chat" em destaque)
// do texto simples usado pela coluna desktop.
//
// `collapsed` (retrabalho pontual, pedido literal do Bruno — ver
// ClienteList.jsx para o mesmo padrão do lado dos clientes): default `false`
// — SÓ ChatSidebarV2.jsx (desktop) passa esta prop; MobileChatSheet.jsx usa
// este componente sem passá-la, então seu visual não muda em nada. Quando
// `true`: em cada linha, `rowBody` (nome+meta) e o botão de fechar (×) somem
// — o × fica escondido de propósito (faixa de 68px não tem espaço confortável
// pro alvo de toque sem risco de encerrar uma sessão sem querer; reabrir a
// coluna continua sendo o caminho pra fechar um chat) — só o avatar
// (`.v2-chat-avatar`, com o anel de "rodando" quando aplicável) e o onClick de
// seleção no `row` inteiro continuam. `groupLabel` (nome do cliente entre
// grupos, no modo "Todos") também some — os avatares de clientes diferentes
// ficam numa lista contínua sem separador de texto. Estado vazio
// (`emptyState`) não renderiza nada (sem espaço pro texto).

import { tabLabels } from '../../utils/sessionLabels.js';
import { RenameableLabel } from '../../components/RenameableLabel.jsx';
import { clienteIdFromProjetoId } from '../../utils/clientes.js';
import { useAgentSettings } from '../../hooks/useAgentSettings.js';
import { relativeProjectPath, truncatePathMeta } from '../../utils/projects.js';

const styles = {
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 8px 12px',
  },
  groupLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--v2-text-faint)',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    padding: '10px 8px 4px',
  },
  row: (active, collapsed) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: '10px',
    padding: '8px',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '2px',
    background: active ? 'var(--v2-surface-2)' : 'transparent',
  }),
  rowBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  rowLabel: {
    fontSize: '13px',
    color: 'var(--v2-text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowMeta: {
    fontSize: '11px',
    // WCAG 1.4.3 (correção da auditoria de Acessibilidade): --v2-text-faint
    // mede 2,65-4,00:1 nos dois temas nesta linha, abaixo do mínimo 4,5:1.
    // --v2-text-dim passa (4,70-5,95:1). Ver tokens.json (chatRowMeta.color).
    color: 'var(--v2-text-dim)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--v2-text-faint)',
    cursor: 'pointer',
    fontSize: '15px',
    lineHeight: 1,
    padding: '2px 4px',
    flexShrink: 0,
  },
  emptyState: {
    padding: '24px 14px',
    textAlign: 'center',
    color: 'var(--v2-text-faint)',
    fontSize: '12px',
  },
};

function initialsFor(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

// Texto COMPLETO (nunca truncado) de exibição de um sub-projeto/raiz na
// linha do chat: "Raiz" quando o chat vive no próprio cliente
// (`projectId === clienteId`); profundidade >= 2 (2+ segmentos abaixo do
// cliente) usa o caminho relativo inteiro (`relativeProjectPath`); senão
// (profundidade 1, filho direto) o nome do sub-projeto resolvido em
// `projectsById` (fallback pro id cru, projeto desconhecido) — mesmo
// comportamento de antes para esse caso.
function resolveRowMetaFull(projectId, clienteId, projectsById) {
  if (projectId === clienteId) return 'Raiz';
  const depth = projectId.split('/').length - 1;
  if (depth >= 2) return relativeProjectPath(projectId, clienteId);
  return projectsById[projectId]?.nome || projectId;
}

// Nome de exibição — igual a `resolveRowMetaFull`, exceto que profundidade
// >= 2 é truncado pela CABEÇA (`truncatePathMeta`, budget 2) pra não quebrar
// em 2 linhas com caminhos longos. O texto completo (sem truncar) fica
// disponível via `resolveRowMetaFull`, usado no `title` da linha.
function resolveRowMeta(projectId, clienteId, projectsById) {
  const full = resolveRowMetaFull(projectId, clienteId, projectsById);
  const depth = projectId.split('/').length - 1;
  if (depth >= 2) return truncatePathMeta(full, 2);
  return full;
}

const defaultRenderEmptyState = (clienteNome) => (
  <div style={styles.emptyState}>
    Nenhum chat aberto para {clienteNome}. Toque em &quot;+ Novo chat&quot; para começar.
  </div>
);

export function ChatList({
  projects = [],
  activeSessionKey,
  activeSessions,
  persistedSessions,
  selectedClienteId,
  onSelectChat,
  onRenameChat,
  onCloseChat,
  selectedCliente,
  renderEmptyState = defaultRenderEmptyState,
  collapsed = false,
}) {
  const { agents: globalAgents } = useAgentSettings();
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));

  // Mesma fonte de verdade que Sidebar.jsx v1 usa para "Chats Abertos" —
  // persistedSessions sobrevive a reload/PTY morto, diferente de activeSessions.
  const openChats = Object.keys(persistedSessions || {}).map((sessionKey) => {
    const [projectId, agentId] = sessionKey.split('::');
    return { sessionKey, projectId, agentId, display_name: persistedSessions[sessionKey]?.display_name };
  });

  // Lookup de agente pelo registro GLOBAL (não `project.agentes`) — mesma
  // decisão documentada em ChatSidebarV2.jsx.
  const labeledChats = tabLabels(openChats, (s) => globalAgents.find((a) => a.id === s.agentId));

  const noChatsAtAll = labeledChats.length === 0;

  const renderChatRow = (chat, rowMetaLabel, rowMetaTitle) => {
    const running = activeSessions?.[chat.sessionKey]?.status === 'running';
    const active = chat.sessionKey === activeSessionKey;
    return (
      <div
        key={chat.sessionKey}
        style={styles.row(active, collapsed)}
        onClick={() => onSelectChat(chat)}
        title={rowMetaTitle}
      >
        <span
          className={`v2-chat-avatar${running ? ' v2-chat-avatar--running' : ''}`}
          title={collapsed ? chat.label : undefined}
        >
          {initialsFor(chat.label)}
        </span>
        {!collapsed && (
          <div style={styles.rowBody}>
            <RenameableLabel
              value={chat.label}
              onRename={(name) => onRenameChat(chat.sessionKey, name)}
              style={styles.rowLabel}
              ariaLabel={`Renomear ${chat.label}`}
            />
            <span style={styles.rowMeta}>{rowMetaLabel}</span>
          </div>
        )}
        {!collapsed && (
          <button
            type="button"
            style={styles.closeBtn}
            title="Encerrar este chat"
            aria-label={`Encerrar ${chat.label}`}
            onClick={(e) => { e.stopPropagation(); onCloseChat(chat.sessionKey); }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  let listContent;
  if (selectedClienteId != null) {
    // Lista única (sem sub-agrupamento) só com as sessões do cliente
    // selecionado.
    const filteredChats = labeledChats.filter(
      (chat) => clienteIdFromProjetoId(chat.projectId) === selectedClienteId
    );
    if (filteredChats.length === 0) {
      // Collapsed: sem espaço pro texto do estado vazio — omite o bloco.
      const clienteNome = selectedCliente?.nome || selectedClienteId;
      listContent = collapsed ? null : renderEmptyState(clienteNome);
    } else {
      listContent = filteredChats.map((chat) =>
        renderChatRow(
          chat,
          resolveRowMeta(chat.projectId, selectedClienteId, projectsById),
          resolveRowMetaFull(chat.projectId, selectedClienteId, projectsById)
        )
      );
    }
  } else if (noChatsAtAll) {
    // Collapsed: idem — sem espaço pro texto do estado vazio.
    listContent = collapsed ? null : <div style={styles.emptyState}>Nenhum chat aberto ainda.</div>;
  } else {
    // "Todos": agrupa por CLIENTE (não mais por projeto), preservando a
    // ordem de primeira aparição.
    const groups = [];
    const groupIndexByClienteId = {};
    for (const chat of labeledChats) {
      const clienteId = clienteIdFromProjetoId(chat.projectId);
      if (!(clienteId in groupIndexByClienteId)) {
        groupIndexByClienteId[clienteId] = groups.length;
        groups.push({ clienteId, chats: [] });
      }
      groups[groupIndexByClienteId[clienteId]].chats.push(chat);
    }

    listContent = groups.map((group) => {
      const cliente = projectsById[group.clienteId];
      return (
        <div key={group.clienteId} data-testid={`chat-group-${group.clienteId}`}>
          {!collapsed && (
            <div style={styles.groupLabel} data-testid={`chat-group-label-${group.clienteId}`}>
              {cliente?.nome || group.clienteId}
            </div>
          )}
          {group.chats.map((chat) =>
            renderChatRow(
              chat,
              resolveRowMeta(chat.projectId, group.clienteId, projectsById),
              resolveRowMetaFull(chat.projectId, group.clienteId, projectsById)
            )
          )}
        </div>
      );
    });
  }

  return <div style={styles.list}>{listContent}</div>;
}
