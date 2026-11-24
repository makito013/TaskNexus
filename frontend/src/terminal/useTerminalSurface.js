import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { isControlFrame } from './controlFrames.js';
import { FONTS_READY_TIMEOUT_MS, TERMINAL_BASE_OPTIONS } from './xtermDefaults.js';

// xterm.js + PTY WebSocket lifecycle extracted from the V2 TerminalPanel.
// All V2-specific behaviour is injected; this module never imports components/,
// features/, layouts/, hooks/ or services/. The order of the xterm and WebSocket
// calls is the one the V2 TerminalPanel tests observe — do not reorder.
//
// Options (read through refs unless noted, so they never re-create the
// terminal or the socket):
//  - containerRef: the term.open() target. CONTRACT: the caller owns its DOM and
//    must give this node ZERO padding of its own (put padding on an outer
//    wrapper) - FitAddon measures its parentElement and over-counts cols/rows by
//    any padding. The hook never writes inline styles to it.
//  - wsUrl, projectId, agentId: identity of the session. Changing any of them
//    tears down and recreates the Terminal + WebSocket.
//  - visible: gates fit()/focus(), applied by the visibility effect.
//  - theme: xterm theme object, or a function resolved inside the mount effect.
//    REACTIVE: a new `theme` identity after mount is applied live through
//    `term.options.theme` (no new Terminal, no new socket); a function theme is
//    re-resolved at that moment. Pass a STABLE identity (module-level function,
//    useMemo) - an inline object literal would be re-applied on every render.
//  - terminalOptions: extra Terminal constructor options (merged over the
//    defaults). Mount-time only.
//  - linkProviders: array of `(term) => provider` registered when the xterm
//    build supports registerLinkProvider. Mount-time only.
//  - onOpenLink: handler passed to the WebLinksAddon. Mount-time only; when
//    omitted the addon falls back to its own default handler.
//  - onControlFrame(frame): recognized backend control frames (never written to xterm).
//  - onStatusChange(status): connecting | open | reconnecting | evicted.
//  - keyboardSuppressedRef: OPTIONAL ref with the "hide keyboard" flag (gates
//    focus()). Defaults to an internal ref that is always false.
//  - fontsReadyTimeoutMs: bound on the document.fonts.ready wait. Mount-time only.
//
// Behavioural contract worth knowing before consuming this hook:
//  - Taps outside the container blur the terminal textarea (iPad keyboard fix).
//    A control that must KEEP terminal focus across a tap (e.g. a toolbar that
//    sends bytes through sendControlByte) must carry the attribute
//    `data-terminal-safe-tap`.
//  - closeSocket() does NOT end the session: it closes the current socket
//    without marking it intentional, so the usual backoff reconnect follows.
//  - The hook listens for the V2 window event `escritorio:sidebar-toggled` and
//    re-fits 250ms after it (the V2 sidebar animates its width). Other shells
//    simply never dispatch it.
//  - The latest onControlFrame/onStatusChange are read at call time, so changing
//    the session identity should be paired with a remount (V2 uses a `key`),
//    otherwise a late frame from the old socket reaches the new callbacks.
// Returns { status, sendControlByte, pasteText, refit, focus, closeSocket, termRef }.
function resolveTheme(theme) {
  return typeof theme === 'function' ? theme() : theme;
}

