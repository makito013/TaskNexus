// frontend/src/layouts/v2/TarefasV2.jsx
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 15): versão v2 da tela de
// Tarefas — lista ÚNICA centralizada (max-width 760px), agrupada só por
// status ("Em aberto"/"Concluídas"), diferente de TarefasGlobalView.jsx (v1)
// que agrupa por PROJETO. Reaproveita `useGlobalTasks` tal como está — mesmo
// hook, mesmas ações (completeTask/reopenTask) que views/TarefasGlobalView.jsx
// já usa; só a apresentação muda (especificação do Designer/TL).
//
// NÃO implementado nesta tela (ver relatório do Dev): as ações "abrir chat"/
// "continuar sessão" (tag tocável + botão ▶) que TarefasGlobalView.jsx (v1)
// tem. A especificação desta tarefa para TarefasV2 pede explicitamente só
// círculo de check + título + meta + badge — sem mencionar navegação para o
// chat de origem. Corte de escopo deliberado (a ação de completar/reabrir,
// que a tarefa PEDE, está implementada), não uma lacuna esquecida.
//
// "Prazo" (mencionado na especificação como parte da meta, "quem/prazo se
// existir"): o modelo de Task (backend/app/task_store.py) não tem nenhum
// campo de prazo/due date — não inventado aqui (instrução explícita do TL de
// não expandir schema). A meta mostra só "quem" (session_display_name ou
// agent_id, mesma fonte que TarefasGlobalView.jsx usa para sua tag).
//
// Feature Clientes em Tarefas v2: filtra/agrupa por CLIENTE
// (`buildClienteTaskGroups`, utils/taskGroups.js — mesma regra de
// `clienteIdFromProjetoId` já usada em ChatSidebarV2.jsx), espelhando o
// mesmo padrão já em produção no Chat v2. `selectedClienteId` != null
// ("cliente específico"): lista única daquele cliente, SEM header (o cliente
// já está implícito na sidebar) — 0 tarefas vira uma mensagem dedicada, não o
// par open/done vazio nem a mensagem global. `selectedClienteId` == null
// ("Todos"): um grupo por cliente com tarefas, cada um com header
// (`clienteNome`), ordenados alfabeticamente por nome — a mensagem global
// ("Nenhuma tarefa pendente em nenhum projeto") continua um guard ANTERIOR a
// qualquer agrupamento, coberto só pelo caso `tasks.length === 0`.
//
// Deliberadamente SÓ por cliente (1º segmento do projeto_id), nunca por
// sub-projeto — não "aproveitar" a estrutura de grupos pra subdividir mais
// desfaria a escolha de UX documentada acima (lista da v2 é mais achatada
// que a v1 de propósito).

import { useMemo } from 'react';
import { useGlobalTasks } from '../../hooks/useGlobalTasks.js';
import { buildClienteTaskGroups, resolveClienteNome } from '../../utils/taskGroups.js';

