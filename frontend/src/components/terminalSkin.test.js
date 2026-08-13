// frontend/src/components/terminalSkin.test.js
//
// Suíte da função pura que resolve a camada estética do TerminalPanel
// (PLAN-terminal-skin.md, §3 "Unitário"). Roda sem DOM, sem CSS e sem xterm —
// que é exatamente o ponto: o Vitest deste repo roda com `css: false`, então
// tudo que morar no theme.css é invisível aqui e só o QA manual pega. O que dá
// para asseverar é o que está neste módulo, e é isso que esta suíte cobre.
//
// ⚠️ O literal de não-regressão do v1 abaixo é ESCRITO À MÃO, copiado do
// TerminalPanel.jsx em git HEAD antes desta entrega. Ele NÃO é importado do
// terminalSkin.js de propósito: importar tornaria a asserção tautológica
// (compararia o módulo consigo mesmo e passaria mesmo com o v1 quebrado). O v1
// é o layout que está em produção e tem que sair pixel-idêntico.

import { describe, it, expect } from 'vitest';
import { resolveTerminalSkin } from './terminalSkin.js';

// Copiado à mão de TerminalPanel.jsx em git HEAD:
//   - linha 644  -> root
//   - linha 759  -> frame (wrapperRef)
//   - linha 760  -> viewport (containerRef), + `border: 0` explícito, que é
//                   no-op visual (o nó nunca teve borda) e fecha a mesma
//                   armadilha de border-box que o `padding: 0` já fechava
//   - linhas 199-201 -> xtermOptions
const V1_FROZEN = {
  layout: 'v1',
  theme: 'dark',
  fontFamily: 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
  fontSize: 14,
  xtermOptions: {
    cursorBlink: true,
    fontFamily: 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
    fontSize: 14,
  },
  xtermTheme: null,
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    padding: 0,
  },
  frameClassName: undefined,
  frame: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    padding: '12px',
    background: 'var(--bg-surface)',
  },
  viewport: {
    width: '100%',
    height: '100%',
    padding: 0,
    border: 0,
  },
  frameInsetPx: 0,
  frameBorderPx: 0,
  framePaddingPx: 12,
  bannerInsetPx: 0,
  banner: null,
  bannerButton: null,
};

const ANSI_16 = [
  'black', 'red', 'green', 'yellow', 'magenta', 'cyan', 'blue', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightMagenta', 'brightCyan', 'brightBlue', 'brightWhite',
];

describe('resolveTerminalSkin — v1 non-regression (frozen literal)', () => {
  it('returns the frozen v1 skin when layout is undefined', () => {
    expect(resolveTerminalSkin(undefined, undefined)).toEqual(V1_FROZEN);
  });

  it('returns the frozen v1 skin for an explicit v1 layout', () => {
    expect(resolveTerminalSkin('v1', undefined)).toEqual(V1_FROZEN);
  });

  // Layout desconhecido cai no v1, o ramo conservador — nunca no v2.
  it('falls back to the frozen v1 skin for an unknown layout', () => {
    expect(resolveTerminalSkin('qualquer-coisa', undefined)).toEqual(V1_FROZEN);
  });

  it('ignores the narrow viewport under v1', () => {
    expect(resolveTerminalSkin('v1', undefined, { narrow: true })).toEqual(V1_FROZEN);
  });

  // O v1 não conhece `data-theme`: os tokens dele vêm do index.css, que não tem
  // bloco por tema. Só o campo `theme` (informativo) acompanha.
  it('keeps every v1 style identical under the light theme', () => {
    const light = resolveTerminalSkin('v1', 'light');
    expect(light).toEqual({ ...V1_FROZEN, theme: 'light' });
  });

  it('leaves xtermTheme null under v1 so the caller keeps the legacy getComputedStyle path', () => {
    expect(resolveTerminalSkin('v1').xtermTheme).toBeNull();
    expect(resolveTerminalSkin('v1', 'light').xtermTheme).toBeNull();
  });

  it('exposes no frame class name under v1', () => {
    expect(resolveTerminalSkin('v1').frameClassName).toBeUndefined();
  });
});

