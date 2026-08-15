// frontend/src/utils/fabGeometry.test.js
//
// Cobertura completa das funções puras de geometria do FAB de atalhos. O
// primeiro describe (`panel geometry constants`) é do Dev, e cobre a refatoração
// que separou o tamanho do FAB do tamanho da célula do painel; todo o resto foi
// acrescentado pela etapa de QA.
//
// POR QUE ESTE ARQUIVO É O MAIS IMPORTANTE DA FEATURE: o núcleo de risco do FAB
// é aritmético (clamp, snap, px<->%, quadrante, colocação do painel), e aqui ele
// é alcançável sem DOM, sem visualViewport, sem timer e sem evento de ponteiro.
// Cada conta verificada aqui é uma conta que NÃO precisa ser reconstituída por um
// arrasto simulado — que é o caminho mais frágil e mais lento possível para
// conferir uma soma. Os testes de componente cobrem a fiação; estes cobrem a
// matemática.
//
// DISCIPLINA DESTE ARQUIVO: as bounds são objetos LITERAIS, nunca o retorno de
// `getPositionBounds`. Reusar a função para construir a entrada dos testes de
// clamp/snap/percentual esconderia um erro em getPositionBounds atrás de uma
// composição consistente — os dois lados erram juntos e nada fica vermelho.
// Idem para os resultados esperados: número literal, nunca a fórmula sob teste
// reescrita dentro do `expect`.
//
// Por que as três primeiras e não uma reasserção da fórmula: `PANEL_WIDTH_PX` e
// `PANEL_HEIGHT_PX` derivavam de `FAB_SIZE_PX`, mas o painel real é montado com
// `var(--touch-target, 44px)`. Eram dois conceitos coincidindo em 44 por
// acidente. No momento em que o FAB ganha 56px no tablet a coincidência se
// rompe, a estimativa de largura do painel erra 48px, e o painel abre cortado ou
// colado na borda errada — sem erro, sem warning, sem teste vermelho. Reescrever
// a fórmula em outra sintaxe dentro de um `expect` não protegeria disso; o 2º e o
// 3º teste abaixo protegem, porque são comportamentais.

import { describe, it, expect, afterEach } from 'vitest';
import { installFakeVisualViewport } from '../test/fakeVisualViewport.js';
import {
  EDGE_MARGIN_PX,
  FAB_SIZE_PX,
  FAB_SIZE_TABLET_PX,
  PANEL_CELL_PX,
  PANEL_GAP_PX,
  PANEL_HEIGHT_PX,
  PANEL_ROW_HEIGHTS_PX,
  PANEL_TOGGLE_ROW_HEIGHT_PX,
  PANEL_WIDTH_PX,
  SNAP_THRESHOLD_PX,
  clampPosition,
  getDefaultPosition,
  getPanelPlacement,
  getPositionBounds,
  getVisibleViewport,
  percentToPx,
  pxToPercent,
  readSafeAreaInsets,
  snapPosition,
} from './fabGeometry.js';

// jsdom não resolve `env()`, e nenhum dispositivo-alvo do produto tem notch no
// eixo que interessa aqui — insets zerados são o caso real, não uma simplificação.
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

// iPad em paisagem, que é também o default do jsdom (window.innerWidth/
// innerHeight = 1024x768) — usar o mesmo retângulo nos dois lados deixa os testes
// de fallback compará-los diretamente.
const LANDSCAPE = { left: 0, top: 0, width: 1024, height: 768 };

// Bounds de um FAB de 44px em LANDSCAPE, escritas à mão de propósito (ver a
// disciplina no cabeçalho): 12 / 1024-12-44 / 12 / 768-12-44.
const FAB_BOUNDS_44 = { minLeft: 12, maxLeft: 968, minTop: 12, maxTop: 712 };

// Bounds DEGENERADAS: uma "viewport" de 40x40 não caberia um FAB de 44 mais as
// duas margens de 12, então maxLeft = 40-12-44 = -16 fica ABAIXO de minLeft = 12.
// Precondição real: vv.width (ou height) < 68px. Inalcançável em dispositivo — é
// por isso que os testes abaixo documentam o comportamento em vez de exigi-lo.
const DEGENERATE_BOUNDS = { minLeft: 12, maxLeft: -16, minTop: 12, maxTop: -16 };