const styles = {
  page: {
    flex: 1,
    overflowY: 'auto',
    background: 'var(--v2-bg)',
    padding: '24px 16px 40px',
  },
  wrap: {
    maxWidth: '760px',
    margin: '0 auto',
  },
  group: {
    marginBottom: '28px',
  },
  clienteGroup: {
    marginBottom: '36px',
  },
  clienteHeader: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--v2-text)',
    padding: '4px 4px 12px',
    marginBottom: '4px',
    borderBottom: '1px solid var(--v2-border)',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    padding: '4px 4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--v2-text-faint)',
  },
  groupCount: {
    fontWeight: 400,
    textTransform: 'none',
    letterSpacing: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 8px',
    borderBottom: '1px solid var(--v2-border)',
  },
  circle: (done) => ({
    width: '26px',
    height: '26px',
    minWidth: '26px',
    borderRadius: '50%',
    border: `2px solid ${done ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
    background: done ? 'var(--v2-accent)' : 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  }),
  title: (done) => ({
    flex: 1,
    minWidth: 0,
    fontSize: '14px',
    color: done ? 'var(--v2-text-faint)' : 'var(--v2-text)',
    textDecoration: done ? 'line-through' : 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  meta: {
    flexShrink: 0,
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
    maxWidth: '140px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: (done) => ({
    flexShrink: 0,
    padding: '3px 8px',
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: 600,
    background: done ? 'var(--v2-accent-soft)' : 'var(--v2-accent-2-soft)',
    color: done ? 'var(--v2-accent-strong)' : 'var(--v2-accent-2)',
  }),
  empty: {
    margin: 'auto',
    textAlign: 'center',
    color: 'var(--v2-text-faint)',
    fontSize: '13px',
    padding: '48px 24px',
  },
};

function TaskRow({ task, onToggle }) {
  const done = task.status === 'done';
  const meta = task.session_display_name || task.agent_id || '';
  return (
    <div style={styles.row} data-testid={`tarefas-v2-row-${task.id}`}>
      <button
        type="button"
        style={styles.circle(done)}
        aria-label={done ? `Reabrir "${task.titulo}"` : `Concluir "${task.titulo}"`}
        onClick={() => onToggle(task)}
      />
      <span style={styles.title(done)}>{task.titulo}</span>
      {meta && <span style={styles.meta} title={meta}>{meta}</span>}
      <span style={styles.badge(done)}>{done ? 'Concluída' : 'Em aberto'}</span>
    </div>
  );
}

// Markup open/done de um único grupo (cliente) — extraído tal como já era
// feito para o array flat, agora reaproveitado tanto no modo "cliente
// específico" (sem header, 1 grupo só) quanto uma vez por cliente no modo
// "Todos" (com header acima, ver TarefasV2).
function OpenDoneSections({ open, done, onToggle }) {
  return (
    <>
      <div style={styles.group}>
        <div style={styles.groupHeader} data-testid="tarefas-v2-group-header-open">
          Em aberto <span style={styles.groupCount}>({open.length})</span>
        </div>
        {open.length === 0 ? (
          <div style={styles.empty}>Nenhuma tarefa em aberto.</div>
        ) : (
          open.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} />)
        )}
      </div>

      {done.length > 0 && (
        <div style={styles.group}>
          <div style={styles.groupHeader} data-testid="tarefas-v2-group-header-done">
            Concluídas <span style={styles.groupCount}>({done.length})</span>
          </div>
          {done.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} />)}
        </div>
      )}
    </>
  );
}

export function TarefasV2({ projects = [], selectedClienteId }) {
  const { tasks, loading, completeTask, reopenTask } = useGlobalTasks();

  const handleToggle = (task) => {
    if (task.status === 'done') reopenTask(task.session_key, task.id);
    else completeTask(task.session_key, task.id);
  };

  // Etapa 1: só agrupa por cliente (dados brutos, sem nome/split/ordenação —
  // ver utils/taskGroups.js).
  const clienteGroups = useMemo(
    () => buildClienteTaskGroups(tasks, selectedClienteId),
    [tasks, selectedClienteId]
  );

  // Etapa 2: resolve o nome de cada cliente (precisa de `projects`, que a
  // etapa 1 não recebe), faz o split open/done por grupo, e ordena
  // alfabeticamente por clienteNome (fallback pro clienteId cru, mesmo
  // fallback de resolveClienteNome).
  const processedGroups = useMemo(() => {
    const withMeta = clienteGroups.map((group) => {
      const clienteNome = resolveClienteNome(group.clienteId, projects);
      return {
        clienteId: group.clienteId,
        clienteNome,
        open: group.tasks.filter((t) => t.status !== 'done'),
        done: group.tasks.filter((t) => t.status === 'done'),
      };
    });
    return [...withMeta].sort((a, b) => a.clienteNome.localeCompare(b.clienteNome));
  }, [clienteGroups, projects]);

  if (loading) {
    return <div style={styles.page}><div style={styles.empty}>Carregando...</div></div>;
  }

  // Guard global, ANTERIOR a qualquer agrupamento por cliente — mesma
  // mensagem/comportamento de antes, cobre tanto "Todos" quanto cliente
  // específico quando NÃO há tarefa nenhuma em lugar nenhum.
  if (tasks.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.empty}>Nenhuma tarefa pendente em nenhum projeto. Tudo em dia.</div>
      </div>
    );
  }

  if (selectedClienteId != null) {
    // Cliente específico: 0 ou 1 grupo (ver buildClienteTaskGroups). Sem
    // header — o cliente já está implícito na sidebar.
    const group = processedGroups[0];
    return (
      <div style={styles.page}>
        <div style={styles.wrap}>
          {group ? (
            <OpenDoneSections open={group.open} done={group.done} onToggle={handleToggle} />
          ) : (
            <div style={styles.empty} data-testid="tarefas-v2-empty-cliente">
              Nenhuma tarefa para {resolveClienteNome(selectedClienteId, projects)}.
            </div>
          )}
        </div>
      </div>
    );
  }

  // "Todos": um grupo por cliente com tarefas, já ordenados alfabeticamente,
  // cada um com seu próprio header antes do markup open/done.
  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        {processedGroups.map((group) => (
          <div
            key={group.clienteId}
            style={styles.clienteGroup}
            data-testid={`tarefas-v2-cliente-group-${group.clienteId}`}
          >
            <div style={styles.clienteHeader} data-testid={`tarefas-v2-cliente-header-${group.clienteId}`}>
              {group.clienteNome}
            </div>
            <OpenDoneSections open={group.open} done={group.done} onToggle={handleToggle} />
          </div>
        ))}
      </div>
    </div>
  );
}