describe('resolveTerminalSkin — INV-TERM-GEOM (term.open() target)', () => {
  // O nó do term.open() é o único lugar onde padding/borda seriam contados
  // duas vezes pelo FitAddon (box-sizing: border-box global) e desalinhariam
  // cols/rows do PTY. Tem que ser idêntico nos dois layouts, para sempre.
  const EXPECTED_VIEWPORT = {
    width: '100%',
    height: '100%',
    padding: 0,
    border: 0,
  };

  it('is identical under v1', () => {
    expect(resolveTerminalSkin('v1').viewport).toEqual(EXPECTED_VIEWPORT);
  });

  it('is identical under v2', () => {
    expect(resolveTerminalSkin('v2').viewport).toEqual(EXPECTED_VIEWPORT);
  });

  it('is byte-for-byte the same object across layouts and themes', () => {
    const v1 = resolveTerminalSkin('v1').viewport;
    const v2Dark = resolveTerminalSkin('v2', 'dark').viewport;
    const v2Light = resolveTerminalSkin('v2', 'light', { narrow: true }).viewport;
    expect(v2Dark).toBe(v1);
    expect(v2Light).toBe(v1);
  });

  it('is frozen, so no caller can mutate the invariant in place', () => {
    expect(Object.isFrozen(resolveTerminalSkin('v1').viewport)).toBe(true);
    expect(Object.isFrozen(resolveTerminalSkin('v2').viewport)).toBe(true);
  });
});

describe('resolveTerminalSkin — inline/CSS boundary (D2)', () => {
  // A armadilha: estilo inline vence classe por especificidade. Um
  // `border: '1px solid var(--v2-border)'` inline setaria também a COR e faria
  // `.v2-terminal-frame:focus-within { border-color: var(--v2-accent) }` nunca
  // disparar. Não aparece em teste de CSS (css:false), não aparece em
  // screenshot estático — só no iPad com teclado externo. Testar a AUSÊNCIA da
  // chave é a única asserção possível daqui.
  it('never sets the border shorthand on the v2 frame', () => {
    expect(Object.keys(resolveTerminalSkin('v2').frame)).not.toContain('border');
  });

  it('never sets borderColor on the v2 frame', () => {
    expect(Object.keys(resolveTerminalSkin('v2').frame)).not.toContain('borderColor');
  });

  it('still sets the border geometry inline (width and style), which has no pseudo-state', () => {
    const { frame } = resolveTerminalSkin('v2');
    expect(frame.borderStyle).toBe('solid');
    expect(frame.borderWidth).toBe(1);
    expect(frame.borderRadius).toBe(10);
  });

  it('never sets a border on the v1 frame either', () => {
    const keys = Object.keys(resolveTerminalSkin('v1').frame);
    expect(keys).not.toContain('border');
    expect(keys).not.toContain('borderColor');
  });
});

describe('resolveTerminalSkin — frame background is the xterm background', () => {
  // A calha de 8px do frame e o canvas do xterm são visualmente UMA superfície
  // contínua. O desenho pediu isso como "comentário cruzado" entre CSS e JS;
  // comentário não é enforcement, então a única fonte de verdade é a paleta e
  // esta é a asserção que garante que continua assim.
  it('matches in the dark theme', () => {
    const skin = resolveTerminalSkin('v2', 'dark');
    expect(skin.frame.background).toBe(skin.xtermTheme.background);
    expect(skin.frame.background).toBe('#14171e');
  });

  it('matches in the light theme', () => {
    const skin = resolveTerminalSkin('v2', 'light');
    expect(skin.frame.background).toBe(skin.xtermTheme.background);
    expect(skin.frame.background).toBe('#fdfcfa');
  });

  // O bug que esta entrega corrige por consequência: o wrapper pintava
  // `var(--bg-surface)` (token v1, #111111 fixo) mesmo sob o v2 — uma auréola
  // quase-preta de 12px em volta de um terminal creme no tema claro.
  it('never leaks the v1 --bg-surface token into the v2 frame', () => {
    expect(resolveTerminalSkin('v2', 'light').frame.background).not.toContain('--bg-surface');
    expect(resolveTerminalSkin('v2', 'dark').frame.background).not.toContain('--bg-surface');
  });
});

