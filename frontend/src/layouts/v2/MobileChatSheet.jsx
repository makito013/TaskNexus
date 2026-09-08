// frontend/src/layouts/v2/MobileChatSheet.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 10): bottom
// sheet de "chats do cliente" — abre quando o usuário toca num cliente na
// tela Chat do menu mobile (MobileMenuScreen.jsx). Envolve <ChatList/> (área
// rolável) num header fixo (título) + footer fixo ("+ Novo chat"), usando o
// contrato `fixedFooter` de BottomSheet.jsx.
//
// Reaproveita a MESMA lógica de `newChatDisabled` que já vive em
// ChatSidebarV2.jsx (só cliente ÓRFÃO desabilita — "Todos" abre o sheet no
// modo "escolher cliente") — não inventa verificação nova,
// só a duplica aqui já que este componente não tem acesso ao estado interno
// de ChatSidebarV2.
//
// `escapeEnabled={!newChatSheetOpen}` no BottomSheet externo: mitiga ESC
// fechando as duas sheets empilhadas de uma vez quando o NewChatSheet
// (aninhado, seu próprio BottomSheet) está aberto por cima deste.

import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet.jsx';
import { ChatList } from './ChatList.jsx';
import { NewChatSheet } from './NewChatSheet.jsx';
import { isClienteId } from '../../utils/clientes.js';

const styles = {
  header: {
    flexShrink: 0,
    padding: '4px 0 12px',
  },
  title: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    margin: '0 -20px',
    padding: '0 12px',
  },
  emptyState: {
    padding: '32px 20px',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '32px',
    filter: 'grayscale(1)',
    opacity: 0.5,
    marginBottom: '10px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--v2-text-faint)',
    marginBottom: '16px',
  },
  emptyBtn: {
    padding: '0 20px',
    height: '44px',
    borderRadius: '10px',
    border: 'none',
    background: 'var(--v2-accent)',
    color: 'var(--v2-bg)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  footer: {
    flexShrink: 0,
    paddingTop: '12px',
  },
  newChatBtn: (disabled) => ({
    width: '100%',
    height: '48px',
    borderRadius: '10px',
    border: '1px solid var(--v2-border)',
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
};

function titleFor(selectedClienteId, selectedCliente, clienteOrfao) {
  if (selectedClienteId == null) return 'Todos os chats';
  if (clienteOrfao) return 'Cliente não encontrado';
  return `Chats de ${selectedCliente?.nome || selectedClienteId}`;
}

export function MobileChatSheet({
  open,
  onClose,
  projects = [],
  activeSessionKey,
  activeSessions,
  persistedSessions,
  selectedClienteId,
  onSelectChat,
  onRenameChat,
  onCloseChat,
  onStartNewChat,
}) {
  const [newChatSheetOpen, setNewChatSheetOpen] = useState(false);

  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const clientes = projects.filter((p) => isClienteId(p.id));
  const selectedCliente = selectedClienteId != null ? (projectsById[selectedClienteId] || null) : null;

  // Mesma lógica de ChatSidebarV2.jsx: só cliente ÓRFÃO (selecionado mas
  // ausente de `projects`) desabilita "+ Novo chat" — "Todos" abre o sheet
  // no modo "escolher cliente".
  const noClienteSelecionado = selectedClienteId == null;
  const clienteOrfao = !noClienteSelecionado && !selectedCliente;
  const newChatDisabled = clienteOrfao;

  // Achado da Segurança (etapa 9, retrabalho): `open` indo pra `false` fecha
  // o BottomSheet externo (que apenas retorna null — ver BottomSheet.jsx),
  // mas esta instância de MobileChatSheet continua montada (AppV2.jsx sempre
  // a renderiza), então `newChatSheetOpen` sobrevivia ao fechamento. Sem este
  // guard, reabrir o modal fazia o NewChatSheet reaparecer sozinho por cima e
  // deixava `escapeEnabled={!newChatSheetOpen}` (abaixo) preso em `false`.
  // Mesmo padrão do guard de `mobileView` em AppV2.jsx.
  useEffect(() => {
    if (!open) setNewChatSheetOpen(false);
  }, [open]);

  // Second unmount path for the nested NewChatSheet, missed by the guard
  // above: the conditional wrapper `{selectedCliente ? <NewChatSheet/> : null}`
  // below unmounts it whenever `selectedCliente` goes falsy, even while `open`
  // stays true (e.g. the parent deselects the client, or the selected client
  // becomes orphaned). That leaves `newChatSheetOpen` stuck at `true`, so the
  // sheet reappears already open the moment a valid client is selected again
  // — same class of bug as the `open` guard above, different trigger. Depends
  // on `newChatDisabled` (the boolean primitive), not `selectedCliente`
  // itself: `selectedCliente` is looked up via `projectsById`, which is
  // rebuilt via `Object.fromEntries` on every render of this component, so a
  // referential dependency here would re-run the effect on every parent
  // re-render even with no real selection change.
  useEffect(() => {
    if (newChatDisabled) setNewChatSheetOpen(false);
  }, [newChatDisabled]);

  const handleNewChatClick = () => {
    if (newChatDisabled) return;
    setNewChatSheetOpen(true);
  };

  const handleSelectChat = (chat) => {
    onSelectChat(chat);
  };

  const renderEmptyState = (clienteNome) => (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>💬</div>
      <div style={styles.emptyText}>Nenhum chat aberto ainda em {clienteNome}.</div>
      <button type="button" style={styles.emptyBtn} onClick={handleNewChatClick} disabled={newChatDisabled}>
        + Novo chat
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      maxHeightVh={68}
      fixedFooter
      escapeEnabled={!newChatSheetOpen}
    >
      <div style={styles.header}>
        <div style={styles.title}>{titleFor(selectedClienteId, selectedCliente, clienteOrfao)}</div>
      </div>

      <div style={styles.scrollArea}>
        <ChatList
          projects={projects}
          activeSessionKey={activeSessionKey}
          activeSessions={activeSessions}
          persistedSessions={persistedSessions}
          selectedClienteId={selectedClienteId}
          onSelectChat={handleSelectChat}
          onRenameChat={onRenameChat}
          onCloseChat={onCloseChat}
          selectedCliente={selectedCliente}
          renderEmptyState={renderEmptyState}
        />
      </div>

      <div style={styles.footer}>
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
      </div>

      {!clienteOrfao ? (
        <NewChatSheet
          open={newChatSheetOpen}
          onClose={() => setNewChatSheetOpen(false)}
          cliente={selectedCliente}
          clientes={clientes}
          projects={projects}
          presentation="sheet"
          onSubmit={onStartNewChat}
        />
      ) : null}
    </BottomSheet>
  );
}
