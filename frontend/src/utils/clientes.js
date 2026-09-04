// frontend/src/utils/clientes.js
// Helpers puros da feature Cliente/Projeto (Grupo B) — espelham no frontend
// a mesma regra que já existe no backend (app/agent_discovery.py:
// cliente_id_from_projeto_id), pra cascata de filtro (v2), select duplo de
// criação (CardFormModal) e agrupamento por cliente derivarem "cliente" do
// mesmo jeito.
//
// Os três helpers de badge de cliente que viviam aqui saíram junto com a
// árvore do Board v1, a única que os chamava.

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
