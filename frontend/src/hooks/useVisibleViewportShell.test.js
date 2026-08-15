// frontend/src/hooks/useVisibleViewportShell.test.js
//
// Rodada 2, Frente B. O que este arquivo pode e o que NÃO pode provar:
//
// PODE — que o hook lê a visual viewport certa, converte o retângulo nos 4
// valores inline certos, reage a `resize` E a `scroll`, coalesce rajadas numa
// escrita só, não toca o DOM quando o retângulo não mudou, volta ao repouso
// dentro da tolerância e desinscreve tudo no unmount.
//
// NÃO PODE — que o app de fato encolha. jsdom não tem engine de layout: o máximo
// asseverável é o valor inline que nós mesmos escrevemos. Que a topbar de 62px
// fique visível acima do teclado, que o Safari paneie/despaneie, e que
// `cols`/`rows` do PTY mudem em consequência: só em dispositivo (o gate manual
// exige a TUI do `claude` viva — risco B-R5 do plano).
//
// Escolha de andaime para o rAF: STUB COM FILA, não `vi.useFakeTimers()`. O rAF
// do jsdom existe mas é assíncrono, e o teste de coalescência precisa observar
// "5 eventos ⇒ 1 callback agendado", ou seja, inspecionar a fila ENTRE o
// agendamento e a execução. Com fake timers o rAF vira um macrotask e a
// contagem só seria observável indiretamente, pelo efeito colateral.
//
// O ref passado ao hook é um objeto `{ current }` cru, e não um ref vindo de um
// componente: o contrato do hook é exatamente esse objeto, e um nó de DOM criado
// à mão deixa o setup do teste legível sem JSX (nenhum outro *.test.js de
// hooks/ tem JSX — o padrão do repo é renderHook, ver useSidebarCollapsed.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { installFakeVisualViewport } from '../test/fakeVisualViewport.js';
import { useVisibleViewportShell, SHELL_BASE_RECT_STYLE } from './useVisibleViewportShell.js';

