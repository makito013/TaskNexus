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
// ids (mesmo shape usado por CardFormModal.jsx) — este arquivo
// não tem acesso à lista completa de `projetos` pra resolver nome bonito a
// partir do id (só recebe o objeto `cliente` já resolvido), então usa o
// próprio id como texto da opção, mesmo fallback que CardFormModal usaria se
// não achasse o projeto na lista.
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

export function NewChatSheet({ open, onClose, cliente, clientes, onSubmit }) {
  const { agents, loading } = useAgentSettings();
  const [selectedTodosClienteId, setSelectedTodosClienteId] = useState('');
  const [selectedProjetoId, setSelectedProjetoId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');

  // Modo "Todos": sem `cliente` fixo, mas com uma lista pra escolher de. Só
  // faz sentido mostrar o select quando há o que escolher — lista vazia (ex.
  // nenhum projeto cadastrado ainda) cai no mesmo hint informativo que os
  // outros campos já usam, em vez de um select sem opções.
  const showClienteSelect = !cliente && Array.isArray(clientes);
  const activeCliente = cliente || (clientes || []).find((c) => c.id === selectedTodosClienteId) || null;
  const hasSubprojetos = (activeCliente?.sub_projetos || []).length > 0;
  const canSubmit = selectedAgentId !== '' && !!activeCliente;

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

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div style={styles.title}>
        {activeCliente ? `Novo chat em ${activeCliente.nome}` : 'Novo chat'}
      </div>

      {showClienteSelect && (
        <div style={styles.field}>
          <span style={styles.label}>Cliente</span>
          {clientes.length === 0 ? (
            <span style={styles.hint}>Nenhum cliente disponível.</span>
          ) : (
            <select
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

      {activeCliente && (
        <div style={styles.field}>
          <span style={styles.label}>Projeto (opcional)</span>
          {hasSubprojetos ? (
            <select
              style={styles.select}
              value={selectedProjetoId}
              onChange={(e) => setSelectedProjetoId(e.target.value)}
              aria-label="Projeto (opcional)"
            >
              <option value="">Nenhum (usa a raiz de {activeCliente.nome})</option>
              {activeCliente.sub_projetos.map((subId) => (
                <option key={subId} value={subId}>{subId}</option>
              ))}
            </select>
          ) : (
            <span style={styles.hint}>
              Este cliente não tem subprojetos — o chat abre na raiz de {activeCliente.nome}.
            </span>
          )}
        </div>
      )}

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
