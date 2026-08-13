// frontend/src/components/terminalSkin.js
//
// Repaginação estética da tela de terminal (PLAN-terminal-skin.md, T1).
//
// Função PURA que resolve toda a camada estética do TerminalPanel a partir de
// (layout, theme, { narrow }). Por que uma função pura num arquivo separado, e
// não `if (isV2)` espalhado pelo JSX:
//
//  1. **Testabilidade.** O Vitest deste repo roda com `css: false`
//     (vite.config.js não tem `test.css`), então NENHUMA regra de theme.css
//     existe durante os testes e `getComputedStyle` não devolve token nenhum.
//     Tudo que morar aqui — geometria, hex, aritmética de inset — é asseverável
//     sem DOM, sem xterm e sem CSS. Tudo que morar no theme.css só é verificável
//     por QA manual. Essa é a régua para decidir onde cada coisa vai.
//  2. **O v1 está em produção e tem que sair pixel-idêntico.** Com o v1
//     congelado num literal aqui e um `toEqual` contra um literal escrito à mão
//     no teste (deliberadamente NÃO importado deste módulo — importar tornaria a
//     asserção tautológica), qualquer deriva do v1 aparece como teste vermelho
//     em vez de aparecer como screenshot diferente.
//  3. **Zero `if` de layout no JSX.** O componente só lê chaves do skin.
//
// ⚠️ A pureza aqui NÃO é para reatividade. Troca de layout ou de tema é
// full-reload (AppearanceSwitch.jsx faz window.location.reload() depois do PUT),
// e `main.jsx` seta `dataset.layout`/`dataset.theme` ANTES do primeiro render —
// então o chamador resolve isto UMA VEZ no mount (`useMemo(..., [])`) e pronto.
// (Corrige o motivo declarado no ADR-001 do Arquiteto, que supunha reatividade
// em runtime; o contrato continua o mesmo, o racional é outro.)

// Stack de fonte do v1 — literal de hoje (TerminalPanel.jsx:199 em git HEAD),
// congelado. Não deduplicar com as outras 9 ocorrências de string mono do repo:
// a stack do terminal precisa de `ui-monospace`/`Cascadia Mono` que as de UI não
// têm, e as de UI têm coisas que aqui atrapalham (ver C3 do plano).
const V1_FONT_FAMILY = 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace';

// Stack do v2 (DESIGN §3). IBM Plex Mono é auto-hospedada (theme.css) — advance
// de 0,600em idêntico em toda plataforma, o que remove a variável "mesma
// session_key rende cols diferentes no iPad e no Windows" (Consolas é 0,550em).
// `Fira Code` sai de propósito: liga `->`/`!=`/`===`, e ligadura funde N células
// numa forma só — quebra alinhamento de coluna e o cursor block cai no meio de
// um glifo fundido. String literal porque o xterm não aceita `var(--…)` em
// `term.options.fontFamily`.
const V2_FONT_FAMILY = "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace";

const BASE_FONT_SIZE_PX = 14;
// Abaixo de MOBILE_VIEWPORT_QUERY (640px — C6 do plano; NÃO os 600px do
// desenho, senão abre uma faixa de 40px onde o botão flutuante "☰ Menu" existe
// mas a compensação não) o terminal cai para 13px, o que devolve ~6 colunas no
// celular. Decidido no mount e NÃO reativo à rotação — consistente com `layout`
// e `theme`, que também são mount-once. Está comentado aqui de propósito para
// não virar ticket (risco 9 do plano).
const NARROW_FONT_SIZE_PX = 13;

// ---------------------------------------------------------------------------
// Geometria (INV-TERM-GEOM)
// ---------------------------------------------------------------------------

// v2: 4px de padding no root + 1px de borda + 8px de padding do frame = 13px
// até a coluna 0 do texto (hoje o v1 gasta 12px num padding só). Custo real:
// 1px por lado ⇒ 0 colunas perdidas na esmagadora maioria das larguras.
const V2_FRAME_INSET_PX = 4;
const V2_FRAME_BORDER_PX = 1;
const V2_FRAME_PADDING_PX = 8;

// v1: nenhum padding no root, 12px no wrapper, sem borda — exatamente o de hoje.
const V1_FRAME_INSET_PX = 0;
const V1_FRAME_BORDER_PX = 0;
const V1_FRAME_PADDING_PX = 12;