export function useTerminalSurface({
  containerRef,
  wsUrl,
  projectId,
  agentId,
  visible,
  theme,
  terminalOptions,
  linkProviders,
  onOpenLink,
  onControlFrame,
  onStatusChange,
  keyboardSuppressedRef: keyboardSuppressedRefOption,
  fontsReadyTimeoutMs = FONTS_READY_TIMEOUT_MS,
}) {
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const webglAddonRef = useRef(null);
  const wsRef = useRef(null);
  const visibleRef = useRef(visible);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  // Default so a consumer without a "hide keyboard" mode does not have to supply a ref.
  const defaultKeyboardSuppressedRef = useRef(false);
  const keyboardSuppressedRef = keyboardSuppressedRefOption ?? defaultKeyboardSuppressedRef;
  // The raw `theme` option the live Terminal was last given (mount or live update).
  const appliedThemeRef = useRef(undefined);

  // Latest injected options, written during render (like keyboardSuppressedRef in
  // the V2 panel) so the big effect below never depends on their identity.
  const optionsRef = useRef({});
  optionsRef.current = {
    theme, terminalOptions, linkProviders, onOpenLink, onControlFrame, onStatusChange, fontsReadyTimeoutMs,
  };

  const updateStatus = (next) => {
    setConnectionStatus(next);
    optionsRef.current.onStatusChange?.(next);
  };

  // Sync visibility ref to avoid stale closure in window resize listener
  useEffect(() => {
    visibleRef.current = visible;
    if (visible && fitAddonRef.current) {
      // Delay fit slightly to ensure DOM layout has updated display: flex dimensions
      setTimeout(() => {
        try {
          if (fitAddonRef.current && terminalRef.current) {
            fitAddonRef.current.fit();
            // Becoming the active panel (new chat, or switching tabs) should move
            // keyboard focus onto the terminal itself — xterm.js never grabs focus
            // on its own, so without this the user has to click the terminal a
            // second time after clicking a tab/chat before they can type.
            //
            // Gate 2 de 3 do modo "esconder teclado": trocar de aba não pode
            // refocar a textarea quando o usuário pediu explicitamente que o
            // teclado não abrisse.
            if (!keyboardSuppressedRef.current) {
              terminalRef.current.focus();
            }
          }
        } catch (e) {
          console.warn('Failed to fit terminal on visibility change', e);
        }
      }, 50);
    }
  }, [visible]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Initialize xterm.js instance
    const injected = optionsRef.current;
    appliedThemeRef.current = injected.theme;
    const term = new Terminal({
      ...TERMINAL_BASE_OPTIONS,
      theme: resolveTheme(injected.theme),
      ...injected.terminalOptions,
    });
    terminalRef.current = term;

    // 2. Load Fit addon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // 3. Mount to DOM
    term.open(containerRef.current);

    // Rodada 2, Frente C: aplicar `readOnly` AQUI, e não só no efeito de
    // [keyboardSuppressed] do TerminalPanel, é OBRIGATÓRIO e não redundante.
    // Trocar de sessão re-executa este efeito e cria um Terminal novo, mas o
    // efeito de [keyboardSuppressed] (que mora no painel) NÃO roda de novo porque o valor não mudou — sem esta
    // linha o terminal novo nasceria com a textarea editável e o teclado voltaria
    // a abrir ao primeiro toque, só depois de trocar de sessão. O guard de
    // `textarea` existe porque a propriedade é `undefined` antes de open() e
    // depois de dispose() (API pública, tipada como opcional em xterm.d.ts).
    if (term.textarea) {
      term.textarea.readOnly = keyboardSuppressedRef.current;
    }

    if (visibleRef.current) {
      try {
        fitAddon.fit();
        // A brand-new session mounts already active (this is the panel the user
        // just opened) — grab focus immediately so typing works without an extra
        // click, same as the visibility-change effect does for tab switches.
        //
        // Gate 3 de 3 do modo "esconder teclado", e o mais importante dos três:
        // é ele que garante que um RELOAD com o modo ligado não abra o teclado em
        // momento nenhum durante o boot. `keyboardSuppressedRef` é inicializado
        // no primeiro render, antes deste efeito, então o valor lido aqui é o
        // persistido, não um `false` transitório.
        if (!keyboardSuppressedRef.current) {
          term.focus();
        }
      } catch (e) {
        console.warn('Initial fit failed', e);
      }
    }

    // 3b. Load WebGL renderer addon (requires terminal already attached to DOM);
    // falls back silently to the default renderer when WebGL2 is unavailable.
    try {
      const webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (e) {
      console.warn('WebGL addon unavailable, falling back to default renderer', e);
    }

    // 3c. Fase V-2 (06-planejamento-fase-v.md, 6.5.6): links clicáveis — era o
    // problema de origem ("não dá para clicar em links no terminal").
    //  - URLs http(s) pelo addon oficial, abrindo numa aba do navegador sem
    //    `opener` (openWebLink).
    //  - Caminhos de arquivo (`docs/plano.md`, `src/app.py:42`) por um link
    //    provider nosso, que abre no visualizador (POST da tela, 6.10.3). Só
    //    sublinha quando há visualizador (fora do Provider, ex.: testes
    //    isolados, não faz nada).
    // No iPad o xterm ativa link por clique; o toque precisa ser conferido no
    // aparelho (6.5.6). O caminho garantido continua sendo o agente chamar a
    // tool abrir_no_visualizador. Os dublês de teste do xterm não têm
    // registerLinkProvider — daí a checagem.
    const linkDisposables = [];
    try {
      term.loadAddon(new WebLinksAddon(injected.onOpenLink));
    } catch (e) {
      console.warn('Web links addon unavailable', e);
    }
    if (typeof term.registerLinkProvider === 'function') {
      (injected.linkProviders || []).forEach((createProvider) => {
        linkDisposables.push(term.registerLinkProvider(createProvider(term)));
      });
    }

    // 4. Connect WebSocket (wrapped so onclose can reconnect without recreating the Terminal)
    const encoder = new TextEncoder();

    function connectSocket() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const initFrame = {
          type: 'init',
          project_id: projectId,
          agent_id: agentId || null,
          cols: term.cols || 80,
          rows: term.rows || 24,
        };
        ws.send(JSON.stringify(initFrame));
        if (reconnectAttemptsRef.current > 0) {
          reconnectAttemptsRef.current = 0;
        }
        // A fresh connection either gets a working PTY or a new resume_failed
        // frame if it fails again — either way, any resume_failed overlay from
        // a previous connection attempt on this same socket lineage is stale:
        // the caller clears its overlays when onStatusChange reports 'open'.
        updateStatus('open');
      };

      // Lightweight Custom Bridge (WS message -> xterm write)
      ws.onmessage = async (event) => {
        try {
          if (event.data instanceof Blob) {
            const buffer = await event.data.arrayBuffer();
            term.write(new Uint8Array(buffer));
          } else if (typeof event.data === 'string') {
            // Bug 2 fix: the backend only ever uses send_text() for control
            // frames (e.g. resume_failed) — all PTY output travels as
            // bytes/Blob via send_bytes. Recognized control frames are
            // intercepted here instead of written to the terminal; any other
            // string falls through to the old behavior unchanged.
            const controlFrame = isControlFrame(event.data);
            if (controlFrame) {
              // What each frame type does is up to the caller (the V2 panel
              // handles resume_failed, spawn_failed and viewer_open).
              optionsRef.current.onControlFrame?.(controlFrame);
            } else {
              term.write(event.data);
            }
          } else {
            term.write(new Uint8Array(event.data));
          }
        } catch (err) {
          console.error('Error handling WebSocket message', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error', err);
      };

      ws.onclose = (event) => {
        // Guard against a stale/ghost socket (e.g. the discarded first socket from
        // React 18 StrictMode's dev-only double-invoke) firing its close event after
        // a newer socket has already replaced it in wsRef. Only the current socket
        // may trigger a reconnect; intentionalCloseRef alone is not enough because
        // it is reset on every fresh mount and can transiently be false while an
        // old, already-superseded socket's close event is still in flight.
        if (wsRef.current !== ws) return;
        if (intentionalCloseRef.current) return;
        // Eviction-close: a newer, legitimate WebSocket attachment to the same
        // session_key (another tab/device) took over. This is NOT a network blip —
        // reconnecting here would just re-evict the other side, producing the
        // infinite connect/disconnect storm documented in
        // .planning/debug/ws-reconnect-storm.md. Do not schedule a reconnect.
        if (event.code === 1008) {
          updateStatus('evicted');
          return;
        }
        updateStatus('reconnecting');
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(connectSocket, delay);
      };

      return ws;
    }

    // Reset the intentional-close guard on every fresh mount. Refs persist across
    // React 18 StrictMode's dev-only double-invoke (run -> cleanup -> run), so
    // without this the guard set by the simulated cleanup would stay `true` and
    // permanently disable reconnect for the lifetime of this component instance.
    intentionalCloseRef.current = false;

    // Custom monospace fonts (SF Mono, Fira Code) may still be loading at the
    // moment of the initial fit() above, so the browser measures cell size
    // against its fallback font instead. Waiting for fonts.ready and re-fitting
    // BEFORE connecting (instead of after, as before) ensures the InitFrame
    // sent to the backend always carries the final, font-corrected geometry —
    // a mismatch here was one of the causes of "texto desconfigurado" on
    // reconnect (see the geometry-mismatch fix in pty_manager.py/main.py).
    // Bounded by a short timeout so a browser where fonts.ready never resolves
    // can't block the connection indefinitely.
    let mountCancelled = false;

    function startConnection() {
      if (mountCancelled) return;
      if (visibleRef.current && fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {
          console.warn('Post-fonts-ready fit failed', e);
        }
      }
      connectSocket();
    }

    if (document.fonts && document.fonts.ready) {
      Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, injected.fontsReadyTimeoutMs)),
      ]).then(startConnection);
    } else {
      startConnection();
    }

    // Lightweight Custom Bridge (xterm input -> WS stdin binary)
    const dataSub = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    // Lightweight Custom Bridge (xterm resize -> WS control frame)
    const resizeSub = term.onResize((size) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows,
        }));
      }
    });

    // 5b. iPad touch-scroll bridge.
    //
    // Root cause (confirmed by capturing the raw PTY byte stream of a real
    // `claude` agent session, not just reading xterm's source): Claude
    // Code's CLI unconditionally switches to the alternate screen buffer AND
    // enables full mouse tracking (`CSI ?1000h ?1002h ?1003h ?1006h`) at
    // startup. @xterm/xterm's own touch-to-scroll handling
    // (Viewport.handleTouchMove, bound in bindMouse() to `term.element`) is
    // gated behind `!coreMouseService.areMouseEventsActive` — once the PTY
    // app turns mouse tracking on, xterm deliberately steps aside so pointer
    // events can be reported to the app instead of scrolling xterm's own
    // history. Desktop wheel scroll already has an equivalent path for this
    // exact situation (xterm's own native "wheel" listener, also bound to
    // `term.element`, forwards wheel deltas as SGR mouse reports when mouse
    // tracking is active, or as arrow-key escapes as a fallback when the
    // buffer has no scrollback — e.g. the alt-screen buffer) — but xterm has
    // NO equivalent translation for touch-drag gestures, so on iPad a swipe
    // does nothing at all. This isn't a CSS/touch-action/overflow/preventDefault
    // problem (verified clean: no touch-action, no blocking pointer-events, no
    // stray preventDefault over the terminal area).
    //
    // Fix: bridge touch-drag into a synthetic native `wheel` event dispatched
    // on term.element (the exact node xterm's bindMouse() attaches its own
    // mousedown/wheel/touch listeners to), so whatever xterm already does for
    // a real wheel scroll (scrollback scroll / arrow-key fallback / SGR mouse
    // report to the app) also happens for touch — without reimplementing any
    // of xterm's mouse-report protocol by hand.
    //
    // Only intervenes while term.modes.mouseTrackingMode !== 'none': when
    // mouse tracking is off, xterm's own touchmove handling (also bound to
    // term.element, fires first since it's the touchmove target itself) already
    // does the right thing, so stepping in there too would double-handle the
    // same gesture. When mouse tracking IS on, xterm's own handler no-ops (by
    // the same protocol check) and does not preventDefault, so taking over
    // here is safe and non-conflicting.
    //
    // Selection is unaffected: xterm itself disables text selection
    // (selectionService.disable()) for the entire time mouse tracking is
    // active — the same window in which this bridge is the one doing
    // anything — so there's no selection gesture to compete with here.
    let touchLastY = null;
    let touchTracking = false;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      touchLastY = e.touches[0].clientY;
      touchTracking = true;
    };

    const onTouchMove = (e) => {
      if (!touchTracking || e.touches.length !== 1 || touchLastY === null) return;
      const term = terminalRef.current;
      const mouseTrackingMode = term?.modes?.mouseTrackingMode;
      if (!term || !mouseTrackingMode || mouseTrackingMode === 'none') {
        // xterm's own touchmove handling on term.element already covers
        // this case — don't double-handle the gesture.
        return;
      }
      const touch = e.touches[0];
      const deltaY = touchLastY - touch.clientY;
      touchLastY = touch.clientY;
      if (deltaY === 0 || !term.element) return;
      term.element.dispatchEvent(new WheelEvent('wheel', {
        deltaY,
        deltaMode: 0,
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true,
      }));
      e.preventDefault();
    };

    const onTouchEnd = () => {
      touchTracking = false;
      touchLastY = null;
    };

    const touchTarget = containerRef.current;
    touchTarget.addEventListener('touchstart', onTouchStart, { passive: true });
    touchTarget.addEventListener('touchmove', onTouchMove, { passive: false });
    touchTarget.addEventListener('touchend', onTouchEnd, { passive: true });
    touchTarget.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // 5c. iPad "keyboard opens anywhere" fix.
    //
    // Root cause: xterm.js's input capture is a hidden `.xterm-helper-textarea`
    // (0×0, off-screen, opacity 0 — see @xterm/xterm/css/xterm.css). iOS shows
    // the on-screen keyboard whenever THAT element has focus. It gets focused
    // two ways, both intentional: (a) xterm's own click handling on
    // term.element when the user taps the terminal itself, and (b) this hook's own
    // auto-focus effects on mount / tab-switch (see the two
    // term.focus() calls above — desired, do not remove; both are gated by
    // `keyboardSuppressedRef` since Rodada 2, which suppresses (b) as well).
    //
    // Este handler NÃO muda no modo "esconder teclado": com `readOnly` ligado um
    // blur ou um refoco acidental são inofensivos (nenhum teclado sobe de
    // qualquer forma), e o `data-terminal-safe-tap` dos controles novos do painel
    // já os isenta pelo `closest()` abaixo (quem marca os controles é o consumidor, ex. a toolbar do iPad na V2).
    //
    // The bug: once that textarea has focus, tapping anything ELSE in the app
    // (sidebar rows, the settings gear, session tabs, project list — almost
    // all plain <div>/<button onClick> elements) does not blur it on iOS the
    // way clicking a real focusable control blurs a text input on desktop.
    // Those elements only run their own onClick; nothing tells the previously
    // focused terminal to give up focus. So the keyboard just stays open,
    // which reads to the user as "it opens no matter where I tap" — it's
    // really never closing. Fix: on any tap outside this terminal's own
    // container, explicitly blur the terminal's textarea if it currently
    // holds focus. `data-terminal-safe-tap` is an opt-out for controls that
    // must keep terminal focus across a tap by design — IpadToolbar's ^C/Tab/
    // arrow/Esc buttons (D-10) send bytes to the PTY and rely on the terminal
    // staying focused for the next keystroke.
    const onOutsideTap = (e) => {
      const container = containerRef.current;
      if (!container || container.contains(e.target)) return; // tap on the terminal itself — xterm's own focus handling applies
      if (e.target.closest && e.target.closest('[data-terminal-safe-tap]')) return;
      const active = document.activeElement;
      if (active && container.contains(active)) {
        active.blur();
      }
    };
    document.addEventListener('touchstart', onOutsideTap, { passive: true });
    document.addEventListener('mousedown', onOutsideTap);

    // 5. Responsive Resize (using ResizeObserver for element-specific dimension changes)
    const resizeObserver = new ResizeObserver(() => {
      if (visibleRef.current && fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {
          console.warn('ResizeObserver fit failed', e);
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // 5d. RF02 Tarefa 3 (plano Layout v2, 06-TL.md): sidebar collapse/expand
    // toggle animates `width` via CSS transition (SidebarV2.jsx: 180ms)
    // rather than an instant layout jump — the ResizeObserver above only fires
    // once the transition settles into a new final size, but xterm's own fit()
    // sampled mid-transition can land on a stale intermediate width.
    // Re-fitting after a fixed delay long enough to cover the transition
    // (180ms + margin) is simpler and more robust than trying to detect
    // `transitionend` on an element this component doesn't own.
    // useSidebarCollapsed() dispatches this event on every toggle.
    let sidebarToggleTimer = null;
    const onSidebarToggled = () => {
      if (sidebarToggleTimer) {
        clearTimeout(sidebarToggleTimer);
      }
      sidebarToggleTimer = setTimeout(() => {
        sidebarToggleTimer = null;
        if (visibleRef.current && fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            console.warn('Sidebar-toggle fit failed', e);
          }
        }
      }, 250);
    };
    window.addEventListener('escritorio:sidebar-toggled', onSidebarToggled);

    // 5e. Teclado nativo do iPad: quem encolhe é o CASCO, não este componente.
    //
    // Histórico, porque a lição custou duas investigações (o comentário que
    // estava aqui era da frente da skin e ficou factualmente obsoleto quando a
    // causa foi corrigida em outro lugar — ele é SUBSTITUÍDO por este, não
    // apagado):
    //
    // Este handler escrevia `wrapper.style.height = vv.height - 2 *
    // skin.frameInsetPx` quando a visual viewport encolhia. A própria frente da
    // skin já havia documentado que a linha era provavelmente INERTE, e estava
    // certa: o wrapper tem `flex: 1` (= `flex: 1 1 0%`) dentro de um container
    // em coluna, e com `flex-basis` definido a *preferred main size* (`height`)
    // sai da equação do eixo principal — o `flex-grow` reexpande o nó de
    // qualquer forma. (Nuance para quem for tentar de novo: o resultado do flex
    // É clampado por `min-height`/`max-height`, então `height` é inerte e
    // `maxHeight` não seria. Mesmo assim não é o caminho: resolveria um nó só.)
    //
    // E não era só inerte, era o alvo errado. Com `html/body/#root
    // { overflow: hidden }` a página não rola, então o Safari PANEIA a layout
    // viewport para manter a textarea visível: `visualViewport.offsetTop > 0` e
    // o topo do app sai da tela por cima ("preciso rolar pra cima pra ver os
    // menus"). Encolher um nó de dentro não conserta uma árvore ancorada num
    // topo empurrado para fora.
    //
    // O dono da altura passou a ser hooks/useVisibleViewportShell.js, ligado no
    // nó raiz do layout v2 (layouts/v2/AppV2.jsx): ele reancora o casco inteiro
    // contra a visual viewport com `position: fixed` + `left/top/width/height`.
    // Um dono só. A compensação de `frameInsetPx` deixou de ser necessária aqui
    // porque ninguém mais escreve altura neste nó — o casco encolhe e o flex
    // redistribui, com a topbar e o header do chat dentro da área visível.
    //
    // O que ESTE handler ainda faz, e por que fica: chamar `fit()`. A área do
    // terminal muda quando o casco encolhe, e um `fit()` redundante é barato de
    // verdade — o FitAddon só chama `resize()` quando `cols`/`rows` mudaram de
    // fato, então sem mudança de geometria nenhum frame `{type:'resize'}` vai
    // para o WS. `scroll` além de `resize` porque em algumas versões do iOS o
    // teclado abrindo é reportado como pan da visual viewport, não como resize.
    const onVisualViewportChange = () => {
      if (!visibleRef.current) return;
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {
          console.warn('visualViewport fit failed', e);
        }
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onVisualViewportChange);
      window.visualViewport.addEventListener('scroll', onVisualViewportChange);
    }

    // 6. Cleanup (React 18 StrictMode Safety)
    return () => {
      mountCancelled = true;
      touchTarget.removeEventListener('touchstart', onTouchStart);
      touchTarget.removeEventListener('touchmove', onTouchMove);
      touchTarget.removeEventListener('touchend', onTouchEnd);
      touchTarget.removeEventListener('touchcancel', onTouchEnd);
      document.removeEventListener('touchstart', onOutsideTap);
      document.removeEventListener('mousedown', onOutsideTap);
      resizeObserver.disconnect();
      window.removeEventListener('escritorio:sidebar-toggled', onSidebarToggled);
      if (sidebarToggleTimer) {
        clearTimeout(sidebarToggleTimer);
        sidebarToggleTimer = null;
      }
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onVisualViewportChange);
        window.visualViewport.removeEventListener('scroll', onVisualViewportChange);
      }
      dataSub.dispose();
      resizeSub.dispose();
      linkDisposables.forEach((d) => d?.dispose?.());
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      intentionalCloseRef.current = true;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      if (webglAddonRef.current) {
        try {
          webglAddonRef.current.dispose();
        } catch (e) {
          console.warn('WebGL addon disposal failed', e);
        }
        webglAddonRef.current = null;
      }
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
    // Only the identity of the session (wsUrl, projectId, agentId) may re-run this
    // effect: it tears down and recreates the WebSocket and the xterm instance.
    // Every other input is read through refs.
  }, [wsUrl, projectId, agentId]);

  // Live theme update: only a new `theme` identity touches the running Terminal.
  // Declared AFTER the mount effect on purpose: when the session identity and the
  // theme change in the same render, the mount effect already built the new
  // Terminal with the latest theme and this one is a no-op.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    term.options.theme = resolveTheme(theme);
  }, [theme]);

  // Expose sendControlByte for the IpadToolbar via ref (TERM-03)
  const sendControlByte = useCallback((bytes) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes));
    }
  }, []);

  // Layout v2 "Ajustar layout" button: re-runs fitAddon.fit() + focus() on
  // demand, without touching the WebSocket/PTY at all. Distinct from the
  // visibility-change/resize-driven fit() calls above (which react to a
  // detected layout change) — this one is a user-triggered escape hatch for
  // whenever the terminal's dimensions drift from the actual visible area
  // (e.g. an iPad rotation/split-view resize the ResizeObserver/
  // visualViewport listeners didn't catch cleanly) and the fix is just "fit
  // again", never a session restart. Runs fit() synchronously AND once more
  // after a short delay, mirroring the same "layout settles a beat later"
  // pattern already used by the sidebar-toggle/visibility-change fits above.
  const refit = useCallback(() => {
    const doFit = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
          // Gate 1 de 3 do modo "esconder teclado". Com `readOnly` na textarea
          // o refoco não abre o teclado de tela, mas "Ajustar layout" é
          // justamente o botão que o Bruno usa quando o layout está torto e o
          // modo está ligado — refocar ali é ruído, e defesa em profundidade
          // aqui custa uma linha.
          if (!keyboardSuppressedRef.current) {
            terminalRef.current.focus();
          }
        } catch (e) {
          console.warn('forceFit failed', e);
        }
      }
    };
    doFit();
    setTimeout(doFit, 50);
  }, [keyboardSuppressedRef]);

  // Rodada 2, Frente C: cola via term.paste(), NUNCA via sendControlByte.
  // `paste()` normaliza \r\n -> \r e envolve o texto em bracketed paste
  // (\x1b[200~ … \x1b[201~) quando o modo está ligado — e a TUI do `claude`
  // LIGA bracketed paste. Sem isso, colar 5 linhas viraria 5 submits, cada um
  // podendo disparar uma ação. Também não usar o POST /api/sessions/{key}/paste
  // que já existe no repo: ele manda bytes crus, sem bracketed paste.
  // LIMITE DA MITIGAÇÃO (etapa 10, 2026-08-14): o wrap é CONDICIONAL —
  // `decPrivateModes.bracketedPasteMode` tem que estar ligado, e quem liga é a
  // aplicação que roda dentro do PTY. Agentes do tipo "terminal"
  // (powershell/cmd/bash puros, ver `_build_agent_cmd`) NÃO ligam: neles um
  // clipboard com \n executa na hora, e o único freio é o usuário ver o que
  // está colando. Não estender este caminho a origens de texto que não sejam o
  // clipboard do próprio usuário sem reavaliar isto.
  // Não depende de foco e não toca a textarea, então funciona com o modo
  // "esconder teclado" ativo — que é o ponto todo deste método existir.
  const pasteText = useCallback((text) => {
    if (typeof text === 'string' && text) {
      terminalRef.current?.paste(text);
    }
  }, []);

  // Focus the terminal unless the "hide keyboard" mode is on (same gate as the
  // other focus() calls above).
  const focus = useCallback(() => {
    if (!keyboardSuppressedRef.current) {
      terminalRef.current?.focus();
    }
  }, [keyboardSuppressedRef]);

  // Close the current socket without marking the close as intentional, so the
  // onclose handler schedules the usual reconnect.
  const closeSocket = useCallback(() => {
    wsRef.current?.close();
  }, []);

  return {
    status: connectionStatus,
    sendControlByte,
    pasteText,
    refit,
    focus,
    closeSocket,
    termRef: terminalRef,
  };
}
