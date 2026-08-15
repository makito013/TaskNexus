// frontend/src/layouts/v2/TerminalShortcutsFab.test.jsx
//
// A Fase 1 do FAB foi commitada com ZERO teste próprio, e nenhum arrasto era
// simulado em lugar nenhum da suíte. Foi exatamente isso — e só isso — que
// deixou um bug de duas linhas chegar ao iPad: `resetGesture()` zerava dx/dy
// antes de `commitDrag()` lê-los do ref, então todo arrasto comitava delta zero
// e o botão "voltava pro canto onde estava". Este arquivo é o andaime que
// fecha essa lacuna, começando pelo bloco que prova o fix.
//
// Escopo por autoria: os describes `drag commit`, `size` e `keyboard suppression
// indicator` são do Dev (provam os fixes das Frentes A, D e C); os describes
// `concurrent pointers`, `idle fade`, `session switch` e `panel placement` foram
// acrescentados pela etapa de QA, reusando os helpers `renderFab`/`dragFab`
// definidos abaixo.
//
// Números deste ambiente, todos derivados e não chutados (jsdom 29.1.1):
// innerWidth/innerHeight = 1024x768, `visualViewport` ausente, `env()` não
// resolve (insets = 0).
//
// TAMANHO DO FAB NESTE ARQUIVO: 56px. O critério de tablet é
// `useMediaQuery(MOBILE_VIEWPORT_QUERY)`, o jsdom deste repo não implementa
// `window.matchMedia`, e o guard de useMediaQuery.js devolve `false` nesse caso
// -> `isMobile === false` -> FAB grande. Isto NÃO é bug nem descuido: é o mesmo
// motivo pelo qual o FAB fica com 44px em AppV2.test.jsx (que instala um
// matchMedia respondendo `true` a qualquer query). O describe de tamanho no fim
// deste arquivo instala um matchMedia controlável para fixar os dois casos.
// Logo, para os testes de arrasto abaixo:
// bounds = { minLeft: 12, maxLeft: 1024-12-56 = 956,
//            minTop:  12, maxTop:  768-12-56 = 700 }
// e a posição default (canto inferior direito) é 956px / 700px.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import {
  installFakeVisualViewport,
  installPointerCapture,
} from '../../test/fakeVisualViewport.js';
import { FAB_POSITION_STORAGE_KEY } from '../../hooks/useFabPosition.js';
import { KEYBOARD_SUPPRESSED_STORAGE_KEY } from '../../hooks/useKeyboardSuppressed.js';
import {
  FAB_IDLE_FADE_MS,
  FAB_OPACITY_ACTIVE,
  FAB_OPACITY_FADED,
  FAB_OPACITY_IDLE,
  LONG_PRESS_MS,
  SUPPRESSED_DOT_SIZE_PX,
  TerminalShortcutsFab,
} from './TerminalShortcutsFab.jsx';

// Mockar o HOOK, nunca `matchMedia` cru: `window.matchMedia` não existe no jsdom
// deste repo e uma chamada crua derruba a suíte com TypeError. Padrão já
// estabelecido em ChatV2.test.jsx:29-31.
//
// O valor vive num objeto de `vi.hoisted` em vez de ser o literal `true` porque o
// hard gate `if (!isTouch) return null` só é alcançável com `false`, e a chamada
// de `vi.mock` é içada para o topo do módulo — uma variável `let` comum estaria em
// TDZ quando a factory roda. Default `true`: todo describe que não mexer nisto vê
// exatamente o comportamento de antes.
const touchEnv = vi.hoisted(() => ({ isTouch: true }));
vi.mock('../../hooks/useIsTouchDevice.js', () => ({
  useIsTouchDevice: () => touchEnv.isTouch,
}));

// Bounds e posição default deste ambiente — ver o cabeçalho do arquivo.
const DEFAULT_LEFT_PX = 956;
const DEFAULT_TOP_PX = 700;

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

/**
 * tapFab — o ÚNICO gesto que alterna o painel: desce e sobe antes dos 280ms, sem
 * escorregar. Deliberadamente sem `advanceTimersByTime`: avançar qualquer tempo
 * entre o down e o up armaria o arrasto e o gesto deixaria de ser um tap.
 *
 * `pointerId` é parâmetro porque um dos testes de ponteiros concorrentes precisa
 * tocar com um id DIFERENTE do que acabou de arrastar.
 */
