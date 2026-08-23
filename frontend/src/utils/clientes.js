// frontend/src/utils/clientes.js
// Helpers puros da feature Cliente/Projeto (Grupo B) — espelham no frontend
// a mesma regra que já existe no backend (app/agent_discovery.py:
// cliente_id_from_projeto_id), pra cascata de filtro (BoardView),
// select duplo de criação (CardFormModal) e badge condicional
// (CardItem/KanbanBoard) todos derivarem "cliente" do mesmo jeito.

// Deriva o cliente_id de um projeto_id — sempre o primeiro segmento antes
// da 1ª "/". Cobre os 3 formatos de projeto_id: cliente com múltiplos
// projetos ("cliente_projeto_1/subprojeto_1" -> "cliente_projeto_1"),
// cliente-como-projeto sem subpasta ("podesubir" -> "podesubir") e projeto
// solto na raiz ("projeto_2" -> "projeto_2").
export function clienteIdFromProjetoId(projetoId) {
  // Guarda defensiva (achado do QA, sessão "Tarefas por cliente"): nenhum
  // caminho real do backend hoje produz projeto_id null/undefined, mas esta
  // função virou a chave de agrupamento de telas sem error boundary (Tarefas,
  // Chat) — um dado malformado não pode derrubar a tela inteira.
  return (projetoId || '').split('/')[0];
}

// Um projeto_id é um id de CLIENTE quando é de nível-topo (não tem "/"): a
// mesma regra que a sidebar v2, a cascata de filtro v2 e os selects de criação
// usam pra separar "clientes" de sub-projetos. Centralizada aqui pra que a
// cascata v2 não reescreva `!p.id.includes('/')` inline — divergência entre
// cópias dessa regra foi a causa-raiz do bug de filtro desta tarefa.
export function isClienteId(id) {
  return typeof id === 'string' && id.length > 0 && !id.includes('/');
}

// Um projeto "tem subprojetos de verdade" quando seu Project.sub_projetos
// (populado por scan_projects no backend) não é vazio. Usado tanto para
// decidir se a Tier 2 do filtro/select aparece, quanto para decidir se a
// badge "Cliente" faz sentido num card (ver riscos apontados pelo TL: um
// cliente-como-projeto e um cliente-only com subprojetos têm o mesmo
// formato bruto de projeto_id — só sub_projetos.length > 0 diferencia).
export function projectHasSubprojects(projetoId, projetos) {
  const found = (projetos || []).find((p) => p.id === projetoId);
  return !!found && (found.sub_projetos || []).length > 0;
}

// Decide se a badge "Cliente" deve aparecer num card. `projectHasSubprojects`
// sozinho NÃO basta: em hierarquias de 3+ níveis, um card vinculado a um
// PROJETO específico que por sua vez tem subpastas (ex.
// projeto_id="cliente-x/projeto-y", que tem filho
// "cliente-x/projeto-y/sub-z") também teria sub_projetos.length > 0 e
// ganharia a badge incorretamente, mesmo não sendo um card cliente-only.
// A badge só faz sentido quando as DUAS condições valem: (a) o próprio
// card.projeto_id é um id de nível-topo (sem "/", candidato a "cliente");
// e (b) esse id tem sub_projetos não-vazios (só aí existe ambiguidade real
// entre "cliente-only" e "cliente-como-projeto" a desfazer visualmente).
export function shouldShowClienteBadge(projetoId, projetos) {
  return !projetoId.includes('/') && projectHasSubprojects(projetoId, projetos);
}

// Resolve o texto da badge "Cliente" de um card, conforme o modo de filtro da
// sidebar (Bloco A, feature Clientes na sidebar v2). Em modo "Todos"
// (`showAllClientes` true) TODO card ganha uma badge com o NOME do cliente —
// diferente do modo "cliente específico selecionado" (`showAllClientes`
// false), onde a regra antiga de `shouldShowClienteBadge` continua intacta
// (só cards cliente-only ambíguos ganham a string fixa "Cliente"). Não dá pra
// só reaproveitar `shouldShowClienteBadge` em modo "Todos" porque ali a badge
// precisa aparecer em TODO card (pra identificar de qual cliente cada card é
// na lista combinada), não só nos ambíguos.
export function resolveClienteBadgeLabel(projetoId, projetos, showAllClientes) {
  if (!showAllClientes) {
    return shouldShowClienteBadge(projetoId, projetos) ? 'Cliente' : null;
  }
  const clienteId = clienteIdFromProjetoId(projetoId);
  const found = (projetos || []).find((p) => p.id === clienteId);
  return found ? found.nome : clienteId;
}
