// frontend/src/utils/fabGeometry.test.js
//
// Escopo deste arquivo nesta rodada: SÓ as três guardas da refatoração que
// separou o tamanho do FAB do tamanho da célula do painel. A cobertura completa
// das funções puras de geometria (getVisibleViewport, readSafeAreaInsets,
// getPositionBounds, clampPosition, snapPosition, pxToPercent/percentToPx,
// getDefaultPosition e os quadrantes de getPanelPlacement) é da etapa de QA e
// entra aqui depois.
//
// Por que estas três e não uma reasserção da fórmula: `PANEL_WIDTH_PX` e
// `PANEL_HEIGHT_PX` derivavam de `FAB_SIZE_PX`, mas o painel real é montado com
// `var(--touch-target, 44px)`. Eram dois conceitos coincidindo em 44 por
// acidente. No momento em que o FAB ganha 56px no tablet a coincidência se
// rompe, a estimativa de largura do painel erra 48px, e o painel abre cortado ou
// colado na borda errada — sem erro, sem warning, sem teste vermelho. Reescrever
// a fórmula em outra sintaxe dentro de um `expect` não protegeria disso; o 2º e o
// 3º teste abaixo protegem, porque são comportamentais.

import { describe, it, expect } from 'vitest';
import {
  EDGE_MARGIN_PX,
  FAB_SIZE_TABLET_PX,
  PANEL_HEIGHT_PX,
  PANEL_ROW_HEIGHTS_PX,
  PANEL_WIDTH_PX,
  getPanelPlacement,
} from './fabGeometry.js';

// jsdom não resolve `env()`, e nenhum dispositivo-alvo do produto tem notch no
// eixo que interessa aqui — insets zerados são o caso real, não uma simplificação.
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

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
