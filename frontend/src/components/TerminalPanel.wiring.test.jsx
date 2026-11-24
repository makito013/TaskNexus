// Wiring of TerminalPanel (V2 shell) to the extracted src/terminal core:
// overlays driven by control frames and by status changes, the "start a new
// conversation" reset-then-reconnect order, and the V2-specific values the panel
// injects into the hook (theme tokens, web link handler, link provider).
// The 51 pre-existing panel tests stay untouched; this file only adds coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TerminalPanel } from './TerminalPanel.jsx';
import { openWebLink } from '../features/viewer/terminalLinks.js';
import { api } from '../services/api.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = [];
    constructor(options) {
      this.options = { ...options };
      this.cols = 80;
      this.rows = 24;
      this.textarea = document.createElement('textarea');
      this.paste = vi.fn();
      this.write = vi.fn();
      this.registerLinkProvider = vi.fn(() => ({ dispose() {} }));
      this.constructor.instances.push(this);
    }
    loadAddon() {}
    open(el) { if (el) el.appendChild(this.textarea); }
    focus() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    static handlers = [];
    constructor(handler) { this.constructor.handlers.push(handler); }
  },
}));
vi.mock('../services/api.js', () => ({
  api: { resetSession: vi.fn() },
}));

class FakeWebSocket {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
}

const RESUME_TEXT = /Esta sessão não pôde ser retomada/;
const RETRY_BUTTON = 'Iniciar nova conversa';
const SPAWN_TEXT = /Não foi possível iniciar o comando deste agente/;
const RECONNECTING_TEXT = /Tentando reconectar automaticamente/;
const EVICTED_TEXT = /aberta em outro dispositivo ou aba/;

function mountPanel() {
  render(<TerminalPanel sessionKey="proj::agent" projectId="proj" agentId="agent" visible />);
  return FakeWebSocket.instances[0];
}

function openSocket(ws) {
  ws.readyState = FakeWebSocket.OPEN;
  act(() => { ws.onopen(); });
}

async function sendControlFrame(ws, frame) {
  await act(async () => { await ws.onmessage({ data: JSON.stringify(frame) }); });
}

