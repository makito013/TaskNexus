// frontend/src/test/fakeVisualViewport.js
//
// Andaime de teste compartilhado para as duas APIs de browser que o jsdom
// 29.1.1 NÃO implementa e das quais a geometria do FAB de atalhos do terminal
// depende inteiramente: `window.visualViewport` e o trio
// `Element.prototype.set/release/hasPointerCapture`.
//
// Este arquivo NÃO é uma suíte: o nome não casa com o `include` default do
// Vitest (`**/*.{test,spec}.?(c|m)[jt]s?(x)`), então ele nunca é coletado como
// arquivo de teste. Precedente de módulo morando em src/test/:
// src/test/webStorageEnvironment.test.js.
//
// Por que ele existe em vez do fake local que havia em
// components/TerminalPanel.test.jsx: aquele tinha SÓ `height` — justamente sem
// `width`/`offsetLeft`/`offsetTop`, que são as dimensões que decidem os
// problemas reais do teclado no iPad. O Safari não só encolhe a visual
// viewport: ele PANEIA a layout viewport por baixo do teclado, e é `offsetTop`
// que expressa esse pan. Um fake sem `offsetTop` não consegue nem reproduzir o
// sintoma "preciso rolar pra cima pra ver os menus"; um fake sem `width` não
// consegue mexer nas bounds do eixo X do FAB. Duplicar um fake incompleto em
// cada frente é como um sintoma fica sem teste possível.
import { vi } from 'vitest';

/**
 * FakeVisualViewport — stub mínimo mas completo da VisualViewport API.
 *
 * As dimensões são propriedades PÚBLICAS e MUTÁVEIS de propósito, não getters:
 * os testes de components/TerminalPanel.test.jsx escrevem `vv.height = 500`
 * direto no objeto, e transformá-las em getter quebraria todos eles de uma vez.
 */
export class FakeVisualViewport {
  constructor({ width = 1024, height = 768, offsetLeft = 0, offsetTop = 0, scale = 1 } = {}) {
    this.width = width;
    this.height = height;
    // Deslocamento da borda da visual viewport em relação à layout viewport —
    // é o pan do Safari. utils/fabGeometry.js getVisibleViewport() traduz isso
    // em `left`/`top`, então um fake que zere estes dois campos silenciosamente
    // testa apenas metade da conversão.
    this.offsetLeft = offsetLeft;
    this.offsetTop = offsetTop;
    this.scale = scale;
    this._listeners = { resize: [], scroll: [] };
  }

  addEventListener(type, cb) {
    if (this._listeners[type]) this._listeners[type].push(cb);
  }

  removeEventListener(type, cb) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((fn) => fn !== cb);
  }

  /**
   * Quantos listeners estão inscritos num tipo. Existe para os testes de
   * cleanup-no-unmount asseverarem sem furar o encapsulamento lendo
   * `vv._listeners` de fora do módulo.
   */
  listenerCount(type) {
    return (this._listeners[type] || []).length;
  }

  fire(type) {
    for (const cb of this._listeners[type] || []) cb();
  }

  /**
   * Muta as dimensões SEM disparar evento nenhum. Quem decide qual evento o
   * browser emitiria (`resize` ou `scroll`) é o teste, porque o iOS emite um ou
   * outro dependendo da versão — e essa ambiguidade é justamente parte do que
   * está sob teste (é a razão de useFabPosition.js e TerminalPanel.jsx
   * escutarem os dois).
   */
  set(patch) {
    Object.assign(this, patch);
  }
}

/**
 * installFakeVisualViewport — instala o fake em `window.visualViewport` e
 * devolve `{ vv, restore }`. Chame `restore()` no `afterEach`.
 *
 * `visualViewport` não é configurável por atribuição simples em jsdom (a
 * propriedade nem existe), por isso o defineProperty.
 */
export function installFakeVisualViewport(init) {
  const vv = new FakeVisualViewport(init);
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(window, 'visualViewport');
  const original = window.visualViewport;

  Object.defineProperty(window, 'visualViewport', {
    value: vv,
    configurable: true,
    writable: true,
  });

  return {
    vv,
    restore() {
      if (hadOwnProperty) {
        Object.defineProperty(window, 'visualViewport', {
          value: original,
          configurable: true,
          writable: true,
        });
        return;
      }
      // No jsdom a propriedade não existe. Apagar devolve o ambiente ao estado
      // original; redefini-la como `undefined` deixaria uma own property que
      // `'visualViewport' in window` continuaria enxergando — e há código no
      // repo que testa a AUSÊNCIA da API.
      delete window.visualViewport;
    },
  };
}

/**
 * installPointerCapture — instala stubs de `setPointerCapture`,
 * `releasePointerCapture` e `hasPointerCapture` em `Element.prototype`.
 *
 * jsdom 29.1.1 não implementa nenhum dos três. Isto serve a dois fins opostos e
 * ambos necessários:
 *  - COM o stub, um teste pode asseverar que o componente pede a captura com o
 *    pointerId certo (é a captura que, no browser real, faz pointermove/up
 *    continuarem chegando no elemento quando o dedo sai dos 44px dele);
 *  - SEM o stub — que é o estado de todos os outros arquivos da suíte que
 *    montam o FAB (ChatV2.test.jsx, AppV2.test.jsx) — o guard
 *    `typeof el.setPointerCapture === 'function'` de TerminalShortcutsFab.jsx
 *    é o que impede um TypeError. Ou seja: aqueles arquivos são a prova viva de
 *    que o guard funciona, e é por isso que ele NÃO pode ser "limpo" num
 *    refactor.
 *
 * Nota de fidelidade: o browser real lança `NotFoundError` em
 * `releasePointerCapture` quando a captura já foi liberada por conta própria
 * (ex.: `pointercancel` emitido pelo sistema) — é o motivo do try/catch em
 * `releaseCapture` (TerminalShortcutsFab.jsx). Estes stubs NÃO lançam, porque o
 * try/catch engole a exceção e nenhum teste conseguiria observar a diferença:
 * um fake que lança seria só um modo de falha extra sem asserção possível. Um
 * teste que queira exercitar esse caminho sobrescreve o stub devolvido aqui.
 */
export function installPointerCapture() {
  const proto = Element.prototype;
  const original = {
    setPointerCapture: proto.setPointerCapture,
    releasePointerCapture: proto.releasePointerCapture,
    hasPointerCapture: proto.hasPointerCapture,
  };

  const captured = new Set();
  proto.setPointerCapture = vi.fn((pointerId) => { captured.add(pointerId); });
  proto.releasePointerCapture = vi.fn((pointerId) => { captured.delete(pointerId); });
  proto.hasPointerCapture = vi.fn((pointerId) => captured.has(pointerId));

  return {
    setPointerCapture: proto.setPointerCapture,
    releasePointerCapture: proto.releasePointerCapture,
    hasPointerCapture: proto.hasPointerCapture,
    restore() {
      for (const name of Object.keys(original)) {
        if (original[name] === undefined) delete proto[name];
        else proto[name] = original[name];
      }
    },
  };
}
