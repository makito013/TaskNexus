// frontend/src/features/viewer/ViewerContext.jsx
// Fase V-2 (docs/melhorias-tablet/06-planejamento-fase-v.md, 6.5.2): estado do
// visualizador de arquivos — as abas abertas, qual está ativa, se o painel está
// aberto/em tela cheia e os avisos de "o agente abriu um arquivo".
//
// ESCOPOS E SUPERFÍCIES (preparado para a Fase A, Parte 7, seção 7.3):
//  - Um ESCOPO é um conjunto de abas. Hoje só existe `session:<session_key>`
//    (as abas de uma conversa, persistidas no backend na tabela viewer_items);
//    a aba Artefatos vai usar o escopo `artefatos` (abas só no front, via
//    `openItem`). Cada item carrega a ORIGEM (`source`: 'viewer' | 'artifact')
//    e o viewerApi monta as URLs certas — os renderers não sabem de sessão.
//  - Uma SUPERFÍCIE é o lugar da tela onde um painel aparece: `chat` (à direita
//    do terminal) e, na Fase A, `artefatos`. O aberto/tela cheia é POR
//    SUPERFÍCIE e não por escopo de propósito: trocar de conversa com o painel
//    aberto troca o escopo (`session:A` → `session:B`) mas o painel continua
//    aberto, mostrando as abas da conversa nova (6.5.3: "Fecha também quando a
//    sessão ativa muda? Não").
//
// QUEM ALIMENTA O CONTEXTO:
//  - TerminalPanel: frame `viewer_open` do WebSocket → `receiveOpen`.
//  - AppV2 (via `useViewerHost`): qual conversa está ativa, se a tela de chat
//    está visível e se é celular — é isso que decide se a abertura do agente
//    ABRE o painel sozinho ou só soma no contador e mostra o aviso (6.1).
//  - Componentes do painel: fechar/trocar abas, abrir links (`openByPath`).
//
// O TerminalPanel também é montado em testes isolados, sem Provider: por isso
// `useViewer()` devolve `null` em vez de lançar erro, e quem chama checa.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  closeSessionItem,
  closeSessionItems,
  listSessionItems,
  normalizeItem,
  openSessionPath,
  sessionKeyFromScope,
  sessionScope,
} from './viewerApi.js';
import { basenameOf } from './viewerPaths.js';

// Mesmo limite do backend (6.1/6.4.3). Para os escopos de sessão quem manda é o
// backend (ele devolve `evicted`); aqui ele só vale para escopos locais
// (Artefatos) e como rede de proteção.
export const MAX_TABS = 15;

export const SURFACE_CHAT = 'chat';

const EMPTY_SCOPE = Object.freeze({
  items: [],
  activeId: null,
  loaded: false,
  loading: false,
  error: null,
});
const CLOSED_SURFACE = Object.freeze({ open: false, fullscreen: false });

// Fase A (07-planejamento-artefatos.md, 7.10.3): o backend publica como
// artefato todo .md/.html/.pdf que o AGENTE abre, e grava ANTES de mandar o
// frame `viewer_open`. O frame não diz se virou artefato, então a regra é a da
// extensão do `path` — a mesma que o backend usa.
const ARTIFACT_PATH_RE = /\.(md|markdown|html?|pdf)$/i;

/** O caminho é de um tipo que a aba Artefatos aceita (.md/.html/.pdf)? */
export function isArtifactPath(path) {
  return ARTIFACT_PATH_RE.test(String(path || ''));
}

/** Em que superfície aparece um escopo: as abas de conversa vivem no painel do
 * chat; qualquer outro escopo (ex.: `artefatos`) tem a superfície homônima. */
export function surfaceForScope(scope) {
  return sessionKeyFromScope(scope) !== null ? SURFACE_CHAT : scope || SURFACE_CHAT;
}

/** Nome curto de quem abriu, para o aviso "claude abriu plano.md". O agente vem
 * do 2º segmento da session_key (`projeto::agente[::instância]`). */
export function openerLabel(item, sessionKey) {
  if (item?.opened_by === 'user') return 'Você';
  const agent = String(sessionKey || item?.session_key || '').split('::')[1];
  return agent || 'O agente';
}

function newestItemId(items) {
  let best = null;
  for (const item of items) {
    if (!best || (item.updated_at ?? 0) >= (best.updated_at ?? 0)) best = item;
  }
  return best ? best.id : null;
}

/** Insere ou atualiza (mesmo `id` = aba reaproveitada, no MESMO lugar da fila
 * de abas) e torna ativa. Respeita o limite tirando a de `updated_at` mais
 * antigo — a mesma regra do backend. */
