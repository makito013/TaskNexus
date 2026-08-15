// frontend/src/components/TerminalPanel.test.jsx
// Bug 2 fix: isControlFrame(data) is the pure, easily-testable piece of the
// resume_failed handling in TerminalPanel's ws.onmessage bridge. It decides
// whether an incoming WS text frame is a backend control frame (JSON, `type`
// in the allowlist) or should fall through to being written verbatim to the
// terminal, preserving pre-existing behavior for any other string.

import { createRef } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { isControlFrame, TerminalPanel } from './TerminalPanel.jsx';
import { FitAddon } from '@xterm/addon-fit';
// A classe mockada logo abaixo. Importada para alcançar `Terminal.instances` — a
// instância que o TerminalPanel cria vive num ref interno e não há outro caminho
// até ela.
import { Terminal } from '@xterm/xterm';
import {
  KEYBOARD_SUPPRESSED_EVENT,
  KEYBOARD_SUPPRESSED_STORAGE_KEY,
} from '../hooks/useKeyboardSuppressed.js';
// Fake compartilhado de window.visualViewport (jsdom não implementa a API).
// Este arquivo tinha DUAS copias locais de uma versão com só `height` — sem
// `width`/`offsetLeft`/`offsetTop`, que são as dimensões que expressam o PAN da
// layout viewport que o Safari faz por baixo do teclado. O fake compartilhado
// tem os cinco campos, então os testes de geometria do FAB (e qualquer frente
// futura que reancore o casco contra a área visível) reproduzem o sintoma real
// em vez de metade dele. Única diferença de API para as cópias locais: o
// construtor recebe um OBJETO (`{ height: 800 }`) — com cinco dimensões, um
// argumento posicional deixaria de ser legível.
import { FakeVisualViewport } from '../test/fakeVisualViewport.js';

// @xterm/xterm and its addons touch canvas/WebGL APIs jsdom doesn't implement,
// so the mount tests below (unlike the pure isControlFrame tests above) stub
// them out with the minimal surface TerminalPanel.jsx actually calls.
//
// Bug 2 fix (keyboard opens anywhere): open()/focus() below mimic just enough
// of xterm's real behavior — a real focusable `textarea` mounted INSIDE the
// term.open() target, actually gaining DOM focus on focus() — for the
// outside-tap-blur tests further down to exercise the real focus/blur
// mechanism instead of asserting against a no-op.
//
// Rodada 2, Frente C: `paste()` e `Terminal.instances` são acréscimos. A
// instância real vive num ref interno do TerminalPanel e não há outra forma de
// alcançá-la para asseverar que `pasteText()` do imperative handle chama
// `term.paste()` (o que preserva o bracketed paste) e não `ws.send`. Mesmo padrão
// de `FakeWebSocket.instances` usado pelos describes abaixo; quem lê o array é
// responsável por resetá-lo no seu beforeEach.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = [];
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.textarea = document.createElement('textarea');
      this.paste = vi.fn();
      this.constructor.instances.push(this);
    }
    loadAddon() {}
    open(el) {
      if (el) el.appendChild(this.textarea);
    }
    write() {}
    focus() { this.textarea.focus(); }
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose() {}
  },
}));

