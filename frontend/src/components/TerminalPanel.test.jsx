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
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.textarea = document.createElement('textarea');
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

// RF03 Tarefa 4 (plano Layout v2, 06-TL.md): iPad on-screen keyboard shrinks
// `window.visualViewport` without shrinking `window.innerHeight` (Safari
// keeps the layout viewport/100dvh full-height and pans it under the
// keyboard instead). TerminalPanel listens for visualViewport 'resize' and
// 'scroll' and, when the gap exceeds a small tolerance, pins the terminal
// wrapper's height to the shrunk visual viewport height and re-fits — see
// TerminalPanel.jsx ~line 521-556. jsdom doesn't implement
// window.visualViewport at all, so these tests install a minimal fake
// EventTarget-like stub for the duration of the block only (every other
// test in this file exercises the `if (window.visualViewport)` guard's
// false branch implicitly, by simply not defining it).
describe('TerminalPanel — visualViewport keyboard handling (RF03)', () => {
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

  it('shrinks the wrapper height and re-fits when the keyboard opens (viewport shrinks)', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    fitSpy.mockClear();

    vv.height = 500; // on-screen keyboard covers ~300px
    act(() => {
      vv.fire('resize');
    });

    // Locate the wrapper the component actually styles: it's the direct
    // parent of the xterm container, identified by its inline height style.
    const styledWrapper = Array.from(container.querySelectorAll('div')).find(
      (el) => el.style.height === '500px'
    );
    expect(styledWrapper).toBeTruthy();
    expect(fitSpy).toHaveBeenCalled();
  });

  it('resets the wrapper height once the viewport gap is back within tolerance', () => {
    const vv = new FakeVisualViewport({ height: 500 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );
    act(() => {
      vv.fire('resize'); // establish the shrunk state first
    });
    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '500px')
    ).toBe(true);

    vv.height = 800; // keyboard dismissed
    act(() => {
      vv.fire('resize');
    });

    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '500px')
    ).toBe(false);
  });

  it('also reacts to a scroll event on the visual viewport (iOS offset-instead-of-resize case)', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    vv.height = 500;
    act(() => {
      vv.fire('scroll');
    });

    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '500px')
    ).toBe(true);
  });

  it('ignores viewport changes within the tolerance (no visible height jitter)', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
    );

    vv.height = 799; // 1px delta, below the 2px tolerance
    act(() => {
      vv.fire('resize');
    });

    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '799px')
    ).toBe(false);
  });

  it('does nothing when the panel is not visible', () => {
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    const { container } = render(
      <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible={false} />
    );
    fitSpy.mockClear();

    vv.height = 500;
    act(() => {
      vv.fire('resize');
    });

    expect(
      Array.from(container.querySelectorAll('div')).some((el) => el.style.height === '500px')
    ).toBe(false);
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

  // C2 do plano: a aritmética passa a descontar o padding do root. É honesta,
  // mas provavelmente inerte na renderização real — o wrapper tem
  // `flex: 1 1 0%` e o flex-grow reexpande a altura de qualquer jeito. Este
  // teste prova o gate de layout, não a correção do teclado do iPad (que
  // segue aberta, em outro ticket).
  it('discounts the root inset from the pinned visual-viewport height', () => {
    const originalVisualViewport = window.visualViewport;
    const originalInnerHeight = window.innerHeight;
    const vv = new FakeVisualViewport({ height: 800 });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    try {
      const { container } = render(
        <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
      );

      vv.height = 500;
      act(() => {
        vv.fire('resize');
      });

      const frame = container.querySelector('[data-terminal-viewport]').parentElement;
      // 500 - 2 * 4. Sob v1 o mesmo cenário continua dando '500px' — é essa
      // diferença que prova que o gate de layout funcionou.
      expect(frame.style.height).toBe('492px');
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        value: originalVisualViewport,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        value: originalInnerHeight,
        configurable: true,
      });
    }
  });
});