describe('resolveTerminalSkin — banner inset arithmetic', () => {
  it('derives the v2 inset from root padding + border + frame padding', () => {
    const skin = resolveTerminalSkin('v2');
    expect(skin.bannerInsetPx).toBe(skin.frameInsetPx + skin.frameBorderPx + skin.framePaddingPx);
    expect(skin.bannerInsetPx).toBe(13);
  });

  // 13, não 9. As faixas são `position:absolute` filhas do root, e o bloco
  // contenedor de um absolute é a caixa de PADDING do ancestral — que, num
  // elemento sem borda, começa na borda externa, ANTES do padding. Um inset de
  // 9px (borda + padding do frame apenas) poria a faixa 4px antes da coluna 0
  // do texto.
  it('is not the naive border + frame padding sum', () => {
    expect(resolveTerminalSkin('v2').bannerInsetPx).not.toBe(9);
  });

  // ⚠️ LITERAL, NÃO FÓRMULA. A fórmula daria 0+0+12 = 12, mas as faixas do v1
  // são top/left/right: 0 e sangram de ponta a ponta. Se este teste ficar
  // vermelho porque alguém "unificou" o cálculo, o v1 quebrou.
  it('is a frozen literal 0 under v1, not the formula', () => {
    const skin = resolveTerminalSkin('v1');
    expect(skin.bannerInsetPx).toBe(0);
    expect(skin.bannerInsetPx).not.toBe(skin.frameInsetPx + skin.frameBorderPx + skin.framePaddingPx);
  });

  it('does not change with the narrow viewport (the inset costs 1px per side either way)', () => {
    expect(resolveTerminalSkin('v2', 'dark', { narrow: true }).bannerInsetPx).toBe(13);
  });
});

describe('resolveTerminalSkin — column budget', () => {
  // Teste-orçamento. Não prova nada de bonito: existe para que quem quiser um
  // padding maior tenha que editar uma linha que diz por que não deveria. A
  // célula tem ~8,4px a 14px/IBM Plex Mono, então 13px por lado custa 0 coluna
  // na esmagadora maioria das larguras; passar disso começa a custar colunas
  // de verdade no iPad em retrato.
  const MAX_INSET_TO_TEXT_PX = 13;

  it('keeps the v2 distance to column 0 within budget', () => {
    const skin = resolveTerminalSkin('v2');
    expect(skin.frameInsetPx + skin.frameBorderPx + skin.framePaddingPx)
      .toBeLessThanOrEqual(MAX_INSET_TO_TEXT_PX);
  });

  it('keeps the v1 distance to column 0 within budget', () => {
    const skin = resolveTerminalSkin('v1');
    expect(skin.frameInsetPx + 1 + skin.framePaddingPx)
      .toBeLessThanOrEqual(MAX_INSET_TO_TEXT_PX);
  });
});