describe('isControlFrame', () => {
  it('recognizes a resume_failed control frame', () => {
    const data = JSON.stringify({ type: 'resume_failed', session_key: 'projA::claude' });
    expect(isControlFrame(data)).toEqual({ type: 'resume_failed', session_key: 'projA::claude' });
  });

  // .planning/debug/claude-work-ws-reconnect-loop.md
  it('recognizes a spawn_failed control frame', () => {
    const data = JSON.stringify({
      type: 'spawn_failed',
      session_key: 'projA::claude-work',
      detail: "[Errno 2] No such file or directory: 'claude-work'",
    });
    expect(isControlFrame(data)).toEqual({
      type: 'spawn_failed',
      session_key: 'projA::claude-work',
      detail: "[Errno 2] No such file or directory: 'claude-work'",
    });
  });

  it('returns null for a non-JSON string (falls back to raw terminal write)', () => {
    expect(isControlFrame('[32mhello[0m')).toBeNull();
    expect(isControlFrame('just plain text output')).toBeNull();
  });

  it('returns null for JSON whose type is outside the allowlist', () => {
    expect(isControlFrame(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))).toBeNull();
    expect(isControlFrame(JSON.stringify({ type: 'something_else' }))).toBeNull();
  });

  it('returns null for JSON with no type field at all', () => {
    expect(isControlFrame(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(isControlFrame(null)).toBeNull();
    expect(isControlFrame(undefined)).toBeNull();
    expect(isControlFrame(123)).toBeNull();
    expect(isControlFrame({ type: 'resume_failed' })).toBeNull();
  });

  it('returns null for a JSON array (valid JSON, not an object with type)', () => {
    expect(isControlFrame(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});

// .planning/debug/ws-reconnect-storm.md
//
// Regression guard for the reconnect storm: a close code 1008 means the
// backend's single-reader eviction closed THIS connection because a newer
// client (another tab/device) attached to the same session_key — not a
// network blip. Reconnecting here would immediately re-evict the other side,
// which would reconnect and re-evict this one, forever. ws.onclose (this
// file, ~line 224) must recognize code 1008 and skip scheduling a reconnect,
// showing the "evicted" banner instead; any other close code must still
// reconnect as before.
describe('TerminalPanel — WS close-code handling (reconnect storm regression)', () => {
  class FakeWebSocket {
    static instances = [];
    // Match the real WebSocket readyState constants — the component reads
    // them off the global `WebSocket` (e.g. `ws.readyState === WebSocket.OPEN`),
    // not off an instance, so these must line up with what's installed below.
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    // jsdom (the test DOM environment) doesn't implement ResizeObserver;
    // TerminalPanel.jsx only uses it to re-fit the terminal on layout
    // changes, irrelevant to the WS close-code behavior under test here.
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('does not schedule a reconnect when the socket closes with code 1008 (eviction)', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    act(() => {
      ws.onclose({ code: 1008, reason: 'New connection established' });
      // Advance well past the reconnect backoff window (max 10s) — if the
      // 1008 branch didn't return early, a second socket would appear here.
      vi.advanceTimersByTime(15000);
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(
      screen.getByText(/Esta sessão foi aberta em outro dispositivo ou aba/)
    ).toBeTruthy();
  });

  it('still schedules a reconnect for a non-1008 close (e.g. a real network blip)', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    act(() => {
      ws.onclose({ code: 1006, reason: '' });
      // First backoff step is ~1s; 15s comfortably covers it.
      vi.advanceTimersByTime(15000);
    });

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });
});

// Bug 2 (2026-07-16): "o teclado abre a todo momento em qualquer lugar q
// clico" — iOS shows the on-screen keyboard whenever xterm's hidden
// `.xterm-helper-textarea` has focus. Once the terminal auto-focuses (mount /
// tab-switch — see the two term.focus() calls in TerminalPanel.jsx, both
// intentionally left untouched), tapping anywhere else in the app (sidebar
// rows, gear icon, tabs — plain divs/buttons that never blur the previously
// focused element) left the keyboard open, reading as "opens no matter where
// I tap". These tests exercise the mechanism of the fix: a document-level
// outside-tap listener that blurs the terminal's textarea unless the tap
// landed inside the terminal itself or on an explicitly opted-out control
// (data-terminal-safe-tap — IpadToolbar's D-10 buttons).
//
// Ceiling of what these tests can prove: jsdom can confirm `blur()` is called
// (or skipped) on the right element for the right tap target. It cannot
// confirm iOS Safari actually dismisses the on-screen keyboard when that
// happens — that requires validation on a physical iPad.
describe('TerminalPanel — outside-tap blur (bug 2: keyboard opens anywhere)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('blurs the terminal textarea when tapping outside the terminal container', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    const textarea = container.querySelector('textarea');
    expect(document.activeElement).toBe(textarea); // mount effect auto-focused it

    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    act(() => {
      outsideEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.activeElement).not.toBe(textarea);
    document.body.removeChild(outsideEl);
  });

  it('does not blur when tapping inside the terminal container', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    const textarea = container.querySelector('textarea');
    expect(document.activeElement).toBe(textarea);

    act(() => {
      textarea.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.activeElement).toBe(textarea); // unaffected — xterm's own handling applies here
  });

  it('does not blur when tapping a control opted out via data-terminal-safe-tap (D-10)', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    const textarea = container.querySelector('textarea');
    expect(document.activeElement).toBe(textarea);

    const safeButton = document.createElement('button');
    safeButton.setAttribute('data-terminal-safe-tap', 'true');
    document.body.appendChild(safeButton);
    act(() => {
      safeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.activeElement).toBe(textarea); // IpadToolbar's ^C/Tab/arrow/Esc buttons must keep terminal focus
    document.body.removeChild(safeButton);
  });
});

// Root-cause fix for "texto desconfigurado" on reconnect: a custom monospace
// font (SF Mono/Fira Code) may still be loading at the moment of the initial
// fit(), so the browser measures cell size against its fallback font and the
// InitFrame sent to the backend (term.cols/term.rows) can carry a stale
// geometry. The mount effect now waits for document.fonts.ready (bounded by
// a 500ms fallback timeout via Promise.race) and re-fits BEFORE calling
// connectSocket() — these tests exercise that ordering directly. jsdom does
// not implement document.fonts at all (confirmed: `typeof document.fonts ===
// 'undefined'`), which is exactly why every OTHER test in this file already
// exercises the synchronous `else` branch (no document.fonts -> connect
// immediately) — these tests are what cover the `if` branch instead, by
// installing a fake `document.fonts` for their duration only.
describe('TerminalPanel — waits for document.fonts.ready before connecting (texto desconfigurado fix)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;
  let originalFontsDescriptor;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // Preserve whatever (if anything) is already on document.fonts so each
    // test can install its own fake and this can restore the real shape
    // afterwards, regardless of which test ran.
    originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  });

  afterEach(() => {
    cleanup();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
    if (originalFontsDescriptor) {
      Object.defineProperty(document, 'fonts', originalFontsDescriptor);
    } else {
      delete document.fonts;
    }
  });

  it('does not connect until document.fonts.ready resolves, then connects', async () => {
    let resolveFonts;
    const fontsReady = new Promise((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReady },
      configurable: true,
    });

    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    // Fonts haven't resolved yet — connectSocket() must not have run.
    expect(FakeWebSocket.instances).toHaveLength(0);

    await act(async () => {
      resolveFonts();
      await fontsReady;
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('falls back to connecting after the 500ms timeout when fonts.ready never resolves', async () => {
    const neverResolves = new Promise(() => {});
    Object.defineProperty(document, 'fonts', {
      value: { ready: neverResolves },
      configurable: true,
    });
    vi.useFakeTimers();

    try {
      render(
        <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
      );

      expect(FakeWebSocket.instances).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not connect after unmount even if fonts.ready resolves later (mountCancelled guard)', async () => {
    let resolveFonts;
    const fontsReady = new Promise((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReady },
      configurable: true,
    });

    const { unmount } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    unmount();

    await act(async () => {
      resolveFonts();
      await fontsReady;
    });

    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

// RF02 Tarefa 3 (plano Layout v2, 06-TL.md): sidebar collapse/expand toggle
// animates `width` via CSS transition rather than an instant layout jump —
// ResizeObserver (which jsdom doesn't implement and is stubbed out below)
// only fires once a transition settles, and a fit() sampled mid-transition
// can land on a stale intermediate width. useSidebarCollapsed() dispatches
// a global `escritorio:sidebar-toggled` CustomEvent on every toggle (from
// either layout); TerminalPanel listens for it and re-fits after a fixed
// 250ms delay (see TerminalPanel.jsx ~line 503-519) chosen to outlast the
// longest known sidebar transition (180ms + margin).
describe('TerminalPanel — sidebar-toggled re-fit (RF02)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;
  let fitSpy;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    fitSpy = vi.spyOn(FitAddon.prototype, 'fit');
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fitSpy.mockRestore();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('does not re-fit synchronously when the sidebar-toggled event fires', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    fitSpy.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
    });

    expect(fitSpy).not.toHaveBeenCalled();
  });

  it('re-fits ~250ms after the sidebar-toggled event fires', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    fitSpy.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
      vi.advanceTimersByTime(250);
    });

    expect(fitSpy).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid repeated toggles into a single re-fit', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    fitSpy.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
      vi.advanceTimersByTime(250);
    });

    expect(fitSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-fit when the panel is not visible', () => {
    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible={false} />
    );
    fitSpy.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
      vi.advanceTimersByTime(250);
    });

    expect(fitSpy).not.toHaveBeenCalled();
  });

  it('stops listening and clears the pending timer after unmount', () => {
    const { unmount } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
    });

    unmount();
    fitSpy.mockClear();

    // A pending re-fit scheduled before unmount must not fire afterwards,
    // and a post-unmount dispatch must not throw or schedule anything either
    // — the listener was removed in the effect's cleanup.
    expect(() => {
      act(() => {
        window.dispatchEvent(new CustomEvent('escritorio:sidebar-toggled'));
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();
    expect(fitSpy).not.toHaveBeenCalled();
  });
});

