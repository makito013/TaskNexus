// frontend/src/layouts/v2/TerminalShortcutsFab.jsx
//
// Botão flutuante arrastável que abre/fecha a grade de atalhos do terminal
// (TerminalShortcutsPanel.jsx) no layout v2. Pedido original do Bruno: a faixa
// fixa de atalhos atrapalhava exatamente quando ele precisava LER e TOCAR num
// menu de escolha numerada que a TUI do `claude` apresenta ("1. Sim  2. Não
// 3. Sempre"); então os atalhos só existem na tela quando ele pede, e o próprio
// botão pode ser arrastado pra fora do caminho.
//
// -------------------------------------------------------------------------
// ARMADILHA QUE QUEBRA ESTE ARQUIVO EM SILÊNCIO — leia antes de mexer em CSS
// de qualquer ancestral. Este componente e o painel são `position: fixed` e
// TODA a matemática de utils/fabGeometry.js pressupõe que eles se posicionam
// contra a viewport. Basta que alguém adicione `transform`, `filter`,
// `will-change` ou `contain` em QUALQUER ancestral — hoje limpos, grep
// conferido: AppV2.jsx:203, :234, :271, :285 e ChatV2.jsx:94 — pra que esses
// elementos passem a se posicionar contra aquele ancestral. Não gera erro,
// não gera warning, nenhum teste pega: o FAB simplesmente vai parar no lugar
// errado e o clamp de viewport vira lixo. A Fase 2 desta feature (encolher a
// tela quando o teclado nativo abre) é precisamente o tipo de mudança capaz de
// introduzir isso.
//
// Corolário que a gente EXPLORA de propósito: o wrapper da tela Chat usa
// `display: none` para as outras telas (AppV2.jsx:285), e `display: none` num
// ancestral remove a subárvore inteira da box tree, inclusive descendentes
// `fixed`. É isso que faz o FAB desaparecer sozinho em Board/Tarefas/
// Configuração, de graça. Portar este componente pro document.body via
// createPortal QUEBRARIA esse gate e o FAB apareceria por cima do Board.
// -------------------------------------------------------------------------
//
// Máquina de gestos, em uma frase: um toque curto alterna o painel; segurar
// 280ms arma o arrasto (e consome o gesto — o up que vem depois não alterna
// nada); escorregar antes dos 280ms aborta tudo. A fronteira entre React e DOM
// imperativo é explicável: TUDO do arrasto ao vivo é imperativo (transform +
// classe), todo o resto é estado React. `dragging` não é estado porque um
// pointermove por frame causando re-render seria patológico.
import { useEffect, useRef, useState } from 'react';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice.js';
import { useFabPosition } from '../../hooks/useFabPosition.js';
import { FAB_SIZE_PX, getPanelPlacement } from '../../utils/fabGeometry.js';
import { TerminalShortcutsPanel } from './TerminalShortcutsPanel.jsx';

// 280ms, não 500ms: (a) fica ABAIXO do timer de callout/seleção do iOS Safari
// (~500ms), então não disputamos o gesto com o sistema; (b) faz o gesto
// frequente (alternar o painel) ser o caminho de menor resistência, que é o que
// a demanda pede.
export const LONG_PRESS_MS = 280;

// Constante PRÓPRIA, deliberadamente NÃO importada do TAP_SLOP_PX do painel.
// Mesmo número hoje pelo mesmo motivo humano (tremor de dedo), mas governam
// decisões independentes: lá é "foi tap ou arrasto de rolagem num botão", aqui
// é "o dedo ficou parado o bastante pra armar o arrasto". Acoplá-las faria um
// ajuste futuro em uma mudar a outra em silêncio.
export const FAB_DRAG_SLOP_PX = 10;

export const FAB_IDLE_FADE_MS = 4000;
export const FAB_OPACITY_IDLE = 0.55;
// Piso de opacidade: o FAB desbota, mas NUNCA chega a 0 nem a display:none —
// um controle invisível é um controle que o usuário não encontra mais.
export const FAB_OPACITY_FADED = 0.35;
export const FAB_OPACITY_ACTIVE = 1;

