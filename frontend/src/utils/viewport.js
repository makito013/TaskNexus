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