describe('panel geometry constants', () => {
  it('measures 204x156 for a four-column grid with a full-width toggle row', () => {
    // A largura NÃO muda com a entrada da barra larga: ela é uma LINHA, e gasta
    // as 4 colunas que já existiam (`grid-column: 1 / -1`). 4*44 + 3*4 + 2*8.
    expect(PANEL_WIDTH_PX).toBe(204);
    // A altura muda, e é a única coisa que muda: 3 linhas de 44 em vez de 2.
    // 3*44 + 2*4 + 2*8.
    expect(PANEL_HEIGHT_PX).toBe(156);
    // O vetor de alturas existe para que uma linha de altura diferente entre
    // somando, em vez de virar caso especial numa multiplicação `rows * cell`.
    expect(PANEL_ROW_HEIGHTS_PX).toEqual([44, 44, 44]);
  });

  it('does not derive the panel size from the fab size', () => {
    // FAB de 56px (tablet) repousando no canto inferior direito de um iPad em
    // paisagem: maxLeft = 1024 - 12 - 56 = 956, maxTop = 768 - 12 - 56 = 700.
    const viewport = { left: 0, top: 0, width: 1024, height: 768 };
    const fabLeft = 956;
    const fabTop = 700;

    const placement = getPanelPlacement({
      left: fabLeft,
      top: fabTop,
      size: FAB_SIZE_TABLET_PX,
      viewport,
      insets: NO_INSETS,
    });

    // À direita do centro visível, então o painel cresce pra ESQUERDA — o que
    // alinha a borda direita do painel com a borda direita do FAB.
    expect(placement.growX).toBe('left');
    // 956 + 56 - 204 = 808. Este é O teste da refatoração, e o literal 204 é
    // deliberado: se PANEL_WIDTH_PX voltasse a derivar de um FAB de 56px, ele
    // valeria 4*56 + 3*4 + 2*8 = 252, o painel aterraria em 760, e uma asserção
    // escrita como `fabLeft + size - PANEL_WIDTH_PX` seria tautológica e passaria
    // mesmo assim.
    expect(placement.panelLeft).toBe(808);
    // A borda direita do painel encosta na do FAB — a definição de "cresce pra
    // esquerda" — com o painel ainda medindo 204.
    expect(placement.panelLeft + 204).toBe(fabLeft + FAB_SIZE_TABLET_PX);
  });

  it('keeps the panel inside the visible area when the toggle row makes it taller', () => {
    // iPhone SE em PAISAGEM (667x375) é onde os 48px extras de altura passam a
    // morder de fato: com o FAB logo acima do centro vertical o painel cresce pra
    // BAIXO, e 156px não caberiam sem o clamp.
    //
    // (Em retrato, 667px de altura sobram tanto que o clamp nunca engata e o
    // teste passaria com os 108px antigos — ou seja, não guardaria nada. É o
    // risco R-R1 do plano na prática, por isso a paisagem.)
    const viewport = { left: 0, top: 0, width: 667, height: 375 };
    const fabLeft = 100;
    const fabTop = 165; // centro do FAB em 187, logo acima do centro visível (187.5)

    const placement = getPanelPlacement({
      left: fabLeft,
      top: fabTop,
      size: 44,
      viewport,
      insets: NO_INSETS,
    });

    expect(placement.growY).toBe('down');
    // Sem clamp o painel abriria em 165 + 44 + 8 = 217 e sua borda inferior
    // cairia em 373, invadindo os 12px de margem. O clamp o segura em
    // maxTop = 375 - 12 - 156 = 207. Com os 108px antigos, maxTop era 255 e o
    // 217 passava intocado — é essa diferença que este teste captura.
    expect(placement.panelTop).toBe(207);
    expect(placement.panelTop + PANEL_HEIGHT_PX).toBeLessThanOrEqual(
      viewport.height - EDGE_MARGIN_PX,
    );
    expect(placement.panelTop).toBeGreaterThanOrEqual(EDGE_MARGIN_PX);
  });
});