function upsertItem(scopeState, item, evicted = []) {
  const evictedSet = new Set(evicted);
  const items = scopeState.items.filter((i) => !evictedSet.has(i.id));
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...item };
  else items.push(item);
  while (items.length > MAX_TABS) {
    let oldest = -1;
    items.forEach((candidate, i) => {
      if (candidate.id === item.id) return;
      if (oldest === -1 || (candidate.updated_at ?? 0) < (items[oldest].updated_at ?? 0)) oldest = i;
    });
    if (oldest === -1) break;
    items.splice(oldest, 1);
  }
  return { ...scopeState, items, activeId: item.id };
}

/** Tira uma aba; se era a ativa, a vizinha da direita (ou da esquerda) assume —
 * o mesmo que um navegador faz ao fechar a aba atual. */
function removeItem(scopeState, itemId) {
  const idx = scopeState.items.findIndex((i) => i.id === itemId);
  if (idx === -1) return scopeState;
  const items = scopeState.items.filter((i) => i.id !== itemId);
  let { activeId } = scopeState;
  if (activeId === itemId) {
    const neighbor = items[idx] || items[idx - 1] || null;
    activeId = neighbor ? neighbor.id : null;
  }
  return { ...scopeState, items, activeId };
}

let toastSeq = 0;
function nextToastId() {
  toastSeq += 1;
  return toastSeq;
}

const ViewerContext = createContext(null);
const ViewerActionsContext = createContext(null);

