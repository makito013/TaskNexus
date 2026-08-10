// frontend/src/utils/viewport.test.js
// QA (etapa 8, navegação mobile do Layout v2): fecha uma lacuna real —
// MOBILE_VIEWPORT_QUERY/NARROW_VIEWPORT_QUERY nunca tinham teste próprio,
// só eram exercitadas indiretamente via mocks de window.matchMedia em outros
// arquivos (que nunca avaliam a query de verdade contra uma largura real).
//
// jsdom não implementa media queries reais (window.matchMedia é sempre um
// shim nos outros testes deste repo), então este arquivo não pode confirmar
// "abre em 744px" de ponta a ponta — isso é o gap documentado em
// CONTEXTO.md (Fase 3: pendência de verificação humana em dispositivo real).
// O que ESTE teste garante é mais barato e ainda assim valioso: uma
// regressão de guarda que impede qualquer edição futura de
// MOBILE_VIEWPORT_QUERY de acidentalmente alargar o breakpoint para além do
// menor tablet real do Bruno (iPad Mini retrato, Split View/Slide View
// estreito, ~744px, confirmado em CONTEXTO.md seção 4) — se alguém mudar
// "640px" para, digamos, "768px" sem querer, este teste quebra na hora.
import { describe, it, expect } from 'vitest';
import { MOBILE_VIEWPORT_QUERY, NARROW_VIEWPORT_QUERY } from './viewport.js';

// Extrai o número de "(max-width: NNNpx)" sem depender de parsing de CSS de
// verdade — string simples o bastante para isso ser seguro.
function maxWidthPx(query) {
  const match = /max-width:\s*(\d+)px/.exec(query);
  return match ? Number(match[1]) : NaN;
}

describe('viewport — MOBILE_VIEWPORT_QUERY nunca alcança a largura de um iPad real', () => {
  it('é exatamente "(max-width: 640px)"', () => {
    expect(MOBILE_VIEWPORT_QUERY).toBe('(max-width: 640px)');
  });

  it('o valor numérico fica estritamente abaixo do menor iPad real do Bruno (iPad Mini retrato / Split View estreito, ~744px)', () => {
    const IPAD_MINI_NARROWEST_SPLIT_VIEW_PX = 744;
    expect(maxWidthPx(MOBILE_VIEWPORT_QUERY)).toBeLessThan(IPAD_MINI_NARROWEST_SPLIT_VIEW_PX);
  });

  it('continua estritamente mais estreito que NARROW_VIEWPORT_QUERY (820px, usado só pelo default de colapso da sidebar/TasksDrawer)', () => {
    expect(maxWidthPx(MOBILE_VIEWPORT_QUERY)).toBeLessThan(maxWidthPx(NARROW_VIEWPORT_QUERY));
  });
});

describe('viewport — NARROW_VIEWPORT_QUERY (regressão, não específico da navegação mobile)', () => {
  it('é exatamente "(max-width: 820px)"', () => {
    expect(NARROW_VIEWPORT_QUERY).toBe('(max-width: 820px)');
  });
});
