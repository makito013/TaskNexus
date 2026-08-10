// frontend/src/hooks/useRoute.js
// Roteador mínimo caseiro (ADR-4, .planning/phases/05-tarefas-board-jira/05-ARQUITETO.md
// seção 4.1) — pushState/popstate, sem dependência de lib de rota (nenhuma
// instalada no projeto). Suficiente para alternar entre `/`, `/board` e
// `/tarefas` em App.jsx sem re-render de página inteira nem perder o estado
// vivo do TerminalProvider (sessões PTY continuam montadas nas 3 árvores).

import { useState, useEffect, useCallback } from 'react';

export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);

  return [path, navigate];
}