describe('TerminalPanel wiring to the terminal core', () => {
  let originalWebSocket;
  let originalResizeObserver;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    Terminal.instances = [];
    WebLinksAddon.handlers = [];
    api.resetSession.mockReset();
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.documentElement.style.removeProperty('--v2-bg');
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
  });

  describe('overlays', () => {
    it('shows the resume_failed overlay when the control frame arrives', async () => {
      const ws = mountPanel();
      expect(screen.queryByText(RESUME_TEXT)).toBeNull();
      await sendControlFrame(ws, { type: 'resume_failed' });
      expect(screen.getByText(RESUME_TEXT)).toBeTruthy();
      expect(Terminal.instances[0].write).not.toHaveBeenCalled();
    });

    it('shows the spawn_failed overlay with the backend detail, or a default message', async () => {
      const ws = mountPanel();
      await sendControlFrame(ws, { type: 'spawn_failed', detail: 'No such file: claude-work' });
      expect(screen.getByText(SPAWN_TEXT)).toBeTruthy();
      expect(screen.getByText('No such file: claude-work')).toBeTruthy();
      await sendControlFrame(ws, { type: 'spawn_failed' });
      expect(screen.getByText('Comando do agente não pôde ser iniciado.')).toBeTruthy();
    });

    it('clears the resume_failed, reset-error and spawn_failed overlays when a connection opens', async () => {
      vi.useFakeTimers();
      const first = mountPanel();
      openSocket(first);
      await sendControlFrame(first, { type: 'resume_failed' });
      await sendControlFrame(first, { type: 'spawn_failed', detail: 'boom' });
      api.resetSession.mockRejectedValueOnce(new Error('offline'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await act(async () => { fireEvent.click(screen.getByText(RETRY_BUTTON)); });
      expect(screen.getByText(/Falha ao reiniciar/)).toBeTruthy();

      act(() => { first.onclose({ code: 1006 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      openSocket(FakeWebSocket.instances[1]);

      expect(screen.queryByText(RESUME_TEXT)).toBeNull();
      expect(screen.queryByText(/Falha ao reiniciar/)).toBeNull();
      expect(screen.queryByText(SPAWN_TEXT)).toBeNull();

      // The reset error is state of its own: a later resume_failed on the new
      // connection must not resurrect the stale "reset failed" message.
      await sendControlFrame(FakeWebSocket.instances[1], { type: 'resume_failed' });
      expect(screen.getByText(RESUME_TEXT)).toBeTruthy();
      expect(screen.queryByText(/Falha ao reiniciar/)).toBeNull();
    });

    it('shows the reconnecting banner after an unexpected close and hides it once reopened', async () => {
      vi.useFakeTimers();
      const first = mountPanel();
      openSocket(first);
      act(() => { first.onclose({ code: 1006 }); });
      expect(screen.getByText(RECONNECTING_TEXT)).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      openSocket(FakeWebSocket.instances[1]);
      expect(screen.queryByText(RECONNECTING_TEXT)).toBeNull();
    });

    it('shows the evicted banner on close code 1008 and does not reconnect', async () => {
      vi.useFakeTimers();
      const ws = mountPanel();
      act(() => { ws.onclose({ code: 1008 }); });
      expect(screen.getByText(EVICTED_TEXT)).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe('start a new conversation', () => {
    it('resets the session first, then closes the socket and hides the overlay', async () => {
      const order = [];
      api.resetSession.mockImplementation(async () => { order.push('reset'); });
      const ws = mountPanel();
      ws.close.mockImplementation(() => { order.push('close'); ws.readyState = FakeWebSocket.CLOSED; });
      openSocket(ws);
      await sendControlFrame(ws, { type: 'resume_failed' });

      await act(async () => { fireEvent.click(screen.getByText(RETRY_BUTTON)); });

      expect(api.resetSession).toHaveBeenCalledWith('proj::agent');
      expect(order).toEqual(['reset', 'close']);
      expect(screen.queryByText(RESUME_TEXT)).toBeNull();
    });

    it('lets the close handler reconnect after the reset', async () => {
      vi.useFakeTimers();
      api.resetSession.mockResolvedValue(undefined);
      const ws = mountPanel();
      openSocket(ws);
      await sendControlFrame(ws, { type: 'resume_failed' });
      await act(async () => { fireEvent.click(screen.getByText(RETRY_BUTTON)); });
      act(() => { ws.onclose({ code: 1000 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('keeps the overlay, shows the error and leaves the socket alone when the reset fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      api.resetSession.mockRejectedValue(new Error('offline'));
      const ws = mountPanel();
      openSocket(ws);
      await sendControlFrame(ws, { type: 'resume_failed' });
      await act(async () => { fireEvent.click(screen.getByText(RETRY_BUTTON)); });
      expect(ws.close).not.toHaveBeenCalled();
      expect(screen.getByText(RESUME_TEXT)).toBeTruthy();
      expect(screen.getByText(/Falha ao reiniciar/)).toBeTruthy();
    });
  });

  describe('values injected into the core', () => {
    it('builds the terminal theme from the --v2-* tokens', () => {
      document.documentElement.style.setProperty('--v2-bg', '#123456');
      mountPanel();
      expect(Terminal.instances[0].options.theme.background).toBe('#123456');
    });

    it('connects to the /ws/pty/<sessionKey> endpoint of the current origin', () => {
      const ws = mountPanel();
      expect(ws.url).toBe(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/pty/proj::agent`);
    });

    it('opens web links through openWebLink', () => {
      mountPanel();
      expect(WebLinksAddon.handlers).toEqual([openWebLink]);
    });

    it('registers the file path link provider on the terminal', () => {
      mountPanel();
      expect(Terminal.instances[0].registerLinkProvider).toHaveBeenCalledTimes(1);
    });
  });
});
