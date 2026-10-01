// frontend/src/features/viewer/escape.js
// Fase V-2: regra única do Esc nos contêineres do visualizador.
//
// O Esc é tecla de trabalho no terminal (cancela no `claude`, sai do modo de
// inserção no vim). Um Esc digitado com o foco no xterm é do AGENTE e nunca
// pode fechar o painel — inclusive quando o painel abriu sozinho porque o
// agente mandou abrir um arquivo enquanto o usuário digitava.
export function isTerminalKeyEvent(event) {
  const target = event?.target;
  return !!(target && typeof target.closest === 'function'
    && target.closest('.xterm, [data-terminal-viewport]'));
}

export function isPlainEscape(event) {
  return event?.key === 'Escape' && !event.defaultPrevented && !isTerminalKeyEvent(event);
}
