// frontend/src/layouts/v2/collapseLayout.js
// Plano Layout v2 (etapa 7, RF01/RF02): fonte única de verdade para as
// larguras/transição do padrão de sidebar recolhível (240px<->68px,
// 0.18s ease) que SidebarV2.jsx já usava com valores soltos e que
// ChatSidebarV2.jsx passa a adotar agora. Centralizado aqui para que as duas
// sidebars nunca divirjam de duração de transição — TerminalPanel.jsx (linha
// ~517) agenda seu refit do xterm.js 250ms depois do evento
// `escritorio:sidebar-toggled`, uma margem hardcoded que assume 180ms como a
// MAIOR transição de largura conhecida no app. Uma sidebar reimplementando
// isso com uma duração maior invalidaria essa margem silenciosamente.
export const EXPANDED_WIDTH = '240px';
export const COLLAPSED_WIDTH = '68px';
export const SIDEBAR_TRANSITION = 'width 0.18s ease, min-width 0.18s ease';