export const PANEL_DOM_ID = 'terminal-shortcuts-panel';

const fabStyle = ({ left, top, opacity, armed }) => ({
  position: 'fixed',
  left: `${left}px`,
  top: `${top}px`,
  width: 'var(--touch-target, 44px)',
  height: 'var(--touch-target, 44px)',
  // 30, NÃO 20: o botão `☰ Menu` (AppV2.jsx:335) também é `position: fixed` e
  // vive no canto superior esquerdo — exatamente um dos cantos pra onde este FAB
  // pode ser arrastado. Empatados em z-index, quem pinta por cima é a ordem no
  // DOM, e o `☰ Menu` é renderizado DEPOIS do ChatV2 na árvore do AppV2
  // (:327 vs :301), então o FAB ficaria parcialmente inalcançável — e ele é
  // justamente o controle que a demanda exige sempre alcançável. 30 o põe acima
  // do `☰ Menu` e dos banners de reconnect do TerminalPanel (10, e ele precisa
  // ser tocável mesmo com banner na tela), e ABAIXO de todo sheet/overlay
  // (40+), que é o certo: com o MobileChatSheet ou o MobileMenuScreen abertos o
  // FAB não deve flutuar por cima.
  zIndex: 30,
  borderRadius: '50%',
  border: '1px solid var(--v2-border)',
  background: 'var(--v2-surface-2)',
  color: 'var(--v2-text)',
  fontSize: '18px',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  opacity,
  // `scale(1)` explícito (em vez de omitir a propriedade) é o que garante que o
  // commit do arrasto não deixe DOM obsoleto: o diff do React vê prev
  // 'scale(1.12)' -> next 'scale(1)' e reescreve a propriedade, apagando o
  // translate3d que o handler de arrasto escreveu por fora. Ver "commit sem
  // piscada" em handlePointerUp.
  transform: `scale(${armed ? 1.12 : 1})`,
  boxShadow: armed ? 'var(--v2-shadow-lg)' : 'var(--v2-shadow)',
  // `manipulation` (usado pelos botões do painel) NÃO basta aqui: ele permite
  // pan, e sem `none` o Safari pode reivindicar o arrasto como rolagem e emitir
  // pointercancel no meio do gesto. O usuário veria o FAB "travar" de forma
  // intermitente — não reproduz no Chrome desktop, não reproduz em teste.
  touchAction: 'none',
  // Um hold de 280ms+ num <button> dispara o callout/preview de link do iOS
  // Safari, que estoura o arrasto visivelmente. onContextMenu abaixo cobre o
  // mesmo modo de falha pelo outro caminho.
  WebkitTouchCallout: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
});

/**
 * TerminalShortcutsFab — touch-only (hard gate: devolve null fora de
 * dispositivo de toque; o gate morava em TerminalShortcutsBar e subiu pra cá).
 *
 * `terminalRef` deve ser um ref pra uma instância de TerminalPanel expondo
 * `sendControlByte(payload)`. `sessionKey` existe só pra fechar o painel quando
 * a sessão ativa troca — ver o efeito no fim do componente.
 */
