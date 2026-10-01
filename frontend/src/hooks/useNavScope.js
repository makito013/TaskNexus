// frontend/src/hooks/useNavScope.js
// Fase N (docs/melhorias-tablet/08-planejamento-navegacao-cliente-projeto.md,
// seção 8.3.2): escopo GLOBAL de navegação do layout v2 — qual cliente e qual
// projeto estão selecionados na sidebar, e em que nível do drill-down ela
// está. Substitui o `useState(selectedClienteId)` que vivia no AppV2: o
// cliente continua existindo, agora com um projeto opcional embaixo, e os dois
// juntos filtram Chat, Board e Tarefas.
//
// Forma do estado:
//   clienteId  'podesubir' | null         null = "Todos"
//   projetoId  'podesubir/site' | null    null = "Todos os projetos" do cliente;
//                                         === clienteId = "Raiz" (só a pasta do
//                                         cliente, ver utils/projectTree.js)
//   level      'clientes' | 'projetos'    o que a seção da sidebar está listando
//   parentId   id | null                  de quem os filhos estão sendo listados
//                                         no nível 'projetos' (o cliente ou um
//                                         projeto com filhos); null em 'clientes'
//
// Seleção e navegação são coisas diferentes de propósito: `back()` só muda o
// que a sidebar LISTA, nunca o que está selecionado (voltar para Clientes não
// limpa o filtro — quem limpa é "Todos", item 3 do aceite manual 8.4).
//
// Persistência em localStorage (`escritorio::v2_nav_scope`, item 8 da seção
// 8.2.1): recarregar a página volta para o mesmo cliente/projeto/nível. O valor
// salvo é validado contra `projects` assim que a lista chega — um cliente ou
// projeto que deixou de existir no disco cai para "Todos" (seção 8.5). Antes
// de a lista chegar NÃO se valida: `useProjects` começa com `[]`, e validar
// contra a lista vazia jogaria fora toda escolha salva em todo reload.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasChildren, parentOf } from '../utils/projectTree.js';

export const NAV_SCOPE_STORAGE_KEY = 'escritorio::v2_nav_scope';

// Constante de módulo, não objeto novo a cada chamada: `sanitizeNavScope`
// devolve ESTA referência quando cai para "Todos", e o efeito de sincronia
// abaixo compara por referência para não entrar em loop de setState.
export const TODOS_SCOPE = Object.freeze({
  clienteId: null,
  projetoId: null,
  level: 'clientes',
  parentId: null,
});

function isWithin(id, rootId) {
  return id === rootId || (typeof id === 'string' && id.startsWith(`${rootId}/`));
}

// Só a FORMA (tipos e combinações possíveis), sem olhar `projects` — serve
// para descartar lixo do localStorage (JSON de outra versão, edição manual)
// antes mesmo de a lista de projetos existir.
function hasValidShape(s) {
  if (!s || typeof s !== 'object') return false;
  const { clienteId, projetoId, level, parentId } = s;
  const isIdOrNull = (v) => v === null || (typeof v === 'string' && v.length > 0);
  if (!isIdOrNull(clienteId) || !isIdOrNull(projetoId) || !isIdOrNull(parentId)) return false;
  if (level !== 'clientes' && level !== 'projetos') return false;
  if (clienteId === null) return projetoId === null && parentId === null && level === 'clientes';
  if (clienteId.includes('/')) return false;
  if (projetoId !== null && !isWithin(projetoId, clienteId)) return false;
  if (level === 'clientes') return parentId === null;
  return parentId !== null && isWithin(parentId, clienteId);
}

// Valida um escopo contra a lista REAL de projetos. Qualquer peça que não
// existe mais derruba o escopo inteiro para "Todos" (decisão da seção 8.5 —
// previsível, e o usuário refaz a escolha com dois toques). Devolve o MESMO
// objeto quando está tudo certo, para quem chama poder comparar referências.
export function sanitizeNavScope(scope, projects) {
  if (!hasValidShape(scope)) return TODOS_SCOPE;
  if (!projects || projects.length === 0) return scope;
  const ids = new Set(projects.map((p) => p.id));
  const { clienteId, projetoId, level, parentId } = scope;
  if (clienteId === null) return scope;
  if (!ids.has(clienteId)) return TODOS_SCOPE;
  if (projetoId !== null && !ids.has(projetoId)) return TODOS_SCOPE;
  // No nível 'projetos' o pai precisa existir E ter o que listar: um nível de
  // projetos vazio não tem saída a não ser o botão voltar.
  if (level === 'projetos' && (!ids.has(parentId) || !hasChildren(parentId, projects))) {
    return TODOS_SCOPE;
  }
  return scope;
}