// Rodada 2, Frente B: o teclado nativo do iPad encolhe `window.visualViewport`
// sem encolher `window.innerHeight` (o Safari mantém a layout viewport cheia e a
// PANEIA por baixo do teclado). Este componente deixou de ter opinião sobre
// altura: quem encolhe é o casco do app, via hooks/useVisibleViewportShell.js
// ligado no nó raiz do AppV2. O que sobrou aqui é reagir aos eventos da visual
// viewport com um `fit()`.
//
// Por que este bloco foi REESCRITO e não estendido: os 7 testes que estavam aqui
// asseveravam essencialmente a mesma coisa (`el.style.height === '500px'`) num
// jsdom sem engine de layout, ou seja, passavam com o bug 100% presente — a
// escrita de altura era inerte na renderização real por causa do `flex: 1 1 0%`
// do nó. Pior: só passavam porque montam sem o bootstrap do main.jsx, o que dá a
// skin v1 e `frameInsetPx = 0`; no v2 real o valor era 492px e nada cobria.
// Substituir asserção de valor inline por asserção de AUSÊNCIA de valor inline é
// o que este bloco pode honestamente provar; que o layout de fato encolha só é
// verificável em dispositivo.
//
// jsdom não implementa `window.visualViewport`, daí o fake compartilhado de
// src/test/fakeVisualViewport.js (todo outro teste deste arquivo exercita o ramo
// falso do guard `if (window.visualViewport)` implicitamente, por simplesmente
// não definir a API).
describe('TerminalPanel — visualViewport keyboard handling', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;
  let originalVisualViewport;
  let originalInnerHeight;
  let fitSpy;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    originalVisualViewport = window.visualViewport;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    fitSpy = vi.spyOn(FitAddon.prototype, 'fit');
  });

  afterEach(() => {
    cleanup();
    fitSpy.mockRestore();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  it('re-fits the terminal when the visual viewport changes', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    // Os DOIS eventos no mesmo teste de propósito: o iOS reporta o teclado
    // abrindo como `resize` em algumas versões e como `scroll` (pan da visual
    // viewport) em outras, e é justamente essa ambiguidade que faz o componente
    // escutar os dois. Um teste por evento seria a mesma asserção duas vezes.
    vv.height = 500; // teclado de tela cobre ~300px
    fitSpy.mockClear();
    act(() => {
      vv.fire('resize');
    });
    expect(fitSpy).toHaveBeenCalled();

    fitSpy.mockClear();
    act(() => {
      vv.fire('scroll');
    });
    expect(fitSpy).toHaveBeenCalled();
  });

  it('no longer writes an inline height on the wrapper (the app shell owns the shrink)', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    // A moldura é o pai direto do nó do term.open() — o mesmo nó que este
    // componente pinava com a altura da visual viewport até a Frente B.
    const frame = container.querySelector('[data-terminal-viewport]').parentElement;
    const heightBefore = frame.style.height;

    vv.height = 500;
    vv.offsetTop = 120; // o Safari paneou a layout viewport, além de encolher
    act(() => {
      vv.fire('resize');
    });

    // Nenhuma altura de teclado escrita aqui, e nada mudou em relação ao
    // repouso: o único dono da altura agora é hooks/useVisibleViewportShell.js,
    // no nó raiz do AppV2. Se alguém reintroduzir a escrita neste componente,
    // passa a haver dois donos e a altura oscila entre eles.
    expect(frame.style.height).toBe(heightBefore);
    expect(frame.style.height).not.toBe('500px');
    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '500px')
    ).toBe(false);
  });

  it('does nothing when the panel is not visible', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible={false} />
    );
    fitSpy.mockClear();

    vv.height = 500;
    act(() => {
      vv.fire('resize');
    });

    expect(fitSpy).not.toHaveBeenCalled();
  });

  it('does not throw when window.visualViewport is undefined (unsupported browser)', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });

    expect(() => {
      render(
        <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
      );
    }).not.toThrow();
  });

  it('removes visualViewport listeners on unmount', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { unmount } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    expect(vv.listenerCount('resize')).toBeGreaterThan(0);
    expect(vv.listenerCount('scroll')).toBeGreaterThan(0);

    unmount();

    expect(vv.listenerCount('resize')).toBe(0);
    expect(vv.listenerCount('scroll')).toBe(0);
  });
});

