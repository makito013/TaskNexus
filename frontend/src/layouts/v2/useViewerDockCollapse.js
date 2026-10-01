// frontend/src/layouts/v2/useViewerDockCollapse.js
// Fase N (docs/melhorias-tablet/08-planejamento-navegacao-cliente-projeto.md,
// seções 8.2.4 e 8.3.3): recolhimento AUTOMÁTICO da sidebar e da lista de
// chats enquanto o visualizador de arquivos (Fase V) estiver encaixado à
// direita. Nesta fase o visualizador ainda não existe — o AppV2 passa
// `viewerOpen: false` sempre —, mas a regra fica pronta e testada, e a Fase V
// só precisa ligar esse valor.
//
// A regra (escolhida pela usabilidade, 8.2.4):
//  1. Tela larga (WIDE_VIEWPORT_QUERY, ≥ 1100px) + painel aberto = "encaixado":
//     as duas colunas viram trilhos de 68px. Quem abre um arquivo quer ler, e
//     os trilhos mantêm a navegação a um toque.
//  2. O controle do usuário vale mais: com o painel encaixado, os botões de
//     recolher continuam funcionando e o que ele expandir fica expandido
//     enquanto o painel estiver aberto (um "override" por coluna).
//  3. Ao fechar o painel (ou deixar de estar encaixado), tudo volta a ser a
//     PREFERÊNCIA SALVA — que este hook NUNCA altera. É por isso que ele não
//     chama os `toggle` do useSidebarCollapsed enquanto o painel está
//     encaixado: aquele hook grava em localStorage a cada mudança, e o
//     recolhimento automático gravaria "recolhida" como se fosse escolha do
//     usuário.
//  4. Tela média/celular: nada recolhe (o painel abre por cima/tela cheia).
//  5. Girar o iPad com o painel aberto: ao sair do encaixe as colunas voltam;
//     ao voltar para paisagem recolhem de novo (o override é zerado a cada
//     troca de encaixe, então a rotação não "lembra" uma expansão antiga).
//
// Refit do terminal: a largura do xterm muda quando o encaixe muda (as colunas
// recolhem E o painel entra), então este hook dispara o mesmo
// `escritorio:sidebar-toggled` que o useSidebarCollapsed dispara num clique —
// o TerminalPanel espera 250ms e chama fitAddon.fit(), margem que cobre a
// transição de 180ms de collapseLayout.js. Os toggles com o painel encaixado
// disparam o evento também, pelo mesmo motivo.

import { useCallback, useEffect, useRef, useState } from 'react';

const NO_OVERRIDE = Object.freeze({ sidebar: false, chat: false });

function notifyLayoutChanged() {
  window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
}

/**
 * @param {object} args
 * @param {boolean} args.viewerOpen            visualizador aberto (Fase V liga)
 * @param {boolean} args.isWide                useMediaQuery(WIDE_VIEWPORT_QUERY)
 * @param {boolean} args.sidebarCollapsed      preferência salva da SidebarV2
 * @param {() => void} args.toggleSidebar      toggle da preferência (grava)
 * @param {boolean} args.chatSidebarCollapsed  preferência salva da ChatSidebarV2
 * @param {() => void} args.toggleChatSidebar  toggle da preferência (grava)
 * @returns {{ viewerDocked: boolean, sidebarCollapsed: boolean,
 *   onToggleSidebar: () => void, chatSidebarCollapsed: boolean,
 *   onToggleChatSidebar: () => void }} valores EFETIVOS para as colunas
 */
export function useViewerDockCollapse({
  viewerOpen,
  isWide,
  sidebarCollapsed,
  toggleSidebar,
  chatSidebarCollapsed,
  toggleChatSidebar,
}) {
  const viewerDocked = !!viewerOpen && !!isWide;

  // "Expandi à mão com o painel aberto", por coluna. Zerado a cada troca de
  // encaixe — no próprio render da troca (ajuste de estado durante o render),
  // para o primeiro quadro encaixado já sair com as duas colunas recolhidas.
  const [override, setOverride] = useState(NO_OVERRIDE);
  const [dockedSeen, setDockedSeen] = useState(viewerDocked);
  let currentOverride = override;
  if (dockedSeen !== viewerDocked) {
    setDockedSeen(viewerDocked);
    setOverride(NO_OVERRIDE);
    currentOverride = NO_OVERRIDE;
  }

  const sidebarEffective = viewerDocked ? !currentOverride.sidebar : sidebarCollapsed;
  const chatSidebarEffective = viewerDocked ? !currentOverride.chat : chatSidebarCollapsed;

  // Botões de recolher: com o painel encaixado mexem só no override (nunca na
  // preferência salva); sem painel, na preferência, exatamente como antes.
  const onToggleSidebar = useCallback(() => {
    if (!viewerDocked) {
      toggleSidebar();
      return;
    }
    setOverride((o) => ({ ...o, sidebar: !o.sidebar }));
    notifyLayoutChanged();
  }, [viewerDocked, toggleSidebar]);

  const onToggleChatSidebar = useCallback(() => {
    if (!viewerDocked) {
      toggleChatSidebar();
      return;
    }
    setOverride((o) => ({ ...o, chat: !o.chat }));
    notifyLayoutChanged();
  }, [viewerDocked, toggleChatSidebar]);

  // Entrar e sair do encaixe muda a largura do terminal mesmo quando as duas
  // colunas já estavam recolhidas (o painel ocupa a direita). Nada no mount:
  // abrir a página não é uma mudança de layout. Compara com o valor anterior
  // em vez de "pular o primeiro efeito": o StrictMode roda os efeitos duas
  // vezes em dev, e um flag de "já montei" dispararia o evento à toa.
  const lastDockedRef = useRef(viewerDocked);
  useEffect(() => {
    if (lastDockedRef.current === viewerDocked) return;
    lastDockedRef.current = viewerDocked;
    notifyLayoutChanged();
  }, [viewerDocked]);

  return {
    viewerDocked,
    sidebarCollapsed: sidebarEffective,
    onToggleSidebar,
    chatSidebarCollapsed: chatSidebarEffective,
    onToggleChatSidebar,
  };
}