export function ViewerProvider({ children }) {
  const [state, setState] = useState(() => ({
    scopes: {},
    surfaces: {},
    unseen: {},
    toast: null,
    // Fase A (7.5.5): contador que sobe a cada `viewer_open` de .md/.html/.pdf,
    // de qualquer conversa. A tela Artefatos observa o número e recarrega a
    // lista — sem polling e sem a tela precisar saber de WebSocket.
    artifactsSignal: 0,
  }));

  // Leitura do estado mais recente dentro de callbacks estáveis (as ações abaixo
  // têm identidade fixa: o TerminalPanel guarda o contexto num ref e não pode
  // ser re-renderizado a cada aba aberta).
  const stateRef = useRef(state);
  stateRef.current = state;

  // O que o casco (AppV2) informa via useViewerHost. Ref, não estado: só é lido
  // no instante em que um frame chega, e mudar de tela não precisa re-renderizar
  // o painel.
  const hostRef = useRef({
    activeSessionKey: null,
    chatVisible: false,
    isMobile: false,
    onShowSession: null,
  });

  // Ids que chegaram ao vivo (frame/POST) enquanto um GET estava em voo: o GET
  // pode ter saído antes de a aba ser gravada, e a resposta dele não pode
  // apagar uma aba que o usuário acabou de ver aparecer.
  const liveArrivalsRef = useRef(new Map());

  const patchScope = useCallback((scope, fn) => {
    setState((prev) => ({
      ...prev,
      scopes: { ...prev.scopes, [scope]: fn(prev.scopes[scope] || EMPTY_SCOPE) },
    }));
  }, []);

  const loadItems = useCallback(async (scope, { force = false } = {}) => {
    const sessionKey = sessionKeyFromScope(scope);
    if (!sessionKey) return;
    const current = stateRef.current.scopes[scope];
    if (!force && current && (current.loaded || current.loading)) return;
    const startedAt = Date.now();
    patchScope(scope, (s) => ({ ...s, loading: true, error: null }));
    try {
      const serverItems = await listSessionItems(sessionKey);
      patchScope(scope, (s) => {
        const serverIds = new Set(serverItems.map((i) => i.id));
        const arrivals = liveArrivalsRef.current;
        const extras = s.items.filter(
          (i) => !serverIds.has(i.id) && (arrivals.get(i.id) ?? 0) >= startedAt,
        );
        const items = [...serverItems, ...extras];
        const activeId = items.some((i) => i.id === s.activeId) ? s.activeId : newestItemId(items);
        return { ...s, items, activeId, loaded: true, loading: false, error: null };
      });
    } catch (error) {
      patchScope(scope, (s) => ({
        ...s,
        loading: false,
        // Mesmo com erro marca `loaded`: sem isso cada re-render tentaria de
        // novo em laço. "Tentar de novo" no painel chama com `force`.
        loaded: true,
        error: error?.message || 'Não consegui carregar as abas.',
      }));
    }
  }, [patchScope]);

  /** Mostra a superfície (painel) com o escopo aberto. No celular é sempre tela
   * cheia (6.1: não há espaço para painel). */
  const revealSurface = (prev, surface) => {
    const isMobile = hostRef.current.isMobile;
    const current = prev.surfaces[surface] || CLOSED_SURFACE;
    return {
      ...prev.surfaces,
      [surface]: { open: true, fullscreen: isMobile ? true : current.fullscreen },
    };
  };

  // `_reused` é parte do contrato do frame (`{item, reused, evicted}`) mas não
  // muda nada aqui: mesmo `item_id` já é a mesma aba, atualizada no lugar.
  const receiveOpen = useCallback((sessionKey, rawItem, _reused = false, evicted = []) => {
    const item = normalizeItem(rawItem);
    if (!item || !sessionKey) return;
    const scope = sessionScope(sessionKey);
    liveArrivalsRef.current.set(item.id, Date.now());
    const host = hostRef.current;
    // 6.1: abre sozinho só se a conversa do agente estiver na tela. Senão soma no
    // contador do botão e mostra o aviso curto — tomar a tela de quem está no
    // Board ou em outra conversa seria pior do que esperar um toque.
    const visible = !!host.chatVisible && host.activeSessionKey === sessionKey;
    const toast = visible
      ? null
      : {
          id: nextToastId(),
          kind: 'open',
          scope,
          sessionKey,
          itemId: item.id,
          text: `${openerLabel(item, sessionKey)} abriu ${item.title || basenameOf(item.path)}`,
        };
    const bump = isArtifactPath(item.path) ? 1 : 0;
    setState((prev) => {
      const scopeState = upsertItem(prev.scopes[scope] || EMPTY_SCOPE, item, evicted);
      const artifactsSignal = prev.artifactsSignal + bump;
      if (visible) {
        return {
          ...prev,
          artifactsSignal,
          scopes: { ...prev.scopes, [scope]: scopeState },
          surfaces: revealSurface(prev, SURFACE_CHAT),
          unseen: { ...prev.unseen, [scope]: 0 },
        };
      }
      return {
        ...prev,
        artifactsSignal,
        scopes: { ...prev.scopes, [scope]: scopeState },
        unseen: { ...prev.unseen, [scope]: (prev.unseen[scope] || 0) + 1 },
        toast,
      };
    });
  }, []);

  const showToast = useCallback((text, kind = 'info') => {
    setState((prev) => ({ ...prev, toast: { id: nextToastId(), kind, text } }));
  }, []);

  const dismissToast = useCallback((toastId) => {
    setState((prev) => (prev.toast && (toastId == null || prev.toast.id === toastId)
      ? { ...prev, toast: null }
      : prev));
  }, []);

  /** Abrir pelo usuário: link num markdown aberto ou caminho tocado no terminal.
   * É uma ação explícita, então sempre mostra o painel. Devolve `{ ok, error }`
   * e, em caso de erro, também mostra o aviso com a mensagem do backend
   * ("Arquivo não encontrado: …"). */
  const openByPath = useCallback(async (scope, caminho, { linha, relativoA } = {}) => {
    const sessionKey = sessionKeyFromScope(scope);
    if (!sessionKey) {
      const error = 'Abra uma conversa para ver arquivos do projeto.';
      showToast(error, 'error');
      return { ok: false, error };
    }
    try {
      const { item, evicted } = await openSessionPath(sessionKey, caminho, { linha, relativoA });
      if (!item) throw new Error('Resposta inválida do servidor.');
      liveArrivalsRef.current.set(item.id, Date.now());
      const surface = surfaceForScope(scope);
      setState((prev) => ({
        ...prev,
        scopes: { ...prev.scopes, [scope]: upsertItem(prev.scopes[scope] || EMPTY_SCOPE, item, evicted) },
        surfaces: revealSurface(prev, surface),
        unseen: { ...prev.unseen, [scope]: 0 },
      }));
      return { ok: true, item };
    } catch (error) {
      const message = error?.message || 'Não consegui abrir o arquivo.';
      showToast(message, 'error');
      return { ok: false, error: message };
    }
  }, [showToast]);

  /** Fase A: abre um item que NÃO vem do backend do visualizador (ex.: um
   * artefato, `source: 'artifact'`) num escopo local, já normalizado. */
  const openItem = useCallback((scope, rawItem, { source } = {}) => {
    const item = normalizeItem(rawItem, source);
    if (!item || !scope) return;
    setState((prev) => ({
      ...prev,
      scopes: {
        ...prev.scopes,
        [scope]: { ...upsertItem(prev.scopes[scope] || EMPTY_SCOPE, item), loaded: true },
      },
      surfaces: revealSurface(prev, surfaceForScope(scope)),
    }));
  }, []);

  /** Fase A (7.5.4): devolve a um escopo LOCAL as abas guardadas (ex.: em
   * sessionStorage) sem abrir o painel — recarregar a página não deve jogar o
   * visualizador na cara de quem só voltou à tela. Só age se o escopo ainda não
   * foi carregado nesta página: depois disso, quem manda é o que está na tela. */
  const restoreItems = useCallback((scope, rawItems, activeId = null, { source } = {}) => {
    if (!scope || sessionKeyFromScope(scope)) return;
    setState((prev) => {
      if (prev.scopes[scope]?.loaded) return prev;
      const items = (Array.isArray(rawItems) ? rawItems : [])
        .map((raw) => normalizeItem(raw, source))
        .filter(Boolean)
        .slice(-MAX_TABS);
      const active = items.some((i) => i.id === activeId) ? activeId : newestItemId(items);
      return {
        ...prev,
        scopes: {
          ...prev.scopes,
          [scope]: { ...EMPTY_SCOPE, items, activeId: active, loaded: true },
        },
      };
    });
  }, []);

  /** Fase A: atualiza no lugar as abas JÁ abertas de um escopo com dados mais
   * novos (a lista de artefatos recarregou: título renomeado, arquivo alterado
   * no disco). Nunca abre aba nova nem mexe no painel; sem mudança real, não
   * troca o estado (evita re-render de todo o app a cada recarga da lista). */
  const syncItems = useCallback((scope, rawItems, { source } = {}) => {
    if (!scope || !Array.isArray(rawItems)) return;
    const fresh = new Map();
    rawItems.forEach((raw) => {
      const item = normalizeItem(raw, source);
      if (item) fresh.set(item.id, item);
    });
    setState((prev) => {
      const current = prev.scopes[scope];
      if (!current || current.items.length === 0) return prev;
      let changed = false;
      const items = current.items.map((old) => {
        const next = fresh.get(old.id);
        if (!next) return old;
        const merged = { ...old, ...next };
        const differs = Object.keys(merged).some((k) => merged[k] !== old[k]);
        if (!differs) return old;
        changed = true;
        return merged;
      });
      if (!changed) return prev;
      return { ...prev, scopes: { ...prev.scopes, [scope]: { ...current, items } } };
    });
  }, []);

  const closeItem = useCallback((scope, itemId) => {
    const surface = surfaceForScope(scope);
    setState((prev) => {
      const scopeState = removeItem(prev.scopes[scope] || EMPTY_SCOPE, itemId);
      const scopes = { ...prev.scopes, [scope]: scopeState };
      // 6.7: fechar a última aba fecha o painel — painel vazio aberto só ocupa
      // espaço (e mantém as colunas recolhidas à toa no iPad deitado).
      if (scopeState.items.length === 0) {
        return { ...prev, scopes, surfaces: { ...prev.surfaces, [surface]: CLOSED_SURFACE } };
      }
      return { ...prev, scopes };
    });
    const sessionKey = sessionKeyFromScope(scope);
    if (sessionKey) {
      closeSessionItem(sessionKey, itemId).catch(() => {
        // Falha de rede: a aba sumiu da tela mas pode continuar no banco.
        // Recarregar a lista é mais honesto do que fingir que fechou.
        loadItems(scope, { force: true });
      });
    }
  }, [loadItems]);

  const closeAll = useCallback((scope) => {
    const surface = surfaceForScope(scope);
    setState((prev) => ({
      ...prev,
      scopes: { ...prev.scopes, [scope]: { ...(prev.scopes[scope] || EMPTY_SCOPE), items: [], activeId: null } },
      surfaces: { ...prev.surfaces, [surface]: CLOSED_SURFACE },
      unseen: { ...prev.unseen, [scope]: 0 },
    }));
    const sessionKey = sessionKeyFromScope(scope);
    if (sessionKey) {
      closeSessionItems(sessionKey).catch(() => loadItems(scope, { force: true }));
    }
  }, [loadItems]);

  const setActive = useCallback((scope, itemId) => {
    patchScope(scope, (s) => (s.items.some((i) => i.id === itemId) ? { ...s, activeId: itemId } : s));
  }, [patchScope]);

  const setOpen = useCallback((surface, open) => {
    setState((prev) => {
      const current = prev.surfaces[surface] || CLOSED_SURFACE;
      const next = open ? { ...current, open: true } : CLOSED_SURFACE;
      let { unseen } = prev;
      // Abrir o painel do chat é "ver" o que o agente abriu na conversa ativa.
      if (open && surface === SURFACE_CHAT) {
        const scope = sessionScope(hostRef.current.activeSessionKey);
        if (scope && unseen[scope]) unseen = { ...unseen, [scope]: 0 };
      }
      return { ...prev, surfaces: { ...prev.surfaces, [surface]: next }, unseen };
    });
  }, []);

  const setFullscreen = useCallback((surface, fullscreen) => {
    setState((prev) => {
      const current = prev.surfaces[surface] || CLOSED_SURFACE;
      // Tela cheia implica painel aberto; sair dela volta ao painel (6.5.3).
      const next = fullscreen ? { open: true, fullscreen: true } : { ...current, fullscreen: false };
      return { ...prev, surfaces: { ...prev.surfaces, [surface]: next } };
    });
  }, []);

  /** "Ver" do aviso: leva à conversa (o casco troca de tela e de chat) e abre o
   * painel na aba que chegou. */
  const revealToast = useCallback((toast) => {
    if (!toast) return;
    if (toast.sessionKey) hostRef.current.onShowSession?.(toast.sessionKey);
    if (toast.scope && toast.itemId) {
      patchScope(toast.scope, (s) => (s.items.some((i) => i.id === toast.itemId)
        ? { ...s, activeId: toast.itemId }
        : s));
    }
    setState((prev) => ({
      ...prev,
      surfaces: revealSurface(prev, surfaceForScope(toast.scope)),
      unseen: toast.scope ? { ...prev.unseen, [toast.scope]: 0 } : prev.unseen,
      toast: null,
    }));
  }, [patchScope]);

  // Dois contextos: as AÇÕES têm identidade fixa (todas as funções acima são
  // estáveis), então quem só dispara ações — o TerminalPanel, um por conversa
  // montada — não re-renderiza a cada aba aberta. Quem desenha o painel usa
  // `useViewer()`, que junta estado + ações.
  const actions = useMemo(() => ({
    loadItems,
    receiveOpen,
    openByPath,
    openItem,
    restoreItems,
    syncItems,
    closeItem,
    closeAll,
    setActive,
    setOpen,
    setFullscreen,
    showToast,
    dismissToast,
    revealToast,
    hostRef,
  }), [
    loadItems,
    receiveOpen,
    openByPath,
    openItem,
    restoreItems,
    syncItems,
    closeItem,
    closeAll,
    setActive,
    setOpen,
    setFullscreen,
    showToast,
    dismissToast,
    revealToast,
  ]);

  const value = useMemo(() => ({
    ...actions,
    scopes: state.scopes,
    surfaces: state.surfaces,
    unseen: state.unseen,
    toast: state.toast,
    artifactsSignal: state.artifactsSignal,
    getScope: (scope) => state.scopes[scope] || EMPTY_SCOPE,
    getSurface: (surface) => state.surfaces[surface] || CLOSED_SURFACE,
  }), [actions, state]);

  return (
    <ViewerActionsContext.Provider value={actions}>
      <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
    </ViewerActionsContext.Provider>
  );
}