// Raio 10px (DESIGN §2.2/§2.3): um degrau acima dos 8px que o v2 usa em botão/
// linha/pílula — correto, já que a moldura contém todos eles. A condição
// geométrica para o canvas não ser recortado é `padding >= 0,293·R` = 2,93px, e
// temos 8px: o canto do canvas fica a 1,41px do centro da curva, que tem raio 9.
const V2_FRAME_RADIUS_PX = 10;

// INV-TERM-GEOM — o nó do `term.open()`.
//
// IDÊNTICO nos dois layouts, de propósito, e por isso é UM ÚNICO objeto
// congelado compartilhado pelos dois ramos: a invariante fica garantida por
// construção, não por disciplina. Padding/borda/raio moram todos no wrapper,
// nunca aqui.
//
// O `padding: 0` é o núcleo do fix de .planning/debug/terminal-cursor-desalinhado.md:
// FitAddon.proposeDimensions() mede `getComputedStyle(parentElement)` e, com o
// `box-sizing: border-box` global, um pai com padding faz o FitAddon contar
// cols/rows a mais. O `border: 0` é a mesma armadilha um passo adiante — com
// border-box, uma borda aqui seria contada igual ao padding.
const VIEWPORT_STYLE = Object.freeze({
  width: '100%',
  height: '100%',
  padding: 0,
  border: 0,
});

// ---------------------------------------------------------------------------
// Paleta ANSI (DESIGN §4.3 / §4.4 / §4.5)
// ---------------------------------------------------------------------------
//
// Hex literal, não `var(--v2-*)`, e por três motivos concretos:
//
//  1. O xterm não lê `var()`. `getComputedStyle().getPropertyValue()` devolve o
//     TEXTO do token — hoje isso significa entregar strings `oklch()` cruas ao
//     parser do xterm, que só tem regex para `#hex`/`rgb()` e cai num fallback
//     via `canvas.fillStyle` capaz de LANÇAR se o browser não parsear. Funciona
//     hoje em Safari/Chrome modernos, mas é a inicialização do terminal que
//     quebra se um dia falhar.
//  2. Determinismo: sem gamut-mapping do UA, a cor é a mesma em todo browser.
//  3. 32 variáveis CSS que nenhum CSS consome seriam ruído morto no theme.css.
//
// `background` é lido daqui TAMBÉM pelo fundo da moldura (skin.frame.background).
// Uma fonte de verdade só: a calha de 8px do frame e o canvas do xterm são
// visualmente uma superfície contínua, e um comentário cruzado entre CSS e JS
// não é enforcement — isto é (D1 do plano). Há teste asseverando a igualdade.
const V2_ANSI_DARK = Object.freeze({
  background: '#14171e',
  foreground: '#dadee5',
  // `black` é cor de FUNDO (vídeo invertido, blocos), não de texto — 1,5:1
  // contra o fundo é proposital, fica logo acima dele para que moldura preta
  // apareça em vez de sumir.
  black: '#34383f',
  red: '#ed756e',
  green: '#67d283',
  yellow: '#eac25a',
  blue: '#7ba4f0',
  magenta: '#dc89d5',
  cyan: '#65d0dc',
  white: '#dadee5',
  // `brightBlack` é o "dim" que a CLI usa a rodo (dicas, timestamps, molduras
  // ASCII). 4,9:1 passa AA como texto — não é o cinza sumido da maioria dos
  // temas.
  brightBlack: '#82868f',
  brightRed: '#f99e97',
  brightGreen: '#82ec9c',
  brightYellow: '#fadc7d',
  brightBlue: '#a3c2f9',
  brightMagenta: '#f4abec',
  brightCyan: '#8ce9f4',
  brightWhite: '#f7f8fb',
  cursor: '#6fd5b0',
  cursorAccent: '#14171e',
  // Corrige o achado §0.3 do desenho: hoje é `rgba(255,255,255,0.15)` nos DOIS
  // temas — branco a 15% sobre `#fdfcfa` é seleção invisível no tema claro.
  selectionBackground: '#36705c8c',
  selectionInactiveBackground: '#36705c4d',
});

