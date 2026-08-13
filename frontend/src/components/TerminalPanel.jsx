import { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { api } from '../services/api.js';
import { resolveTerminalSkin } from './terminalSkin.js';
import { MOBILE_VIEWPORT_QUERY } from '../utils/viewport.js';

// Bug 2 fix: recognized WS text-frame types sent by the backend as control
// frames (as opposed to PTY output, which always travels as bytes/Blob — see
// send_bytes in backend/app/main.py). Today the backend only ever calls
// websocket.send_text() for these; any other string is treated as raw
// terminal output for backward compatibility (see isControlFrame below).
// 'spawn_failed' (.planning/debug/claude-work-ws-reconnect-loop.md): sent
// when the agent's configured `cmd` can't be spawned at all (e.g. a shell
// alias/function that isn't a real executable on PATH) — same "keep the
// socket open, don't let onclose reconnect into the same failure forever"
// shape as resume_failed.
const CONTROL_FRAME_TYPES = new Set(['resume_failed', 'spawn_failed']);

/** Pure/testable: returns the parsed control frame if `data` is a JSON string
 * whose `type` is in the allowlist above, otherwise null. `null` means "not a
 * recognized control frame" — the caller should fall back to writing `data`
 * to the terminal unchanged, preserving today's behavior for any string that
 * isn't backend-control JSON. */
export function isControlFrame(data) {
  if (typeof data !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && CONTROL_FRAME_TYPES.has(parsed.type)) {
    return parsed;
  }
  return null;
}

// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 18): tema do xterm.js
// derivado dos tokens `--v2-*` (theme.css) quando o layout ativo é v2 —
// resolvido UMA VEZ no mount, nunca reativo em runtime, porque a troca de
// layout/tema já é full-reload (decisão fechada do TL em AppearanceSwitch.jsx:
// window.location.reload() após o PUT resolver) — não existe um cenário em
// que dataset.layout mude sob um TerminalPanel já montado. `document.
// documentElement.dataset.layout` já está setado por main.jsx ANTES do
// primeiro render (fetchAppearance() resolve, dataset é setado, só ENTÃO
// ReactDOM.createRoot(...).render(<App/>) roda) — então lê-lo de forma
// síncrona aqui no mount é seguro, sem race.
//
// v1 (dataset.layout !== 'v2', incluindo ausente — ex.: testes que montam
// TerminalPanel isolado sem o bootstrap de main.jsx) mantém EXATAMENTE o
// tema anterior (--bg-surface/--text-primary/--accent-green, tokens v1) —
// zero mudança de comportamento pro v1, era o requisito explícito da tarefa.
function resolveTerminalTheme() {
  const isV2 = document.documentElement.dataset.layout === 'v2';
  const style = getComputedStyle(document.documentElement);
  const read = (token, fallback) => style.getPropertyValue(token).trim() || fallback;

  if (!isV2) {
    return {
      background: read('--bg-surface', '#111111'),
      foreground: read('--text-primary', '#e0e0e0'),
      cursor: read('--accent-green', '#4ade80'),
      cursorAccent: read('--bg-surface', '#111111'),
      selectionBackground: 'rgba(255, 255, 255, 0.15)',
    };
  }

  // Cores ANSI básicas mapeadas a partir da paleta --v2-* (Designer não
  // extraiu uma paleta ANSI de 16 cores dedicada do mockup — este mapeamento
  // é uma escolha pragmática do Dev: preto/branco a partir de bg/text,
  // vermelho a partir de --v2-danger, verde/ciano a partir de --v2-accent
  // (a cor de destaque "viva" do tema), azul/magenta a partir de --v2-accent-2,
  // amarelo sem token v2 dedicado, cai no --v2-accent-strong).
  const bg = read('--v2-bg', '#111111');
  const fg = read('--v2-text', '#e0e0e0');
  const accent = read('--v2-accent', '#4ade80');
  const accentStrong = read('--v2-accent-strong', accent);
  const accent2 = read('--v2-accent-2', '#60a5fa');
  const danger = read('--v2-danger', '#ff3333');
  const surface2 = read('--v2-surface-2', bg);
  const textFaint = read('--v2-text-faint', fg);

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    black: surface2,
    red: danger,
    green: accent,
    yellow: accentStrong,
    blue: accent2,
    magenta: accent2,
    cyan: accent,
    white: fg,
    brightBlack: textFaint,
    brightRed: danger,
    brightGreen: accent,
    brightYellow: accentStrong,
    brightBlue: accent2,
    brightMagenta: accent2,
    brightCyan: accent,
    brightWhite: fg,
  };
}

