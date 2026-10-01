// frontend/src/features/viewer/useViewerContent.js
// Fase V-2 (6.5.1): busca o corpo de uma aba em GET …/content, com cache por
// item + `updated_at`.
//
// Por que a chave inclui `updated_at`: o agente reabre o mesmo arquivo depois
// de alterá-lo, o backend reaproveita a aba (mesmo item_id) e só muda o
// `updated_at`. Com ele na chave, "abrir de novo" recarrega sozinho; trocar
// entre abas já vistas não refaz a requisição.
//
// O cache é do módulo (não do componente) porque a mesma aba aparece em
// contêineres diferentes — painel encaixado e tela cheia — e trocar de
// contêiner não deve baixar o arquivo de novo.
import { useCallback, useEffect, useState } from 'react';
import { fetchContent } from './viewerApi.js';

const MAX_CACHE = 30;
const cache = new Map();

function cacheKey(item) {
  return item ? `${item.source}:${item.id}:${item.updated_at ?? ''}` : null;
}

function remember(key, data) {
  cache.delete(key);
  cache.set(key, data);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

/** Só para testes. */
export function clearViewerContentCache() {
  cache.clear();
}

/**
 * @returns {{ status: 'idle'|'loading'|'ready'|'gone'|'error',
 *   data: object|null, error: string|null, reload: () => void }}
 *   `gone` = 404: o arquivo (ou a aba) não existe mais — o agente pode ter
 *   movido/apagado; `error` = qualquer outra falha (rede, 403…).
 */
export function useViewerContent(item) {
  const key = cacheKey(item);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(() => (key && cache.has(key)
    ? { key, status: 'ready', data: cache.get(key), error: null }
    : { key, status: key ? 'loading' : 'idle', data: null, error: null }));

  useEffect(() => {
    if (!key) {
      setState({ key, status: 'idle', data: null, error: null });
      return undefined;
    }
    // `reload` apaga a entrada antes de mudar o nonce, então aqui o cache só
    // responde quando a versão ainda é válida.
    if (cache.has(key)) {
      setState({ key, status: 'ready', data: cache.get(key), error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ key, status: 'loading', data: null, error: null });
    fetchContent(item, { signal: controller.signal })
      .then((data) => {
        remember(key, data);
        setState({ key, status: 'ready', data, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          status: error?.status === 404 ? 'gone' : 'error',
          data: null,
          error: error?.status ? error.message : 'Não consegui carregar o arquivo.',
        });
      });
    return () => controller.abort();
    // `item` fica fora das deps de propósito: a chave já resume o que importa
    // dele (origem, id e versão).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  // Enquanto o efeito da chave nova não roda, não devolve o conteúdo da aba
  // anterior (um quadro com o arquivo errado).
  if (state.key !== key) {
    return key && cache.has(key)
      ? { status: 'ready', data: cache.get(key), error: null, reload }
      : { status: key ? 'loading' : 'idle', data: null, error: null, reload };
  }
  return { status: state.status, data: state.data, error: state.error, reload };
}
