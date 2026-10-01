// frontend/src/features/artifacts/useArtifactTabsStorage.js
// Fase A (07-planejamento-artefatos.md, 7.5.4): as abas do painel da tela
// Artefatos vivem só no front (não têm tabela, ao contrário das abas de uma
// conversa) e ficam em sessionStorage para sobreviver a recarregar a página —
// no iPad o Safari descarta a aba em segundo plano com frequência.
//
// sessionStorage, e não localStorage, de propósito: é "o que eu estava lendo
// nesta janela". Abrir o TaskNexus amanhã não deve reabrir 15 abas velhas.
//
// Todo acesso fica em try/catch: no Safari em navegação privada (e com o
// armazenamento bloqueado) o acesso lança, e a tela tem de funcionar igual,
// só sem lembrar as abas.
import { useEffect } from 'react';
import { MAX_TABS } from '../viewer/ViewerContext.jsx';
import { SOURCE_ARTIFACT } from '../viewer/viewerApi.js';
import { SCOPE_ARTEFATOS } from './artifactModel.js';

export const ARTIFACT_TABS_KEY = 'escritorio::artefatos_viewer_tabs';

export function readStoredTabs() {
  try {
    const raw = window.sessionStorage.getItem(ARTIFACT_TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items.filter((i) => i && typeof i === 'object' && i.artifact_id).slice(-MAX_TABS),
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return null;
  }
}

export function writeStoredTabs(items, activeId) {
  try {
    if (!items || items.length === 0) {
      window.sessionStorage.removeItem(ARTIFACT_TABS_KEY);
      return;
    }
    // Só o que o painel precisa para reabrir a aba; `source`/`id` são
    // recalculados pelo normalizeItem na volta.
    const slim = items.slice(-MAX_TABS).map(({ source: _s, id: _i, ...rest }) => rest);
    window.sessionStorage.setItem(ARTIFACT_TABS_KEY, JSON.stringify({ items: slim, activeId }));
  } catch {
    // Cota cheia, modo privado, armazenamento bloqueado: segue sem lembrar.
  }
}

/** Restaura as abas na primeira vez que a tela monta nesta página e grava a
 * cada mudança depois disso. `viewer` = useViewer(). */
export function useArtifactTabsStorage(viewer) {
  const scopeState = viewer ? viewer.getScope(SCOPE_ARTEFATOS) : null;
  const restoreItems = viewer?.restoreItems;
  const loaded = !!scopeState?.loaded;

  useEffect(() => {
    if (!restoreItems || loaded) return;
    const stored = readStoredTabs();
    // Mesmo sem nada guardado, marca o escopo como carregado: daqui em diante
    // o que vale é o que está na tela.
    restoreItems(SCOPE_ARTEFATOS, stored?.items || [], stored?.activeId || null, { source: SOURCE_ARTIFACT });
  }, [restoreItems, loaded]);

  const items = scopeState?.items;
  const activeId = scopeState?.activeId ?? null;
  useEffect(() => {
    if (!loaded) return;
    writeStoredTabs(items || [], activeId);
  }, [loaded, items, activeId]);
}
