// frontend/src/utils/projectTree.js
// Fase N (docs/melhorias-tablet/08-planejamento-navegacao-cliente-projeto.md):
// helpers PUROS da árvore cliente → projeto → subprojeto que a sidebar
// (ClienteList.jsx, drill-down), o escopo global (hooks/useNavScope.js) e os
// filtros das telas (ChatList.jsx) consultam. Ficam juntos e sem React para
// que as três pontas derivem "quem é filho de quem" e "o que está dentro do
// escopo" da MESMA regra — a divergência entre cópias dessa regra já foi a
// causa-raiz de um bug de filtro no Board (ver utils/clientes.js).
//
// A árvore sai do PREFIXO do id, nunca de `Project.sub_projetos`: o backend
// (agent_discovery.scan_projects) garante que toda pasta intermediária existe
// na lista (as "pastas-pai sintéticas", `elegivel: false`), então o prefixo
// basta, e é a mesma regra de `collectSubtreeIds`
// (layouts/v2/useClienteProjetoFilter.js) — que agrega em qualquer
// profundidade, coisa que `sub_projetos` (só filhos diretos) não faz.
//
// Todo teste de prefixo usa `id + '/'`: 'cliente' NÃO é pai de 'cliente2/x'.

import { compareProjectPaths, relativeProjectPath } from './projects.js';

// Pai de um projeto: o id sem o último segmento. Um cliente (nível-topo, sem
// "/") não tem pai dentro da árvore de projetos — devolve `null`, e quem
// navega entende isso como "voltar para a lista de Clientes".
export function parentOf(id) {
  if (typeof id !== 'string' || !id.includes('/')) return null;
  return id.slice(0, id.lastIndexOf('/'));
}

// Filhos DIRETOS de `parentId` (exatamente um segmento a mais), em ordem de
// árvore. `compareProjectPaths` (utils/projects.js) em vez de `localeCompare`
// para a sidebar listar os projetos na MESMA ordem em que o select "Projeto
// principal" do NewChatSheet já lista — duas telas com a mesma lista em ordens
// diferentes confundem mais do que qualquer critério de ordenação.
export function childrenOf(parentId, projects) {
  if (!parentId) return [];
  const prefix = `${parentId}/`;
  const depth = parentId.split('/').length + 1;
  return (projects || [])
    .filter((p) => p.id.startsWith(prefix) && p.id.split('/').length === depth)
    .sort((a, b) => compareProjectPaths(a.id, b.id));
}

// Tem algum descendente? Decide se a linha mostra "›" (e se tocar nela ENTRA
// num nível novo em vez de só selecionar). Qualquer profundidade conta: uma
// pasta cujo único descendente está dois níveis abaixo ainda leva a algum lugar.
export function hasChildren(id, projects) {
  if (!id) return false;
  const prefix = `${id}/`;
  return (projects || []).some((p) => p.id.startsWith(prefix));
}

// Nome de exibição de um nó da árvore. Cai para o último segmento do id (o
// nome da pasta) quando o projeto não está em `projects` — a sidebar precisa
// de ALGUM rótulo no botão "← voltar" mesmo durante o carregamento; aqui não
// vale a regra "sem nome, sem tag" de `resolveProjectName` porque não é tag.
export function labelFor(id, projects) {
  if (!id) return '';
  const found = (projects || []).find((p) => p.id === id);
  if (found?.nome) return found.nome;
  return id.slice(id.lastIndexOf('/') + 1);
}

// "Raiz" do cliente: o escopo que olha SÓ a pasta do próprio cliente (chats,
// cards e tarefas presos direto nele), sem os projetos de baixo. É codificado
// como `projetoId === clienteId` porque esse par não tem outro significado: a
// subárvore inteira do cliente já é `projetoId: null` ("Todos os projetos").
export function isRaizScope(clienteId, projetoId) {
  return clienteId != null && projetoId === clienteId;
}

// Um projeto (de um chat, card ou tarefa) está dentro do escopo da sidebar?
//   - sem cliente ("Todos")            → tudo passa;
//   - cliente, sem projeto             → qualquer coisa do cliente (1º segmento);
//   - Raiz (`projetoId === clienteId`) → só o próprio cliente, igualdade exata;
//   - projeto                          → o projeto e toda a subárvore dele (3+
//                                        níveis inclusive, por prefixo).
export function isInScope(projectId, clienteId, projetoId) {
  if (clienteId == null) return true;
  if (typeof projectId !== 'string' || projectId === '') return false;
  if (projetoId == null) {
    return projectId === clienteId || projectId.startsWith(`${clienteId}/`);
  }
  if (isRaizScope(clienteId, projetoId)) return projectId === clienteId;
  return projectId === projetoId || projectId.startsWith(`${projetoId}/`);
}

// Rótulo do escopo para títulos ("podesubir / site-institucional"): o nome do
// cliente e, abaixo dele, o caminho relativo do projeto (3+ níveis viram
// "api-pagamentos / v2", mesma grafia de `relativeProjectPath` que a linha do
// chat já usa) ou "Raiz". Sem projeto, só o nome do cliente; sem cliente, ''.
// É o que impede o usuário de "se perder no nível Projetos" (seção 8.5): a
// lista de chats diz exatamente o que está filtrando.
export function scopeLabel(clienteId, projetoId, projects) {
  if (clienteId == null) return '';
  const clienteNome = labelFor(clienteId, projects);
  if (projetoId == null) return clienteNome;
  if (isRaizScope(clienteId, projetoId)) return `${clienteNome} / Raiz`;
  return `${clienteNome} / ${relativeProjectPath(projetoId, clienteId)}`;
}