describe('useVisibleViewportShell', () => {
  let restoreViewport;
  let vv;
  let shell;
  let shellRef;
  let originalInnerHeight;
  let originalRaf;
  let originalCancelRaf;
  let frames;
  let nextFrameId;

  const installRafQueue = () => {
    frames = [];
    nextFrameId = 1;
    const raf = (cb) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.push({ id, cb });
      return id;
    };
    const cancel = (id) => {
      frames = frames.filter((frame) => frame.id !== id);
    };
    // Os dois alvos de propósito: o Vitest copia os globais do jsdom para o
    // `globalThis`, então `window.requestAnimationFrame` e o
    // `requestAnimationFrame` bare que o hook chama podem ser referências
    // diferentes. Trocar só um deixaria o stub inerte, sem nenhum sintoma.
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = cancel;
    global.requestAnimationFrame = raf;
    global.cancelAnimationFrame = cancel;
  };

  const flushFrames = () => {
    const pending = frames;
    frames = [];
    act(() => {
      for (const frame of pending) frame.cb();
    });
  };

  const mountShell = () => renderHook(() => useVisibleViewportShell(shellRef));

  const rectOf = (el) => ({
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  });

  /**
   * Substitui as 4 propriedades por acessores próprios no objeto de estilo, para
   * CONTAR escritas. É o único jeito síncrono e determinístico de asseverar "não
   * tocou o DOM": reescrever o mesmo valor não muda nada observável no estilo,
   * mas é exatamente o que invalida layout e reaciona o ResizeObserver do
   * TerminalPanel — o loop realimentado que o dedup de retângulo existe para
   * cortar.
   */
  const spyOnStyleWrites = (el) => {
    const writes = [];
    for (const prop of ['left', 'top', 'width', 'height']) {
      let value = el.style[prop];
      Object.defineProperty(el.style, prop, {
        configurable: true,
        get: () => value,
        set: (next) => {
          writes.push([prop, next]);
          value = next;
        },
      });
    }
    return writes;
  };

  beforeEach(() => {
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    installRafQueue();

    // O nó nasce com o retângulo de repouso escrito, que é o estado em que o
    // React entrega o nó raiz do AppV2 (o objeto de estilo inline espalha
    // SHELL_BASE_RECT_STYLE). Sem isto, "voltar ao repouso" não teria o que
    // comparar.
    shell = document.createElement('div');
    Object.assign(shell.style, SHELL_BASE_RECT_STYLE);
    shell.style.position = 'fixed';
    document.body.appendChild(shell);
    shellRef = { current: shell };
  });

  afterEach(() => {
    cleanup();
    shell.remove();
    if (restoreViewport) restoreViewport();
    restoreViewport = undefined;
    vv = undefined;
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      configurable: true,
    });
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
    vi.restoreAllMocks();
  });

  const installViewport = (init) => {
    const installed = installFakeVisualViewport(init);
    vv = installed.vv;
    restoreViewport = installed.restore;
    return installed.vv;
  };

  it('writes the visible viewport rect onto the shell when the keyboard shrinks the viewport', () => {
    installViewport({ width: 1024, height: 800 });
    mountShell();

    vv.set({ height: 500 }); // teclado de tela cobre ~300px
    act(() => {
      vv.fire('resize');
    });
    flushFrames();

    expect(rectOf(shell)).toEqual({
      left: '0px',
      top: '0px',
      width: '1024px',
      height: '500px',
    });
  });

  it('re-anchors the shell against a panned visual viewport', () => {
    // O caso que nenhum teste cobria antes desta rodada, e que é a causa do
    // "preciso rolar pra cima pra ver os menus": com `overflow: hidden` na
    // página o Safari não tem scroll a oferecer, então PANEIA a layout viewport
    // para manter a textarea visível. A altura da visual viewport pode até
    // continuar cheia — o que muda é `offsetTop`, e é ele que joga a topbar de
    // 62px para fora da tela por cima. Um critério de encolhimento que olhasse
    // só a altura deixaria este caso sem correção.
    installViewport({ width: 1024, height: 800, offsetTop: 120 });
    mountShell();

    act(() => {
      vv.fire('scroll'); // é o `scroll`, não o `resize`, que reporta o pan
    });
    flushFrames();

    expect(rectOf(shell)).toEqual({
      left: '0px',
      top: '120px',
      width: '1024px',
      height: '800px',
    });
  });

  it('re-anchors the shell against a horizontally panned visual viewport', () => {
    installViewport({ width: 1024, height: 800, offsetLeft: 40 });
    mountShell();

    act(() => {
      vv.fire('scroll');
    });
    flushFrames();

    expect(shell.style.left).toBe('40px');
  });

  it('restores the baseline rect once the viewport is back within tolerance', () => {
    installViewport({ width: 1024, height: 500 });
    mountShell();
    expect(shell.style.height).toBe('500px');

    vv.set({ height: 800 }); // teclado fechado
    act(() => {
      vv.fire('resize');
    });
    flushFrames();

    // Restaurar os valores do repouso, e NÃO limpar para '': limpar apagaria a
    // declaração inline que o React escreveu, o React não a reescreveria (para
    // ele nada mudou entre renders) e o casco ficaria com `width/height: auto` —
    // um container `display: flex` com a altura do conteúdo, ou seja o app
    // colapsado depois de abrir e fechar o teclado uma vez.
    expect(rectOf(shell)).toEqual({ ...SHELL_BASE_RECT_STYLE });
    expect(shell.style.height).not.toBe('');
  });

  it('ignores a height delta within the tolerance', () => {
    installViewport({ width: 1024, height: 800 });
    mountShell();
    const writes = spyOnStyleWrites(shell);

    vv.set({ height: 799 }); // 1px, abaixo dos 2px de tolerância
    act(() => {
      vv.fire('resize');
    });
    flushFrames();

    expect(writes).toEqual([]);
    expect(shell.style.height).toBe(SHELL_BASE_RECT_STYLE.height);
  });

  it('coalesces a burst of viewport events into a single write', () => {
    installViewport({ width: 1024, height: 800 });
    mountShell();

    vv.set({ height: 500 });
    act(() => {
      vv.fire('resize');
      vv.fire('scroll');
      vv.fire('resize');
      vv.fire('scroll');
      vv.fire('resize');
    });

    // 5 eventos, 1 frame agendada: é isso que impede que uma rajada do iOS vire
    // 5 escritas de geometria (e 5 invalidações de layout) no mesmo tick.
    expect(frames).toHaveLength(1);

    flushFrames();
    expect(shell.style.height).toBe('500px');
  });

  it('does not touch the dom when the rect is unchanged', () => {
    installViewport({ width: 1024, height: 800 });
    mountShell();

    vv.set({ height: 500 });
    act(() => {
      vv.fire('resize');
    });
    flushFrames();

    const writes = spyOnStyleWrites(shell);
    act(() => {
      vv.fire('resize'); // mesmo retângulo
    });
    flushFrames();

    expect(writes).toEqual([]);
  });

  it('applies the rect on mount when the keyboard is already open', () => {
    // Recarregar a página com o foco no terminal: o casco tem que nascer no
    // tamanho certo, não aparecer errado por uma frame.
    installViewport({ width: 1024, height: 500, offsetTop: 60 });
    mountShell();

    // Sem nenhum evento e sem flush: a chamada do mount é síncrona de propósito.
    expect(frames).toHaveLength(0);
    expect(rectOf(shell)).toEqual({
      left: '0px',
      top: '60px',
      width: '1024px',
      height: '500px',
    });
  });

  it('removes its listeners and restores the baseline rect on unmount', () => {
    installViewport({ width: 1024, height: 500 });
    const view = mountShell();
    expect(shell.style.height).toBe('500px');
    expect(vv.listenerCount('resize')).toBe(1);
    expect(vv.listenerCount('scroll')).toBe(1);

    view.unmount();

    expect(vv.listenerCount('resize')).toBe(0);
    expect(vv.listenerCount('scroll')).toBe(0);
    // Um casco desmontado não pode deixar a geometria do teclado congelada no
    // nó: se ele for reaproveitado, reapareceria com a altura de quando o
    // teclado estava aberto.
    expect(rectOf(shell)).toEqual({ ...SHELL_BASE_RECT_STYLE });
  });

  it('cancels a pending frame on unmount', () => {
    installViewport({ width: 1024, height: 800 });
    const view = mountShell();

    vv.set({ height: 500 });
    act(() => {
      vv.fire('resize');
    });
    expect(frames).toHaveLength(1);

    view.unmount();

    expect(frames).toHaveLength(0);
  });

  it('does nothing when visualViewport is unavailable', () => {
    // jsdom não implementa a API, então este é o estado natural do ambiente — e
    // é também o de um browser antigo.
    expect(window.visualViewport).toBeUndefined();

    expect(() => {
      mountShell();
    }).not.toThrow();

    // Repouso intacto: nenhum px escrito e, sobretudo, nada apagado.
    expect(rectOf(shell)).toEqual({ ...SHELL_BASE_RECT_STYLE });
  });
});
