// frontend/src/views/TarefasGlobalView.jsx
// Tela cheia "Tarefas" (rota /tarefas) — Tarefa 28 de
// .planning/phases/05-tarefas-board-jira/05-TL.md. Visão GLOBAL do TaskStore
// já existente (a mesma tabela `tasks` que TasksDrawer.jsx mostra escopada a
// uma sessão), agrupada por projeto. Ver 05-DESIGNER.md seção 14 e
// 05-ARQUITETO.md seção 9 para a especificação completa — nada aqui introduz
// schema novo nem reabre a distinção Card (Board) vs. Task (esta tela).
//
// Duas ações de navegação DISTINTAS (05-DESIGNER.md 14.3 / 05-ARQUITETO.md
// 9.5 — decisão do pipeline, não interpretação livre do Dev):
// - Tocar na TAG do chat de origem ("abrir chat"): garante a sessão viva via
//   useTerminal().startSession(session_key, projeto_id, agent_id) e SÓ DEPOIS
//   navega para '/' (achado #4 de 05-TL.md — nesta ordem exata; navegar
//   antes faria MainLayout montar procurando uma sessão que ainda não existe
//   no estado do TerminalProvider). Não envia nenhuma mensagem.
// - Tocar no botão ▶ ("continuar"): chama POST /api/sessions/{key}/continue
//   (api.continueSession, mesmo endpoint que o rodapé de TasksDrawer.jsx já
//   usa) diretamente, SEM navegar — a mensagem canônica de continuação vai
//   pro PTY em segundo plano, o Bruno pode continuar na tela de Tarefas.
// Mantidas como duas ações separadas (não colapsadas em uma só) porque a
// especificação do pipeline distingue claramente os dois efeitos esperados;
// ver o relatório do Dev para o racional completo.
//
// Vocabulário visual deliberadamente herdado de TasksDrawer.jsx (círculo
// binário pendente/concluído, "Concluídas (N)" colapsável) — esta tela NUNCA
// usa o status-pill de 4 cores do Board (a_fazer/em_andamento/em_revisao/
// feito), porque uma Task de validação só existe ou não existe mais como
// pendência (05-DESIGNER.md 14.2).

import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../services/api.js';
import { useGlobalTasks } from '../hooks/useGlobalTasks.js';
import { useTerminal } from '../components/TerminalContext.jsx';
import { ProjectGroupHeader } from '../components/ProjectGroupHeader.jsx';

// Chave de agrupamento reservada para tarefas cujo projeto_id não bate com
// nenhum item de /api/projects (projeto renomeado/movido — risco já
// registrado em 05-ARQUITETO.md seção 9.9). Nunca colide com um projeto real
// porque projeto_id real é sempre um slug de path (sem espaços/parênteses).
const UNKNOWN_GROUP_KEY = '__unknown_project__';

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  title: {
    padding: '12px 16px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 16px 24px',
  },
  groupBody: {
    padding: '0 0 8px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 4px',
  },
  // 28px: literalmente o mesmo styles.circle de TasksDrawer.jsx (mesmo
  // vocabulário visual, replicado aqui em vez de importado — decisão de
  // implementação, não visual, autorizada em 05-DESIGNER.md 14.2).
  circle: (done) => ({
    width: '28px',
    height: '28px',
    minWidth: '28px',
    borderRadius: '50%',
    border: `2px solid ${done ? 'var(--accent-green)' : 'var(--border-strong)'}`,
    background: done ? 'var(--accent-green-dim)' : 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  }),
  itemTitle: (done) => ({
    flex: 1,
    fontSize: '14px',
    color: done ? 'var(--text-muted)' : 'var(--text-primary)',
    textDecoration: done ? 'line-through' : 'none',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    cursor: 'default',
  }),
  tag: {
    flexShrink: 0,
    maxWidth: '140px',
    padding: '5px 8px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface-3)',
    color: 'var(--text-secondary)',
    fontSize: '10px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    border: 'none',
  },
  continueBtn: {
    flexShrink: 0,
    width: '32px',
    height: '32px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '13px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  sectionToggle: {
    width: '100%',
    textAlign: 'left',
    padding: '10px 4px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  unknownLabel: {
    color: 'var(--text-muted)',
  },
  stateWrap: {
    margin: 'auto',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px',
    padding: '48px 24px',
  },
};

/** Linha de uma tarefa — círculo binário + título + tag do chat de origem
 * (tocável, "abrir chat") + botão ▶ ("continuar"). Ver header do arquivo
 * para a distinção entre as duas ações. */
function TaskRow({ task, onToggleDone, onOpenChat, onContinue }) {
  const done = task.status === 'done';
  const tagLabel = task.session_display_name || task.agent_id || '';
  return (
    <div style={styles.row}>
      <button
        style={styles.circle(done)}
        aria-label={done ? `Reabrir "${task.titulo}" (marcar como pendente)` : `Marcar "${task.titulo}" como concluída`}
        onClick={() => onToggleDone(task)}
      />
      <div style={styles.itemTitle(done)}>{task.titulo}</div>
      {tagLabel && (
        <button
          style={styles.tag}
          title={tagLabel}
          onClick={() => onOpenChat(task)}
        >
          {tagLabel}
        </button>
      )}
      <button
        style={styles.continueBtn}
        aria-label="Continuar sessão"
        onClick={() => onContinue(task)}
      >
        &#9654;
      </button>
    </div>
  );
}