// Layout v2 "Ajustar layout" button (TL plano, Decisão 1): forceFit() is the
// imperative escape hatch exposed via ref for the button to call — it must
// re-run fitAddon.fit() (+ focus the terminal) TWICE: once synchronously and
// once again after a short delay, exactly like the visibility-change/
// sidebar-toggle fits elsewhere in this file already do, in case the layout
// settles a beat later than the click. Crucially, it must never touch the
// WebSocket/PTY — this suite only asserts on fit()/focus(), no socket
// assertions, because forceFit() has no business with the connection at all.
describe('TerminalPanel — forceFit() via ref (Ajustar layout button)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;
  let fitSpy;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    fitSpy = vi.spyOn(FitAddon.prototype, 'fit');
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fitSpy.mockRestore();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('exposes forceFit on the ref, which fits synchronously and again after 50ms', () => {
    const ref = createRef();
    render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(typeof ref.current.forceFit).toBe('function');
    fitSpy.mockClear();

    act(() => {
      ref.current.forceFit();
    });
    expect(fitSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(fitSpy).toHaveBeenCalledTimes(2);
  });

  it('focuses the terminal on forceFit()', () => {
    const ref = createRef();
    const { container } = render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const textarea = container.querySelector('textarea');
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    act(() => {
      ref.current.forceFit();
    });

    expect(document.activeElement).toBe(textarea);
  });

  it('does not touch the WebSocket connection', () => {
    const ref = createRef();
    render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');

    act(() => {
      ref.current.forceFit();
      vi.advanceTimersByTime(50);
    });

    expect(closeSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

// Repaginação estética da tela de terminal (PLAN-terminal-skin.md, T2): a
// moldura do v2. A geometria toda vem de resolveTerminalSkin() e já é coberta
// em terminalSkin.test.js sem DOM nenhum; o que ESTAS suítes cobrem é o que só
// existe depois de montar — que o skin certo chegou aos nós certos.
//
// Teto do que dá para provar aqui: o Vitest roda com `css: false`
// (vite.config.js não tem `test.css`), então NENHUMA regra de theme.css existe
// durante o teste. Cor de borda, `:focus-within`, raio e transição são
// invisíveis daqui e ficam só no QA manual. Por isso a asserção que importa
// sobre o nó do term.open() é a AUSÊNCIA de className: se um dia alguém mover
// o padding dele para uma classe, o getComputedStyle continuaria devolvendo
// zero neste ambiente e a regressão passaria batida — só o `className === ''`
// pega.
describe('TerminalPanel — terminal frame skin (v1 default)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('marks the term.open() target with data-terminal-viewport', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const viewport = container.querySelector('[data-terminal-viewport]');
    expect(viewport).toBeTruthy();
    // É o nó que recebeu o term.open() do mock — a textarea foi anexada nele.
    expect(viewport.querySelector('textarea')).toBeTruthy();
  });

  // INV-TERM-GEOM. Padding ou borda aqui seriam contados em dobro pelo
  // FitAddon (box-sizing: border-box global) e desalinhariam cols/rows do PTY.
  it('gives the viewport no class name, so no stylesheet can add padding to it', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(container.querySelector('[data-terminal-viewport]').className).toBe('');
  });

  it('keeps the viewport free of padding and border', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const viewport = container.querySelector('[data-terminal-viewport]');
    expect(viewport.style.padding).toBe('0px');
    expect(viewport.style.border).toBe('0px');
  });

  // O v1 está em produção: nenhuma classe, nenhum padding novo no root, e o
  // wrapper mantém o `--bg-surface` de sempre.
  it('adds no frame class under v1', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const frame = container.querySelector('[data-terminal-viewport]').parentElement;
    expect(frame.className).toBe('');
    expect(frame.style.padding).toBe('12px');
    expect(frame.style.background).toBe('var(--bg-surface)');
    expect(frame.style.borderRadius).toBe('');
  });

  it('leaves the root without padding under v1', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(container.firstChild.style.padding).toBe('0px');
  });
});