describe('resolveTerminalSkin — ANSI palette', () => {
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const HEX8 = /^#[0-9a-f]{8}$/i;

  it('defaults to the dark palette when the theme is undefined', () => {
    expect(resolveTerminalSkin('v2', undefined).theme).toBe('dark');
    expect(resolveTerminalSkin('v2', undefined).xtermTheme.background).toBe('#14171e');
  });

  it('defaults to the dark palette for an unknown theme value', () => {
    expect(resolveTerminalSkin('v2', 'auto').xtermTheme.background).toBe('#14171e');
  });

  it('uses the light palette only for an explicit light theme', () => {
    expect(resolveTerminalSkin('v2', 'light').xtermTheme.background).toBe('#fdfcfa');
  });

  for (const theme of ['dark', 'light']) {
    // Nenhuma cor pode ser `oklch()`: o parser do xterm (common/Color.ts) só
    // tem regex para #hex/rgb() e o resto cai num fallback via canvas.fillStyle
    // que pode LANÇAR — e quem lança é a inicialização do terminal.
    it(`emits only 6-digit hex for the 16 ANSI colors in the ${theme} theme`, () => {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      for (const name of ANSI_16) {
        expect(xtermTheme[name], name).toMatch(HEX6);
      }
    });

    it(`emits only 6-digit hex for background, foreground and cursor in the ${theme} theme`, () => {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      expect(xtermTheme.background).toMatch(HEX6);
      expect(xtermTheme.foreground).toMatch(HEX6);
      expect(xtermTheme.cursor).toMatch(HEX6);
      expect(xtermTheme.cursorAccent).toMatch(HEX6);
    });

    // Seleção é o único lugar com alpha — 8 dígitos, ainda hex, ainda
    // parseável pelo xterm sem cair no fallback de canvas.
    it(`emits 8-digit hex with alpha for the selection colors in the ${theme} theme`, () => {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      expect(xtermTheme.selectionBackground).toMatch(HEX8);
      expect(xtermTheme.selectionInactiveBackground).toMatch(HEX8);
    });

    it(`defines all 16 ANSI slots in the ${theme} theme`, () => {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      expect(ANSI_16.filter((name) => xtermTheme[name] !== undefined)).toHaveLength(16);
    });

    it(`makes the cursor accent match the background in the ${theme} theme`, () => {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      expect(xtermTheme.cursorAccent).toBe(xtermTheme.background);
    });
  }

  // Achado §0.3 do desenho: hoje é `rgba(255,255,255,0.15)` nos dois temas —
  // branco a 15% sobre #fdfcfa é seleção invisível no tema claro.
  it('no longer uses the white-on-white selection of the legacy theme', () => {
    for (const theme of ['dark', 'light']) {
      const { xtermTheme } = resolveTerminalSkin('v2', theme);
      expect(xtermTheme.selectionBackground).not.toBe('rgba(255, 255, 255, 0.15)');
    }
  });

  it('gives the two themes different palettes', () => {
    const dark = resolveTerminalSkin('v2', 'dark').xtermTheme;
    const light = resolveTerminalSkin('v2', 'light').xtermTheme;
    for (const name of ANSI_16) {
      expect(dark[name], name).not.toBe(light[name]);
    }
  });
});

describe('resolveTerminalSkin — typography', () => {
  it('uses the self-hosted IBM Plex Mono stack under v2', () => {
    const skin = resolveTerminalSkin('v2');
    expect(skin.fontFamily).toContain('IBM Plex Mono');
    expect(skin.xtermOptions.fontFamily).toBe(skin.fontFamily);
  });

  // Ligadura funde N células numa forma só — quebra alinhamento de coluna em
  // diff/tabela e o cursor block cai no meio de um glifo fundido. Remover Fira
  // Code é correção, não preferência.
  it('drops Fira Code from the v2 stack (ligatures break the cell grid)', () => {
    expect(resolveTerminalSkin('v2').fontFamily).not.toContain('Fira Code');
  });

  it('keeps the legacy stack under v1', () => {
    expect(resolveTerminalSkin('v1').fontFamily).toBe(
      'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace'
    );
  });

  it('uses 14px by default and 13px on a narrow viewport', () => {
    expect(resolveTerminalSkin('v2', 'dark', { narrow: false }).fontSize).toBe(14);
    expect(resolveTerminalSkin('v2', 'dark', { narrow: true }).fontSize).toBe(13);
    expect(resolveTerminalSkin('v2', 'dark').fontSize).toBe(14);
  });

  it('propagates the resolved font size into the xterm options', () => {
    expect(resolveTerminalSkin('v2', 'dark', { narrow: true }).xtermOptions.fontSize).toBe(13);
  });

  it('omits the xterm options that must keep their defaults', () => {
    const keys = Object.keys(resolveTerminalSkin('v2').xtermOptions);
    // customGlyphs (default true) é o que desenha ╭─╮ em canvas — a Plex Mono
    // não cobre U+2500–257F. minimumContrastRatio reescreveria a paleta em
    // runtime. drawBoldTextInBrightColors (default true) é o que faz negrito
    // virar a variante bright, mais escura no tema claro.
    expect(keys).not.toContain('customGlyphs');
    expect(keys).not.toContain('minimumContrastRatio');
    expect(keys).not.toContain('drawBoldTextInBrightColors');
  });

  it('sets the v2 render options the design asked for', () => {
    const { xtermOptions } = resolveTerminalSkin('v2');
    expect(xtermOptions.lineHeight).toBe(1.2);
    expect(xtermOptions.letterSpacing).toBe(0);
    expect(xtermOptions.fontWeight).toBe(400);
    expect(xtermOptions.fontWeightBold).toBe(600);
    expect(xtermOptions.rescaleOverlappingGlyphs).toBe(true);
  });
});

