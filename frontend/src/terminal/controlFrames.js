// Bug 2 fix: recognized WS text-frame types sent by the backend as control
// frames (as opposed to PTY output, which always travels as bytes/Blob — see
// send_bytes in backend/app/main.py). Today the backend only ever calls
// websocket.send_text() for these; any other string is treated as raw
// terminal output for backward compatibility (see isControlFrame below).
// 'spawn_failed' (.planning/debug/claude-work-ws-reconnect-loop.md): sent
// when the agent's configured `cmd` can't be spawned at all (e.g. a shell
// alias/function that isn't a real executable on PATH) — same "keep the
// socket open, don't let onclose reconnect into the same failure forever"
// shape as resume_failed.
// 'viewer_open' (Fase V, docs/melhorias-tablet/06-planejamento-fase-v.md,
// 6.4.4/6.10.3): o agente chamou a tool abrir_no_visualizador e o backend avisa
// a tela pelo MESMO socket do terminal — `{type, item, reused, evicted}`. Vai
// para o ViewerContext; nunca para o xterm.
export const CONTROL_FRAME_TYPES = new Set(['resume_failed', 'spawn_failed', 'viewer_open']);

/** Pure/testable: returns the parsed control frame if `data` is a JSON string
 * whose `type` is in the allowlist above, otherwise null. `null` means "not a
 * recognized control frame" — the caller should fall back to writing `data`
 * to the terminal unchanged, preserving today's behavior for any string that
 * isn't backend-control JSON. */
export function isControlFrame(data) {
  if (typeof data !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && CONTROL_FRAME_TYPES.has(parsed.type)) {
    return parsed;
  }
  return null;
}
