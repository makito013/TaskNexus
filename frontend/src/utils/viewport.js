// frontend/src/utils/viewport.js
// Shared narrow-viewport breakpoint. Extracted from App.jsx so components
// that need it (e.g. TasksDrawer.jsx) can import it without creating a
// circular App.jsx <-> component import.
export const NARROW_VIEWPORT_QUERY = '(max-width: 820px)';

// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 3): breakpoint
// deliberadamente mais estreito que NARROW_VIEWPORT_QUERY (820px) — 640px
// nunca ativa em nenhum modo de iPad (nem Split View/Slide Over estreito),
// só em celular de verdade (confirmado pelo Bruno). Não reutiliza/altera a
// query de 820px acima, que continua servindo outros usos (TasksDrawer,
// default de colapso da sidebar).
export const MOBILE_VIEWPORT_QUERY = '(max-width: 640px)';

// Fase N (docs/melhorias-tablet/08-planejamento-navegacao-cliente-projeto.md,
// seção 8.2.4): a partir desta largura (iPad deitado, 1180px, e desktop) o
// visualizador de arquivos da Fase V abre ENCAIXADO à direita e a sidebar e a
// lista de chats recolhem sozinhas para trilhos de 68px enquanto ele estiver
// aberto. Abaixo dela (iPad em pé, Split View) o painel abre por cima e nada
// recolhe. 1100px e não 1024px: com 68+68px de trilhos, 1100 ainda deixa ~540px
// para o terminal ao lado de um painel de 420px (a largura mínima dele); abaixo
// disso o terminal ficaria estreito demais para ler.
export const WIDE_VIEWPORT_QUERY = '(min-width: 1100px)';
