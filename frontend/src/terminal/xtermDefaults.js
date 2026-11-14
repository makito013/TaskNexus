// Fixed xterm.js constructor options and the ANSI palette mapping shared by every
// terminal surface. Copied literally from the V2 TerminalPanel; the theme is
// merged on top by useTerminalSurface.
export const TERMINAL_BASE_OPTIONS = {
  cursorBlink: true,
  fontFamily: 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
  fontSize: 14,
};

// Upper bound for the wait on document.fonts.ready before connecting (see the
// comment in useTerminalSurface where it is consumed).
export const FONTS_READY_TIMEOUT_MS = 500;

// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 18): tema do xterm.js
// derivado dos tokens `--v2-*` (theme.css) — resolvido UMA VEZ no mount, nunca
// reativo em runtime, porque a troca de tema já é full-reload (decisão fechada
// do TL em AppearanceSwitch.jsx: window.location.reload() após o PUT resolver)
// — não existe um cenário em que o tema mude sob um TerminalPanel já montado.
// O boot já aplicou os tokens ANTES do primeiro render, então lê-los de forma
// síncrona aqui no mount é seguro, sem race. Sem o bootstrap (testes que
// montam o TerminalPanel isolado) os tokens vêm vazios e valem os fallbacks.
// `read(token, fallback)` returns the resolved CSS custom property or the
// fallback; the V2 reads `--v2-*` tokens from the document root.
export function ansiPaletteFrom(read) {
  // Cores ANSI básicas mapeadas a partir da paleta --v2-* (Designer não
  // extraiu uma paleta ANSI de 16 cores dedicada do mockup — este mapeamento
  // é uma escolha pragmática do Dev: preto/branco a partir de bg/text,
  // vermelho a partir de --v2-danger, verde/ciano a partir de --v2-accent
  // (a cor de destaque "viva" do tema), azul/magenta a partir de --v2-accent-2,
  // amarelo sem token v2 dedicado, cai no --v2-accent-strong).
  const bg = read('--v2-bg', '#111111');
  const fg = read('--v2-text', '#e0e0e0');
  const accent = read('--v2-accent', '#4ade80');
  const accentStrong = read('--v2-accent-strong', accent);
  const accent2 = read('--v2-accent-2', '#60a5fa');
  const danger = read('--v2-danger', '#ff3333');
  const surface2 = read('--v2-surface-2', bg);
  const textFaint = read('--v2-text-faint', fg);

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    black: surface2,
    red: danger,
    green: accent,
    yellow: accentStrong,
    blue: accent2,
    magenta: accent2,
    cyan: accent,
    white: fg,
    brightBlack: textFaint,
    brightRed: danger,
    brightGreen: accent,
    brightYellow: accentStrong,
    brightBlue: accent2,
    brightMagenta: accent2,
    brightCyan: accent,
    brightWhite: fg,
  };
}
