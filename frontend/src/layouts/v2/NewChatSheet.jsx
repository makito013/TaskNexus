// frontend/src/layouts/v2/NewChatSheet.jsx
// Feature Clientes na sidebar v2 (Bloco C) — conteúdo de domínio do "+ Novo
// chat" da ChatSidebarV2. Substitui o antigo dropdown inline de agente (que só
// existia pra escolher a IA dentro do projeto já selecionado na SidebarV2) por
// um formulário completo: agora um chat pode nascer em QUALQUER subprojeto do
// cliente selecionado e com QUALQUER agente do registro global — não mais só
// os agentes configurados no `.escritorio/agents.yaml` daquele projeto.
//
// Lista de agentes vem de `useAgentSettings()` (mesmo hook que
// ConfiguracaoV2.jsx já usa pro CRUD de /api/agents) — é
// o registro GLOBAL, não `cliente.agentes` (que só reflete o que está
// configurado por projeto).
//
// Lista de sub-projetos: `listSubProjectsForClient` (utils/projects.js) —
// filtra `projects` (array plano de /api/projetos) por prefixo do cliente +
// `elegivel === true` e ordena em ordem de árvore. Não usa mais
// `cliente.sub_projetos` (só filhos DIRETOS, sem filtro de elegibilidade).
//
// Modo "Todos": quando o chamador não tem um cliente fixo
// pra passar (`cliente` null — sidebar filtrada em "Todos"), passa `clientes`
// (a lista inteira) em vez disso. Aí este sheet ganha um select de CLIENTE
// como primeiro campo; escolher um resolve `activeCliente` localmente
// (`selectedTodosClienteId`) e o resto do formulário (select de Projeto,
// submit) segue exatamente a mesma lógica de antes, só que a partir do
// cliente escolhido em vez do fixo. Quando `cliente` vem preenchido (fluxo
// de sempre, cliente específico já selecionado na sidebar), `clientes` é
// ignorado e nada muda.
//
// `presentation` ('sheet' | 'modal', default 'sheet'): o breakpoint de 640px
// do AppV2 decide qual container este componente monta — BottomSheet
// (mobile/toque) ou CenteredModal (desktop/iPad landscape). A diferença fica
// isolada na CASCA (qual wrapper, header com botão × ou não): o bloco de
// campos (Cliente/Projeto/Agente) é um render ÚNICO, compartilhado pelos 2
// branches — ver `fieldsContent` abaixo. `initialFocusRef` só é passado ao
// CenteredModal (o BottomSheet não tem esse contrato); em modo modal, aponta
// pro 1º <select> renderizado: modo "Todos" pré-escolha de cliente = select
// de Cliente; senão = select de Projeto (mesmo desabilitado — se nem esse
// select existir, ex. fallback de "nenhum projeto disponível", o ref fica
// null e o CenteredModal cai no próprio fallback de foco, no painel).
import { useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet.jsx';
import { CenteredModal } from './CenteredModal.jsx';
import { useAgentSettings } from '../../hooks/useAgentSettings.js';
import { listSubProjectsForClient } from '../../utils/projects.js';

const styles = {
  title: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    padding: '4px 0 16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--v2-text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  select: {
    height: '44px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '13px',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.4,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '8px',
  },
  cancelBtn: {
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  submitBtn: (disabled) => ({
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-accent)',
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
  // Modal-only chrome (CenteredModal's 3 regions) — the field block above is
  // shared with sheet mode.
  modalHeader: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  modalHeaderTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  modalCloseBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--v2-text-dim)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  modalBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
  },
  modalFooter: {
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '12px 16px',
    borderTop: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
};

export function NewChatSheet({
  open,
  onClose,
  cliente,
  clientes,
  projects = [],
  onSubmit,
  presentation = 'sheet',
}) {
  const { agents, loading } = useAgentSettings();
  const [selectedTodosClienteId, setSelectedTodosClienteId] = useState('');
  const [selectedProjetoId, setSelectedProjetoId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const clienteSelectRef = useRef(null);
  const projetoSelectRef = useRef(null);

  // Modo "Todos": sem `cliente` fixo, mas com uma lista pra escolher de. Só
  // faz sentido mostrar o select quando há o que escolher — lista vazia (ex.
  // nenhum projeto cadastrado ainda) cai no mesmo hint informativo que os
  // outros campos já usam, em vez de um select sem opções.
  const showClienteSelect = !cliente && Array.isArray(clientes);
  const activeCliente = cliente || (clientes || []).find((c) => c.id === selectedTodosClienteId) || null;
  const subProjects = activeCliente ? listSubProjectsForClient(activeCliente.id, projects) : [];
  const canSubmit = selectedAgentId !== '' && !!activeCliente;

  // Todos-mode, before a client is chosen: the Projeto select renders
  // disabled instead of being hidden (avoids a layout jump when a client
  // gets picked) — see style-guide.md §1/§2.
  const projetoFieldPreChoice = showClienteSelect && !activeCliente;

  const initialFocusRef = projetoFieldPreChoice ? clienteSelectRef : projetoSelectRef;

  const title = activeCliente ? `Novo chat em ${activeCliente.nome}` : 'Novo chat';

  const handleClose = () => {
    // Reseta a seleção pra próxima abertura não herdar a escolha anterior
    // (cada abertura do sheet é um formulário novo, não uma sessão que
    // continua de onde parou).
    setSelectedTodosClienteId('');
    setSelectedProjetoId('');
    setSelectedAgentId('');
    onClose();
  };

  const handleTodosClienteChange = (e) => {
    setSelectedTodosClienteId(e.target.value);
    // Um sub-projeto escolhido pro cliente anterior não existe no novo.
    setSelectedProjetoId('');
  };

  const handleSubmit = () => {
    // Defesa em profundidade: ChatSidebarV2 já garante que não monta/abre
    // este sheet sem `cliente`/`clientes` válidos, mas se algo mudar isso no
    // futuro (ou este componente for reusado em outro lugar), evita o
    // TypeError de `activeCliente.id` com `activeCliente` null derrubando a
    // árvore inteira.
    if (!canSubmit || !activeCliente) return;
    onSubmit(selectedProjetoId || activeCliente.id, selectedAgentId);
    handleClose();
  };

  const fieldsContent = (
    <>
      {showClienteSelect && (
        <div style={styles.field}>
          <span style={styles.label}>Cliente</span>
          {clientes.length === 0 ? (
            <span style={styles.hint}>Nenhum cliente disponível.</span>
          ) : (
            <select
              ref={clienteSelectRef}
              style={styles.select}
              value={selectedTodosClienteId}
              onChange={handleTodosClienteChange}
              aria-label="Cliente"
            >
              <option value="">Selecione um cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={styles.field}>
        <span style={styles.label}>Projeto</span>
        {projetoFieldPreChoice ? (
          <select
            ref={projetoSelectRef}
            style={styles.select}
            value=""
            disabled
            onChange={() => {}}
            aria-label="Projeto"
          >
            <option value="">Escolha um cliente para ver os projetos</option>
          </select>
        ) : !activeCliente ? null : subProjects.length === 0 ? (
          <span style={styles.hint}>
            Nenhum projeto disponível agora. O chat abre na raiz de {activeCliente.nome}.
          </span>
        ) : (
          <select
            ref={projetoSelectRef}
            style={styles.select}
            value={selectedProjetoId}
            onChange={(e) => setSelectedProjetoId(e.target.value)}
            aria-label="Projeto"
          >
            <option value="">Raiz de {activeCliente.nome}</option>
            {subProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      <div style={styles.field}>
        <span style={styles.label}>IA / Agente</span>
        {loading ? (
          <span style={styles.hint}>Carregando agentes…</span>
        ) : agents.length === 0 ? (
          <span style={styles.hint}>
            Nenhum agente cadastrado ainda. Use "+ Novo agente" para adicionar um.
          </span>
        ) : (
          <select
            style={styles.select}
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            aria-label="IA / Agente"
          >
            <option value="">Selecione um agente</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.nome}</option>
            ))}
          </select>
        )}
      </div>
    </>
  );

  const cancelButton = (
    <button type="button" style={styles.cancelBtn} onClick={handleClose}>
      Cancelar
    </button>
  );
  const submitButton = (
    <button
      type="button"
      style={styles.submitBtn(!canSubmit)}
      disabled={!canSubmit}
      onClick={handleSubmit}
    >
      Criar chat
    </button>
  );

  if (presentation === 'modal') {
    return (
      <CenteredModal open={open} onClose={handleClose} ariaLabel={title} initialFocusRef={initialFocusRef}>
        <header style={styles.modalHeader}>
          <span style={styles.modalHeaderTitle}>{title}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.modalCloseBtn} onClick={handleClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div style={styles.modalBody}>
          {fieldsContent}
        </div>

        <footer style={styles.modalFooter}>
          {cancelButton}
          {submitButton}
        </footer>
      </CenteredModal>
    );
  }

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div style={styles.title}>{title}</div>

      {fieldsContent}

      <div style={styles.footer}>
        {cancelButton}
        {submitButton}
      </div>
    </BottomSheet>
  );
}
