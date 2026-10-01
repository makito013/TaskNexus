// frontend/src/features/artifacts/useSaveToArtifacts.js
// Fase A (07-planejamento-artefatos.md, 7.5.1): "☆ Salvar em Artefatos" no
// visualizador do CHAT. Só aparece para uma aba de conversa (`source:
// 'viewer'`) de um .md/.html/.pdf que AINDA NÃO é artefato.
//
// Por que perguntar ao backend se "ainda não é": tudo que o AGENTE abre desses
// tipos já vira artefato sozinho (7.10.2, item 17), então o botão é útil
// justamente para o que VOCÊ abriu (link no markdown, caminho tocado no
// terminal) — e para o que alguém tirou da lista. O jeito barato e exato é a
// lista do projeto (`GET /api/artifacts?projeto_id=`), guardada por alguns
// segundos por projeto: trocar de aba no painel não refaz a pergunta a cada
// toque. Salvar invalida o cache daquele projeto.
import { useCallback, useEffect, useState } from 'react';
import { isArtifactPath } from '../viewer/ViewerContext.jsx';
import { SOURCE_VIEWER } from '../viewer/viewerApi.js';
import { createArtifact, listProjectArtifacts } from './artifactsApi.js';

const CACHE_TTL_MS = 15000;
const cache = new Map(); // projectId -> { at, promise }

/** Só para testes. */
export function clearArtifactStatusCache() {
  cache.clear();
}

function projectPaths(projectId) {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = listProjectArtifacts(projectId)
    .then((list) => new Set(list.filter((a) => a.project_id === projectId).map((a) => a.path)))
    .catch((error) => {
      cache.delete(projectId);
      throw error;
    });
  cache.set(projectId, { at: Date.now(), promise });
  return promise;
}

/** A aba pode virar artefato? (origem chat + tipo aceito + projeto conhecido) */
export function canSaveAsArtifact(item) {
  return !!item
    && (item.source || SOURCE_VIEWER) === SOURCE_VIEWER
    && !!item.project_id
    && isArtifactPath(item.path);
}

/**
 * @returns {{ status: 'hidden'|'checking'|'available'|'saving'|'saved',
 *   save: () => Promise<{ ok: boolean, created?: boolean, error?: string }> }}
 */
export function useSaveToArtifacts(item) {
  const eligible = canSaveAsArtifact(item);
  const projectId = item?.project_id;
  const path = item?.path;
  const key = eligible ? `${projectId}\n${path}` : null;
  const [state, setState] = useState({ key: null, status: 'hidden' });

  useEffect(() => {
    if (!key) {
      setState({ key: null, status: 'hidden' });
      return undefined;
    }
    let cancelled = false;
    setState({ key, status: 'checking' });
    projectPaths(projectId)
      .then((paths) => {
        if (!cancelled) setState({ key, status: paths.has(path) ? 'hidden' : 'available' });
      })
      .catch(() => {
        // Sem resposta, mostra o botão: o POST é idempotente (200 = já era).
        if (!cancelled) setState({ key, status: 'available' });
      });
    return () => { cancelled = true; };
  }, [key, projectId, path]);

  const save = useCallback(async () => {
    if (!key) return { ok: false };
    setState({ key, status: 'saving' });
    try {
      const { created } = await createArtifact(projectId, path);
      cache.delete(projectId);
      setState({ key, status: 'saved' });
      return { ok: true, created };
    } catch (error) {
      setState({ key, status: 'available' });
      return { ok: false, error: error?.message || 'Não consegui salvar em Artefatos.' };
    }
  }, [key, projectId, path]);

  return { status: state.key === key ? state.status : (key ? 'checking' : 'hidden'), save };
}
