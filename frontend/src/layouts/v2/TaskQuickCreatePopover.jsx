// frontend/src/layouts/v2/TaskQuickCreatePopover.jsx
// Fase "Tarefas" no layout v2 (plano do TL, Tarefa 7): popover de criação
// RÁPIDA de tarefa, disparado pelo botão "+ Tarefa" no header do ChatV2.
//
// NÃO reusa BottomSheet.jsx (decisão do Designer): um sheet ancorado embaixo
// colidiria com o teclado do iPad ao focar o textarea de descrição. Este
// componente é um painel `position: fixed` ancorado no canto superior direito
// (abaixo do header do chat), com scrim TRANSPARENTE — clique fora fecha, mas
// não escurece nem bloqueia visualmente o chat atrás.
//
// Fecha por 4 gestos: clique no "×", clique fora (scrim), tecla ESC, OU
// automaticamente quando a `sessionKey` ativa muda enquanto está aberto
// (descarta o rascunho). O mecanismo de ESC/click-outside espelha o de
// BottomSheet.jsx (stopPropagation interno + listener de keydown só enquanto
// aberto), mas SEM o handle de arrasto e SEM escurecer a tela.
//
// A resolução de nome de sub-projeto reaproveita `resolveProjectLabel` de
// utils/projects.js (compartilhada com CardFormModal.jsx, de onde ela saiu)
// para não divergir dos dois pontos que hoje resolvem projeto_id -> nome.
// Atenção à homônima de useClienteProjetoFilter.js, que devolve `null` no
// caso não resolvido — semântica oposta, ver o cabeçalho de utils/projects.js.
// O select é ÚNICO (não cascata): uma opção "Nenhum projeto", depois um
// <optgroup> por cliente (raiz + cada subprojeto); clientes sem sub_projetos
// viram opção solta, sem optgroup.
// Sem filtro de "mesmo cliente" — a UI do humano vê TODOS os projetos (a
// restrição de segurança de "mesmo cliente" é só do caminho MCP/IA).

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveProjectLabel } from '../../utils/projects.js';
import { isClienteId } from '../../utils/clientes.js';

const styles = {
  scrim: {
    position: 'fixed',
    inset: 0,
    // Transparente de propósito (Designer): fecha ao clicar fora sem
    // escurecer o chat atrás. Ainda captura o clique (fixed + inset:0).
    background: 'transparent',
    zIndex: 50,
  },
  panel: {
    position: 'fixed',
    top: '104px',
    right: '16px',
    width: 'min(340px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 130px)',
    overflowY: 'auto',
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    boxShadow: 'var(--v2-shadow-lg)',
    padding: '14px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 51,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '12px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  closeBtn: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '16px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '14px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--v2-text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  input: {
    height: '40px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '13px',
    boxSizing: 'border-box',
    width: '100%',
  },
  textarea: {
    minHeight: '92px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '13px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
    width: '100%',
  },
  select: {
    height: '40px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '13px',
    boxSizing: 'border-box',
    width: '100%',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '2px',
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
    opacity: disabled ? 0.6 : 1,
  }),
};

export function TaskQuickCreatePopover({ open, onClose, sessionKey, projects = [], onCreateTask }) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [selectedProjetoId, setSelectedProjetoId] = useState('');
  const [saving, setSaving] = useState(false);

  // Fecha + descarta o rascunho: reseta os 3 campos e delega o fechamento ao
  // pai (que controla `open`). Todos os gestos de fechamento passam por aqui
  // (× / scrim / ESC / troca de sessão), então o reset fica num só lugar.
  const handleClose = useCallback(() => {
    setTitulo('');
    setDescricao('');
    setSelectedProjetoId('');
    onClose();
  }, [onClose]);

  // Listener de ESC só enquanto aberto (mesmo cuidado de BottomSheet.jsx: não
  // deixa um keydown global "vazando" quando o popover está montado-mas-fechado).
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  // Fecha sozinho (descartando o rascunho) se a sessão ativa mudar enquanto o
  // popover está aberto — o rascunho pertencia à sessão anterior. `prevKeyRef`
  // começa igual à sessionKey atual, então o 1º render nunca dispara isto.
  const prevKeyRef = useRef(sessionKey);
  useEffect(() => {
    if (open && prevKeyRef.current !== sessionKey) {
      handleClose();
    }
    prevKeyRef.current = sessionKey;
  }, [open, sessionKey, handleClose]);

  if (!open) return null;

  // "Clientes" = qualquer Project sem "/" no id (cliente-como-projeto e
  // projeto-solto-na-raiz contam como cliente de si mesmos) — mesma regra de
  // CardFormModal.jsx/BoardView.jsx, centralizada em `isClienteId`
  // (utils/clientes.js) pra não triplicar a regra (achado do QA na Fase 2,
  // mesmo padrão de duplicação que causou o bug raiz desta epic).
  const clientes = projects.filter((p) => isClienteId(p.id));

  const canSubmit = titulo.trim() !== '' && !saving;

  const handleSubmit = async () => {
    const trimmedTitulo = titulo.trim();
    if (!trimmedTitulo || saving) return;
    // Caso de borda (TL): captura a sessionKey do MOMENTO do clique. Se o
    // usuário trocar de chat enquanto o POST está no ar, a tarefa criada é
    // aplicada a ESTA sessão (não à ativa no momento da resposta) — não se
    // perde a tarefa só porque a sessão ativa mudou no meio.
    const capturedKey = sessionKey;
    setSaving(true);
    try {
      await onCreateTask(capturedKey, {
        titulo: trimmedTitulo,
        descricao_markdown: descricao,
        descricao_html: null,
        projeto_id: selectedProjetoId || null,
      });
      handleClose(); // sucesso: fecha + reseta os 3 campos
    } catch (e) {
      // Falha: painel continua aberto com o conteúdo intacto (NÃO reseta) —
      // mesmo padrão de TaskDetailModal.jsx/CardFormModal.jsx.
      alert('Falha ao criar tarefa. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.scrim} onClick={handleClose} data-testid="task-popover-scrim">
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        data-testid="task-popover-panel"
      >
        <div style={styles.headerRow}>
          <span style={styles.title}>Nova tarefa</span>
          <button
            type="button"
            style={styles.closeBtn}
            aria-label="Fechar"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="task-quick-titulo">Título</label>
          <input
            id="task-quick-titulo"
            style={styles.input}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título da tarefa"
            autoFocus
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="task-quick-descricao">Descrição (Markdown)</label>
          <textarea
            id="task-quick-descricao"
            style={styles.textarea}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descreva a tarefa em markdown..."
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="task-quick-projeto">Projeto (opcional)</label>
          <select
            id="task-quick-projeto"
            style={styles.select}
            value={selectedProjetoId}
            onChange={(e) => setSelectedProjetoId(e.target.value)}
            aria-label="Projeto (opcional)"
          >
            <option value="">Nenhum projeto</option>
            {clientes.map((cliente) => {
              const subs = cliente.sub_projetos || [];
              if (subs.length === 0) {
                // Cliente sem subprojetos: opção solta, sem optgroup.
                return (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nome}
                  </option>
                );
              }
              return (
                <optgroup key={cliente.id} label={cliente.nome}>
                  <option value={cliente.id}>{cliente.nome}</option>
                  {subs.map((subId) => (
                    <option key={subId} value={subId}>
                      {resolveProjectLabel(subId, projects)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            style={styles.submitBtn(!canSubmit)}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {saving ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