describe('getVisibleViewport', () => {
  let restoreViewport;

  afterEach(() => {
    if (restoreViewport) restoreViewport();
    restoreViewport = undefined;
  });

  it('translates the visual viewport by its offsets, not just its size', () => {
    // O pan do Safari é o caso que decide a feature: com `overflow: hidden` na
    // página o iOS não tem scroll a oferecer, então empurra a LAYOUT viewport
    // para manter a textarea visível, e `offsetTop` é a única expressão desse
    // deslocamento. Um `getVisibleViewport` que devolvesse só width/height
    // posicionaria o FAB (e o casco do app) contra uma origem que não existe
    // mais na tela.
    const installed = installFakeVisualViewport({
      width: 800, height: 600, offsetLeft: 40, offsetTop: 120,
    });
    restoreViewport = installed.restore;

    expect(getVisibleViewport()).toEqual({
      left: 40, top: 120, width: 800, height: 600,
    });
  });

  it('coerces absent offsets to zero instead of leaking undefined into the maths', () => {
    // Browsers antigos expõem `visualViewport` sem os dois `offset*`. Sem o
    // `|| 0` o valor viraria `undefined`, e `undefined + 12` é NaN — o FAB
    // receberia `left: NaNpx` e o browser descartaria a declaração inteira,
    // deixando o botão no canto superior esquerdo do fluxo, longe de qualquer
    // canto calculado.
    const installed = installFakeVisualViewport({ width: 800, height: 600 });
    restoreViewport = installed.restore;
    installed.vv.set({ offsetLeft: undefined, offsetTop: undefined });

    expect(getVisibleViewport()).toEqual({
      left: 0, top: 0, width: 800, height: 600,
    });
  });

  it('falls back to the layout viewport when visualViewport is unavailable', () => {
    // Este é o estado NATURAL do jsdom (a API não existe) e também o de um
    // browser antigo. Toda a suíte de arrasto do FAB depende deste fallback para
    // ter bounds; se ele deixasse de existir, os testes de componente não
    // falhariam com uma mensagem sobre viewport — falhariam com NaN.
    expect(window.visualViewport).toBeUndefined();

    expect(getVisibleViewport()).toEqual({
      left: 0, top: 0, width: 1024, height: 768,
    });
  });
});

describe('readSafeAreaInsets', () => {
  it('reports no insets in jsdom, because env() is never resolved', () => {
    // Não é uma limitação a contornar: 0 é o valor CORRETO para um ambiente sem
    // notch, e é o que torna toda a aritmética de bounds determinística nos
    // testes. Este teste existe para que a premissa fique escrita — se um dia
    // jsdom passar a resolver `env()`, é aqui que a suíte avisa, em vez de dezenas
    // de asserções de px começarem a errar por 34.
    expect(readSafeAreaInsets()).toEqual({
      top: 0, right: 0, bottom: 0, left: 0,
    });
  });

  it('parses the four --v2-safe-* custom properties when the platform resolves them', () => {
    // O caminho que só existe em dispositivo real: layouts/v2/theme.css copia os
    // quatro `env(safe-area-inset-*)` para custom properties justamente para que
    // JS possa lê-los. Stubbar getComputedStyle é o único jeito de exercitar o
    // parse aqui — e é o parse que importa, porque um `parseFloat` que caísse em
    // NaN silenciosamente viraria 0 e o FAB invadiria o notch do iPhone.
    const values = {
      '--v2-safe-top': '44px',
      '--v2-safe-right': '8px',
      '--v2-safe-bottom': '34px',
      '--v2-safe-left': '8px',
    };
    const original = window.getComputedStyle;
    window.getComputedStyle = () => ({
      getPropertyValue: (name) => values[name] ?? '',
    });

    try {
      expect(readSafeAreaInsets()).toEqual({
        top: 44, right: 8, bottom: 34, left: 8,
      });
    } finally {
      window.getComputedStyle = original;
    }
  });

  it('falls back to zero for a property that does not parse as a number', () => {
    // Dois modos de falha reais no mesmo teste: a propriedade ausente (string
    // vazia) e a expressão `env()` devolvida sem resolução, que é o que alguns
    // motores fazem. `parseFloat` dá NaN nos dois casos, e NaN propagado nas
    // bounds põe o FAB fora da tela sem erro nenhum.
    const original = window.getComputedStyle;
    window.getComputedStyle = () => ({
      getPropertyValue: (name) => (name === '--v2-safe-top' ? 'env(safe-area-inset-top)' : ''),
    });

    try {
      expect(readSafeAreaInsets()).toEqual({
        top: 0, right: 0, bottom: 0, left: 0,
      });
    } finally {
      window.getComputedStyle = original;
    }
  });

  it('returns zeroes when getComputedStyle is unavailable at all', () => {
    // Guard de ambiente sem DOM (SSR, worker). Sem ele a leitura estoura no
    // primeiro render do FAB em vez de degradar.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
    Object.defineProperty(window, 'getComputedStyle', {
      value: undefined, configurable: true, writable: true,
    });

    try {
      expect(readSafeAreaInsets()).toEqual({
        top: 0, right: 0, bottom: 0, left: 0,
      });
    } finally {
      Object.defineProperty(window, 'getComputedStyle', descriptor);
    }
  });
});