export function TerminalShortcutsFab({ terminalRef, sessionKey }) {
  const isTouch = useIsTouchDevice();
  const { position, viewport, insets, commitPosition } = useFabPosition();

  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [faded, setFaded] = useState(false);
  // Bump a cada interação com o FAB: é o que reinicia o timer de fade sem
  // precisar de um segundo efeito nem de leitura de timestamp.
  const [interactionNonce, setInteractionNonce] = useState(0);

  const fabRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);

  // Ref ÚNICO da máquina de gestos. Tudo aqui é lido/escrito dentro de handlers
  // de ponteiro, nunca em render — por isso ref e não estado.
  const gestureRef = useRef({
    pointerId: null,
    phase: null,          // 'pressed' | 'aborted' | 'armed' | 'dragging'
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    dx: 0,                // último delta conhecido — é o que pointercancel usa
    dy: 0,                // pra persistir a última posição válida
  });

  // Tamanho real do botão. jsdom devolve offsetWidth 0 (verificado: 29.1.1), e
  // sem o `|| FAB_SIZE_PX` a matemática de clamp colapsaria em tamanho 0 na
  // suíte inteira — o fallback é o que permite testar, não cortesia. Escrito no
  // mount, muito antes de qualquer gesto ou abertura de painel poder acontecer,
  // então ler o ref durante o render abaixo é determinístico.
  const sizeRef = useRef(FAB_SIZE_PX);
  useEffect(() => {
    sizeRef.current = fabRef.current?.offsetWidth || FAB_SIZE_PX;
  }, []);

  // Timer de fade. O cleanup NÃO é opcional: AppV2.test.jsx não mocka
  // useIsTouchDevice e instala um matchMedia que responde `matches: true` a
  // qualquer query, então este componente monta de verdade em vários testes de
  // lá. Um timer pendente disparando setState depois do cleanup() da Testing
  // Library gera warning de `act` e vaza entre testes. Mesmo cuidado, com o
  // comentário já escrito, em ResetLayoutButton.jsx:39-47.
  useEffect(() => {
    if (open) return undefined; // com o painel aberto o FAB nunca desbota
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      setFaded(true);
    }, FAB_IDLE_FADE_MS);
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [open, interactionNonce]);

  // O timer de long-press vive num ref escrito por handler, não por efeito —
  // então precisa do seu próprio cleanup de unmount pelo mesmo motivo acima
  // (um long-press interrompido por navegação deixaria o timer pendurado).
  useEffect(() => () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Troca de sessão ativa com o painel aberto: os botões escrevem em
  // terminalRef.current, que passou a apontar pra OUTRO PTY. Deixar aberto
  // convida a mandar um ^C na sessão errada acreditando que é a antiga —
  // destrutivo e silencioso. 1 prop + 1 efeito pra evitar isso.
  useEffect(() => {
    setOpen(false);
  }, [sessionKey]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetGesture = () => {
    const g = gestureRef.current;
    g.pointerId = null;
    g.phase = null;
    g.dx = 0;
    g.dy = 0;
  };

  const handlePointerDown = (e) => {
    const g = gestureRef.current;
    // Segundo dedo enquanto um gesto está ativo: ignorado por completo. Sem
    // isso, um pointerId novo sobrescreveria startX/startY e o arrasto passaria
    // a seguir o dedo errado.
    if (g.pointerId !== null) return;

    g.pointerId = e.pointerId;
    g.phase = 'pressed';
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.startLeft = position.left;
    g.startTop = position.top;
    g.dx = 0;
    g.dy = 0;

    // Volta a 100% de opacidade ANTES de qualquer decisão de toggle: o usuário
    // tocou, então o FAB já não está mais ocioso.
    setFaded(false);
    setInteractionNonce((n) => n + 1);

    const el = fabRef.current;
    // jsdom (verificado: 29.1.1) NÃO implementa setPointerCapture. Chamar
    // direto derruba com TypeError todo teste que faz pointerDown neste
    // componente — este guard é o que viabiliza a suíte, não defensividade
    // cosmética; não "limpar" num refactor. No browser real a captura é o que
    // garante que pointermove/pointerup continuem chegando NESTE elemento mesmo
    // quando o dedo sai da área de 44px dele — sem ela o arrasto morre no
    // primeiro pixel fora do botão.
    if (el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }

    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      const gesture = gestureRef.current;
      if (gesture.phase !== 'pressed') return; // já abortou ou já subiu
      gesture.phase = 'armed';
      setArmed(true);
      // Cruzar o threshold com o painel aberto fecha o painel na hora: o
      // usuário está prestes a mover o botão, e um painel de 204px seguindo o
      // dedo (ou ficando pra trás) é ruído puro.
      setOpen(false);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e) => {
    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return; // ponteiro que não estamos seguindo
    if (g.phase === 'aborted' || g.phase === null) return;

    if (g.phase === 'pressed') {
      // Escorregou antes dos 280ms: não foi tap nem long-press. Aborta o gesto
      // inteiro — nem alterna o painel, nem arma o arrasto. O usuário
      // provavelmente estava rolando e passou por cima do FAB.
      if (Math.abs(e.clientX - g.startX) > FAB_DRAG_SLOP_PX
        || Math.abs(e.clientY - g.startY) > FAB_DRAG_SLOP_PX) {
        g.phase = 'aborted';
        clearLongPressTimer();
      }
      return;
    }

    const el = fabRef.current;
    if (g.phase === 'armed') {
      g.phase = 'dragging';
      // A classe sai da lista de transição do `transform` (theme.css): durante o
      // arrasto o movimento tem que ser 1:1 com o dedo, e qualquer transição
      // deixa o FAB visivelmente atrasado atrás do ponteiro.
      if (el) el.classList.add('v2-fab--dragging');
    }

    // DELTA, nunca clientX absoluto — e isso não é estilo: o sistema de
    // coordenadas de clientX (layout vs visual viewport) difere entre browsers
    // e versões, e na subtração a origem se cancela. O left/top absoluto vem do
    // nosso próprio estado (startLeft/startTop), jamais do ponteiro.
    g.dx = e.clientX - g.startX;
    g.dy = e.clientY - g.startY;
    // A porcentagem persistida é calculada SÓ no up/cancel, nunca aqui.
    if (el) el.style.transform = `translate3d(${g.dx}px, ${g.dy}px, 0) scale(1.12)`;
  };

  const releaseCapture = (pointerId) => {
    const el = fabRef.current;
    // Mesmo motivo do guard em handlePointerDown: inexistente em jsdom.
    if (el && typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // O browser já pode ter liberado a captura sozinho (ex.: pointercancel
        // do sistema), e nesse caso releasePointerCapture lança
        // NotFoundError. Não há nada a fazer nem a reportar: o objetivo — não
        // ter mais a captura — já foi atingido.
      }
    }
  };

  // Escreve a posição final no DOM e no estado. As TRÊS escritas juntas,
  // sincronamente, dentro do mesmo handler: se left/top ficassem pro próximo
  // render do React e o transform fosse limpo aqui, existiria um frame com o
  // FAB no left/top ANTIGO e sem translate — um "salta pra trás e volta" de
  // ~16ms, visível no iPad e invisível em teste. O setState dentro de
  // commitPosition mantém o React como fonte de verdade; o render seguinte
  // escreve exatamente os mesmos valores (idempotente).
  const commitDrag = () => {
    const g = gestureRef.current;
    const snapped = commitPosition({ left: g.startLeft + g.dx, top: g.startTop + g.dy });
    const el = fabRef.current;
    if (el) {
      el.style.left = `${snapped.left}px`;
      el.style.top = `${snapped.top}px`;
      el.style.transform = '';
      el.classList.remove('v2-fab--dragging');
    }
  };

  const handlePointerUp = (e) => {
    // preventDefault() em TODO pointerup, antes de qualquer outra coisa. É um
    // mecanismo INDEPENDENTE do data-terminal-safe-tap abaixo, não um reforço
    // dele: impede o browser de mover o foco do DOM pro <button>, o que no iOS
    // fecha o teclado porque o textarea oculto do xterm perde foco. Ter um sem o
    // outro dá um bug parcial que só aparece no iPadOS — ninguém pega em review.
    // Consequência deliberada: nenhum evento `click` nasce de toque (ver
    // handleClick).
    e.preventDefault();

    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return;

    releaseCapture(e.pointerId);
    clearLongPressTimer();

    const { phase } = g;
    resetGesture();
    setArmed(false);

    if (phase === 'pressed') {
      // Tap: subiu antes dos 280ms e sem escorregar. O único gesto que alterna.
      setOpen((o) => !o);
      return;
    }
    if (phase === 'dragging') {
      commitDrag();
    }
    // 'armed' (segurou e soltou sem mover) e 'aborted' não fazem nada: cruzar o
    // threshold CONSOME o gesto, e um gesto abortado não é sinal de intenção.
  };

  const handlePointerCancel = (e) => {
    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return;

    releaseCapture(e.pointerId);
    clearLongPressTimer();

    const { phase } = g;
    const wasDragging = phase === 'dragging';
    resetGesture();
    setArmed(false);

    if (wasDragging) {
      // Persiste a ÚLTIMA posição válida, nunca volta pra posição antiga: se o
      // sistema cancelou o gesto no meio, o botão já está visualmente sob o
      // dedo, e saltar de volta seria uma perda de trabalho do usuário.
      commitDrag();
      return;
    }
    // pointercancel durante PRESSED não mexe no painel: cancelamento não é sinal
    // de intenção, e só um tap completo alterna.
  };

  // Caminho de acessibilidade, NÃO substituto da máquina de estados acima. Como
  // fazemos preventDefault() em todo pointerup, nenhum `click` nasce de toque —
  // então qualquer click que chegue veio de teclado físico ou do gesto de
  // ativação do VoiceOver, que dispara `click` SEM pointerdown/pointerup.
  // `e.detail === 0` é o que distingue esses dois casos de um click sintetizado
  // por ponteiro. Sem este caminho o FAB é literalmente inoperável sob
  // VoiceOver, mesmo com aria-expanded/aria-label/aria-controls corretos —
  // ARIA sem ativação é fachada.
  const handleClick = (e) => {
    if (e.detail !== 0) return;
    setOpen((o) => !o);
  };

  // Hard gate DEPOIS de todos os hooks (não podem ser condicionais).
  if (!isTouch) return null;

  const opacity = open || armed
    ? FAB_OPACITY_ACTIVE
    : (faded ? FAB_OPACITY_FADED : FAB_OPACITY_IDLE);

  const ariaLabel = open ? 'Hide terminal shortcuts' : 'Show terminal shortcuts';

  // Recalculado a cada render, então uma mudança de viewport com o painel aberto
  // (rotação, teclado subindo) reposiciona o painel junto com o FAB de graça:
  // viewport/insets vêm do estado do useFabPosition, que se re-sincroniza nos
  // eventos da visual viewport.
  const placement = open
    ? getPanelPlacement({
      left: position.left,
      top: position.top,
      size: sizeRef.current,
      viewport,
      insets,
    })
    : null;

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="v2-fab"
        style={fabStyle({ left: position.left, top: position.top, opacity, armed })}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-expanded={open}
        // Só aponta pro painel quando ele existe de fato no DOM: um
        // aria-controls apontando pra um id inexistente é pior que ausente.
        aria-controls={open ? PANEL_DOM_ID : undefined}
        // Sem este atributo, abrir/fechar o painel dispara o
        // onOutsideTap de TerminalPanel.jsx:490-498, que dá blur() no textarea
        // do xterm e FECHA o teclado do iPad — ou seja, o próprio ato de pedir
        // os atalhos destruiria o contexto em que eles são úteis.
        data-terminal-safe-tap="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        // Segurar 280ms+ num <button> pode abrir o menu de contexto do iOS e
        // estourar o arrasto. Par obrigatório do WebkitTouchCallout acima.
        onContextMenu={(event) => event.preventDefault()}
      >
        {open ? '✕' : '⌨️'}
      </button>

      {open && (
        <TerminalShortcutsPanel
          id={PANEL_DOM_ID}
          terminalRef={terminalRef}
          left={placement.panelLeft}
          top={placement.panelTop}
          transformOrigin={placement.transformOrigin}
        />
      )}
    </>
  );
}
