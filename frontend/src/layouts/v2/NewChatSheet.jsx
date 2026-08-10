// frontend/src/layouts/v2/NewChatSheet.jsx
// Feature Clientes na sidebar v2 (Bloco C) — conteúdo de domínio do "+ Novo
// chat" da ChatSidebarV2, montado dentro do primitivo genérico
// `BottomSheet.jsx`. Substitui o antigo dropdown inline de agente (que só
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
// Resolução de nome de sub-projeto: `cliente.sub_projetos` é só uma lista de
// ids (mesmo shape usado por CardFormModal.jsx/BoardView.jsx) — este arquivo
// não tem acesso à lista completa de `projetos` pra resolver nome bonito a
// partir do id (só recebe o objeto `cliente` já resolvido), então usa o
// próprio id como texto da opção, mesmo fallback que CardFormModal usaria se
// não achasse o projeto na lista.
import { useState } from 'react';
import { BottomSheet } from './BottomSheet.jsx';
import { useAgentSettings } from '../../hooks/useAgentSettings.js';

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
};

export function NewChatSheet({ open, onClose, cliente, onSubmit }) {
  const { agents, loading } = useAgentSettings();
  const [selectedProjetoId, setSelectedProjetoId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const hasSubprojetos = (cliente?.sub_projetos || []).length > 0;
  const canSubmit = selectedAgentId !== '';

  const handleClose = () => {
    // Reseta a seleção pra próxima abertura não herdar a escolha anterior
    // (cada abertura do sheet é um formulário novo, não uma sessão que
    // continua de onde parou).
    setSelectedProjetoId('');
    setSelectedAgentId('');
    onClose();
  };

  const handleSubmit = () => {
    // Defesa em profundidade: ChatSidebarV2 já garante que não monta/abre
    // este sheet sem um `cliente` válido, mas se algo mudar isso no futuro
    // (ou este componente for reusado em outro lugar), evita o TypeError de
    // `cliente.id` com `cliente` null/undefined derrubando a árvore inteira.
    if (!canSubmit || !cliente) return;
    onSubmit(selectedProjetoId || cliente.id, selectedAgentId);
    handleClose();
  };

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div style={styles.title}>Novo chat em {cliente?.nome}</div>

      <div style={styles.field}>
        <span style={styles.label}>Projeto (opcional)</span>
        {hasSubprojetos ? (
          <select
            style={styles.select}
            value={selectedProjetoId}
            onChange={(e) => setSelectedProjetoId(e.target.value)}
            aria-label="Projeto (opcional)"
          >
            <option value="">Nenhum (usa a raiz de {cliente.nome})</option>
            {cliente.sub_projetos.map((subId) => (
              <option key={subId} value={subId}>{subId}</option>
            ))}
          </select>
        ) : (
          <span style={styles.hint}>
            Este cliente não tem subprojetos — o chat abre na raiz de {cliente?.nome}.
          </span>
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

      <div style={styles.footer}>
        <button type="button" style={styles.cancelBtn} onClick={handleClose}>
          Cancelar
        </button>
        <button
          type="button"
          style={styles.submitBtn(!canSubmit)}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Criar chat
        </button>
      </div>
    </BottomSheet>
  );
}
