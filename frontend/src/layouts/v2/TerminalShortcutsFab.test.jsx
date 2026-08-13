// frontend/src/layouts/v2/TerminalShortcutsFab.test.jsx
//
// A Fase 1 do FAB foi commitada com ZERO teste próprio, e nenhum arrasto era
// simulado em lugar nenhum da suíte. Foi exatamente isso — e só isso — que
// deixou um bug de duas linhas chegar ao iPad: `resetGesture()` zerava dx/dy
// antes de `commitDrag()` lê-los do ref, então todo arrasto comitava delta zero
// e o botão "voltava pro canto onde estava". Este arquivo é o andaime que
// fecha essa lacuna, começando pelo bloco que prova o fix.
//
// Escopo deste arquivo nesta rodada: `TerminalShortcutsFab — drag commit`. O
// resto da máquina de gestos (toggle, abort, arming, múltiplos ponteiros, fade,
// colocação do painel, troca de sessão) é da etapa de QA e entra aqui depois,
// reusando os helpers `renderFab`/`dragFab` definidos abaixo.
//
// Números deste ambiente, todos derivados e não chutados (jsdom 29.1.1):
// innerWidth/innerHeight = 1024x768, `visualViewport` ausente, `env()` não
// resolve (insets = 0), FAB de 44px. Logo
// bounds = { minLeft: 12, maxLeft: 1024-12-44 = 968,
//            minTop:  12, maxTop:  768-12-44 = 712 }
// e a posição default (canto inferior direito) é 968px / 712px.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import {
  installFakeVisualViewport,
  installPointerCapture,
} from '../../test/fakeVisualViewport.js';
import { FAB_POSITION_STORAGE_KEY } from '../../hooks/useFabPosition.js';
import { LONG_PRESS_MS, TerminalShortcutsFab } from './TerminalShortcutsFab.jsx';

// Mockar o HOOK, nunca `matchMedia` cru: `window.matchMedia` não existe no jsdom
// deste repo e uma chamada crua derruba a suíte com TypeError. Padrão já
// estabelecido em ChatV2.test.jsx:29-31.
vi.mock('../../hooks/useIsTouchDevice.js', () => ({
  useIsTouchDevice: () => true,
}));

// Bounds e posição default deste ambiente — ver o cabeçalho do arquivo.
const DEFAULT_LEFT_PX = 968;
const DEFAULT_TOP_PX = 712;

// Ponto de partida do dedo. Qualquer valor serve: a matemática do arrasto usa
// DELTA, nunca clientX/clientY absoluto (o left/top absoluto vem do estado do
// componente). Um teste que dependesse do valor absoluto estaria testando outra
// coisa.
const POINTER_START_X = 500;
const POINTER_START_Y = 500;

function renderFab({ sessionKey = 'projA::claude' } = {}) {
  // `terminalRef` mockado com o mínimo que o painel consome. Instanciar um
  // TerminalPanel de verdade aqui traria xterm.js + WebSocket para um teste de
  // geometria de botão.
  const terminalRef = { current: { sendControlByte: vi.fn() } };
  const utils = render(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey={sessionKey} />);
  return { ...utils, terminalRef, fab: screen.getByLabelText('Show terminal shortcuts') };
}

/**
 * dragFab — a sequência canônica de um arrasto completo, do pointerdown ao
 * commit. É o helper que as próximas frentes reusam, por isso ele mora aqui e
 * não inline nos testes.
 *
 * `onDragging` roda com o gesto AINDA aberto (depois do move, antes do
 * up/cancel): é a única janela em que dá pra observar o estado intermediário.
 */
function dragFab(fab, { dx, dy, cancel = false, onDragging } = {}) {
  fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
  // O timer de long-press arma o arrasto e chama setArmed/setOpen — precisa de
  // act(). Sempre `advanceTimersByTime`, NUNCA `runAllTimers`: o segundo
  // dispararia também o timer de fade de 4s e mudaria a opacidade no meio do
  // gesto.
  act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });

  const endX = POINTER_START_X + dx;
  const endY = POINTER_START_Y + dy;
  // Um único move basta: ele promove 'armed' -> 'dragging' e já grava o delta.
  fireEvent.pointerMove(fab, { pointerId: 1, clientX: endX, clientY: endY });

  if (onDragging) onDragging();

  if (cancel) fireEvent.pointerCancel(fab, { pointerId: 1, clientX: endX, clientY: endY });
  else fireEvent.pointerUp(fab, { pointerId: 1, clientX: endX, clientY: endY });
}

