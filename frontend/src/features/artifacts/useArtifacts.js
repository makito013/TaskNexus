// frontend/src/features/artifacts/useArtifacts.js
// Fase A (07-planejamento-artefatos.md, 7.5.5): a lista de artefatos da tela e
// QUANDO ela é buscada de novo. Sem polling contínuo — só nestes momentos:
//  1. ao entrar na tela (o hook monta com ela) e ao trocar o cliente;
//  2. quando a aba do navegador/PWA volta a ficar visível ou ganha foco (o
//     agente pode ter publicado algo enquanto o iPad estava em outro app);
//  3. quando chega um `viewer_open` de .md/.html/.pdf de QUALQUER conversa
//     (`artifactsSignal` do ViewerContext): o backend grava o artefato antes
//     de mandar o frame (7.10.3), então a busca já o encontra.
//
// Uma busca nova cancela a anterior (AbortController): trocar de cliente
// rápido não pode deixar a resposta velha chegar por último e ganhar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { listArtifacts } from './artifactsApi.js';

// Foco e visibilidade disparam juntos ao voltar para o app; uma busca basta.
const FOCUS_THROTTLE_MS = 2000;
// Vários `viewer_open` em sequência (o agente abrindo 3 arquivos) viram uma busca.
const SIGNAL_DEBOUNCE_MS = 300;

/**
 * @param {object} args
 * @param {string|null} args.clienteId  cliente efetivo da tela (null = todos)
 * @param {number} [args.signal]        artifactsSignal do ViewerContext
 * @returns {{ artifacts: object[]|null, loading: boolean, error: string|null,
 *   reload: () => void, upsertLocal: (a: object) => void,
 *   removeLocal: (id: string) => void }}
 *   `artifacts` é `null` até a primeira resposta (a tela mostra esqueletos).
 */
export function useArtifacts({ clienteId = null, signal = 0 } = {}) {
  const [state, setState] = useState({ artifacts: null, loading: true, error: null });
  const controllerRef = useRef(null);
  const lastFetchRef = useRef(0);

  const reload = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastFetchRef.current = Date.now();
    setState((prev) => ({ ...prev, loading: true }));
    listArtifacts({ clienteId, signal: controller.signal })
      .then((artifacts) => {
        if (controller.signal.aborted) return;
        setState({ artifacts, loading: false, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        // Mantém a última lista boa: um erro na recarga do foco não deve
        // apagar a tela inteira. O estado de erro só aparece sem lista.
        setState((prev) => ({
          artifacts: prev.artifacts,
          loading: false,
          error: error?.message || 'Não consegui carregar os artefatos.',
        }));
      });
  }, [clienteId]);

  // (1) Montar e trocar de cliente.
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // (2) Voltar para o app.
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastFetchRef.current < FOCUS_THROTTLE_MS) return;
      reload();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [reload]);

  // (3) Agente abriu/publicou um .md/.html/.pdf. O valor inicial não conta
  // (a montagem já buscou).
  const firstSignalRef = useRef(signal);
  useEffect(() => {
    if (signal === firstSignalRef.current) return undefined;
    const timer = setTimeout(reload, SIGNAL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signal, reload]);

  // Ajustes locais depois de uma ação que já tem a resposta do backend
  // (renomear, salvar, remover): a tela muda na hora, sem esperar outra busca.
  const upsertLocal = useCallback((artifact) => {
    if (!artifact?.artifact_id) return;
    setState((prev) => {
      const list = prev.artifacts || [];
      const idx = list.findIndex((a) => a.artifact_id === artifact.artifact_id);
      const next = idx >= 0
        ? list.map((a, i) => (i === idx ? { ...a, ...artifact } : a))
        : [artifact, ...list];
      return { ...prev, artifacts: next };
    });
  }, []);

  const removeLocal = useCallback((artifactId) => {
    setState((prev) => ({
      ...prev,
      artifacts: (prev.artifacts || []).filter((a) => a.artifact_id !== artifactId),
    }));
  }, []);

  return {
    artifacts: state.artifacts,
    loading: state.loading,
    error: state.error,
    reload,
    upsertLocal,
    removeLocal,
  };
}