describe('getPositionBounds', () => {
  it('subtracts the object size from the maximums so it never overhangs', () => {
    // `maxLeft` é a posição da borda ESQUERDA no instante em que a borda DIREITA
    // encosta no limite — é essa subtração que impede o FAB de ficar meio fora da
    // tela. Literais, não `1024 - EDGE_MARGIN_PX - FAB_SIZE_PX`.
    expect(getPositionBounds({
      viewport: LANDSCAPE, insets: NO_INSETS, width: FAB_SIZE_PX, height: FAB_SIZE_PX,
    })).toEqual({ minLeft: 12, maxLeft: 968, minTop: 12, maxTop: 712 });
  });

  it('shifts the whole range by the visual viewport origin', () => {
    // Com a visual viewport paneada, "12px da borda visível" NÃO é "12px da
    // borda da layout viewport": os limites inteiros andam junto com o pan. Sem
    // isto o FAB fica alcançável no papel e debaixo do teclado na prática.
    expect(getPositionBounds({
      viewport: { left: 40, top: 120, width: 800, height: 600 },
      insets: NO_INSETS,
      width: FAB_SIZE_PX,
      height: FAB_SIZE_PX,
    })).toEqual({ minLeft: 52, maxLeft: 784, minTop: 132, maxTop: 664 });
  });

  it('shrinks the range by the safe-area insets on the correct side of each axis', () => {
    // Cada inset morde UM lado: `left` só o mínimo do eixo X, `right` só o
    // máximo. Trocar os dois é o erro clássico aqui, e ele é invisível numa
    // viewport com insets simétricos — por isso os quatro valores são diferentes.
    expect(getPositionBounds({
      viewport: LANDSCAPE,
      insets: { top: 24, right: 8, bottom: 34, left: 16 },
      width: FAB_SIZE_PX,
      height: FAB_SIZE_PX,
    })).toEqual({ minLeft: 28, maxLeft: 960, minTop: 36, maxTop: 678 });
  });

  it('produces an inverted range when the object cannot fit the viewport', () => {
    // Não é asserção de fórmula, é a PRECONDIÇÃO dos guards degenerados de
    // clamp/snap/percentual testados abaixo: sem provar que getPositionBounds
    // realmente devolve `hi < lo` em algum cenário, aqueles guards seriam código
    // que os testes tratam como alcançável por fé.
    const bounds = getPositionBounds({
      viewport: { left: 0, top: 0, width: 40, height: 40 },
      insets: NO_INSETS,
      width: FAB_SIZE_PX,
      height: FAB_SIZE_PX,
    });

    expect(bounds).toEqual(DEGENERATE_BOUNDS);
    expect(bounds.maxLeft).toBeLessThan(bounds.minLeft);
  });
});

describe('clampPosition', () => {
  it('leaves a position that already sits inside the range untouched', () => {
    expect(clampPosition({ left: 500, top: 300 }, FAB_BOUNDS_44))
      .toEqual({ left: 500, top: 300 });
  });

  it('pulls an out-of-range position back to the nearest bound on each axis', () => {
    // Os dois eixos em direções OPOSTAS no mesmo caso: um clamp que confundisse
    // os eixos passaria num teste que empurra tudo para o mesmo lado.
    expect(clampPosition({ left: -400, top: 5000 }, FAB_BOUNDS_44))
      .toEqual({ left: 12, top: 712 });
    expect(clampPosition({ left: 5000, top: -400 }, FAB_BOUNDS_44))
      .toEqual({ left: 968, top: 12 });
  });

  it('anchors to the low bound when the range is degenerate (hi < lo)', () => {
    // O guard que existe para isto: `Math.min(Math.max(v, lo), hi)` devolveria
    // `hi` = -16, ou seja o FAB posicionado 16px FORA do lado oposto da tela —
    // exatamente o contrário do que um clamp deveria garantir. Devolver `lo`
    // mantém o botão no canto superior/esquerdo, que é seguro e alcançável.
    expect(clampPosition({ left: 500, top: 500 }, DEGENERATE_BOUNDS))
      .toEqual({ left: 12, top: 12 });
    expect(clampPosition({ left: -500, top: -500 }, DEGENERATE_BOUNDS))
      .toEqual({ left: 12, top: 12 });
  });
});

