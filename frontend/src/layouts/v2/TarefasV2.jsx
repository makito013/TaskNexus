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
// não expandir schema).
//
// Cascata de filtro Cliente -> Projeto (Fase 2): mesma `ClienteProjetoFilterBar`
// /`useClienteProjetoFilter` já em produção em BoardV2.jsx, com estado LOCAL
// desta tela. `effectiveClienteId` (sidebar ?? seleção local) — e NÃO o prop
// `selectedClienteId` cru — é o que governa agrupamento, branch de render e
// mensagem de vazio: o branch não precisa saber se o cliente veio da sidebar
// ou do select local, e tratá-los igual é o que impede a tela de renderizar
// todos os grupos por cliente com "Em aberto (0)" quando o cliente foi
// escolhido localmente.
//
// A meta por linha ("quem": session_display_name/agent_id) deu lugar às tags
// de cliente/projeto (`resolveCardTags`, mesma função que BoardV2 usa nos
// cards): numa lista agregada, saber a QUAL projeto a tarefa pertence vale
// mais do que a sessão de origem. No modo "Todos" a tag de cliente é
// suprimida por linha — o header do grupo já mostra o cliente, repetir seria
// ruído puro; a tag de projeto continua sempre visível.
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
import { ClienteProjetoFilterBar } from './ClienteProjetoFilterBar.jsx';
import { resolveCardTags, useClienteProjetoFilter } from './useClienteProjetoFilter.js';

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
  // Container das tags cliente/projeto — o cap de largura fica AQUI e não em
  // cada tag, senão duas tags disputariam o mesmo `maxWidth` e ambas seriam
  // truncadas cedo demais (mesmo par cardMeta+tag de BoardV2.jsx).
  tags: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    maxWidth: '200px',
    overflow: 'hidden',
  },
  tag: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
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

function TaskRow({ task, onToggle, projects, hideClienteTag }) {
  const done = task.status === 'done';
  const { clienteNome, projetoNome } = resolveCardTags(task.projeto_id, projects);
  return (
    <div style={styles.row} data-testid={`tarefas-v2-row-${task.id}`}>
      <button
        type="button"
        style={styles.circle(done)}
        aria-label={done ? `Reabrir "${task.titulo}"` : `Concluir "${task.titulo}"`}
        onClick={() => onToggle(task)}
      />
      <span style={styles.title(done)}>{task.titulo}</span>
      <span style={styles.tags}>
        {!hideClienteTag && clienteNome && (
          <span style={styles.tag} title={clienteNome}>{clienteNome}</span>
        )}
        {projetoNome && <span style={styles.tag} title={projetoNome}>{projetoNome}</span>}
      </span>
      <span style={styles.badge(done)}>{done ? 'Concluída' : 'Em aberto'}</span>
    </div>
  );
}

// Markup open/done de um único grupo (cliente) — extraído tal como já era
// feito para o array flat, agora reaproveitado tanto no modo "cliente
// específico" (sem header, 1 grupo só) quanto uma vez por cliente no modo
// "Todos" (com header acima, ver TarefasV2).
function OpenDoneSections({ open, done, onToggle, projects, hideClienteTag }) {
  return (
    <>
      <div style={styles.group}>
        <div style={styles.groupHeader} data-testid="tarefas-v2-group-header-open">
          Em aberto <span style={styles.groupCount}>({open.length})</span>
        </div>
        {open.length === 0 ? (
          <div style={styles.empty}>Nenhuma tarefa em aberto.</div>
        ) : (
          open.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={onToggle} projects={projects} hideClienteTag={hideClienteTag} />
          ))
        )}
      </div>

      {done.length > 0 && (
        <div style={styles.group}>
          <div style={styles.groupHeader} data-testid="tarefas-v2-group-header-done">
            Concluídas <span style={styles.groupCount}>({done.length})</span>
          </div>
          {done.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={onToggle} projects={projects} hideClienteTag={hideClienteTag} />
          ))}
        </div>
      )}
    </>
  );
}