function tapFab(fab, { pointerId = 1 } = {}) {
  fireEvent.pointerDown(fab, { pointerId, clientX: POINTER_START_X, clientY: POINTER_START_Y });
  fireEvent.pointerUp(fab, { pointerId, clientX: POINTER_START_X, clientY: POINTER_START_Y });
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

    // 956-200 = 756 e 700-100 = 600, ambos a mais de 24px (SNAP_THRESHOLD_PX)
    // de qualquer bound nos dois eixos, então nem clamp nem snap alteram nada:
    // a posição final é o delta puro aplicado à base.
    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('600px');
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
    // existir no blob). x: (756-12)/(956-12) = 744/944 = 0.788135...
    //                  y: (600-12)/(700-12) = 588/688 = 0.854651...
    expect(stored.xPercent).toBeCloseTo(744 / 944, 10);
    expect(stored.yPercent).toBeCloseTo(588 / 688, 10);
  });

  it('keeps the last valid position when the gesture is cancelled mid-drag', () => {
    const { fab } = renderFab();

    dragFab(fab, { dx: -200, dy: -100, cancel: true });

    // pointercancel comita a ÚLTIMA posição válida: o botão já está visualmente
    // sob o dedo quando o sistema cancela, e saltar de volta pro canto antigo
    // seria perda de trabalho do usuário.
    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('600px');
    const stored = readStoredPosition();
    expect(stored.xPercent).toBeCloseTo(744 / 944, 10);
    expect(stored.yPercent).toBeCloseTo(588 / 688, 10);
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
    // então a posição default continua 956/700 e o teste isola uma variável só.
    viewportHandle = installFakeVisualViewport({ width: 1024, height: 768 });
    const { vv } = viewportHandle;
    const { fab } = renderFab();

    dragFab(fab, {
      dx: -200,
      dy: -100,
      onDragging: () => {
        // Teclado abrindo no meio do arrasto. Sem a suspensão, o resync
        // re-derivaria left/top contra as bounds novas — maxTop passaria a
        // 500-12-56 = 432 — e o React reescreveria o `top` do FAB enquanto o
        // `transform` imperativo continua sendo um delta contado a partir da
        // base ANTIGA (700, capturada no pointerdown). A posição renderizada
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
    // está encolhida: 700-100 = 600 é clampado para maxTop = 432, e 432 encosta
    // no bound, então o snap o mantém lá. O eixo X não foi afetado.
    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('432px');

    // E a suspensão tem que ter sido LIBERADA no fim do gesto — um ref setado e
    // nunca limpo deixaria o FAB permanentemente surdo a rotação e teclado, o
    // que é um bug pior que o original. Com o teclado fechando, yPercent = 1
    // (o FAB ficou encostado no bound inferior) re-deriva para maxTop = 700.
    vv.set({ height: 768 });
    act(() => { vv.fire('resize'); });
    expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);
  });
});

/**
 * makeMatchMedia — MediaQueryList controlável, mesmo shape do fabricante de
 * hooks/useMediaQuery.test.js e AppV2.test.jsx. Responde o MESMO `matches` a
 * qualquer query, que é suficiente aqui porque o componente consulta uma query
 * só (MOBILE_VIEWPORT_QUERY).
 *
 * Instalado e restaurado APENAS dentro dos describes abaixo, nunca no topo do
 * arquivo: o describe de arrasto acima depende da AUSÊNCIA de `window.matchMedia`
 * (é o que o torna um teste de FAB de 56px — ver o cabeçalho).
 */
function makeMatchMedia(matches) {
  const mql = {
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return vi.fn(() => mql);
}

// Frente D. São DOIS pontos acoplados: o tamanho RENDERIZADO (fabStyle) e o
// tamanho que alimenta os BOUNDS (useFabPosition({ size })). Mexer em um só não
// gera erro nenhum — só um FAB que para 12px antes da borda, ou um que encosta
// 12px além dela. Por isso cada tamanho tem um teste de render E um de bound.
describe('TerminalShortcutsFab — size', () => {
  let originalMatchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMatchMedia = window.matchMedia;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // `delete` e não `= undefined`: o guard de useMediaQuery.js testa
    // `typeof window.matchMedia !== 'function'`, e deixar a propriedade
    // definida-como-undefined é indistinguível para ele, mas não para um
    // `'matchMedia' in window` de um teste futuro.
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    else delete window.matchMedia;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('renders a 56px fab when the viewport is wider than the mobile breakpoint', () => {
    window.matchMedia = makeMatchMedia(false); // não é mobile -> tablet/desktop
    const { fab } = renderFab();

    expect(fab.style.width).toBe('56px');
    expect(fab.style.height).toBe('56px');
    // O glifo cresce com o botão: `⌨️` a 18px dentro de um círculo de 56px fica
    // visivelmente perdido.
    expect(fab.style.fontSize).toBe('22px');
  });

  it('renders a 44px fab on a mobile-width viewport', () => {
    window.matchMedia = makeMatchMedia(true); // (max-width: 640px) casa
    const { fab } = renderFab();

    expect(fab.style.width).toBe('44px');
    expect(fab.style.height).toBe('44px');
    expect(fab.style.fontSize).toBe('18px');
  });

  it('derives the drag bounds from the rendered size (a 56px fab rests at maxLeft 956)', () => {
    window.matchMedia = makeMatchMedia(false);
    const { fab } = renderFab();

    // maxLeft = 1024 - 12 - 56 = 956, maxTop = 768 - 12 - 56 = 700. Se `size`
    // chegasse ao fabStyle mas não ao useFabPosition, o default seria 968/712
    // (bounds calculados com 44) e o FAB pararia 12px antes da borda. É ESTE
    // teste que pega "mexeram no render e esqueceram o hook".
    expect(fab.style.left).toBe('956px');
    expect(fab.style.top).toBe('700px');
  });

  it('derives the drag bounds from the rendered size (a 44px fab rests at maxLeft 968)', () => {
    window.matchMedia = makeMatchMedia(true);
    const { fab } = renderFab();

    // O par do teste acima, na outra direção: prova que o acoplamento
    // render<->bounds vale nos dois tamanhos, e não que um número foi fixado.
    expect(fab.style.left).toBe('968px');
    expect(fab.style.top).toBe('712px');
  });
});

// C-T5. O modo "esconder teclado" persiste entre reloads e só é visível DENTRO
// do painel; com o painel fechado seria um estado silencioso que impede o
// usuário de digitar. O ponto é a única superfície que o expõe.
describe('TerminalShortcutsFab — keyboard suppression indicator', () => {
  const DOT_LABEL = 'Teclado suprimido';

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  it('shows an 8px indicator dot on the closed fab while suppression is on', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    renderFab();

    const dot = screen.getByLabelText(DOT_LABEL);
    expect(dot.style.width).toBe(`${SUPPRESSED_DOT_SIZE_PX}px`);
    expect(dot.style.height).toBe(`${SUPPRESSED_DOT_SIZE_PX}px`);
    // Sem isto o ponto entra como alvo de pointerdown/pointerup e um tap que
    // caísse nele deixaria de alternar o painel.
    expect(dot.style.pointerEvents).toBe('none');
  });

  it('shows no indicator dot when suppression is off', () => {
    renderFab(); // nada em localStorage -> default false

    expect(screen.queryByLabelText(DOT_LABEL)).toBeNull();
  });

  it('hides the indicator dot while the panel is open (the toggle itself carries the state there)', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const { fab } = renderFab();

    // Tap: down + up antes dos 280ms e sem mover. O único gesto que alterna.
    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });

    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByLabelText(DOT_LABEL)).toBeNull();
    // E o toggle do painel está lá, marcado, para provar que o estado não
    // desapareceu — só mudou de superfície.
    expect(screen.getByLabelText('Esconder teclado').getAttribute('aria-pressed')).toBe('true');
  });
});