describe('snapPosition', () => {
  it('snaps to the resting position of the low bound within the threshold, and not one pixel past it', () => {
    // A fronteira exata dos 24px, nos dois lados dela. `lo + 24` ainda gruda
    // (`<=`), `lo + 25` não. Um teste que só checasse `lo + 1` passaria com um
    // threshold de 2px.
    expect(snapPosition({ left: 36, top: 36 }, FAB_BOUNDS_44))
      .toEqual({ left: 12, top: 12 });
    expect(snapPosition({ left: 37, top: 37 }, FAB_BOUNDS_44))
      .toEqual({ left: 37, top: 37 });
    expect(SNAP_THRESHOLD_PX).toBe(24);
  });

  it('snaps to the resting position of the high bound within the threshold', () => {
    expect(snapPosition({ left: 944, top: 688 }, FAB_BOUNDS_44))
      .toEqual({ left: 968, top: 712 });
    expect(snapPosition({ left: 943, top: 687 }, FAB_BOUNDS_44))
      .toEqual({ left: 943, top: 687 });
  });

  it('snaps each axis independently, so corner snapping needs no special case', () => {
    // Perto do mínimo em X e do máximo em Y ao mesmo tempo: o canto inferior
    // esquerdo sai de graça. Uma implementação que tratasse "canto" como um caso
    // próprio erraria aqui ou exigiria quatro ramificações.
    expect(snapPosition({ left: 20, top: 700 }, FAB_BOUNDS_44))
      .toEqual({ left: 12, top: 712 });
    // E um eixo grudando não pode arrastar o outro consigo.
    expect(snapPosition({ left: 20, top: 400 }, FAB_BOUNDS_44))
      .toEqual({ left: 12, top: 400 });
  });

  it('leaves the middle of the range alone', () => {
    expect(snapPosition({ left: 490, top: 362 }, FAB_BOUNDS_44))
      .toEqual({ left: 490, top: 362 });
  });

  it('prefers the low bound when a narrow range puts both within the threshold', () => {
    // Range de 40px (menor que 2*24): a posição 35 está a 23px do mínimo E a 17px
    // do máximo. O código checa o mínimo primeiro, então o mínimo ganha. Isto é
    // desempate arbitrário mas DETERMINÍSTICO, e vale fixá-lo: sem o teste, uma
    // reordenação das duas comparações mudaria o comportamento em tela estreita
    // sem nada ficar vermelho.
    expect(snapPosition({ left: 35, top: 35 }, {
      minLeft: 12, maxLeft: 52, minTop: 12, maxTop: 52,
    })).toEqual({ left: 12, top: 12 });
  });

  it('collapses onto the low bound when the range is degenerate', () => {
    expect(snapPosition({ left: 500, top: 500 }, DEGENERATE_BOUNDS))
      .toEqual({ left: 12, top: 12 });
  });
});