export function TarefasGlobalView({ navigate }) {
  const { tasks, loading: tasksLoading, completeTask, reopenTask } = useGlobalTasks();
  const { startSession } = useTerminal();

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Busca /api/projects uma vez ao montar — usada só para resolver
  // projeto_id → nome de exibição (ADR-9: o backend nunca resolve nome de
  // projeto, só devolve o id cru em TaskGlobal.projeto_id).
  useEffect(() => {
    let cancelled = false;
    api.fetchProjects()
      .then((list) => { if (!cancelled) setProjects(list); })
      .catch((e) => {
        // Falha de rede — mantém `projects` vazio; todo grupo cairá em
        // "Projeto desconhecido" até a próxima montagem da tela conseguir
        // buscar, mesma tolerância a falha de fetchAll em useGlobalTasks.js.
        console.warn('fetchProjects error (TarefasGlobalView)', e);
      })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Grupos colapsados (chevron por projeto) e sub-seções "Concluídas"
  // expandidas (chevron por projeto, dentro do grupo) — dois Sets
  // independentes, ambos vazios por padrão: todo grupo vem expandido
  // (05-DESIGNER.md 14.1) e toda sub-seção de concluídas vem colapsada
  // (mesmo padrão de showCompleted em TasksDrawer.jsx).
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [expandedCompleted, setExpandedCompleted] = useState(() => new Set());

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleCompleted = useCallback((key) => {
    setExpandedCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const projectsById = useMemo(() => {
    const map = new Map();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Agrupa por projeto_id, preservando a ordem de primeira aparição em
  // `tasks` (backend já ordena por session_key ASC, id ASC — 05-ARQUITETO.md
  // 9.3), e sempre empurra o grupo "Projeto desconhecido" pro final (14.5).
  const groups = useMemo(() => {
    const order = [];
    const byKey = new Map();
    for (const t of tasks) {
      const project = projectsById.get(t.projeto_id);
      const key = project ? t.projeto_id : UNKNOWN_GROUP_KEY;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          unknown: !project,
          label: project ? project.nome : `Projeto desconhecido (${t.projeto_id})`,
          tasks: [],
        });
        order.push(key);
      }
      byKey.get(key).tasks.push(t);
    }
    order.sort((a, b) => {
      if (a === UNKNOWN_GROUP_KEY) return 1;
      if (b === UNKNOWN_GROUP_KEY) return -1;
      return 0;
    });
    return order.map((k) => byKey.get(k));
  }, [tasks, projectsById]);

  const loading = tasksLoading || projectsLoading;
  const totalPending = useMemo(() => tasks.filter((t) => t.status !== 'done').length, [tasks]);

  const handleToggleDone = useCallback((task) => {
    if (task.status === 'done') reopenTask(task.session_key, task.id);
    else completeTask(task.session_key, task.id);
  }, [completeTask, reopenTask]);

  // "Abrir chat": garante a sessão viva ANTES de navegar (achado #4,
  // 05-TL.md) — nesta ordem exata.
  const handleOpenChat = useCallback((task) => {
    startSession(task.session_key, task.projeto_id, task.agent_id);
    navigate('/');
  }, [startSession, navigate]);

  // "Continuar": dispara o endpoint direto, sem navegar — mesma ação do
  // rodapé de TasksDrawer.jsx (onContinue -> api.continueSession).
  const handleContinue = useCallback((task) => {
    api.continueSession(task.session_key).catch((e) => {
      console.warn('continueSession error (TarefasGlobalView)', e);
      alert('Falha ao continuar sessão. Tente novamente.');
    });
  }, []);

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.title}>Tarefas</div>
        <div style={styles.stateWrap}>Carregando...</div>
      </div>
    );
  }

  // Estado vazio global (05-DESIGNER.md 14.6): dispara quando não há
  // NENHUMA tarefa pendente em nenhum projeto — mesmo que ainda existam
  // tarefas concluídas em algum grupo (a tela inteira vira esta mensagem;
  // histórico de concluídas continua acessível dentro de cada sessão via
  // TasksDrawer.jsx, esta tela não é o único lugar onde ele existe).
  if (totalPending === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.title}>Tarefas</div>
        <div style={styles.stateWrap}>
          Nenhuma tarefa pendente em nenhum projeto. Tudo em dia.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.title}>Tarefas</div>
      <div style={styles.body}>
        {groups.map((group) => {
          const pending = group.tasks.filter((t) => t.status !== 'done');
          const completed = group.tasks.filter((t) => t.status === 'done');
          const collapsed = collapsedGroups.has(group.key);
          const showCompleted = expandedCompleted.has(group.key);
          return (
            <div key={group.key}>
              <ProjectGroupHeader
                label={group.unknown ? <span style={styles.unknownLabel}>{group.label}</span> : group.label}
                count={pending.length}
                countLabel="pendentes"
                collapsed={collapsed}
                onToggle={() => toggleGroup(group.key)}
              />
              {!collapsed && (
                <div style={styles.groupBody}>
                  {pending.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onToggleDone={handleToggleDone}
                      onOpenChat={handleOpenChat}
                      onContinue={handleContinue}
                    />
                  ))}
                  {completed.length > 0 && (
                    <>
                      <button style={styles.sectionToggle} onClick={() => toggleCompleted(group.key)}>
                        {showCompleted ? '▾' : '▸'} Concluídas ({completed.length})
                      </button>
                      {showCompleted && completed.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          onToggleDone={handleToggleDone}
                          onOpenChat={handleOpenChat}
                          onContinue={handleContinue}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