// Ramos da máquina de gestos que nenhum teste alcançava: a fase 'armed' que
// termina sem movimento, o fechamento do painel no instante em que o arrasto arma,
// e o caminho de ativação por teclado/VoiceOver — que é o único jeito de operar o
// FAB sem ponteiro e estava 100% descoberto.
describe('TerminalShortcutsFab — gesture machine edges', () => {
  let pointerCapture;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('does nothing when the fab is held past the threshold and released without moving', () => {
    // Cruzar os 280ms CONSOME o gesto. Sem isso, "segurei pra mover e desisti"
    // alternaria o painel na soltura — e o painel de 204px abriria em cima do
    // menu numerado da TUI, que é exatamente o que a feature existe para evitar.
    // Também não pode comitar posição: o dedo nunca se moveu, e uma escrita no
    // localStorage aqui gravaria a posição atual como se fosse escolha do usuário.
    const { fab } = renderFab();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });

    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
    expect(fab.style.top).toBe(`${DEFAULT_TOP_PX}px`);
    expect(readStoredPosition()).toBeNull();
    // E o estado visual de "armado" foi desfeito: o scale volta a 1 e a classe de
    // arrasto nunca entrou (o FAB não chegou à fase 'dragging').
    expect(fab.style.transform).toBe('scale(1)');
    expect(fab.classList.contains('v2-fab--dragging')).toBe(false);
  });

  it('closes an open panel the moment a drag arms', () => {
    // Um painel de 204px seguindo o dedo (ou ficando parado enquanto o botão
    // anda) é ruído puro, e pior: os botões continuariam tocáveis debaixo do
    // arrasto.
    const { fab } = renderFab();
    tapFab(fab);
    expect(screen.getByLabelText('Ctrl+C')).toBeTruthy();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });

    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Ctrl+C')).toBeNull();
    // Armado: o FAB cresce 12% para dar retorno de que o gesto pegou.
    expect(fab.style.transform).toBe('scale(1.12)');
  });

  it('toggles the panel on an activation click that came from no pointer at all', () => {
    // O caminho de acessibilidade, e ele estava inteiramente sem teste. Como o
    // componente chama preventDefault() em TODO pointerup, nenhum `click` nasce de
    // toque — então um click que chegue veio de teclado físico (Enter/Espaço num
    // <button>) ou do gesto de ativação do VoiceOver, que dispara `click` sem
    // pointerdown/pointerup. Sem este handler o FAB é LITERALMENTE inoperável sob
    // VoiceOver, com aria-expanded/aria-label/aria-controls todos corretos: ARIA
    // sem ativação é fachada, e é o tipo de quebra que nenhuma revisão visual pega.
    const { fab } = renderFab();

    fireEvent.click(fab); // detail 0 — o default de um click não sintetizado por ponteiro
    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Ctrl+C')).toBeTruthy();

    fireEvent.click(fab);
    expect(fab.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores a click that a pointer synthesised, so a tap never toggles twice', () => {
    // `e.detail !== 0` é o que distingue os dois casos. Se o guard caísse, um
    // browser que ainda sintetizasse `click` depois do nosso pointerup faria o
    // painel abrir e fechar no mesmo toque — um FAB que "não responde", com o
    // sintoma dependendo de qual browser.
    const { fab } = renderFab();

    fireEvent.click(fab, { detail: 1 });

    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Ctrl+C')).toBeNull();
  });
});

