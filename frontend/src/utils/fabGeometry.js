// frontend/src/utils/fabGeometry.js
//
// Toda a matemática de posicionamento do FAB de atalhos do terminal
// (layouts/v2/TerminalShortcutsFab.jsx). Funções PURAS: zero React, zero
// escrita no DOM. Só duas funções leem o DOM/`window` (`getVisibleViewport` e
// `readSafeAreaInsets`), e ambas só leem.
//
// Por que este módulo existe separado do componente: o núcleo de risco desta
// feature é aritmético (clamp, snap, px<->%, quadrante, colocação do painel).
// Como função pura ele é verificável em testes determinísticos de
// milissegundos, sem DOM, sem visualViewport, sem timers. Enterrada dentro do
// componente, a mesma fórmula só seria alcançável através de eventos de
// ponteiro — o caminho mais frágil e mais lento possível para conferir uma
// conta. Precedente no repo: utils/viewport.js, utils/sessionLabels.js.
//
// ATENÇÃO ao ambiente de teste (jsdom 29.1.1, verificado empiricamente):
// `window.visualViewport` não existe, `env()` não é resolvido e
// `getBoundingClientRect()`/`offsetWidth` devolvem SEMPRE 0. Todos os
// fallbacks abaixo existem por causa disso — não são defensividade cosmética,
// são o que permite a suíte rodar. Remover qualquer um deles derruba testes.

// Espelha `--touch-target` (frontend/src/index.css:45). A duplicação é
// inevitável: a geometria precisa do número em JS, e `var()` não é legível
// por JS sem a ponte de getComputedStyle. Os botões e as colunas da grade
// continuam usando `var(--touch-target, 44px)`, então grade e botões nunca
// divergem entre si; aqui o número entra só no cálculo de bounds.
export const FAB_SIZE_PX = 44;

// Mesmo respiro do botão flutuante `☰ Menu` (layouts/v2/AppV2.jsx:334-337).
export const EDGE_MARGIN_PX = 12;

// ~metade dos 44px do alvo: a zona de snap nunca excede a própria pegada do
// botão, então o FAB nunca "salta de longe" para um canto.
export const SNAP_THRESHOLD_PX = 24;

// Folga entre o FAB e o painel que ele abre.
export const PANEL_GAP_PX = 8;

export const PANEL_COLUMNS = 4;
export const PANEL_ROWS = 2;
export const PANEL_CELL_GAP_PX = 4;
export const PANEL_PADDING_PX = 8;

// Estimativas, não medidas: o painel real é montado com colunas em
// `var(--touch-target, 44px)`, então estes números podem derivar alguns px se
// o token mudar. Isso é aceitável de propósito — o clamp do painel mais os
// 12px de margem absorvem a deriva sem jogar nada pra fora da tela.
export const PANEL_WIDTH_PX =
  PANEL_COLUMNS * FAB_SIZE_PX + (PANEL_COLUMNS - 1) * PANEL_CELL_GAP_PX + 2 * PANEL_PADDING_PX; // 204
export const PANEL_HEIGHT_PX =
  PANEL_ROWS * FAB_SIZE_PX + (PANEL_ROWS - 1) * PANEL_CELL_GAP_PX + 2 * PANEL_PADDING_PX; // 108

/**
 * getVisibleViewport — o "retângulo verdade" contra o qual o FAB se posiciona.
 *
 * `position: fixed` no iOS Safari é resolvido contra a LAYOUT viewport. Quando
 * o teclado abre, o Safari encolhe a VISUAL viewport e paneia a layout viewport
 * por baixo do teclado (mesmo mecanismo já documentado em
 * components/TerminalPanel.jsx:545-553). Consequência: ancorar o FAB por
 * `bottom`/`right` em CSS o joga literalmente debaixo do teclado. Por isso ele
 * usa sempre `left`/`top` em px derivados daqui.
 *
 * `offsetLeft`/`offsetTop` são o deslocamento da borda da visual viewport em
 * relação à layout viewport — exatamente a translação necessária pra converter
 * "coordenada dentro da área visível" em "coordenada que `fixed` consome".
 *
 * Ressalva conhecida e deliberadamente não tratada: com `vv.scale !== 1`
 * (pinch-zoom) a conversão fica aproximada. Não vale lutar — o clamp mantém o
 * botão alcançável de qualquer forma.
 */