export const TerminalPanel = forwardRef(function TerminalPanel({ sessionKey, projectId, agentId, visible }, ref) {
  // Repaginação estética (PLAN-terminal-skin.md, T2): toda a camada visual —
  // geometria da moldura, paleta, tipografia, faixas — vem de uma função pura
  // resolvida UMA VEZ no mount. `useMemo(..., [])` e não `useState`/efeito
  // porque nada disto é reativo: troca de layout ou de tema é full-reload
  // (AppearanceSwitch.jsx chama window.location.reload() depois do PUT), e
  // main.jsx seta `dataset.layout`/`dataset.theme` antes do primeiro render.
  // Consequência aceita e documentada: `narrow` também é mount-once, ou seja o
  // fontSize NÃO reage a uma rotação do iPad — consistente com layout/theme,
  // que já se comportam assim. Não é bug, não abrir ticket.
  //
  // A guarda de `typeof window.matchMedia` NÃO é redundante: o jsdom deste
  // repo não implementa matchMedia (mesmo motivo documentado em
  // hooks/useIsTouchDevice.js), e sem ela todo teste que monta o TerminalPanel
  // isolado quebraria com TypeError. 640px é MOBILE_VIEWPORT_QUERY, o mesmo
  // gate que decide se o botão flutuante "☰ Menu" existe — usar outro valor
  // abriria uma faixa de larguras com o botão presente e a compensação ausente.
  const skin = useMemo(() => resolveTerminalSkin(
    document.documentElement.dataset.layout,
    document.documentElement.dataset.theme,
    {
      narrow: typeof window.matchMedia === 'function'
        && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches,
    },
  ), []);

  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const webglAddonRef = useRef(null);
  const wsRef = useRef(null);
  const visibleRef = useRef(visible);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  // Bug 2 fix: dedicated state, deliberately NOT folded into connectionStatus
  // (connecting/open/reconnecting/evicted) — resume_failed is orthogonal to
  // socket connectivity: the WS stays OPEN, just without a PTY behind it.
  const [resumeFailed, setResumeFailed] = useState(false);
  // Bug 2 QA follow-up: surfaces a failure of the "Iniciar nova conversa"
  // retry (POST /reset) itself — e.g. backend unreachable / flaky iPad
  // network. Without this the user is stuck on the overlay with no feedback
  // and no indication that clicking the same button again might work.
  const [resetError, setResetError] = useState(false);
  // .planning/debug/claude-work-ws-reconnect-loop.md: the agent's cmd could
  // not be spawned at all (e.g. it names a shell alias/function, not a real
  // executable on PATH) — holds the backend's `detail` string so the user
  // gets an actionable message instead of a silent reconnect loop.
  const [spawnFailedDetail, setSpawnFailedDetail] = useState(null);

  // Expose sendControlByte for the IpadToolbar via ref (TERM-03)
  useImperativeHandle(ref, () => ({
    sendControlByte(bytes) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes));
      }
    },
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
    forceFit() {
      const doFit = () => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit();
            terminalRef.current.focus();
          } catch (e) {
            console.warn('forceFit failed', e);
          }
        }
      };
      doFit();
      setTimeout(doFit, 50);
    }
  }), []);

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
            terminalRef.current.focus();
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
    const term = new Terminal({
      cursorBlink: true,
      theme: resolveTerminalTheme(),
      fontFamily: 'SF Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
    });
    terminalRef.current = term;

    // 2. Load Fit addon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // 3. Mount to DOM
    term.open(containerRef.current);
    if (visibleRef.current) {
      try {
        fitAddon.fit();
        // A brand-new session mounts already active (this is the panel the user
        // just opened) — grab focus immediately so typing works without an extra
        // click, same as the visibility-change effect does for tab switches.
        term.focus();
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

    // 4. Connect WebSocket (wrapped so onclose can reconnect without recreating the Terminal)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/pty/${sessionKey}`;
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
        setConnectionStatus('open');
        // A fresh connection either gets a working PTY or a new resume_failed
        // frame if it fails again — either way, any resume_failed overlay from
        // a previous connection attempt on this same socket lineage is stale.
        setResumeFailed(false);
        setResetError(false);
        setSpawnFailedDetail(null);
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
              if (controlFrame.type === 'resume_failed') {
                setResumeFailed(true);
              } else if (controlFrame.type === 'spawn_failed') {
                setSpawnFailedDetail(controlFrame.detail || 'Comando do agente não pôde ser iniciado.');
              }
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
          setConnectionStatus('evicted');
          return;
        }
        setConnectionStatus('reconnecting');
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
    const FONTS_READY_TIMEOUT_MS = 500;

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
        new Promise((resolve) => setTimeout(resolve, FONTS_READY_TIMEOUT_MS)),
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
    // term.element when the user taps the terminal itself, and (b) this
    // component's own auto-focus effects on mount / tab-switch (see the two
    // term.focus() calls above — desired, do not remove).
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
    // toggle animates `width` via CSS transition (v1 Sidebar.jsx: 150ms; v2
    // SidebarV2.jsx: 180ms) rather than an instant layout jump — the
    // ResizeObserver above only fires once the transition settles into a new
    // final size, but xterm's own fit() sampled mid-transition can land on a
    // stale intermediate width. Re-fitting after a fixed delay long enough to
    // cover the longest known transition (180ms + margin) is simpler and more
    // robust than trying to detect `transitionend` on an element this
    // component doesn't own. useSidebarCollapsed() dispatches this event on
    // every toggle, from either layout, since both share that hook.
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

    // 5e. RF03 Tarefa 4 (plano Layout v2, 06-TL.md): iPad on-screen keyboard
    // shrinks `window.visualViewport` without shrinking `window.innerHeight`
    // (Safari keeps the layout viewport/100dvh full-height and instead pans
    // it under the keyboard) — so the wrapper below, which inherits
    // height:100% from `.app-root`'s 100dvh, stays sized for the keyboard-less
    // viewport and the actual usable area (and the terminal's fit()ted
    // rows/cols) ends up wrong/occluded once the keyboard is up. Also listens
    // on `scroll` because iOS sometimes reports the shrink as the visual
    // viewport being scrolled/offset rather than resized.
    const VIEWPORT_TOLERANCE_PX = 2;
    const onVisualViewportChange = () => {
      if (!visibleRef.current) return;
      const vv = window.visualViewport;
      const wrapper = wrapperRef.current;
      if (!vv || !wrapper) return;
      const delta = window.innerHeight - vv.height;
      if (delta > VIEWPORT_TOLERANCE_PX) {
        // `- 2 * frameInsetPx` desconta o padding que o root ganhou no v2 (4px
        // em cima e embaixo): o wrapper é filho do root, então a altura que
        // sobra para ele é a do viewport visual menos esse padding. No v1
        // frameInsetPx é 0 e a conta continua sendo `vv.height`, idêntica à de
        // hoje.
        //
        // ⚠️ Honestidade sobre o alcance disto (C2 do plano): esta linha é
        // provavelmente INERTE hoje, nos dois layouts. O wrapper tem
        // `flex: 1` = `flex: 1 1 0%`, e num container flex em coluna com
        // `flex-basis` definido a propriedade `height` não é usada para o
        // tamanho no eixo principal — o `flex-grow` reexpande o wrapper para
        // preencher o root de qualquer jeito. O que este handler efetivamente
        // faz é chamar `fit()`. A correção entra porque a aritmética fica
        // honesta e custa uma linha, NÃO porque conserta o teclado virtual do
        // iPad. O RF03 de verdade (a altura ignorar o header e a barra de
        // atalhos do terminal) continua aberto e é outro ticket, com
        // investigação em hardware.
        wrapper.style.height = `${vv.height - 2 * skin.frameInsetPx}px`;
      } else {
        wrapper.style.height = '';
      }
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
    // `skin` é lido dentro deste efeito (onVisualViewportChange) mas NÃO entra
    // nas dependências de propósito: vem de um useMemo com lista vazia, é
    // estável por toda a vida do componente, e acrescentá-lo aqui só criaria a
    // ilusão de que o efeito reage a ele. Este efeito derruba e recria o
    // WebSocket e a instância do xterm — só identidade de sessão pode
    // dispará-lo.
  }, [sessionKey, projectId, agentId]);

  // Bug 2 fix: order matters here — reset() must resolve BEFORE the socket is
  // closed. Closing first would let the existing onclose reconnect handler
  // race ahead and reconnect with the OLD claude_session_id still mapped,
  // reopening the same "No conversation found" failure. Resetting first
  // clears that mapping, so the reconnect that onclose schedules next lands
  // on the resume=False branch server-side and spawns a clean session.
  const handleStartNewConversation = async () => {
    setResetError(false);
    try {
      await api.resetSession(sessionKey);
    } catch (err) {
      console.error('Falha ao reiniciar sessão', err);
      setResetError(true);
      return;
    }
    setResumeFailed(false);
    wsRef.current?.close();
  };

  return (
    <div style={skin.root}>
      {connectionStatus === 'reconnecting' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: '#ff3333',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid #ff3333',
        }}>
          Conexão encerrada com o servidor. Tentando reconectar automaticamente...
        </div>
      )}
      {connectionStatus === 'evicted' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-muted)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          Esta sessão foi aberta em outro dispositivo ou aba. Selecione o agente novamente ou recarregue a página para reconectar aqui.
        </div>
      )}
      {resumeFailed && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span>Esta sessão não pôde ser retomada. Iniciar uma nova conversa?</span>
            <button
              onClick={handleStartNewConversation}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                background: 'var(--accent-green)',
                color: '#111',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Iniciar nova conversa
            </button>
          </div>
          {resetError && (
            <span style={{ color: '#ff3333' }}>
              Falha ao reiniciar. Tentando novamente pode funcionar.
            </span>
          )}
        </div>
      )}
      {spawnFailedDetail && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid #ff3333',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <span>Não foi possível iniciar o comando deste agente.</span>
          <span style={{ color: 'var(--text-muted)' }}>{spawnFailedDetail}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Verifique nas configurações (⚙) se o campo "comando" desse agente é um executável real (ex.: "claude --settings ~/.claude-work"), não um alias/atalho do seu terminal.
          </span>
        </div>
      )}
      {/*
        Two nested divs, not one, on purpose (see .planning/debug/terminal-cursor-desalinhado.md):
        @xterm/addon-fit's FitAddon.proposeDimensions() reads
        getComputedStyle(this._terminal.element.parentElement) — i.e. THIS component's
        term.open() target — as the available width/height, and only subtracts the
        padding of xterm's own internal `.xterm` element (always 0), never the padding
        of its own parentElement. Combined with the global `box-sizing: border-box`
        reset (index.css), a padded parentElement makes getComputedStyle(...).width
        include that padding, so FitAddon over-counts cols/rows by the padding amount —
        desyncing the PTY-reported terminal size from the true visible area (matches
        xterm.js upstream issue #1283, unresolved as of writing). The fix: keep the
        padding on an OUTER wrapper and give the term.open() target (containerRef)
        zero padding of its own, so FitAddon's parentElement measurement is exact.
      */}
      {/*
        A MOLDURA. Toda a geometria vem inline do skin (testável sem CSS); só a
        COR da borda e sua transição moram em `.v2-terminal-frame` no theme.css,
        porque têm estado (`:focus-within`) — e estilo inline vence classe por
        especificidade, então um `border: '1px solid …'` aqui mataria a regra de
        foco em silêncio. No v1 `frameClassName` é undefined (React não emite o
        atributo) e o estilo é o literal congelado de sempre.
      */}
      <div ref={wrapperRef} className={skin.frameClassName} style={skin.frame}>
        {/*
          `data-terminal-viewport` marca o nó do term.open() para os testes de
          INV-TERM-GEOM: com o Vitest rodando `css: false`, um padding que
          migrasse daqui para uma classe passaria invisível ao getComputedStyle.
          Por isso o teste assevera também que este nó NÃO tem className.
        */}
        <div ref={containerRef} data-terminal-viewport style={skin.viewport} />
      </div>
    </div>
  );
});
