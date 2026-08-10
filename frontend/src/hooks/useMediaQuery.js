// frontend/src/hooks/useMediaQuery.js
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 1): generaliza
// useNarrowViewport() de components/TasksDrawer.jsx (NÃO tocado — é usado
// pelo v1 também, fora de escopo aqui) para aceitar qualquer media query
// como parâmetro, não só a NARROW_VIEWPORT_QUERY (820px) fixa.
//
// Diferença deliberada em relação ao original: lá o efeito usa `[]` nas deps
// porque a query é uma constante de módulo (nunca muda entre renders); aqui
// `query` é parâmetro, então o `useEffect` precisa de `[query]` — se o
// chamador passar uma query diferente entre renders, o listener antigo é
// removido e um novo é registrado na query nova.
//
// Mantém o mesmo guard SSR/jsdom (`typeof window`) e o fallback
// addListener/removeListener pro Safari antigo (sem addEventListener em
// MediaQueryList) do original.
import { useEffect, useState } from 'react';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler); // older Safari
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, [query]);

  return matches;
}