describe('pxToPercent / percentToPx', () => {
  it('expresses the position as a fraction of the placeable range, not of the viewport', () => {
    // 500 está a 488px do mínimo num range de 956. Se a definição fosse
    // `left / viewport.width`, a fração seria 500/1024 = 0.488 — número parecido,
    // significado diferente, e é a diferença que estraga a rotação (teste abaixo).
    const pct = pxToPercent({ left: 500, top: 362 }, FAB_BOUNDS_44);
    expect(pct.xPercent).toBeCloseTo(488 / 956, 12);
    expect(pct.yPercent).toBeCloseTo(0.5, 12);
  });

  it('round-trips a position through percent and back to the same pixels', () => {
    const pct = pxToPercent({ left: 731, top: 289 }, FAB_BOUNDS_44);
    const back = percentToPx(pct, FAB_BOUNDS_44);
    expect(back.left).toBeCloseTo(731, 9);
    expect(back.top).toBeCloseTo(289, 9);
  });

  it('keeps a corner in the corner when the device rotates', () => {
    // O teste que justifica a definição inteira. iPad paisagem -> retrato, FAB
    // encostado no canto inferior direito.
    const landscapePct = pxToPercent({ left: 968, top: 712 }, FAB_BOUNDS_44);
    expect(landscapePct).toEqual({ xPercent: 1, yPercent: 1 });

    // Retrato: 768x1024 -> maxLeft = 712, maxTop = 968.
    const portraitBounds = { minLeft: 12, maxLeft: 712, minTop: 12, maxTop: 968 };
    expect(percentToPx(landscapePct, portraitBounds))
      .toEqual({ left: 712, top: 968 });

    // Contraprova do que a definição rejeitada faria: `left / viewport.width` daria
    // 968/1024 = 0.9453..., e 0.9453 * 768 = 726px — 14px ALÉM do maxLeft de 712,
    // ou seja o FAB pendurado fora da borda. O número abaixo é literal de
    // propósito: ele não é produzido por nenhuma função do módulo, é a
    // demonstração de por que ela não existe.
    expect(0.9453125 * 768).toBeCloseTo(726, 0);
    expect(726).toBeGreaterThan(portraitBounds.maxLeft);
  });

  it('collapses percentToPx onto the low bound when the range is degenerate', () => {
    expect(percentToPx({ xPercent: 0.5, yPercent: 0.5 }, DEGENERATE_BOUNDS))
      .toEqual({ left: 12, top: 12 });
  });

  it('reports a full-range percentage for ANY position when the range is degenerate', () => {
    // FIXA O VALOR ARBITRÁRIO, que continua sendo `1` de propósito. `pct1`
    // devolve `1` quando `span <= 0` porque precisa devolver um número (um `NaN`
    // vazaria por `readStoredPercent` e por todo o cálculo de px), e a escolha
    // entre `0` e `1` é indiferente para o consumo legítimo: dentro do mesmo
    // ciclo degenerado, `percentToPx` colapsa qualquer % em `lo` (o teste
    // anterior é exatamente isso).
    //
    // Este teste NÃO documenta mais uma dívida. O caminho que tornava o valor
    // perigoso — a % degenerada chegando ao localStorage — foi fechado em
    // hooks/useFabPosition.js: o `writeStoredPercent` de `commitPosition` está
    // guardado por `bounds.maxLeft > bounds.minLeft && bounds.maxTop >
    // bounds.minTop`. O que sobra aqui é o contrato de `pct1`, e ele importa por
    // um motivo prático: quem for "consertar" o `1` para `0` derruba este teste
    // e o seguinte, e é aí que deve ler o comentário do módulo antes de seguir.
    expect(pxToPercent({ left: 12, top: 12 }, DEGENERATE_BOUNDS))
      .toEqual({ xPercent: 1, yPercent: 1 });
    expect(pxToPercent({ left: -9999, top: -9999 }, DEGENERATE_BOUNDS))
      .toEqual({ xPercent: 1, yPercent: 1 });
  });

  it('composes a degenerate percentage into the opposite corner of a healthy range', () => {
    // O MODO DE FALHA QUE O GUARD IMPEDE, escrito como composição pura para não
    // depender de storage nem de React: uma % de (1, 1) medida contra bounds
    // degenerados, aplicada a bounds saudáveis, aterra no canto INFERIOR DIREITO
    // — mesmo tendo sido produzida por um FAB que estava no canto SUPERIOR
    // ESQUERDO (12, 12). É o teleporte de canto a canto, em duas linhas.
    //
    // Por que o teste continua vivo depois da correção: `pxToPercent` e
    // `percentToPx` são funções puras e continuam compondo exatamente assim — o
    // que mudou é que `commitPosition` não deixa mais essa % ser PERSISTIDA
    // (hooks/useFabPosition.js), logo a composição não é mais alcançável por um
    // reload. Este teste guarda a aritmética; o teste
    // `does not persist a percentage measured against a degenerate range` em
    // hooks/useFabPosition.test.js guarda o guard. Apagar este aqui tiraria a
    // única descrição executável do motivo pelo qual aquele guard existe.
    const degeneratePct = pxToPercent({ left: 12, top: 12 }, DEGENERATE_BOUNDS);
    expect(percentToPx(degeneratePct, FAB_BOUNDS_44))
      .toEqual({ left: 968, top: 712 });
  });
});

