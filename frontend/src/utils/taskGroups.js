// frontend/src/utils/taskGroups.js
// Agrupamento por CLIENTE das tarefas globais (TarefasV2.jsx) — mesma regra
// de derivação de cliente_id (`clienteIdFromProjetoId`, utils/clientes.js)
// já usada por ChatSidebarV2.jsx/BoardView.jsx, aplicada aqui à lista bruta
// de `useGlobalTasks`. Puramente de dados: NÃO faz split open/done (isso
// continua responsabilidade de quem consome, em TarefasV2.jsx, exatamente
// como já era feito antes pro array flat) e NÃO ordena (ordenação alfabética
// por nome de cliente exige `projects`, que esta função não recebe — quem
// consome ordena depois de resolver os nomes via `resolveClienteNome`).
//
// Agrupamento é SÓ por cliente (1º segmento do projeto_id) — nunca por
// sub-projeto/projeto individual dentro do cliente. A lista da v2 é
// deliberadamente mais achatada que a v1 (ver cabeçalho de TarefasV2.jsx);
// subdividir por sub-projeto aqui desfaria essa escolha de UX.

import { clienteIdFromProjetoId } from './clientes.js';

// Constrói os grupos de tarefas por cliente:
// - `selectedClienteId` != null: filtra `tasks` pelo cliente selecionado
//   (sub-projetos sobem pro cliente pai via `clienteIdFromProjetoId`).
//   Retorna 0 grupos (nenhuma tarefa) ou 1 grupo (ao menos 1 tarefa).
// - `selectedClienteId` == null ("Todos"): agrupa TODAS as `tasks`, um grupo
//   por cliente distinto que tenha ao menos 1 tarefa, na ordem de primeira
//   aparição na lista bruta.
export function buildClienteTaskGroups(tasks, selectedClienteId) {
  if (selectedClienteId != null) {
    const filtered = (tasks || []).filter(
      (t) => clienteIdFromProjetoId(t.projeto_id) === selectedClienteId
    );
    return filtered.length > 0 ? [{ clienteId: selectedClienteId, tasks: filtered }] : [];
  }

  const groups = [];
  const groupIndexByClienteId = {};
  for (const task of tasks || []) {
    const clienteId = clienteIdFromProjetoId(task.projeto_id);
    if (!(clienteId in groupIndexByClienteId)) {
      groupIndexByClienteId[clienteId] = groups.length;
      groups.push({ clienteId, tasks: [] });
    }
    groups[groupIndexByClienteId[clienteId]].tasks.push(task);
  }
  return groups;
}

// Resolve o nome de exibição de um cliente. Decisão de produto (Bruno, sessão
// "tarefa/card órfão"): um cliente sem nome resolvível (projeto
// removido/desconhecido, sem entrada em `projects`) não mostra o id cru como
// se fosse nome — retorna `null` e quem consome decide o que fazer com a
// ausência (tag some sozinha por já ser condicional; um rótulo estrutural,
// como o header de grupo em TarefasV2.jsx, precisa de um fallback próprio,
// documentado onde é usado). Antes retornava o `clienteId` cru — esse
// fallback é exatamente o que a decisão do Bruno pediu para tirar.
export function resolveClienteNome(clienteId, projects) {
  return (projects || []).find((p) => p.id === clienteId)?.nome || null;
}
