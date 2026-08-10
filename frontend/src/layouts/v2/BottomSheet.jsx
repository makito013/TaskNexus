// frontend/src/layouts/v2/BottomSheet.jsx
// Feature Clientes na sidebar v2 (Bloco C) — primitivo genérico de bottom
// sheet (scrim + painel + handle), SEM conteúdo de domínio: quem precisa de
// um formulário dentro (ex. NewChatSheet.jsx) monta o próprio conteúdo como
// `children`. Mantém este componente reaproveitável para qualquer sheet
// futuro do v2, sem acoplar a nenhum caso de uso específico.
//
// Fecha por 3 gestos: clique no scrim, tecla ESC (listener de `keydown` só
// enquanto `open` — não fica escutando globalmente quando fechado) e clique no
// handle (mesma ação do scrim). Clique DENTRO do painel não fecha
// (`stopPropagation` no painel) — só o scrim/handle/ESC fecham.
//
// Sem drag-to-dismiss: o projeto não usa nenhuma lib de gestos (Technology
// Stack em .claude/CLAUDE.md), então implementar arrasto à mão só pra este
// componente seria escopo não pedido — os 3 gestos acima já cobrem touch e
// teclado.
//
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 4): 3 props
// aditivas, cada uma com default que preserva 100% o comportamento anterior
// (nenhum consumidor existente passa qualquer uma delas):
//   - `maxHeightVh` (default 85): substitui o `85vh` antes hardcoded em
//     styles.panel — permite sheets mais baixos (ex. MobileChatSheet).
//   - `fixedFooter` (default false): quando true, o painel vira
//     `overflow:'hidden'` em vez de `overflowY:'auto'`. CONTRATO: quem usa
//     este modo é responsável por estruturar os próprios `children` como
//     header fixo + `<div style={{flex:1,minHeight:0,overflowY:'auto'}}>` +
//     footer fixo — o painel em si só para de rolar como um todo, não rola
//     mais nada sozinho.
//   - `escapeEnabled` (default true): quando false, o listener de `keydown`
//     não é registrado (mesmo enquanto `open`) — usado por quem empilha um
//     segundo BottomSheet por cima (ex. NewChatSheet dentro de
//     MobileChatSheet) pra evitar que um único ESC feche as duas sheets de
//     uma vez.

import { useEffect } from 'react';

const styles = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'var(--v2-scrim)',
    zIndex: 40,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  panel: (maxHeightVh, fixedFooter) => ({
    width: '100%',
    maxWidth: '480px',
    maxHeight: `${maxHeightVh}vh`,
    overflowY: fixedFooter ? 'hidden' : 'auto',
    overflow: fixedFooter ? 'hidden' : undefined,
    background: 'var(--v2-surface)',
    borderTopLeftRadius: '16px',
    borderTopRightRadius: '16px',
    boxShadow: 'var(--v2-shadow-lg)',
    // padding-bottom soma env(safe-area-inset-bottom) ao valor fixo em vez de
    // substituí-lo — achado do Revisor (etapa 9): sem isso, o footer fixo do
    // MobileChatSheet.jsx (fixedFooter=true) cola no home indicator do iOS.
    padding: '8px 20px calc(24px + env(safe-area-inset-bottom))',
    display: 'flex',
    flexDirection: 'column',
  }),
  handleWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: '10px 0 6px',
    cursor: 'pointer',
  },
  handle: {
    width: '36px',
    height: '4px',
    borderRadius: '999px',
    background: 'var(--v2-border)',
  },
};

export function BottomSheet({ open, onClose, children, maxHeightVh = 85, fixedFooter = false, escapeEnabled = true }) {
  // Listener de ESC só existe enquanto o sheet está aberto E escapeEnabled —
  // evita um `keydown` global "vazando" (e fechando um sheet futuro por
  // engano) quando este componente está montado mas fechado, e evita ESC
  // fechando duas sheets empilhadas de uma vez quando o pai desabilita.
  useEffect(() => {
    if (!open || !escapeEnabled) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, escapeEnabled, onClose]);

  if (!open) return null;

  return (
    <div style={styles.scrim} onClick={onClose} data-testid="bottom-sheet-scrim">
      <div style={styles.panel(maxHeightVh, fixedFooter)} onClick={(e) => e.stopPropagation()} data-testid="bottom-sheet-panel">
        <div style={styles.handleWrap} onClick={onClose} data-testid="bottom-sheet-handle">
          <div style={styles.handle} />
        </div>
        {children}
      </div>
    </div>
  );
}