const V2_ANSI_LIGHT = Object.freeze({
  background: '#fdfcfa',
  foreground: '#342c24',
  black: '#251e15',
  red: '#b63132',
  green: '#137738',
  yellow: '#9a6a17',
  blue: '#3664be',
  magenta: '#993f94',
  cyan: '#117780',
  // Decisão explícita do desenho (§4.4, nota 3): no tema claro `white` e
  // `brightWhite` são INVERTIDOS — viram pesos de tinta, não claridades. Num
  // terminal de fundo claro não existe mapeamento certo para "branco": ou
  // `chalk.white("texto")` fica invisível, ou um bloco `bgBlack` fica
  // escuro-sobre-escuro. Escolhida a segunda falha porque é a mais rara (a CLI
  // do Claude não pinta blocos de fundo preto) e porque a primeira faz TEXTO
  // SUMIR. Então 7 = tinta regular, 15 = tinta de ênfase — e com
  // `drawBoldTextInBrightColors` (default true) o negrito fica mais escuro, que
  // é a semântica correta de ênfase em papel.
  white: '#58514a',
  brightBlack: '#857f78',
  brightRed: '#a50d1c',
  brightGreen: '#0d632d',
  brightYellow: '#865901',
  brightBlue: '#2151af',
  brightMagenta: '#892784',
  brightCyan: '#0d646c',
  brightWhite: '#342c24',
  cursor: '#26795f',
  cursorAccent: '#fdfcfa',
  selectionBackground: '#97d3bb99',
  selectionInactiveBackground: '#97d3bb59',
});

// ---------------------------------------------------------------------------
// Faixas de status (DESIGN §5) — consumidas pelo StatusBanner (T4)
// ---------------------------------------------------------------------------

// Casca comum das 4 faixas do v2. Fundo neutro + trilho colorido à esquerda, em
// vez de faixa inteira tingida: faixa tingida (`--v2-danger` sobre
// `--v2-danger-soft`) dá 3,60:1 no escuro, reprova AA. O trilho resolve por
// construção e lê como produto em vez de caixa de alerta de framework.
//
// `top/left/right` em vez do atalho `inset`: o cssstyle do jsdom não implementa
// `inset`, então o atalho seria silenciosamente inerte em teste — e o
// alinhamento da faixa com a coluna 0 do texto é justamente o que se quer
// asseverar. Sem `bottom`: a faixa se ajusta ao próprio conteúdo.
//
// Sem `box-shadow`: lê pelo degrau de superfície contra o canvas.
function makeV2BannerBase(insetPx) {
  return {
    position: 'absolute',
    top: insetPx,
    left: insetPx,
    right: insetPx,
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    background: 'var(--v2-surface-2)',
    border: '1px solid var(--v2-border)',
    borderRadius: 8,
    // NÃO é mono: a faixa é mensagem de produto, não output do PTY. Herda a
    // fonte de UI (Figtree) de propósito — a única coisa em Plex Mono dentro de
    // uma faixa é o `detail` do spawn_failed, que é caminho/comando de shell.
    fontSize: '12.5px',
    lineHeight: 1.45,
    color: 'var(--v2-text)',
  };
}

// ---------------------------------------------------------------------------

/**
 * Resolve toda a camada estética do TerminalPanel.
 *
 * Os dois primeiros argumentos podem vir `undefined`: todo teste que monta o
 * TerminalPanel isolado o faz SEM o bootstrap do main.jsx, então
 * `document.documentElement.dataset.layout`/`.theme` simplesmente não existem
 * ali. `layout` desconhecido ou ausente ⇒ **v1** (o layout de produção, o mais
 * conservador); `theme` ausente ⇒ **dark**.
 *
 * @param {string|undefined} layout  `document.documentElement.dataset.layout`
 * @param {string|undefined} theme   `document.documentElement.dataset.theme`
 * @param {{ narrow?: boolean }} [options] `narrow`: viewport abaixo de
 *   MOBILE_VIEWPORT_QUERY (640px). Só afeta o v2.
 */
