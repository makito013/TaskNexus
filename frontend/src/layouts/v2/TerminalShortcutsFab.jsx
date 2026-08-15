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
import { useKeyboardSuppressed } from '../../hooks/useKeyboardSuppressed.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useFabPosition } from '../../hooks/useFabPosition.js';
import { FAB_SIZE_PX, FAB_SIZE_TABLET_PX, getPanelPlacement } from '../../utils/fabGeometry.js';
import { MOBILE_VIEWPORT_QUERY } from '../../utils/viewport.js';
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

// Diâmetro do ponto indicador de "teclado suprimido" no FAB fechado.
export const SUPPRESSED_DOT_SIZE_PX = 8;

const fabStyle = ({ left, top, opacity, armed, size }) => ({
  position: 'fixed',
  left: `${left}px`,
  top: `${top}px`,
  // O tamanho vem de JS, NÃO de `var(--touch-target)`, desde a Rodada 2: o FAB
  // tem 56px no tablet e 44px no celular, e `--touch-target` governa alvos de
  // toque de TODO o repo (IpadToolbar, células do painel, banner da skin). Uma
  // variante do token por media query inflaria tudo em cascata sem aparecer em
  // teste nenhum. O contrapeso obrigatório: este mesmo `size` tem que chegar ao
  // useFabPosition, senão os bounds continuam calculados com 44 e o botão para
  // 12px antes da borda sem motivo visível.
  width: `${size}px`,
  height: `${size}px`,
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
  // O glifo `⌨️` a 18px dentro de um círculo de 56px fica visivelmente perdido —
  // o ícone tem que crescer com o botão, não só o botão.
  fontSize: size >= FAB_SIZE_TABLET_PX ? '22px' : '18px',
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
  // Critério de tablet: `isTouch && !isMobile`. SEMPRE via useMediaQuery, NUNCA
  // `window.matchMedia` cru — o jsdom deste repo não implementa matchMedia e
  // components/TerminalPanel.test.jsx não instala fallback, então uma chamada
  // crua derrubaria ~31 testes com TypeError; o guard vive dentro do hook.
  // Consequência decidida e não-bug: iPhone em PAISAGEM (largura > 640px) entra
  // no FAB grande. Em paisagem há espaço e o dedo é o mesmo; reverter é 1 linha.
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  const size = isMobile ? FAB_SIZE_PX : FAB_SIZE_TABLET_PX;

  // Rodada 2, Frente C (C-T5): o modo "esconder teclado" persiste entre reloads e
  // só é visível DENTRO do painel. Com o painel fechado, "meu teclado não abre"
  // seria um estado silencioso que sobrevive a um reload — o ponto indicador
  // abaixo é o que o torna visível sem abrir nada.
  const [keyboardSuppressed] = useKeyboardSuppressed();

  const {
    position, viewport, insets, commitPosition, suspendResyncRef,
  } = useFabPosition({ size });

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

  // Aqui existia um `sizeRef` medido do DOM (`fabRef.current?.offsetWidth ||
  // FAB_SIZE_PX`) num efeito de mount. Foi REMOVIDO na Rodada 2 e não deve
  // voltar: medir o DOM para descobrir um número que nós mesmos escrevemos é
  // redundante, e um efeito de mount ficaria OBSOLETO agora que `size` pode
  // mudar (44 <-> 56 numa mudança de breakpoint). O `size` derivado acima é a
  // única fonte, e passá-lo direto para getPanelPlacement elimina de tabela o
  // fallback de `offsetWidth === 0` do jsdom.

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

    // Congela o resync de viewport pelo gesto INTEIRO, já a partir do
    // pointerdown (não do momento em que o arrasto arma): startLeft/startTop
    // acabaram de ser capturados acima e são a base de todo delta daqui pra
    // frente. Um evento da visual viewport no meio do caminho re-derivaria
    // left/top da % e trocaria essa base embaixo do dedo. Ver o comentário de
    // suspendResyncRef em hooks/useFabPosition.js.
    suspendResyncRef.current = true;

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
    // quando o dedo sai da área de 44/56px dele — sem ela o arrasto morre no
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
  //
  // POR QUE OS 4 VALORES VÊM POR PARÂMETRO, e não de gestureRef — isto não é
  // estilo, é a correção de um bug real que chegou ao iPad: `resetGesture()`
  // zera `dx`/`dy` no ref, e os dois handlers chamavam `resetGesture()` ANTES de
  // `commitDrag()`. Resultado: todo arrasto comitava `startLeft + 0`, reescrevia
  // a posição ANTIGA no DOM e persistia a % antiga — um no-op idempotente
  // perfeito, que é exatamente o sintoma "arrasto o botão e ele volta pro canto
  // onde estava". Com o snapshot explícito por parâmetro, a ordem das duas
  // chamadas deixa de importar e a CLASSE do bug desaparece.
  //
  // ALTERNATIVA REJEITADA, e não a reintroduza: mover `resetGesture()` para
  // depois de `commitDrag()`. Faz o teste passar, mas deixa a correção
  // dependente de uma ordem de chamada que nenhuma assinatura expressa — a
  // mesma fragilidade que produziu o bug — e reabre uma janela em que um segundo
  // `pointerdown` chega com `g.pointerId` ainda setado e é descartado pelo guard
  // de handlePointerDown. Custo idêntico, robustez menor.
  const commitDrag = ({ startLeft, startTop, dx, dy }) => {
    const snapped = commitPosition({ left: startLeft + dx, top: startTop + dy });
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
    //
    // A ORDEM DESTAS DUAS LINHAS É A INVARIANTE, não estilo. O `preventDefault()`
    // tem que vir ANTES do guard `if (g.pointerId !== e.pointerId) return`
    // logo abaixo, porque o "TODO pointerup" acima inclui os pointerup que o
    // guard descarta. O caso real é multi-toque no iPad: com um dedo já
    // arrastando o FAB, um SEGUNDO dedo que toque e solte em cima do botão
    // emite um pointerup com outro `pointerId`. Se o preventDefault ficar
    // depois do guard, esse evento sai sem ser cancelado, o browser move o foco
    // do DOM pro <button>, o textarea do xterm perde foco e o teclado do iPad
    // FECHA — no meio de um arrasto, exatamente quando o usuário estava
    // ajustando o FAB pra continuar digitando. Nenhum teste fica vermelho se
    // alguém inverter: jsdom não tem foco de verdade nem teclado virtual, e o
    // pointerup descartado não muda nenhum estado observável.
    e.preventDefault();

    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return;

    releaseCapture(e.pointerId);
    clearLongPressTimer();

    // Snapshot dos 4 campos ANTES do resetGesture(), que zera dx/dy — ver o
    // comentário de commitDrag. Tirar o snapshot aqui é o que torna a ordem
    // destas duas linhas irrelevante.
    const { phase, startLeft, startTop, dx, dy } = g;
    resetGesture();
    setArmed(false);

    if (phase === 'pressed') {
      // Tap: subiu antes dos 280ms e sem escorregar. O único gesto que alterna.
      setOpen((o) => !o);
    } else if (phase === 'dragging') {
      commitDrag({ startLeft, startTop, dx, dy });
    }
    // 'armed' (segurou e soltou sem mover) e 'aborted' não fazem nada: cruzar o
    // threshold CONSOME o gesto, e um gesto abortado não é sinal de intenção.

    // Liberado só AQUI, no fim do handler e DEPOIS do commit: o setState de
    // commitPosition tem que ser a última escrita de posição do gesto, senão um
    // resync enfileirado sobrescreveria a posição recém-comitada.
    suspendResyncRef.current = false;
  };

  const handlePointerCancel = (e) => {
    const g = gestureRef.current;
    if (g.pointerId !== e.pointerId) return;

    releaseCapture(e.pointerId);
    clearLongPressTimer();

    // Mesmo snapshot-antes-do-reset do handlePointerUp. O bug do delta zerado
    // estava DUPLICADO aqui: o comentário abaixo ("nunca volta pra posição
    // antiga") descrevia um comportamento que o código não tinha, porque
    // resetGesture() zerava dx/dy antes de commitDrag() lê-los do ref.
    const { phase, startLeft, startTop, dx, dy } = g;
    resetGesture();
    setArmed(false);

    if (phase === 'dragging') {
      // Persiste a ÚLTIMA posição válida, nunca volta pra posição antiga: se o
      // sistema cancelou o gesto no meio, o botão já está visualmente sob o
      // dedo, e saltar de volta seria uma perda de trabalho do usuário.
      commitDrag({ startLeft, startTop, dx, dy });
    }
    // pointercancel durante PRESSED não mexe no painel: cancelamento não é sinal
    // de intenção, e só um tap completo alterna.

    // Mesmo motivo do handlePointerUp: liberar depois do commit.
    suspendResyncRef.current = false;
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
      size,
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
        style={fabStyle({ left: position.left, top: position.top, opacity, armed, size })}
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
        {!open && keyboardSuppressed && (
          // Ponto indicador de "teclado suprimido". `<span>` posicionado, e não
          // um `::after`, porque toda a estilização deste componente é inline e
          // um pseudo-elemento exigiria uma regra em theme.css para um estado que
          // já é conhecido em JS.
          //
          // `role="img"` + aria-label em vez de aria-hidden: com o painel fechado
          // este ponto é a ÚNICA superfície que expõe o modo, e um estado que
          // impede o usuário de digitar não pode ser exclusivamente visual. O
          // aria-label do FAB fica intocado de propósito (ele descreve a AÇÃO de
          // abrir/fechar o painel, não este estado).
          //
          // `pointerEvents: 'none'` é obrigatório: sem isso o ponto entra como
          // alvo de `pointerdown`/`pointerup` no meio da máquina de gestos do FAB
          // e um tap que caia exatamente nele deixaria de alternar o painel.
          //
          // DEPENDÊNCIA IMPLÍCITA (e é a razão deste parágrafo existir): o
          // `position: 'absolute'` abaixo resolve `top`/`right` contra o
          // ANCESTRAL POSICIONADO mais próximo, e hoje esse ancestral é o
          // próprio <button> do FAB — não porque alguém o tenha declarado
          // `relative` para servir de âncora, mas porque `fabStyle` o faz
          // `position: 'fixed'` para se posicionar contra a viewport, e `fixed`
          // também estabelece bloco de contenção para descendentes absolutos. É
          // acidente feliz, não desenho. Se uma rodada futura tirar o `fixed` do
          // FAB (por exemplo, movendo a geometria para um wrapper), este ponto
          // deixa de ancorar no botão e salta para o canto superior direito do
          // primeiro ancestral posicionado que sobrar — ou do bloco inicial, se
          // não houver nenhum —, virando um pontinho perdido no meio da tela.
          // Nada disso fica vermelho: jsdom não resolve blocos de contenção
          // (mesma limitação que obrigou fixedPositioningInvariant.test.js a ler
          // o FONTE em vez do DOM), e as asserções sobre este <span> só olham as
          // strings de estilo inline. Quem mexer no `position` do FAB precisa
          // declarar `position: 'relative'` no botão de forma explícita.
          <span
            role="img"
            aria-label="Teclado suprimido"
            style={{
              position: 'absolute',
              // `top`/`right` separados, nunca o atalho `inset`: o `cssstyle` do
              // jsdom não implementa `inset` e a asserção passaria com o estilo
              // inerte.
              top: '2px',
              right: '2px',
              width: `${SUPPRESSED_DOT_SIZE_PX}px`,
              height: `${SUPPRESSED_DOT_SIZE_PX}px`,
              borderRadius: '50%',
              background: 'var(--v2-accent)',
              pointerEvents: 'none',
            }}
          />
        )}
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