describe('resolveTerminalSkin — status banner styles', () => {
  it('exposes no banner styles under v1 (the caller keeps its four legacy blocks)', () => {
    expect(resolveTerminalSkin('v1').banner).toBeNull();
    expect(resolveTerminalSkin('v1').bannerButton).toBeNull();
  });

  it('positions every v2 variant on the text column, not on the frame edge', () => {
    const { banner, bannerInsetPx } = resolveTerminalSkin('v2');
    for (const variant of Object.values(banner)) {
      expect(variant.position).toBe('absolute');
      expect(variant.top).toBe(bannerInsetPx);
      expect(variant.left).toBe(bannerInsetPx);
      expect(variant.right).toBe(bannerInsetPx);
      // Sem `bottom`: a faixa se ajusta ao próprio conteúdo em vez de esticar
      // até o fim do terminal.
      expect(variant.bottom).toBeUndefined();
    }
  });

  // O cssstyle do jsdom não implementa o atalho `inset` — usá-lo tornaria a
  // posição da faixa silenciosamente inerte no teste, que é justamente onde o
  // alinhamento com a coluna 0 precisa ser provado.
  it('uses explicit top/left/right instead of the inset shorthand', () => {
    const keys = Object.keys(resolveTerminalSkin('v2').banner.accent);
    expect(keys).not.toContain('inset');
  });

  it('gives each variant its own semantic rail over a neutral surface', () => {
    const { banner } = resolveTerminalSkin('v2');
    expect(banner.accent.borderLeft).toContain('--v2-accent');
    expect(banner.neutral.borderLeft).toContain('--v2-text-faint');
    expect(banner.warn.borderLeft).toContain('--v2-warn');
    expect(banner.danger.borderLeft).toContain('--v2-danger');
    // Faixa inteira tingida (--v2-danger sobre --v2-danger-soft) dá 3,60:1 no
    // escuro e reprova AA; fundo neutro + trilho resolve por construção.
    for (const variant of Object.values(banner)) {
      expect(variant.background).toBe('var(--v2-surface-2)');
    }
  });

  // A faixa é mensagem de produto, não output do PTY — herda a fonte de UI.
  it('never forces a monospace family on the banner shell', () => {
    const keys = Object.keys(resolveTerminalSkin('v2').banner.accent);
    expect(keys).not.toContain('fontFamily');
  });

  it('gives the banner button a 44px touch target unconditionally', () => {
    expect(resolveTerminalSkin('v2').bannerButton.minHeight).toBe(44);
    expect(resolveTerminalSkin('v2', 'light', { narrow: false }).bannerButton.minHeight).toBe(44);
  });
});

describe('resolveTerminalSkin — purity and immutability', () => {
  it('returns a frozen skin', () => {
    expect(Object.isFrozen(resolveTerminalSkin('v2'))).toBe(true);
    expect(Object.isFrozen(resolveTerminalSkin('v1'))).toBe(true);
  });

  it('freezes every style object it hands out', () => {
    const skin = resolveTerminalSkin('v2');
    expect(Object.isFrozen(skin.root)).toBe(true);
    expect(Object.isFrozen(skin.frame)).toBe(true);
    expect(Object.isFrozen(skin.xtermTheme)).toBe(true);
    expect(Object.isFrozen(skin.xtermOptions)).toBe(true);
    expect(Object.isFrozen(skin.bannerButton)).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    expect(resolveTerminalSkin('v2', 'light', { narrow: true }))
      .toEqual(resolveTerminalSkin('v2', 'light', { narrow: true }));
  });

  it('tolerates a missing options object', () => {
    expect(() => resolveTerminalSkin('v2', 'dark')).not.toThrow();
    expect(resolveTerminalSkin('v2', 'dark').fontSize).toBe(14);
  });
});
