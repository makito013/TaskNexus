// frontend/src/hooks/useVisibleViewportShell.js
//
// Rodada 2, Frente B: encolher o casco do app para a área visível quando o
// teclado nativo do iPad abre. Pedido literal do Bruno: "não dá para o chat
// diminuir no momento q o teclado abre no tablet? assim o sistema fica do
// tamanho disponivel, tela − teclado".
//
// POR QUE ISTO NÃO É "só encolher um div":
//
// Com `html/body/#root { overflow: hidden }` (index.css) a página não rola.
// Quando o teclado sobe e a textarea do xterm precisa continuar visível, o
// Safari não tem scroll para oferecer — então ele PANEIA a layout viewport por
// baixo do teclado. O resultado é `visualViewport.offsetTop > 0`: o topo do app
// sai da tela por cima, e é por isso que o Bruno relata "preciso rolar pra cima
// pra ver os menus". Encolher qualquer nó de DENTRO da árvore não resolve nada,
// porque a árvore inteira continua ancorada num topo que foi empurrado para
// fora. A única correção é REANCORAR o casco contra a visual viewport — daí
// `position: fixed` + `left`/`top` em px no nó raiz do layout v2.
//
// Histórico do que NÃO funciona, para ninguém tentar de novo:
//  - `wrapper.style.height = vv.height` dentro do TerminalPanel: o nó tem
//    `flex: 1` (= `flex: 1 1 0%`) num container em coluna, então a *preferred
//    main size* sai da equação e o `flex-grow` reexpande. Era inerte, e a
//    escrita foi removida quando este hook nasceu (ver o comentário de
//    components/TerminalPanel.jsx no handler de visualViewport).
//  - `<meta name="viewport" content="... interactive-widget=resizes-content">`:
//    o Safari não implementa `resizes-content` (mdn/browser-compat-data#29011).
//    Pode entrar como linha gratuita; nunca como a solução.
//  - `transform: translateY(-offsetTop)` para compensar o pan: PROIBIDO. Ver a
//    proibição das 4 propriedades no comentário de layouts/v2/AppV2.jsx.
import { useEffect, useRef } from 'react';
import { getVisibleViewport } from '../utils/fabGeometry.js';

// Mesma intenção (e mesmo valor) do VIEWPORT_TOLERANCE_PX que o handler de
// visualViewport de components/TerminalPanel.jsx usa: 1-2px de diferença entre
// `innerHeight` e `vv.height` aparecem sozinhos em iOS por arredondamento de
// barra de endereço, e reagir a eles seria tremor de layout sem causa.
export const VIEWPORT_SHELL_TOLERANCE_PX = 2;

/**
 * O retângulo de REPOUSO do casco: o que ele vale quando não há teclado nenhum.
 *
 * Este objeto é a fonte única desses 4 valores e é espalhado (`...`) direto no
 * objeto de estilo inline do nó raiz do AppV2. Duas consequências, as duas
 * deliberadas:
 *
 *  1. As 4 propriedades ficam ESTÁTICAS no JSX (strings vindas de um objeto
 *     congelado no módulo). React só reescreve chaves de `style` que mudaram
 *     entre renders, então os valores que este hook escreve imperativamente
 *     SOBREVIVEM a qualquer re-render do AppV2. Se alguém tornar `top`/`height`
 *     dinâmicos no JSX, React passa a brigar com o hook e o casco oscila a cada
 *     render (risco B-R3 do plano).
 *  2. Voltar ao repouso é reescrever ESTES valores, e não `el.style.top = ''`.
 *     A diferença é crítica e não é estilística: limpar para `''` APAGA a
 *     declaração inline que o React escreveu, e o React não a reescreve (para
 *     ele nada mudou). O casco ficaria com `width/height: auto` — um container
 *     `display: flex` de altura de conteúdo, ou seja, o app colapsado depois de
 *     fechar o teclado uma vez. Foi por isso que a receita "limpar as 4
 *     propriedades" do plano virou "restaurar as 4 propriedades" aqui.
 *
 * `left`/`top` em px, e não o atalho `inset`: o `cssstyle` do jsdom não
 * implementa `inset`, então uma asserção sobre `inset` passaria com o estilo
 * inerte de fato.
 */
export const SHELL_BASE_RECT_STYLE = Object.freeze({
  left: '0px',
  top: '0px',
  width: '100%',
  height: '100%',
});

/**
 * useVisibleViewportShell — mantém o nó de `shellRef` do tamanho e na posição da
 * área REALMENTE visível, escrevendo `left`/`top`/`width`/`height` diretamente
 * no DOM.
 *
 * Não devolve nada e não tem estado React de propósito: pôr o retângulo em
 * estado do AppV2 re-renderizaria ChatV2, todos os TerminalPanel montados e o
 * FAB a cada evento da visual viewport — e o iOS emite esses eventos em rajada.
 *
 * @param {{ current: HTMLElement|null }} shellRef ref do nó raiz do layout.
 */
