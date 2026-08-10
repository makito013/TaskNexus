// frontend/src/hooks/useSidebarCollapsed.js
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 12): extraído de
// layouts/v1/AppV1.jsx (onde vivia como função local desde o Milestone 1)
// para este módulo compartilhado — layouts/v2/AppV2.jsx precisa da mesma
// preferência de colapso, sob a MESMA chave de localStorage, então trocar de
// v1 para v2 (ou vice-versa) não reseta a escolha do usuário. AppV1.jsx
// importa daqui também (ver Tarefa 12), sem mudança de comportamento.
//
// Etapa 7 (plano de fix, RF02 Tarefa 2): `storageKey` virou parâmetro em vez
// de constante fixa, para que ChatSidebarV2 (nova sidebar recolhível) possa
// persistir seu próprio estado sob uma chave diferente, sem pisar na
// preferência da SidebarV2 de navegação. Chamadas existentes sem argumento
// (v1 AppV1.jsx, v2 AppV2.jsx->SidebarV2) continuam usando o default
// SIDEBAR_COLLAPSE_KEY — byte-a-byte o mesmo comportamento de antes.
import { useCallback, useEffect, useState } from 'react';
import { NARROW_VIEWPORT_QUERY } from '../utils/viewport.js';

const SIDEBAR_COLLAPSE_KEY = 'escritorio::sidebar_collapsed';

export function useSidebarCollapsed(storageKey = SIDEBAR_COLLAPSE_KEY) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === 'true';
    } catch { /* ignore */ }
    // No stored preference yet: default collapsed on narrow/tablet-width viewports
    // so the sidebar doesn't eat ~25% of the screen on first load.
    return typeof window !== 'undefined' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(collapsed)); }
    catch { /* ignore */ }
  }, [storageKey, collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
    // RF02 Tarefa 2 (plano Layout v2, 06-TL.md): notifica interessados fora
    // da árvore React (TerminalPanel via CustomEvent global) de que o layout
    // da sidebar mudou de largura, para que possam reagendar um fitAddon.fit()
    // depois que a transição CSS de width terminar (v1 e v2 compartilham este
    // hook, então um único dispatch cobre os dois layouts).
    window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
  }, []);
  return [collapsed, toggle];
}