export function resolveTerminalSkin(layout, theme, options = {}) {
  const isV2 = layout === 'v2';
  // `theme_mode` é validado no backend (models.py) como estritamente
  // 'dark'|'light' — nunca 'auto'. Qualquer outra coisa aqui é ausência.
  const resolvedTheme = theme === 'light' ? 'light' : 'dark';
  const narrow = options.narrow === true;

  if (!isV2) {
    return Object.freeze({
      layout: 'v1',
      theme: resolvedTheme,
      fontFamily: V1_FONT_FAMILY,
      fontSize: BASE_FONT_SIZE_PX,
      // O v1 não reage a `narrow`: tem que sair pixel-idêntico, ponto.
      xtermOptions: Object.freeze({
        cursorBlink: true,
        fontFamily: V1_FONT_FAMILY,
        fontSize: BASE_FONT_SIZE_PX,
      }),
      // `null` (e não um objeto de tema) faz o chamador cair no ramo
      // `resolveTerminalTheme()` legado BYTE A BYTE. Os tokens v1 são hex
      // literal em index.css, então ali o `getComputedStyle` já devolve algo
      // que o xterm parseia — não há nada a consertar no v1, e mexer seria
      // risco puro.
      xtermTheme: null,
      root: Object.freeze({
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        padding: 0,
      }),
      frameClassName: undefined,
      frame: Object.freeze({
        flex: 1,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        padding: '12px',
        // Token do v1 (#111111 fixo, index.css), preservado de propósito. É
        // exatamente este valor que, herdado pelo v2, desenhava uma auréola
        // quase-preta de 12px em volta de um terminal creme no tema claro — no
        // v1 ele está certo e fica.
        background: 'var(--bg-surface)',
      }),
      viewport: VIEWPORT_STYLE,
      frameInsetPx: V1_FRAME_INSET_PX,
      frameBorderPx: V1_FRAME_BORDER_PX,
      framePaddingPx: V1_FRAME_PADDING_PX,
      // ⚠️ LITERAL CONGELADO, NÃO FÓRMULA. A fórmula daria 0+0+12 = 12, mas as
      // faixas do v1 são `top/left/right: 0` — sangram de ponta a ponta, e é
      // assim que o v1 é hoje. Se alguém "unificar" isto com a fórmula do v2
      // para deixar bonito, quebra o v1. Deixe 0.
      bannerInsetPx: 0,
      // Mesma convenção do `xtermTheme: null`: `null` significa "o chamador usa
      // o caminho legado". As 4 faixas do v1 continuam sendo os 4 blocos
      // inline de hoje, dentro do componente, sem uma vírgula de diferença.
      banner: null,
      bannerButton: null,
    });
  }

  const palette = resolvedTheme === 'light' ? V2_ANSI_LIGHT : V2_ANSI_DARK;
  const fontSize = narrow ? NARROW_FONT_SIZE_PX : BASE_FONT_SIZE_PX;
  const bannerInsetPx = V2_FRAME_INSET_PX + V2_FRAME_BORDER_PX + V2_FRAME_PADDING_PX;
  const bannerBase = makeV2BannerBase(bannerInsetPx);

  return Object.freeze({
    layout: 'v2',
    theme: resolvedTheme,
    fontFamily: V2_FONT_FAMILY,
    fontSize,
    xtermOptions: Object.freeze({
      cursorBlink: true,
      fontFamily: V2_FONT_FAMILY,
      fontSize,
      // Default do xterm é 1.0 — grade colada. É a alavanca isolada que mais
      // faz a TUI respirar, ao custo de ~17% de linhas. ⚠️ Se aparecer
      // artefato de render, ESTE é o único valor a reverter.
      lineHeight: 1.2,
      // Explícito: qualquer coisa ≠ 0 degrada o atlas de textura do WebGL, e o
      // advance de 0,6em da Plex Mono já é confortável a 0.
      letterSpacing: 0,
      fontWeight: 400,
      // Só existem 400/500/600 auto-hospedados. O default do xterm é
      // `bold` (=700) ⇒ o browser SINTETIZA o peso, borrando/alargando o glifo
      // — numa grade monoespaçada isso fica visivelmente sujo.
      fontWeightBold: 600,
      // `⏺` (U+23FA), `✻`, `⎿` (U+23BF) não são box-drawing e vêm de fallback
      // do sistema — podem transbordar a célula. Default do xterm é false.
      rescaleOverlappingGlyphs: true,
      // Deliberadamente AUSENTES, não passe nenhum destes:
      //  - `customGlyphs`: default true, e é o que desenha `╭─╮│╰╯` em canvas
      //    na geometria exata da célula. A IBM Plex Mono NÃO cobre o bloco
      //    U+2500–257F (os .woff2 são o subset `latin` de 9,8 KB), então
      //    passar `false` aqui destruiria a moldura da TUI do claude.
      //  - `minimumContrastRatio`: ligar faria o xterm reescrever as cores da
      //    paleta em runtime, anulando a paleta desenhada.
      //  - `drawBoldTextInBrightColors`: default true, e é o que faz negrito
      //    virar a variante bright — que no tema claro é mais escura/enfática,
      //    exatamente o desejado.
    }),
    xtermTheme: palette,
    root: Object.freeze({
      flex: 1,
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      padding: V2_FRAME_INSET_PX,
    }),
    frameClassName: 'v2-terminal-frame',
    // ⚠️ D2 — FRONTEIRA INLINE × CSS. Repare no que NÃO está aqui: `border` e
    // `borderColor`. A cor da borda mora no theme.css porque tem estado
    // (`:focus-within`), e estilo inline vence classe por especificidade — o
    // atalho `border: '1px solid …'` setaria a cor e faria
    // `.v2-terminal-frame:focus-within { border-color: … }` NUNCA disparar.
    // Isso não apareceria em teste (Vitest com css:false), não apareceria em
    // screenshot estático, só no iPad com teclado externo. Por isso a largura e
    // o estilo da borda vêm em propriedades separadas, e há um teste
    // asseverando a AUSÊNCIA das chaves `border`/`borderColor`.
    frame: Object.freeze({
      flex: 1,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      padding: V2_FRAME_PADDING_PX,
      borderStyle: 'solid',
      borderWidth: V2_FRAME_BORDER_PX,
      borderRadius: V2_FRAME_RADIUS_PX,
      // Mesmíssimo valor do canvas do xterm, lido da mesma constante: a calha
      // de 8px e o canvas têm que ser uma superfície contínua. NÃO pode ser
      // `--v2-surface` (é o fundo do header do ChatV2, encostado logo acima —
      // a moldura sumiria contra o próprio header) e não pode ser
      // `--bg-surface` (token v1, #111111 fixo: a auréola preta do tema claro).
      background: palette.background,
    }),
    viewport: VIEWPORT_STYLE,
    frameInsetPx: V2_FRAME_INSET_PX,
    frameBorderPx: V2_FRAME_BORDER_PX,
    framePaddingPx: V2_FRAME_PADDING_PX,
    // Fórmula, não literal: a faixa é `position:absolute` filha do root, e o
    // bloco contenedor de um absolute é a CAIXA DE PADDING do ancestral — que,
    // num elemento sem borda, começa na borda EXTERNA, antes do padding. Logo o
    // inset tem que somar os três degraus (4+1+8) para a borda esquerda da
    // faixa cair exatamente sobre a coluna 0 do texto. Um inset de 9px (só
    // borda+padding do frame) a poria 4px antes do texto.
    bannerInsetPx,
    banner: Object.freeze({
      // Trilho teal: um blip de rede não é um erro. Hoje o v1 pinta
      // `color:'#ff3333'` — vermelho puro para dizer "estou reconectando".
      accent: Object.freeze({ ...bannerBase, borderLeft: '3px solid var(--v2-accent)' }),
      // Sessão despejada não é erro, é um fato: trilho neutro.
      neutral: Object.freeze({ ...bannerBase, borderLeft: '3px solid var(--v2-text-faint)' }),
      // Pergunta acionável (resume falhou): âmbar, e vira `danger` se o próprio
      // retry falhar.
      warn: Object.freeze({ ...bannerBase, borderLeft: '3px solid var(--v2-warn)' }),
      // Erro de configuração (spawn falhou): o comando do agente não existe.
      danger: Object.freeze({ ...bannerBase, borderLeft: '3px solid var(--v2-danger)' }),
    }),
    // Par accent-soft/accent-strong verificado: 4,7:1 no claro, 5,9:1 no
    // escuro — passa AA nos dois, e é o mesmo par já usado em ChatSidebarV2.
    // `minHeight: 44` incondicional (não só no touch): num alerta raro e
    // importante, 44px lê bem no desktop também, e evita depender de detecção
    // de ponteiro para um alvo de toque.
    bannerButton: Object.freeze({
      background: 'var(--v2-accent-soft)',
      color: 'var(--v2-accent-strong)',
      border: '1px solid var(--v2-border)',
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
      minHeight: 44,
      padding: '0 14px',
      cursor: 'pointer',
      flexShrink: 0,
    }),
  });
}