function readStoredPosition() {
  const raw = localStorage.getItem(FAB_POSITION_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('TerminalShortcutsFab — drag commit', () => {
  let pointerCapture;
  let viewportHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    viewportHandle = null;
    // `localStorage` é REAL nesta suíte (Node 26 + o guard de
    // vite.config.js:26-29) e compartilhado entre testes do arquivo. Limpar
    // antes E depois, porque um teste que falhe no meio deixaria o blob para o
    // próximo e o próximo passaria/falharia pelo motivo errado.
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    if (viewportHandle) viewportHandle.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('moves the fab to the dropped position on pointerup', () => {
    const { fab } = renderFab();
    expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
    expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);

    dragFab(fab, { dx: -200, dy: -100 });

    // 968-200 = 768 e 712-100 = 612, ambos a mais de 24px (SNAP_THRESHOLD_PX)
    // de qualquer bound nos dois eixos, então nem clamp nem snap alteram nada:
    // a posição final é o delta puro aplicado à base.
    expect(fab.style.left).toBe('768px');
    expect(fab.style.top).toBe('612px');
    // O translate3d imperativo do arrasto não pode sobrar somando por cima da
    // posição nova. `scale(1)` e não `''` porque são DUAS escritas: commitDrag
    // limpa o transform imperativamente e o render seguinte (disparado pelo
    // setState de commitPosition, agora com `armed` falso) reescreve a
    // propriedade com o valor de repouso do fabStyle.
    expect(fab.style.transform).toBe('scale(1)');
    expect(fab.classList.contains('v2-fab--dragging')).toBe(false);
  });

  it('persists the dropped position as a percentage of the placeable range', () => {
    const { fab } = renderFab();

    dragFab(fab, { dx: -200, dy: -100 });

    const stored = readStoredPosition();
    expect(stored).not.toBeNull();
    expect(stored.v).toBe(1);
    // A % é fração do RANGE POSICIONÁVEL, não da viewport (é a razão de `v: 1`
    // existir no blob). x: (768-12)/(968-12) = 756/956 = 0.790795...
    //                  y: (612-12)/(712-12) = 600/700 = 0.857142...
    expect(stored.xPercent).toBeCloseTo(756 / 956, 10);
    expect(stored.yPercent).toBeCloseTo(600 / 700, 10);
  });

  it('keeps the last valid position when the gesture is cancelled mid-drag', () => {
    const { fab } = renderFab();

    dragFab(fab, { dx: -200, dy: -100, cancel: true });

    // pointercancel comita a ÚLTIMA posição válida: o botão já está visualmente
    // sob o dedo quando o sistema cancela, e saltar de volta pro canto antigo
    // seria perda de trabalho do usuário.
    expect(fab.style.left).toBe('768px');
    expect(fab.style.top).toBe('612px');
    const stored = readStoredPosition();
    expect(stored.xPercent).toBeCloseTo(756 / 956, 10);
    expect(stored.yPercent).toBeCloseTo(600 / 700, 10);
  });

  it('does not move the fab when the pointer slips past the slop before arming', () => {
    const { fab } = renderFab();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    // 20px > FAB_DRAG_SLOP_PX (10) e ANTES dos 280ms: o gesto aborta por
    // inteiro. O usuário provavelmente estava rolando e passou por cima do FAB.
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: POINTER_START_X + 20, clientY: POINTER_START_Y });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    // Um move grande DEPOIS do abort continua sem armar nada — 'aborted' é
    // terminal até o próximo pointerdown.
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: 300, clientY: 400 });

    expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
    expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);
    // Nada persistido: um gesto abortado não é sinal de intenção nenhuma.
    expect(readStoredPosition()).toBeNull();
  });

  it('does not toggle the panel after a drag', () => {
    const { fab } = renderFab();

    dragFab(fab, { dx: -200, dy: -100 });

    // Cruzar o threshold de long-press CONSOME o gesto: o pointerup que fecha o
    // arrasto não pode também alternar o painel.
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Esc')).toBeNull();
  });

  it('ignores viewport resyncs while a gesture is in progress', () => {
    // 1024x768 sem pan: bounds idênticas ao fallback de innerWidth/innerHeight,
    // então a posição default continua 968/712 e o teste isola uma variável só.
    viewportHandle = installFakeVisualViewport({ width: 1024, height: 768 });
    const { vv } = viewportHandle;
    const { fab } = renderFab();

    dragFab(fab, {
      dx: -200,
      dy: -100,
      onDragging: () => {
        // Teclado abrindo no meio do arrasto. Sem a suspensão, o resync
        // re-derivaria left/top contra as bounds novas — maxTop passaria a
        // 500-12-44 = 444 — e o React reescreveria o `top` do FAB enquanto o
        // `transform` imperativo continua sendo um delta contado a partir da
        // base ANTIGA (712, capturada no pointerdown). A posição renderizada
        // vira "base nova + delta velho": o botão salta embaixo do dedo e o
        // drop aterra onde o dedo não está. Perda de posição, não flicker.
        vv.set({ height: 500 });
        act(() => { vv.fire('resize'); });

        // ESTA é a asserção que prova a suspensão. Sem ela o teste passaria de
        // qualquer jeito, porque commitDrag usa startLeft/startTop capturados no
        // pointerdown e o resultado final coincide.
        expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
        expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);
      },
    });

    // O commit reamostra a viewport por conta própria, e nesse momento ela já
    // está encolhida: 712-100 = 612 é clampado para maxTop = 444, e 444 encosta
    // no bound, então o snap o mantém lá. O eixo X não foi afetado.
    expect(fab.style.left).toBe('768px');
    expect(fab.style.top).toBe('444px');

    // E a suspensão tem que ter sido LIBERADA no fim do gesto — um ref setado e
    // nunca limpo deixaria o FAB permanentemente surdo a rotação e teclado, o
    // que é um bug pior que o original. Com o teclado fechando, yPercent = 1
    // (o FAB ficou encostado no bound inferior) re-deriva para maxTop = 712.
    vv.set({ height: 768 });
    act(() => { vv.fire('resize'); });
    expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);
  });
});