describe('getDefaultPosition', () => {
  it('rests in the bottom-right corner of the placeable range, not of the viewport', () => {
    // Canto inferior direito (decisão D2 do PO: alcance do polegar direito, e é o
    // canto que menos oclui a saída do terminal). O "não da viewport" importa: o
    // default já embute os 12px de margem e o safe-area inset, porque vem das
    // bounds e não de `viewport.width`.
    expect(getDefaultPosition(FAB_BOUNDS_44)).toEqual({ left: 968, top: 712 });
    expect(getDefaultPosition({
      minLeft: 28, maxLeft: 960, minTop: 36, maxTop: 678,
    })).toEqual({ left: 960, top: 678 });
  });
});

// Os quatro quadrantes, com o FAB EXATAMENTE nos quatro cantos de repouso de um
// iPad em paisagem. Um único quadrante testado provaria apenas que a função
// devolve algo; a regra "cresce sempre em direção ao centro" só é verificável
// pelo conjunto, porque é a troca de sinal entre os casos que a expressa.
//
// Bounds do FAB (44px): 12..968 / 12..712.
// Bounds do PAINEL (204x156): 12..808 / 12..600.
describe('getPanelPlacement — quadrants', () => {
  const place = (left, top) => getPanelPlacement({
    left, top, size: FAB_SIZE_PX, viewport: LANDSCAPE, insets: NO_INSETS,
  });

  it('grows right and down from the top-left corner', () => {
    const placement = place(12, 12);
    expect({ growX: placement.growX, growY: placement.growY })
      .toEqual({ growX: 'right', growY: 'down' });
    // Crescer para a direita alinha as bordas ESQUERDAS: o painel começa onde o
    // FAB começa. Abaixo dele, com o gap de 8: 12 + 44 + 8 = 64.
    expect(placement.panelLeft).toBe(12);
    expect(placement.panelTop).toBe(64);
    // A origem da animação aponta para o canto do painel mais próximo do FAB,
    // para que ele pareça brotar do botão.
    expect(placement.transformOrigin).toBe('left top');
  });

  it('grows left and down from the top-right corner', () => {
    const placement = place(968, 12);
    expect({ growX: placement.growX, growY: placement.growY })
      .toEqual({ growX: 'left', growY: 'down' });
    // Crescer para a esquerda alinha as bordas DIREITAS: 968 + 44 - 204 = 808.
    // Literal, não a fórmula — 808 também é exatamente o maxLeft do painel, o que
    // torna este o caso em que um erro de largura do painel seria absorvido pelo
    // clamp e ficaria invisível se a asserção fosse escrita como conta.
    expect(placement.panelLeft).toBe(808);
    expect(placement.panelTop).toBe(64);
    expect(placement.transformOrigin).toBe('right top');
  });

  it('grows right and up from the bottom-left corner', () => {
    const placement = place(12, 712);
    expect({ growX: placement.growX, growY: placement.growY })
      .toEqual({ growX: 'right', growY: 'up' });
    expect(placement.panelLeft).toBe(12);
    // Acima do FAB: 712 - 8 - 156 = 548.
    expect(placement.panelTop).toBe(548);
    expect(placement.transformOrigin).toBe('left bottom');
  });

  it('grows left and up from the bottom-right corner (the default resting place)', () => {
    const placement = place(968, 712);
    expect({ growX: placement.growX, growY: placement.growY })
      .toEqual({ growX: 'left', growY: 'up' });
    expect(placement.panelLeft).toBe(808);
    expect(placement.panelTop).toBe(548);
    expect(placement.transformOrigin).toBe('right bottom');
  });

  it('flips the growth direction exactly at the centre of the visible area', () => {
    // A fronteira é `fabCenter > viewportCentre` (estritamente maior), então um
    // FAB cujo centro cai EXATAMENTE no centro cresce para a direita/baixo. Fixar
    // isto impede que um refactor troque `>` por `>=` e faça o painel pular de
    // lado num pixel de arrasto.
    const centred = place(512 - 22, 384 - 22); // centro do FAB em (512, 384)
    expect({ growX: centred.growX, growY: centred.growY })
      .toEqual({ growX: 'right', growY: 'down' });

    const onePastCentre = place(512 - 21, 384 - 21); // centro em (513, 385)
    expect({ growX: onePastCentre.growX, growY: onePastCentre.growY })
      .toEqual({ growX: 'left', growY: 'up' });
  });

  it('clamps the panel back inside the viewport when growing toward the centre is not enough', () => {
    // iPhone SE em RETRATO (375x667): meia viewport são 187px, MENOS que os 204px
    // do painel. "Crescer para o centro" garante meia viewport de folga e isso
    // aqui não basta — é exatamente o cenário que justifica o segundo clamp de
    // getPanelPlacement, e sem ele o painel estoura a borda no dispositivo mais
    // estreito do parque.
    const narrow = { left: 0, top: 0, width: 375, height: 667 };
    // FAB com centro em 187 (à esquerda do centro 187.5) -> cresce para a direita
    // a partir de left 165. maxLeft do painel = 375 - 12 - 204 = 159.
    const placement = getPanelPlacement({
      left: 165, top: 100, size: FAB_SIZE_PX, viewport: narrow, insets: NO_INSETS,
    });

    expect(placement.growX).toBe('right');
    expect(placement.panelLeft).toBe(159);
    // E a borda direita encosta exatamente nos 12px de margem, sem invadi-los.
    expect(placement.panelLeft + PANEL_WIDTH_PX).toBe(363);
    expect(placement.panelLeft + PANEL_WIDTH_PX).toBe(narrow.width - EDGE_MARGIN_PX);
  });

  it('places the panel from the fab size that was passed in, not from a module default', () => {
    // Par do teste `does not derive the panel size from the fab size` acima, pelo
    // outro lado: ali o risco era o painel herdar o tamanho do FAB; aqui é o
    // PLACEMENT ignorar o `size` recebido e usar o default de 44. Com 56, a borda
    // direita do painel tem que acompanhar a borda direita do FAB — 12px mais à
    // direita do que com 44.
    const withDefaultSize = getPanelPlacement({
      left: 900, top: 700, viewport: LANDSCAPE, insets: NO_INSETS,
    });
    const withTabletSize = getPanelPlacement({
      left: 900, top: 700, size: FAB_SIZE_TABLET_PX, viewport: LANDSCAPE, insets: NO_INSETS,
    });

    expect(withDefaultSize.panelLeft).toBe(740); // 900 + 44 - 204
    expect(withTabletSize.panelLeft).toBe(752); // 900 + 56 - 204
    // O gap vertical também é medido a partir da borda do FAB, então o painel que
    // cresce PARA CIMA não se move com o tamanho (ele se ancora no topo do FAB),
    // e é isso que distingue os dois eixos.
    expect(withDefaultSize.panelTop).toBe(536);
    expect(withTabletSize.panelTop).toBe(536);
    expect(PANEL_GAP_PX).toBe(8);
  });
});