describe('TerminalPanel — terminal frame skin (v2)', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // O skin é resolvido UMA VEZ no mount a partir do dataset do <html> (que
    // em produção o main.jsx seta antes do primeiro render) — então isto tem
    // que estar no lugar ANTES do render, não depois.
    document.documentElement.dataset.layout = 'v2';
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(() => {
    cleanup();
    // Todo o resto deste arquivo depende do default v1 (dataset ausente, que é
    // também o estado real de qualquer teste que monte o TerminalPanel
    // isolado) — limpar aqui é o que mantém as outras suítes exercitando o v1.
    delete document.documentElement.dataset.layout;
    delete document.documentElement.dataset.theme;
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  it('adds the v2-terminal-frame class to the wrapper', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const frame = container.querySelector('[data-terminal-viewport]').parentElement;
    expect(frame.className).toBe('v2-terminal-frame');
  });

  it('applies the frame geometry inline but never the border shorthand', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const frame = container.querySelector('[data-terminal-viewport]').parentElement;
    expect(frame.style.padding).toBe('8px');
    expect(frame.style.borderWidth).toBe('1px');
    expect(frame.style.borderStyle).toBe('solid');
    expect(frame.style.borderRadius).toBe('10px');
    // A cor da borda é do theme.css (tem :focus-within). Se aparecer aqui,
    // a especificidade do inline matou a regra de foco.
    expect(frame.style.borderColor).toBe('');
  });

  // O bug que esta entrega corrige por consequência: `--bg-surface` é token do
  // v1 com valor fixo #111111, e pintava uma auréola quase-preta de 12px em
  // volta de um terminal creme no v2 tema claro.
  it('stops painting the wrapper with the v1 --bg-surface token', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const frame = container.querySelector('[data-terminal-viewport]').parentElement;
    expect(frame.style.background).not.toContain('--bg-surface');
    expect(frame.style.background).toBe('rgb(20, 23, 30)'); // #14171e
  });

  it('gives the root the 4px inset that separates the frame from the page', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(container.firstChild.style.padding).toBe('4px');
  });

  // INV-TERM-GEOM continua valendo do outro lado do gate.
  it('keeps the viewport identical to v1 (no padding, no border, no class)', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const viewport = container.querySelector('[data-terminal-viewport]');
    expect(viewport.className).toBe('');
    expect(viewport.style.padding).toBe('0px');
    expect(viewport.style.border).toBe('0px');
  });

  // REMOVIDO na Rodada 2, Frente B: havia aqui um
  // `it('discounts the root inset from the pinned visual-viewport height')` que
  // asseverava `frame.style.height === '492px'` (= 500 − 2 × frameInsetPx) depois
  // de um resize da visual viewport. Ele testava a única coisa que a Frente B
  // apagou: a escrita de altura no nó da moldura, que era INERTE na renderização
  // real (`flex: 1 1 0%` reexpande o nó) e cujo dono passou a ser
  // hooks/useVisibleViewportShell.js, no casco do AppV2. Não foi convertido
  // porque o que ele provava de útil — que o v2 dá 4px de inset ao root — já está
  // coberto por 'gives the root the 4px inset that separates the frame from the
  // page', acima, sem depender do teclado. A ausência da escrita é asseverada em
  // 'no longer writes an inline height on the wrapper'.
});