export function TarefasV2({ projects = [], selectedClienteId }) {
  const { tasks, loading, completeTask, reopenTask } = useGlobalTasks();

  // Cascata Cliente -> Projeto (estado local desta tela, mesmo hook que
  // BoardV2.jsx já usa). `effectiveClienteId` (sidebar ?? seleção local) é o
  // que governa agrupamento, branch de render e mensagem de vazio abaixo —
  // ver cabeçalho do arquivo.
  const {
    clienteSelectEnabled,
    clientes,
    effectiveClienteId,
    localClienteId,
    setLocalClienteId,
    subProjetoIds,
    selectedProjetoId,
    setSelectedProjetoId,
    selectedProjectIds,
  } = useClienteProjetoFilter(projects, selectedClienteId);

  const handleToggle = (task) => {
    if (task.status === 'done') reopenTask(task.session_key, task.id);
    else completeTask(task.session_key, task.id);
  };

  // Etapa 1: só agrupa por cliente (dados brutos, sem nome/split/ordenação —
  // ver utils/taskGroups.js). Usa `effectiveClienteId`, não o prop cru, senão
  // uma seleção feita no select LOCAL de cliente (modo "Todos") não teria
  // efeito nenhum sobre o agrupamento.
  const clienteGroups = useMemo(
    () => buildClienteTaskGroups(tasks, effectiveClienteId),
    [tasks, effectiveClienteId]
  );

  // Etapa 2: resolve o nome de cada cliente (precisa de `projects`, que a
  // etapa 1 não recebe), aplica o filtro Tier 2 (`selectedProjectIds`) SÓ
  // quando o usuário escolheu um projeto específico no select de Tier 2
  // (`selectedProjetoId != null`) — faz o split open/done por grupo, e ordena
  // alfabeticamente por clienteNome.
  //
  // Gate em `selectedProjetoId`, não em `effectiveClienteId`: `selectedProjectIds`
  // só lista nós REAIS presentes em `projects` (collectSubtreeIds, ver
  // useClienteProjetoFilter.js). Gatear no cliente ativo, como este código
  // fazia antes, aplicava esse filtro de nós reais o tempo todo — inclusive
  // com o Tier 2 em "Todos os projetos" — e uma tarefa órfã (projeto
  // removido/desconhecido do disco) não tem como casar com nenhum id dessa
  // lista, então sumia da tela assim que QUALQUER cliente específico era
  // aberto, mesmo sem nenhum projeto escolhido. Gatear no Tier 2 restringe o
  // filtro de nós reais ao único caso em que ele faz sentido (uma escolha
  // explícita de projeto); com o Tier 2 em "Todos os projetos", toda tarefa
  // que `buildClienteTaskGroups` já rolou para este cliente aparece, órfã ou
  // não — comportamento coberto pelo teste nomeado em TarefasV2.test.jsx.
  const processedGroups = useMemo(() => {
    const projectIdSet = selectedProjetoId != null ? new Set(selectedProjectIds) : null;
    const withMeta = clienteGroups.map((group) => {
      const clienteNome = resolveClienteNome(group.clienteId, projects);
      const groupTasks = projectIdSet
        ? group.tasks.filter((t) => projectIdSet.has(t.projeto_id))
        : group.tasks;
      return {
        clienteId: group.clienteId,
        clienteNome,
        open: groupTasks.filter((t) => t.status !== 'done'),
        done: groupTasks.filter((t) => t.status === 'done'),
      };
    });
    // Chave de ordenação: `clienteNome` agora pode ser `null` (decisão do
    // Bruno, ver useClienteProjetoFilter.js/taskGroups.js — cliente sem nome
    // resolvível não cai mais pro id cru). O sort só precisa de ALGUMA string
    // comparável e estável, não de um nome de exibição — cai pro clienteId
    // cru só aqui, internamente, sem renderizar nada.
    return [...withMeta].sort((a, b) =>
      (a.clienteNome || a.clienteId).localeCompare(b.clienteNome || b.clienteId)
    );
  }, [clienteGroups, projects, selectedProjetoId, selectedProjectIds]);

  const filterBar = (
    <ClienteProjetoFilterBar
      clienteSelectEnabled={clienteSelectEnabled}
      clientes={clientes}
      localClienteId={localClienteId}
      onSelectLocalCliente={setLocalClienteId}
      effectiveClienteId={effectiveClienteId}
      subProjetoIds={subProjetoIds}
      selectedProjetoId={selectedProjetoId}
      onSelectProjeto={setSelectedProjetoId}
      projects={projects}
    />
  );

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

  if (effectiveClienteId != null) {
    // Cliente específico (via sidebar OU via select local): 0 ou 1 grupo (ver
    // buildClienteTaskGroups). Sem header de cliente por linha — o cliente já
    // está implícito no contexto, repetir seria ruído puro.
    const group = processedGroups[0];
    return (
      <div style={styles.page}>
        <div style={styles.wrap}>
          {filterBar}
          {group ? (
            <OpenDoneSections
              open={group.open}
              done={group.done}
              onToggle={handleToggle}
              projects={projects}
              hideClienteTag={false}
            />
          ) : (
            <div style={styles.empty} data-testid="tarefas-v2-empty-cliente">
              {/* Fallback pro clienteId cru: a decisão do Bruno cobre a tag
                  por linha (já condicional, some sozinha) — não cobre
                  explicitamente uma mensagem que PRECISA nomear o cliente
                  pra fazer sentido. Ver "Pontos de atenção" no relatório. */}
              Nenhuma tarefa para {resolveClienteNome(effectiveClienteId, projects) || effectiveClienteId}.
            </div>
          )}
        </div>
      </div>
    );
  }

  // "Todos": um grupo por cliente com tarefas, já ordenados alfabeticamente,
  // cada um com seu próprio header antes do markup open/done. A tag de
  // cliente por linha é suprimida aqui — o header do grupo já mostra o nome.
  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        {filterBar}
        {processedGroups.map((group) => (
          <div
            key={group.clienteId}
            style={styles.clienteGroup}
            data-testid={`tarefas-v2-cliente-group-${group.clienteId}`}
          >
            <div style={styles.clienteHeader} data-testid={`tarefas-v2-cliente-header-${group.clienteId}`}>
              {/* Fallback pro clienteId cru: a decisão do Bruno cobre a tag
                  por linha (já condicional, some sozinha) — não cobre
                  explicitamente um HEADER estrutural, que precisa de algum
                  rótulo pra distinguir grupos na tela "Todos". Ver "Pontos de
                  atenção" no relatório do Dev. */}
              {group.clienteNome || group.clienteId}
            </div>
            <OpenDoneSections
              open={group.open}
              done={group.done}
              onToggle={handleToggle}
              projects={projects}
              hideClienteTag
            />
          </div>
        ))}
      </div>
    </div>
  );
}