// O Bruno usa o iPad com as duas mãos. Dois dedos na tela ao mesmo tempo não é
// caso exótico: é o que acontece quando ele apoia a palma, quando rola a saída do
// terminal com uma mão e arrasta o FAB com a outra, ou quando o iOS entrega um
// `pointercancel` de um dedo enquanto o outro continua vivo. Toda a máquina de
// gestos depende de UM ref único (`gestureRef`), então cada handler tem um guard
// de `pointerId` — e um guard sem teste é um guard que o próximo refactor remove
// por parecer redundante.
describe('TerminalShortcutsFab — concurrent pointers', () => {
  let pointerCapture;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('ignores a second pointer that arrives while a gesture is in progress', () => {
    const { fab } = renderFab();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(fab.style.transform).toBe('scale(1.12)'); // armado, ainda sem delta

    // Segundo dedo. O pointerdown é descartado pelo guard `g.pointerId !== null`,
    // e o move/up seguintes pelo guard `g.pointerId !== e.pointerId`. Sem o
    // primeiro guard, startX/startY seriam sobrescritos por (100, 100) e o
    // arrasto passaria a seguir o dedo errado, com um salto de 400px.
    fireEvent.pointerDown(fab, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(fab, { pointerId: 2, clientX: 900, clientY: 900 });
    expect(fab.style.transform).toBe('scale(1.12)'); // nenhum translate3d nasceu

    fireEvent.pointerUp(fab, { pointerId: 2, clientX: 900, clientY: 900 });
    // Um up de ponteiro não rastreado não pode alternar o painel nem comitar
    // posição: o gesto do dedo 1 ainda está aberto.
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
    expect(readStoredPosition()).toBeNull();

    // E o dedo 1 continua no controle, do começo ao fim.
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: 300, clientY: 400 });
    expect(fab.style.transform).toBe('translate3d(-200px, -100px, 0) scale(1.12)');
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: 300, clientY: 400 });
    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('600px');
  });

  it('keeps the tracked gesture alive when a different pointer is cancelled', () => {
    // Cenário real: dois dedos na tela, o iOS reivindica um deles como rolagem e
    // emite `pointercancel` para AQUELE id. O gesto rastreado não pode morrer
    // junto, e sobretudo não pode comitar no meio do caminho — se comitasse aqui,
    // o resto do arrasto do dedo 1 seria contado a partir de uma base já
    // reescrita.
    const { fab } = renderFab();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: 400, clientY: 450 });

    fireEvent.pointerCancel(fab, { pointerId: 2, clientX: 900, clientY: 900 });

    expect(readStoredPosition()).toBeNull();
    expect(fab.style.left).toBe(`${DEFAULT_LEFT_PX}px`);
    expect(fab.classList.contains('v2-fab--dragging')).toBe(true);

    // O dedo 1 termina o gesto normalmente: dx=-100, dy=-50 -> 856 / 650.
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: 400, clientY: 450 });
    expect(fab.style.left).toBe('856px');
    expect(fab.style.top).toBe('650px');
  });

  it('accepts a fresh pointer id once the previous gesture has finished', () => {
    // O par obrigatório dos dois testes acima. Um guard que barrasse ponteiros
    // novos e um `resetGesture` que não limpasse `pointerId` produziriam
    // exatamente o mesmo verde nos testes anteriores — e um FAB permanentemente
    // morto depois do primeiro arrasto, que é um bug muito pior que seguir o dedo
    // errado. O toque abaixo usa o id 2 de propósito: se o componente guardasse o
    // id em vez de zerá-lo, este tap seria descartado.
    const { fab } = renderFab();

    dragFab(fab, { dx: -200, dy: -100 }); // consome o gesto do pointerId 1
    expect(fab.getAttribute('aria-expanded')).toBe('false');

    tapFab(fab, { pointerId: 2 });

    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Ctrl+C')).toBeTruthy();
  });
});