export function getVisibleViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) {
    return {
      left: vv.offsetLeft || 0,
      top: vv.offsetTop || 0,
      width: vv.width,
      height: vv.height,
    };
  }
  return {
    left: 0,
    top: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  };
}

/**
 * readSafeAreaInsets — ponte env() -> JS.
 *
 * `env(safe-area-inset-*)` só existe em CSS. layouts/v2/theme.css copia os 4
 * valores para custom properties (`--v2-safe-*`) justamente para que possam ser
 * lidos daqui via getComputedStyle.
 *
 * Em jsdom `env()` não é resolvido: a leitura devolve `''` (ou a própria
 * expressão) -> `parseFloat` dá NaN -> cai em 0, que é o valor CORRETO para um
 * ambiente sem notch. Degradação graciosa, e é o que torna isto testável.
 */
export function readSafeAreaInsets() {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const cs = window.getComputedStyle(document.documentElement);
  const read = (name) => {
    const value = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: read('--v2-safe-top'),
    right: read('--v2-safe-right'),
    bottom: read('--v2-safe-bottom'),
    left: read('--v2-safe-left'),
  };
}

/**
 * getPositionBounds — o range de `left`/`top` em que o objeto pode repousar.
 *
 * Subtrair o tamanho do objeto nos máximos é o que garante que ele nunca fique
 * parcialmente fora: `maxLeft` já é a posição da borda ESQUERDA no momento em
 * que a borda direita encosta no limite.
 *
 * `width`/`height` são o tamanho do objeto posicionado — 44/44 pro FAB,
 * PANEL_WIDTH_PX/PANEL_HEIGHT_PX pro painel (é o mesmo cálculo, por isso a
 * função é reusada nos dois).
 */
export function getPositionBounds({ viewport, insets, width, height }) {
  return {
    minLeft: viewport.left + insets.left + EDGE_MARGIN_PX,
    maxLeft: viewport.left + viewport.width - insets.right - EDGE_MARGIN_PX - width,
    minTop: viewport.top + insets.top + EDGE_MARGIN_PX,
    maxTop: viewport.top + viewport.height - insets.bottom - EDGE_MARGIN_PX - height,
  };
}