function readStoredScope() {
  try {
    const raw = localStorage.getItem(NAV_SCOPE_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return hasValidShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {Array} projects lista de /api/projects (pode chegar vazia no 1º render)
 * @param {{ initialClienteId?: string|null }} options  usado só quando não há
 *   nada salvo: o AppV2 passa o cliente do chat ativo (`selectedProjectId` do
 *   TerminalContext), para a primeira abertura já cair no cliente certo —
 *   mesmo comportamento que o `useState` antigo tinha.
 */
export function useNavScope(projects, { initialClienteId = null } = {}) {
  const [scope, setScope] = useState(() => {
    const stored = readStoredScope();
    if (stored) return stored;
    return initialClienteId ? { ...TODOS_SCOPE, clienteId: initialClienteId } : TODOS_SCOPE;
  });

  // Derivado no render (não só no efeito): o render em que `projects` chega já
  // entrega o escopo validado às telas, sem um quadro filtrando por um
  // projeto que não existe mais.
  const effective = useMemo(() => sanitizeNavScope(scope, projects), [scope, projects]);

  useEffect(() => {
    if (effective !== scope) setScope(effective);
  }, [effective, scope]);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_SCOPE_STORAGE_KEY, JSON.stringify(effective));
    } catch { /* ignore — modo privado do Safari, cota cheia */ }
  }, [effective]);

  const reset = useCallback(() => setScope(TODOS_SCOPE), []);

  // Cliente SEM subprojetos (decisão do Bruno): só seleciona, a lista continua
  // em Clientes. `null` é o "Todos".
  const selectCliente = useCallback((clienteId) => {
    setScope(clienteId == null ? TODOS_SCOPE : { ...TODOS_SCOPE, clienteId });
  }, []);

  // Cliente COM subprojetos: seleciona o cliente inteiro ("Todos os projetos",
  // igual a selecionar o cliente antes desta fase) e troca a lista para os
  // projetos dele.
  const enterCliente = useCallback((clienteId) => {
    if (!clienteId) return;
    setScope({ clienteId, projetoId: null, level: 'projetos', parentId: clienteId });
  }, []);

  // Seleciona um projeto sem mudar o nível. `null` = "Todos os projetos" do
  // cliente; o próprio cliente = "Raiz". Ids fora do cliente atual são
  // ignorados (um clique atrasado depois de trocar de cliente, por exemplo).
  const selectProjeto = useCallback((projetoId) => {
    setScope((s) => {
      if (s.clienteId == null) return s;
      if (projetoId == null) return { ...s, projetoId: null };
      if (!isWithin(projetoId, s.clienteId)) return s;
      return { ...s, projetoId };
    });
  }, []);

  // Projeto COM filhos: seleciona a subárvore dele e desce um nível.
  const enterProjeto = useCallback((projetoId) => {
    setScope((s) => {
      if (s.clienteId == null || !projetoId || !isWithin(projetoId, s.clienteId)) return s;
      return { ...s, projetoId, level: 'projetos', parentId: projetoId };
    });
  }, []);

  // Sobe um nível na LISTA, sem tocar na seleção. Do nível de projetos de um
  // cliente volta para Clientes; de um subnível volta para o pai.
  const back = useCallback(() => {
    setScope((s) => {
      if (s.level !== 'projetos') return s;
      const up = parentOf(s.parentId);
      if (up == null) return { ...s, level: 'clientes', parentId: null };
      return { ...s, parentId: up };
    });
  }, []);

  return {
    ...effective,
    selectCliente,
    enterCliente,
    selectProjeto,
    enterProjeto,
    back,
    reset,
  };
}