// O FAB desbota depois de 4s de inatividade para não competir visualmente com a
// saída do terminal, mas NUNCA desaparece (piso de 0.35): um controle invisível é
// um controle que o usuário não encontra mais. Este describe é também a razão de a
// disciplina do arquivo ser `advanceTimersByTime` e nunca `runAllTimers` — os dois
// timers do componente (280ms de long-press, 4000ms de fade) convivem, e
// `runAllTimers` dispara o fade no meio de um gesto.
describe('TerminalShortcutsFab — idle fade', () => {
  let pointerCapture;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('fades to the floor opacity after four idle seconds, and not a millisecond before', () => {
    const { fab } = renderFab();
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS - 1); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    act(() => { vi.advanceTimersByTime(1); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_FADED));
    // O piso não é zero e não é `display: none`. Se alguém "melhorar" o fade
    // levando-o a 0, o FAB fica inalcançável exatamente para quem depende dele.
    expect(FAB_OPACITY_FADED).toBeGreaterThan(0);
  });

  it('never fades while the panel is open, and restarts the countdown when it closes', () => {
    const { fab } = renderFab();

    tapFab(fab);
    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_ACTIVE));

    // Três ciclos inteiros de fade com o painel aberto: o efeito retorna cedo
    // quando `open`, então nem timer existe para disparar.
    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS * 3); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_ACTIVE));

    tapFab(fab); // fecha
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_FADED));
  });

  it('restarts the idle countdown on every touch', () => {
    const { fab } = renderFab();

    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS - 100); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    // Um toque que NÃO alterna o painel: down + cancel. Serve para isolar o
    // reinício do timer da mudança de `open`, que reiniciaria o efeito por outro
    // caminho (a dep `open`) e tornaria o teste incapaz de distinguir os dois. O
    // cancel também limpa o timer de long-press, então o avanço seguinte não arma
    // nada.
    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    fireEvent.pointerCancel(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });

    // 3900 + 3900 = 7800ms de vida total. Sem o reinício (a dep
    // `interactionNonce`) o FAB já estaria desbotado aqui.
    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS - 100); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    act(() => { vi.advanceTimersByTime(100); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_FADED));
  });

  it('does not arrive already faded when the panel is closed by something other than a touch', () => {
    // ESTE teste existe porque o anterior NÃO guardava o early return
    // `if (open) return undefined` do efeito de fade — descobri isso quebrando o
    // código de propósito e vendo o teste continuar verde. Motivo: com o painel
    // aberto a opacidade é `FAB_OPACITY_ACTIVE` por curto-circuito
    // (`open || armed`), então o timer podendo correr por baixo é invisível; e
    // quando o painel é fechado por um TOQUE, o `setFaded(false)` do pointerdown
    // apaga o rastro antes de qualquer render.
    //
    // O caminho em que a diferença aparece é o fechamento SEM toque no FAB: troca
    // de sessão (aqui), ou o arming do arrasto chamando setOpen(false). Sem o
    // early return, o timer correu enquanto o painel estava aberto, `faded` já é
    // true, e o FAB reaparece a 35% de opacidade logo depois de o Bruno trocar de
    // aba — sem nenhum período de inatividade que justifique isso.
    const { fab, rerender, terminalRef } = renderFab({ sessionKey: 'projA::claude' });
    tapFab(fab);
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_ACTIVE));

    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS * 2); });
    rerender(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projB::claude" />);

    expect(fab.getAttribute('aria-expanded')).toBe('false');
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));
  });

  it('comes back to full opacity when a drag arms on a faded fab', () => {
    // O caso frequente de verdade: o FAB está desbotado (foi isso que a demanda
    // pediu) e o Bruno o segura para movê-lo. Se a opacidade não subisse, ele
    // arrastaria um botão a 35% e não teria retorno visual de que o gesto pegou.
    const { fab } = renderFab();
    act(() => { vi.advanceTimersByTime(FAB_IDLE_FADE_MS); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_FADED));

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: POINTER_START_X, clientY: POINTER_START_Y });
    // O pointerdown por si só já limpa o `faded`, então a opacidade sobe para o
    // repouso antes de o arrasto armar.
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_IDLE));

    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(fab.style.opacity).toBe(String(FAB_OPACITY_ACTIVE));
  });
});