/** Só as ações (identidade estável), ou `null` fora do Provider. */
export function useViewerActions() {
  return useContext(ViewerActionsContext);
}

/** O contexto, ou `null` fora do Provider (TerminalPanel em teste isolado). */
export function useViewer() {
  return useContext(ViewerContext);
}

/**
 * Liga o casco (AppV2 hoje; ArtefatosV2 não precisa) ao contexto: informa a
 * conversa ativa e se ela está na tela, e carrega as abas da conversa ao
 * montar/trocar de conversa (6.5.2: `loadItems` "se !loaded").
 *
 * @param {object} host
 * @param {string|null} host.activeSessionKey
 * @param {boolean} host.chatVisible  a tela de chat está à vista (no celular,
 *   também `mobileView === 'content'`)
 * @param {boolean} host.isMobile     ≤ 640px: abrir = tela cheia
 * @param {(sessionKey: string) => void} [host.onShowSession]  "Ver" do aviso
 */
export function useViewerHost({ activeSessionKey, chatVisible, isMobile, onShowSession }) {
  const viewer = useContext(ViewerActionsContext);
  const hostRef = viewer?.hostRef;
  // Escrito no commit (efeito sem deps), nunca durante o render.
  useEffect(() => {
    if (!hostRef) return;
    hostRef.current = {
      activeSessionKey: activeSessionKey || null,
      chatVisible: !!chatVisible,
      isMobile: !!isMobile,
      onShowSession: onShowSession || null,
    };
  });

  const loadItems = viewer?.loadItems;
  useEffect(() => {
    if (!loadItems || !activeSessionKey) return;
    loadItems(sessionScope(activeSessionKey));
  }, [loadItems, activeSessionKey]);
}