// Guard do caso degenerado: numa viewport menor que o objeto + margens,
// `hi < lo`, e Math.min(Math.max(v, lo), hi) devolveria `hi` — que é MENOR que
// `lo`, ou seja, posicionaria o objeto fora do lado oposto. Retornar `lo`
// mantém o objeto ancorado no canto seguro superior/esquerdo.
function clamp1(v, lo, hi) {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

export function clampPosition({ left, top }, bounds) {
  return {
    left: clamp1(left, bounds.minLeft, bounds.maxLeft),
    top: clamp1(top, bounds.minTop, bounds.maxTop),
  };
}

// Snap por eixo, aplicado DEPOIS do clamp. Os 24px são medidos até
// `minLeft`/`maxLeft`, que JÁ embutem os 12px de margem e o safe-area inset —
// ou seja: "a menos de 24px da posição de repouso daquele canto" gruda
// EXATAMENTE na posição de repouso. O snap nunca empurra o FAB para além dos
// 12px nem invade a safe area. Como é independente por eixo, snap de canto sai
// de graça quando os dois grudam, sem caso especial.
function snap1(v, lo, hi) {
  if (hi <= lo) return lo;
  if (v - lo <= SNAP_THRESHOLD_PX) return lo;
  if (hi - v <= SNAP_THRESHOLD_PX) return hi;
  return v;
}

export function snapPosition({ left, top }, bounds) {
  return {
    left: snap1(left, bounds.minLeft, bounds.maxLeft),
    top: snap1(top, bounds.minTop, bounds.maxTop),
  };
}

/**
 * pxToPercent / percentToPx — a % é fração do RANGE POSICIONÁVEL, não da
 * viewport. Esta escolha é a razão de `v: 1` existir no blob persistido
 * (hooks/useFabPosition.js): o significado de `xPercent` não é auto-descritivo.
 *
 * Por que não `left / viewport.width`: nessa definição um FAB encostado na
 * borda direita de uma tela de 820px dá pct ~= 0.932; restaurar 0.932 numa tela
 * de 1180px (girar o iPad) põe o FAB 27px PRA DENTRO — o canto deixa de ser
 * canto. Com fração do range, 0 = encostado no limite esquerdo e 1 = encostado
 * no direito, exatamente, em qualquer orientação.
 *
 * Caso degenerado (`span <= 0`, viewport menor que o objeto): a % persistida é
 * irrelevante porque percentToPx colapsa em `lo` de qualquer forma. `1` é
 * escolha arbitrária, documentada aqui pra ninguém "consertar" pra 0.
 */
function pct1(v, lo, hi) {
  const span = hi - lo;
  if (span <= 0) return 1;
  return (v - lo) / span;
}

function px1(pct, lo, hi) {
  const span = hi - lo;
  if (span <= 0) return lo;
  return lo + pct * span;
}

export function pxToPercent({ left, top }, bounds) {
  return {
    xPercent: pct1(left, bounds.minLeft, bounds.maxLeft),
    yPercent: pct1(top, bounds.minTop, bounds.maxTop),
  };
}

export function percentToPx({ xPercent, yPercent }, bounds) {
  return {
    left: px1(xPercent, bounds.minLeft, bounds.maxLeft),
    top: px1(yPercent, bounds.minTop, bounds.maxTop),
  };
}

// Canto inferior direito (decisão D2 do PO): o polegar direito alcança ali sem
// atravessar a tela, e é o canto que menos oclui a saída do terminal (que
// cresce de cima pra baixo).
export function getDefaultPosition(bounds) {
  return { left: bounds.maxLeft, top: bounds.maxTop };
}

/**
 * getPanelPlacement — onde o painel de atalhos abre, dado onde o FAB está.
 *
 * Regra: cresce SEMPRE em direção ao centro da área visível, escolhida por
 * quadrante. `growX === 'right'` alinha a borda ESQUERDA do painel com a do FAB
 * e cresce pra direita; `'left'` alinha as bordas DIREITAS e cresce pra
 * esquerda. Idem no eixo Y.
 *
 * O segundo clamp (via getPositionBounds + clampPosition com o tamanho do
 * painel) NÃO é redundante com "crescer pro centro": crescer pro centro garante
 * meia viewport de folga, e meia viewport de um iPhone SE em retrato é 160px —
 * MENOR que os 204px do painel. Sem este clamp o painel estoura a borda
 * exatamente no dispositivo mais estreito.
 *
 * `transformOrigin` aponta pro canto do painel mais próximo do FAB, pra que a
 * animação de entrada (`.v2-fab-panel-enter` em theme.css) pareça brotar do
 * botão em vez de aparecer do centro.
 */
export function getPanelPlacement({ left, top, size = FAB_SIZE_PX, viewport, insets }) {
  const fabCenterX = left + size / 2;
  const fabCenterY = top + size / 2;
  const growX = fabCenterX > viewport.left + viewport.width / 2 ? 'left' : 'right';
  const growY = fabCenterY > viewport.top + viewport.height / 2 ? 'up' : 'down';

  const rawLeft = growX === 'right' ? left : left + size - PANEL_WIDTH_PX;
  const rawTop = growY === 'down'
    ? top + size + PANEL_GAP_PX
    : top - PANEL_GAP_PX - PANEL_HEIGHT_PX;

  const panelBounds = getPositionBounds({
    viewport,
    insets,
    width: PANEL_WIDTH_PX,
    height: PANEL_HEIGHT_PX,
  });
  const clamped = clampPosition({ left: rawLeft, top: rawTop }, panelBounds);

  return {
    panelLeft: clamped.left,
    panelTop: clamped.top,
    transformOrigin: `${growX === 'right' ? 'left' : 'right'} ${growY === 'down' ? 'top' : 'bottom'}`,
    growX,
    growY,
  };
}