// Trocar de sessão com o painel aberto é o cenário destrutivo desta feature: os
// 8 botões escrevem em `terminalRef.current`, que passou a apontar para OUTRO
// PTY. Deixar o painel aberto convida a mandar um `^C` na sessão errada
// acreditando que é a antiga — irreversível e silencioso.
describe('TerminalShortcutsFab — session switch', () => {
  let pointerCapture;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('closes an open panel when the active session changes', () => {
    const { fab, rerender, terminalRef } = renderFab({ sessionKey: 'projA::claude' });
    tapFab(fab);
    expect(screen.getByLabelText('Ctrl+C')).toBeTruthy();

    rerender(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projB::claude" />);

    expect(fab.getAttribute('aria-expanded')).toBe('false');
    // O painel tem que sair do DOM, não só perder o aria: um `^C` só é
    // impossível de mandar por acidente se o botão não existe.
    expect(screen.queryByLabelText('Ctrl+C')).toBeNull();
    expect(fab.getAttribute('aria-controls')).toBeNull();
  });

  it('keeps the panel open across a re-render with the same session key', () => {
    // Guarda do array de dependências. `useEffect(() => setOpen(false))` SEM
    // deps fecharia o painel a cada render — inclusive no render disparado pelo
    // próprio tap que o abriu, e inclusive a cada evento da visual viewport
    // (o resync do useFabPosition re-renderiza este componente). O painel
    // simplesmente não abriria mais, e o sintoma não apontaria para cá.
    const { fab, rerender, terminalRef } = renderFab({ sessionKey: 'projA::claude' });
    tapFab(fab);

    rerender(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projA::claude" />);

    expect(fab.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Ctrl+C')).toBeTruthy();
  });

  it('keeps the persisted position when the session changes', () => {
    // A posição do FAB é preferência de DISPOSITIVO, não de sessão. Se o efeito
    // de troca de sessão algum dia crescer para "resetar o FAB", o Bruno perderia
    // a posição escolhida a cada troca de aba.
    const { fab, rerender, terminalRef } = renderFab({ sessionKey: 'projA::claude' });
    dragFab(fab, { dx: -200, dy: -100 });

    rerender(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projB::claude" />);

    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('600px');
    expect(readStoredPosition().xPercent).toBeCloseTo(744 / 944, 10);
  });
});

// Colocação do painel no nível do COMPONENTE. utils/fabGeometry.test.js já cobre
// os 4 quadrantes como função pura; o que só é verificável aqui é a FIAÇÃO: que o
// `left`/`top`/`size` do FAB chegam a `getPanelPlacement` e que o resultado chega
// ao `style` do painel. Um refactor que passasse `size` errado, ou que trocasse
// `position.left` por `0`, deixaria os testes puros intactos e verdes.
describe('TerminalShortcutsFab — panel placement', () => {
  let pointerCapture;
  let viewportHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    viewportHandle = null;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    if (viewportHandle) viewportHandle.restore();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  const openPanel = (fab) => {
    tapFab(fab);
    return screen.getByLabelText('Terminal shortcuts');
  };

  it('opens the panel up and to the left from the default bottom-right corner', () => {
    const { fab } = renderFab();

    const panel = openPanel(fab);

    // FAB de 56px em 956/700 numa viewport 1024x768. Cresce para a esquerda
    // (borda direita do painel alinhada com a do FAB): 956 + 56 - 204 = 808.
    // Cresce para cima (gap de 8 acima do topo do FAB): 700 - 8 - 156 = 536.
    // Literais, não fórmulas: 808 é também o maxLeft do painel, então uma
    // asserção escrita como conta passaria mesmo com a largura do painel errada.
    expect(panel.style.left).toBe('808px');
    expect(panel.style.top).toBe('536px');
  });

  it('opens the panel down and to the right after the fab is dragged to the top-left corner', () => {
    const { fab } = renderFab();

    // -1000 nos dois eixos: clampa em 12/12 e o snap o mantém lá.
    dragFab(fab, { dx: -1000, dy: -1000 });
    expect(fab.style.left).toBe('12px');
    expect(fab.style.top).toBe('12px');

    const panel = openPanel(fab);

    // Agora à esquerda e acima do centro visível: cresce para a direita (bordas
    // esquerdas alinhadas) e para baixo (12 + 56 + 8 = 76).
    expect(panel.style.left).toBe('12px');
    expect(panel.style.top).toBe('76px');
  });

  it('keeps the open panel inside the viewport when the tablet is rotated', () => {
    // Girar o iPad COM O PAINEL ABERTO muda os DOIS eixos ao mesmo tempo, o que a
    // reflow do teclado (teste seguinte) não faz — lá só a altura muda. É o caso
    // em que um painel memoizado no momento da abertura ficaria ancorado num
    // retângulo que já não existe: em retrato o maxLeft do painel cai de 808 para
    // 552, então um `left` de 808 congelado deixaria 252px do painel fora da tela.
    viewportHandle = installFakeVisualViewport({ width: 1024, height: 768 });
    const { vv } = viewportHandle;
    const { fab } = renderFab();

    const panel = openPanel(fab);
    expect(panel.style.left).toBe('808px');
    expect(panel.style.top).toBe('536px');

    vv.set({ width: 768, height: 1024 });
    act(() => { vv.fire('resize'); });

    // Nada persistido -> o canto padrão é recalculado para o retrato:
    // maxLeft = 768 - 12 - 56 = 700, maxTop = 1024 - 12 - 56 = 956.
    expect(fab.style.left).toBe('700px');
    expect(fab.style.top).toBe('956px');
    // O FAB continua à direita e abaixo do centro visível (384 / 512), então o
    // painel segue crescendo para a esquerda e para cima:
    // left = 700 + 56 - 204 = 552, top = 956 - 8 - 156 = 792.
    expect(panel.style.left).toBe('552px');
    expect(panel.style.top).toBe('792px');
    // E a borda direita do painel encosta exatamente nos 12px de margem do retrato
    // (768 - 12 = 756), sem invadi-los. Literal, não `viewport.width - margem`.
    expect(552 + 204).toBe(756);
  });

  it('reflows the open panel when the keyboard shrinks the viewport under it', () => {
    // O componente afirma isto num comentário ("uma mudança de viewport com o
    // painel aberto reposiciona o painel junto com o FAB de graça"), e é a única
    // afirmação da feature que depende de o `placement` ser recalculado a cada
    // render em vez de memoizado no momento da abertura.
    viewportHandle = installFakeVisualViewport({ width: 1024, height: 768 });
    const { vv } = viewportHandle;
    const { fab } = renderFab();

    const panel = openPanel(fab);
    expect(panel.style.top).toBe('536px');

    // Teclado abrindo. Nada persistido -> o default é recalculado: maxTop passa a
    // 500 - 12 - 56 = 432.
    vv.set({ height: 500 });
    act(() => { vv.fire('resize'); });

    expect(fab.style.top).toBe('432px');
    // O painel acompanha: 432 - 8 - 156 = 268, ainda dentro do maxTop do painel
    // (500 - 12 - 156 = 332). O eixo X não mudou.
    expect(panel.style.top).toBe('268px');
    expect(panel.style.left).toBe('808px');
  });
});

// O hard gate `if (!isTouch) return null`. Ele MIGROU de TerminalShortcutsBar para
// cá quando o FAB substituiu a faixa fixa, e o teste que o cobria ficou no arquivo
// antigo — ou seja, o único gate que decide se esta feature existe na tela estava
// descoberto desde a migração. Este describe é a única parte da suíte que roda com
// `useIsTouchDevice` devolvendo `false`.
describe('TerminalShortcutsFab — touch-only hard gate', () => {
  beforeEach(() => {
    touchEnv.isTouch = false;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    // Restaurar SEMPRE, e no afterEach e não no fim do `it`: um teste que falhe no
    // meio deixaria `isTouch` falso e todo describe subsequente veria um FAB
    // inexistente — a suíte inteira ficaria vermelha longe da causa.
    touchEnv.isTouch = true;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('renders nothing at all on a device without touch input', () => {
    const terminalRef = { current: { sendControlByte: vi.fn() } };
    const { container } = render(
      <TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projA::claude" />,
    );

    // Nada no DOM — e a distinção importa: um FAB apenas escondido por CSS
    // continuaria sendo uma parada de tabulação e continuaria ativável por
    // Enter/Espaço (o componente tem um handler de `click` justamente para o
    // caminho de teclado), então no desktop apareceria um painel de atalhos de
    // toque que ninguém pediu e que não tem gesto para fechar.
    expect(container.innerHTML).toBe('');
    expect(screen.queryByLabelText('Show terminal shortcuts')).toBeNull();
    expect(screen.queryByLabelText('Hide terminal shortcuts')).toBeNull();
  });

  it('leaves a previously persisted position untouched while gated out', () => {
    // O gate roda DEPOIS de todos os hooks (eles não podem ser condicionais), então
    // `useFabPosition` monta, lê o localStorage e registra listeners mesmo num
    // desktop. O que ele não pode fazer é ESCREVER: se o mount persistisse a
    // posição medida (por exemplo, "normalizando" o blob), abrir o app uma vez num
    // monitor de 2560px reescreveria a % e o Bruno encontraria o FAB fora do canto
    // no iPad seguinte.
    const blob = JSON.stringify({ v: 1, xPercent: 0.25, yPercent: 0.75 });
    localStorage.setItem(FAB_POSITION_STORAGE_KEY, blob);
    const terminalRef = { current: { sendControlByte: vi.fn() } };

    render(<TerminalShortcutsFab terminalRef={terminalRef} sessionKey="projA::claude" />);

    expect(localStorage.getItem(FAB_POSITION_STORAGE_KEY)).toBe(blob);
  });
});

// A captura de ponteiro é o que, no browser real, faz `pointermove`/`pointerup`
// continuarem chegando NESTE elemento depois de o dedo sair dos 56px dele — sem
// ela o arrasto morre no primeiro pixel fora do botão, que é o caso normal de um
// arrasto de 200px. jsdom 29.1.1 não implementa nenhuma das três funções, e é
// exatamente por isso que os dois lados precisam de teste: o pedido de captura
// (que nenhum outro teste assevera) e o guard de `typeof` (sem o qual a suíte
// inteira do FAB daria TypeError).
describe('TerminalShortcutsFab — pointer capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('holds the capture for the tracked pointer and gives it back when the drag ends', () => {
    const pointerCapture = installPointerCapture();
    try {
      const { fab } = renderFab();

      dragFab(fab, {
        dx: -200,
        dy: -100,
        onDragging: () => {
          // Asseverado através do ESTADO do fake (`hasPointerCapture` lê o Set que
          // os stubs mantêm), não por contagem de chamadas: uma asserção de
          // `toHaveBeenCalled` passaria também se o componente capturasse e
          // liberasse no mesmo handler, que é o bug que mataria o arrasto real.
          expect(fab.hasPointerCapture(1)).toBe(true);
        },
      });

      expect(pointerCapture.setPointerCapture).toHaveBeenCalledWith(1);
      // Devolvida no fim: uma captura retida sobrevive ao gesto e o elemento passa
      // a engolir os ponteiros da página inteira — no iPad, a saída do terminal
      // pararia de rolar depois do primeiro arrasto do FAB.
      expect(fab.hasPointerCapture(1)).toBe(false);
      expect(pointerCapture.releasePointerCapture).toHaveBeenCalledWith(1);
    } finally {
      pointerCapture.restore();
    }
  });

  it('gives the capture back on pointercancel too', () => {
    // O caminho pelo qual o sistema (e não o usuário) encerra o gesto. Se a
    // liberação vivesse só no `pointerup`, um único `pointercancel` do iOS deixaria
    // a captura pendurada para sempre.
    const pointerCapture = installPointerCapture();
    try {
      const { fab } = renderFab();

      dragFab(fab, { dx: -200, dy: -100, cancel: true });

      expect(fab.hasPointerCapture(1)).toBe(false);
      expect(pointerCapture.releasePointerCapture).toHaveBeenCalledWith(1);
    } finally {
      pointerCapture.restore();
    }
  });

  it('drives a whole drag in an environment that has no pointer capture at all', () => {
    // ESTE é o teste que prova o guard `typeof el.setPointerCapture === 'function'`,
    // e é o único do arquivo que NÃO instala os stubs — o mesmo estado em que o FAB
    // é montado por ChatV2.test.jsx e AppV2.test.jsx. Sem o guard, todo teste que
    // faz `pointerDown` neste componente morre com TypeError, e o sintoma não
    // aponta para captura de ponteiro nenhuma: aponta para "o FAB não monta".
    // Por isso o guard não é defensividade cosmética e não pode ser "limpo".
    expect(Element.prototype.setPointerCapture).toBeUndefined();
    const { fab } = renderFab();

    expect(() => dragFab(fab, { dx: -200, dy: -100 })).not.toThrow();

    // E o gesto não só não estoura: comita normalmente. Um guard que abortasse o
    // handler em vez de pular a chamada deixaria o arrasto inteiro sem efeito, e
    // um `not.toThrow()` sozinho não distinguiria os dois casos.
    expect(fab.style.left).toBe('756px');
    expect(fab.style.top).toBe('600px');
  });

  it('commits the drag even when releasing the capture throws NotFoundError', () => {
    // Fidelidade ao browser real: se o sistema já liberou a captura por conta
    // própria (um `pointercancel` emitido pelo iOS), `releasePointerCapture` lança
    // `NotFoundError`. Sem o try/catch, a exceção sobe do handler ANTES do
    // `commitDrag` e o arrasto é perdido — de novo o sintoma "arrasto e o botão
    // volta pro canto", agora por outra causa e só no dispositivo.
    const pointerCapture = installPointerCapture();
    Element.prototype.releasePointerCapture = vi.fn(() => {
      throw new DOMException('No active pointer with the given id', 'NotFoundError');
    });

    try {
      const { fab } = renderFab();

      expect(() => dragFab(fab, { dx: -200, dy: -100 })).not.toThrow();

      expect(fab.style.left).toBe('756px');
      expect(fab.style.top).toBe('600px');
      expect(readStoredPosition().xPercent).toBeCloseTo(744 / 944, 10);
    } finally {
      pointerCapture.restore();
    }
  });
});

// Ambiente sem `visualViewport`: o estado natural do jsdom, de um browser antigo, e
// de qualquer WebView que não exponha a API. Os describes acima já rodam assim, mas
// nenhum deles ASSEVERA o caminho de fallback — e é o fallback que decide se o FAB
// tem bounds ou `NaN`. Aqui os listeners de `window` (`resize`/`orientationchange`)
// são o único caminho de resync que resta.
describe('TerminalShortcutsFab — without visualViewport', () => {
  let pointerCapture;
  let originalInnerWidth;
  let originalInnerHeight;

  const setLayoutViewport = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    pointerCapture = installPointerCapture();
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    pointerCapture.restore();
    setLayoutViewport(originalInnerWidth, originalInnerHeight);
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  it('re-derives the position from the layout viewport when the device rotates', () => {
    expect(window.visualViewport).toBeUndefined();
    const { fab } = renderFab();

    // Arrasto para a BORDA ESQUERDA sem sair do bound inferior: dx grande o
    // bastante para clampar em minLeft (12) e dy zero, que mantém o FAB encostado
    // em maxTop (700) — o snap o segura lá porque já está no bound.
    // Logo a % persistida é exatamente (0, 1): encostado à esquerda, encostado
    // embaixo. Escolhi este canto de propósito, para que os px pós-rotação sejam
    // literais inteiros em vez de uma dízima que só um toBeCloseTo alcançaria.
    dragFab(fab, { dx: -1000, dy: 0 });
    expect(fab.style.left).toBe('12px');
    expect(fab.style.top).toBe('700px');
    expect(readStoredPosition()).toEqual({ v: 1, xPercent: 0, yPercent: 1 });

    setLayoutViewport(768, 1024);
    act(() => { window.dispatchEvent(new Event('orientationchange')); });

    // Retrato: minLeft continua 12 (xPercent 0) e maxTop passa a
    // 1024 - 12 - 56 = 956 (yPercent 1). Sem os listeners de `window`, o FAB
    // ficaria em 700 — 256px acima de onde deveria estar, o que no iPad é "girei o
    // tablet e o botão ficou no meio da tela".
    expect(fab.style.left).toBe('12px');
    expect(fab.style.top).toBe('956px');
  });
});