describe('panel geometry — the coincidence that must not be re-unified', () => {
  it('keeps the panel cell decoupled from the fab size even though both read 44 today', () => {
    // Guarda de intenção, e digo abertamente o que ela NÃO é: não é uma
    // regressão detectada, e ela ficaria verde tanto antes quanto depois da
    // refatoração desta rodada. O que ela guarda é o futuro — o dia em que
    // `--touch-target` mudar, ou o FAB ganhar um terceiro tamanho, e alguém
    // "limpar" duas constantes de valor 44 numa só. O modo de falha daquele
    // refactor é um painel 48px mais largo na estimativa de colocação, abrindo
    // cortado perto da borda, sem erro nem teste vermelho.
    expect(PANEL_CELL_PX).toBe(44);
    expect(FAB_SIZE_PX).toBe(44);
    expect(FAB_SIZE_TABLET_PX).toBe(56);
    // A barra larga tem a altura de uma célula (alvo de toque de 44px), e é a
    // LARGURA que ela tem de diferente — largura que ela não acrescenta.
    expect(PANEL_TOGGLE_ROW_HEIGHT_PX).toBe(PANEL_CELL_PX);
    // A prova de que a largura do painel não segue o FAB grande: 204, não 252.
    expect(PANEL_WIDTH_PX).toBe(204);
    expect(PANEL_HEIGHT_PX).toBe(156);
  });
});