// Rodada 2, Frente C: o modo "esconder teclado".
//
// O que é ASSEVERÁVEL aqui e o que não é: se o iOS abre ou não o teclado de tela
// é comportamento do SO, testável só por PROXY (`textarea.readOnly === true`), e
// o mesmo vale para "o cursor do xterm continua aceso" e para o menu nativo de
// Colar. O que estes testes cobrem é a mecânica que este componente é dono:
// aplicar/reverter `readOnly`, não roubar foco quando o modo está ligado, o blur
// único da transição, e o paste passando por `term.paste()`.
describe('TerminalPanel — keyboard suppression', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    Terminal.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
    // Limpar nos DOIS lados: um teste que falhe no meio deixaria a preferência
    // ligada e o próximo passaria (ou falharia) pelo motivo errado.
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  it('marks the xterm textarea readOnly while suppression is on', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    // O proxy do "teclado não abre": o iOS só mostra o teclado de tela para um
    // campo MUTÁVEL com foco.
    expect(container.querySelector('textarea').readOnly).toBe(true);
  });

  it('leaves the textarea editable when suppression is off', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    expect(container.querySelector('textarea').readOnly).toBe(false);
  });

  it('does not focus the terminal on mount while suppression is on', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    // Gate 3 dos 3 term.focus(). É o que garante que um RELOAD com o modo ligado
    // não abra o teclado em momento nenhum durante o boot: `keyboardSuppressedRef`
    // é inicializado no primeiro render, antes do efeito de mount.
    expect(document.activeElement).not.toBe(container.querySelector('textarea'));
  });

  it('does not focus the terminal on forceFit() while suppression is on', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const ref = createRef();
    const { container } = render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const textarea = container.querySelector('textarea');

    act(() => { ref.current.forceFit(); });

    // Gate 1 dos 3. "Ajustar layout" é justamente o botão que o Bruno usa quando
    // o layout está torto, e o modo pode estar ligado nesse momento.
    expect(document.activeElement).not.toBe(textarea);
  });

  it('blurs a focused textarea when suppression is switched on', () => {
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const textarea = container.querySelector('textarea');
    expect(document.activeElement).toBe(textarea); // o mount focou (modo desligado)

    // Simula o toque no toggle do painel, que vive em outro ramo da árvore: o
    // CustomEvent é a ponte, exatamente como `escritorio:sidebar-toggled`.
    act(() => {
      localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
      window.dispatchEvent(new CustomEvent(KEYBOARD_SUPPRESSED_EVENT, { detail: true }));
    });

    // `readOnly` sozinho NÃO retira da tela um teclado que já está aberto — o iOS
    // só o retira num blur. Daí o blur ÚNICO desta transição.
    expect(textarea.readOnly).toBe(true);
    expect(document.activeElement).not.toBe(textarea);
  });

  it('reverts readOnly when suppression is switched back off', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const textarea = container.querySelector('textarea');
    expect(textarea.readOnly).toBe(true);

    act(() => {
      localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'false');
      window.dispatchEvent(new CustomEvent(KEYBOARD_SUPPRESSED_EVENT, { detail: false }));
    });

    // O modo tem que ser REVERSÍVEL sem reload: um `readOnly` que fica pra sempre
    // é um terminal que não digita mais, e o usuário não teria como sair de lá.
    expect(textarea.readOnly).toBe(false);
  });

  it('applies readOnly to the terminal recreated by a session change', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    const { container, rerender } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    expect(Terminal.instances).toHaveLength(1);

    // Trocar de sessão derruba e recria o Terminal (deps do efeito grande). O
    // efeito de [keyboardSuppressed] NÃO roda de novo, porque o VALOR não mudou —
    // é exatamente por isso que o readOnly também é aplicado logo depois do
    // term.open(). Sem essa segunda escrita, o terminal novo nasceria editável e
    // o teclado voltaria a abrir só depois de trocar de sessão.
    rerender(
      <TerminalPanel sessionKey="projB::claude" projectId="projB" agentId="claude" visible />
    );

    expect(Terminal.instances).toHaveLength(2);
    // Asseverado na INSTÂNCIA, não em `container.querySelector('textarea')`: o
    // `dispose()` do mock não desanexa a textarea antiga do DOM (o container é o
    // mesmo nó, só o Terminal foi recriado), então o querySelector devolveria a
    // do terminal MORTO e o teste passaria pelo motivo errado.
    expect(Terminal.instances[1].textarea.readOnly).toBe(true);
    expect(container.querySelectorAll('textarea')[1]).toBe(Terminal.instances[1].textarea);
  });

  it('pastes through term.paste so bracketed paste and newline handling are preserved', () => {
    const ref = createRef();
    render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const term = Terminal.instances[0];
    const ws = FakeWebSocket.instances[0];
    const sendSpy = vi.spyOn(ws, 'send');

    act(() => { ref.current.pasteText('linha 1\r\nlinha 2'); });

    // term.paste() normaliza \r\n -> \r e envolve em bracketed paste quando o
    // modo está ligado; a TUI do `claude` LIGA bracketed paste. Mandar os bytes
    // crus pelo WS (sendControlByte, ou o POST /paste que já existe no repo)
    // faria um paste de 5 linhas virar 5 submits.
    expect(term.paste).toHaveBeenCalledWith('linha 1\r\nlinha 2');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('ignores pasteText for empty or non-string input', () => {
    const ref = createRef();
    render(
      <TerminalPanel ref={ref} sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    const term = Terminal.instances[0];

    act(() => {
      ref.current.pasteText('');
      ref.current.pasteText(null);
      ref.current.pasteText(undefined);
    });

    expect(term.paste).not.toHaveBeenCalled();
  });
});