export function useVisibleViewportShell(shellRef) {
  // Último retângulo efetivamente escrito no DOM, ou `null` quando o casco está
  // em repouso. É o dedup que importa (ver `apply`).
  const appliedRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    // Capturado no setup para o cleanup poder devolver o nó ao repouso mesmo
    // depois de o React ter anulado o ref no unmount. `apply` continua lendo o
    // ref a cada chamada, porque é ele que pode chegar preenchido mais tarde.
    const shellAtSetup = shellRef.current;

    const writeRect = (element, rect) => {
      element.style.left = rect.left;
      element.style.top = rect.top;
      element.style.width = rect.width;
      element.style.height = rect.height;
    };

    const rest = (element) => {
      if (appliedRef.current === null) return; // já em repouso: não tocar o DOM
      appliedRef.current = null;
      writeRect(element, SHELL_BASE_RECT_STYLE);
    };

    const apply = () => {
      const element = shellRef.current;
      if (!element) return;

      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      // O critério de "encolheu" inclui `offsetTop`/`offsetLeft`, e não só a
      // altura, porque no iPad o Safari às vezes PANEIA sem encolher: a visual
      // viewport continua com a altura cheia e só é deslocada. Um critério que
      // olhasse apenas a altura não corrigiria justamente o sintoma que o Bruno
      // relatou ("preciso rolar pra cima pra ver os menus").
      const shrunk = !!vv && (
        Math.abs(window.innerHeight - vv.height) > VIEWPORT_SHELL_TOLERANCE_PX
        || Math.abs(vv.offsetTop || 0) > VIEWPORT_SHELL_TOLERANCE_PX
        || Math.abs(vv.offsetLeft || 0) > VIEWPORT_SHELL_TOLERANCE_PX
      );

      if (!shrunk) {
        rest(element);
        return;
      }

      // Uma única fonte de verdade para "qual é o retângulo visível", a MESMA
      // que o FAB de atalhos consome (utils/fabGeometry.js). Duas leituras
      // independentes de `window.visualViewport` é exatamente como o casco e o
      // FAB divergiriam por arredondamento — e a divergência apareceria só no
      // dispositivo.
      const r = getVisibleViewport();
      const next = {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      };

      // Dedup no nível do RETÂNGULO, antes de tocar o DOM. Não é micro-otimização:
      // escrever o MESMO valor já invalida layout, o que reaciona o
      // ResizeObserver do TerminalPanel, que chama fit(), que pode reemitir
      // eventos de viewport. Cortar aqui é o que transforma o ciclo
      // ResizeObserver <-> visualViewport num ponto fixo de duas iterações em vez
      // de um loop (risco B-R2 do plano).
      //
      // Não existe, e não deve existir, dedup de `cols`/`rows` em cima disto: o
      // FitAddon do @xterm já dedupica internamente
      // (`this._terminal.rows===e.rows&&this._terminal.cols===e.cols||...resize()`
      // em node_modules/@xterm/addon-fit/lib/addon-fit.js), então sem mudança
      // real de dimensão nenhum frame {type:'resize'} vai para o WS. Um dedup
      // nosso seria dead code com falsa sensação de proteção.
      const applied = appliedRef.current;
      if (
        applied
        && applied.left === next.left
        && applied.top === next.top
        && applied.width === next.width
        && applied.height === next.height
      ) {
        return;
      }

      appliedRef.current = next;
      writeRect(element, next);
    };

    // Coalescência por requestAnimationFrame, com no máximo UMA frame pendente:
    // o iOS dispara `resize` e `scroll` da visual viewport na mesma rajada, e
    // sem isto cada rajada viraria N escritas de geometria. rAF, e não um timer
    // de ~80ms: a escrita é geométrica e precisa aterrar antes do próximo paint
    // — 80ms de atraso são ~5 frames com o app deslocado, e isso é visível no
    // iPad.
    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        apply();
      });
    };

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      // `scroll` além de `resize` porque é o `scroll` que detecta o PAN — em
      // algumas versões do iOS o teclado abrindo é reportado como a visual
      // viewport sendo deslocada, não redimensionada. Mesma razão pela qual
      // hooks/useFabPosition.js e components/TerminalPanel.jsx escutam os dois.
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);

    // Síncrono, não agendado: se o componente monta com o teclado JÁ aberto
    // (recarregar a página com o foco no terminal), o casco tem que nascer no
    // tamanho certo em vez de aparecer errado por uma frame.
    apply();

    return () => {
      if (vv) {
        vv.removeEventListener('resize', schedule);
        vv.removeEventListener('scroll', schedule);
      }
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      // Um casco desmontado não pode deixar a geometria do teclado congelada no
      // DOM: se o mesmo nó for reaproveitado, ele voltaria a aparecer com a
      // altura de quando o teclado estava aberto.
      if (shellAtSetup) rest(shellAtSetup);
    };
    // `shellRef` é a única dependência externa e é um ref estável (a identidade
    // do objeto nunca muda), então o efeito roda uma vez por montagem — que é o
    // que se quer: reinscrever 4 listeners a cada render seria trabalho por
    // frame de rajada, sem nenhum ganho.
  }, [shellRef]);
}
