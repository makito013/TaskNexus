// frontend/src/components/TerminalPanel.viewer.test.jsx
// Fase V-2 (06-planejamento-fase-v.md, 6.5.2/6.7): o frame de controle
// `viewer_open` que o backend manda pelo WebSocket do terminal quando o agente
// chama abrir_no_visualizador. Ele tem que (1) ser reconhecido como frame de
// controle — nunca escrito no xterm — e (2) chegar ao ViewerContext. Sem
// Provider (o TerminalPanel é montado isolado em vários testes) o frame é só
// descartado, sem erro.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { isControlFrame, TerminalPanel } from './TerminalPanel.jsx';
import { Terminal } from '@xterm/xterm';
import { useViewer, ViewerProvider } from '../features/viewer/ViewerContext.jsx';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances = [];
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.textarea = document.createElement('textarea');
      this.write = vi.fn();
      this.linkProviders = [];
      this.lines = [];
      this.buffer = { active: { getLine: (y) => (this.lines[y] === undefined ? undefined : { translateToString: () => this.lines[y] }) } };
      this.constructor.instances.push(this);
    }
    loadAddon() {}
    registerLinkProvider(provider) {
      this.linkProviders.push(provider);
      return { dispose() {} };
    }
    open(el) {
      if (el) el.appendChild(this.textarea);
    }
    focus() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { constructor(handler) { this.handler = handler; } } }));

const ITEM = {
  item_id: 'vw_abc',
  session_key: 'projA::claude',
  project_id: 'projA',
  path: 'docs/plano.md',
  title: 'plano.md',
  line: null,
  kind: 'markdown',
  language: 'markdown',
  opened_by: 'agent',
  created_at: 1,
  updated_at: 1,
};

describe('isControlFrame — viewer_open', () => {
  it('reconhece o frame viewer_open com item, reused e evicted', () => {
    const frame = { type: 'viewer_open', item: ITEM, reused: false, evicted: [] };
    expect(isControlFrame(JSON.stringify(frame))).toEqual(frame);
  });
});

describe('TerminalPanel — frame viewer_open', () => {
  class FakeWebSocket {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      FakeWebSocket.instances.push(this);
    }
    send() {}
    close() { this.readyState = FakeWebSocket.CLOSED; }
  }

  let originalWebSocket;
  let originalResizeObserver;
  let originalFetch;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    Terminal.instances = [];
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
  });

  afterEach(() => {
    cleanup();
    global.WebSocket = originalWebSocket;
    global.ResizeObserver = originalResizeObserver;
    global.fetch = originalFetch;
  });

  async function deliver(frame) {
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      await ws.onmessage({ data: JSON.stringify(frame) });
    });
  }

  it('sem ViewerProvider: descarta o frame sem escrever no terminal', async () => {
    render(<TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />);
    await deliver({ type: 'viewer_open', item: ITEM, reused: false, evicted: [] });
    expect(Terminal.instances[0].write).not.toHaveBeenCalled();
  });

  it('com ViewerProvider: a aba chega ao contexto (escopo da sessão do painel)', async () => {
    let viewer;
    function Probe() {
      viewer = useViewer();
      return null;
    }
    render(
      <ViewerProvider>
        <Probe />
        <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
      </ViewerProvider>,
    );
    await deliver({ type: 'viewer_open', item: ITEM, reused: false, evicted: [] });
    const scope = viewer.getScope('session:projA::claude');
    expect(scope.items.map((i) => i.id)).toEqual(['vw_abc']);
    expect(scope.activeId).toBe('vw_abc');
    expect(Terminal.instances[0].write).not.toHaveBeenCalled();
  });

  it('caminho de arquivo no terminal abre no visualizador (POST com a linha)', async () => {
    render(
      <ViewerProvider>
        <TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />
      </ViewerProvider>,
    );
    const term = Terminal.instances[0];
    expect(term.linkProviders).toHaveLength(1);
    term.lines = ['  ⎿ alterei src/app.py:42'];
    const callback = vi.fn();
    term.linkProviders[0].provideLinks(1, callback);
    const [links] = callback.mock.calls[0];
    expect(links.map((l) => l.text)).toEqual(['src/app.py:42']);

    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, item: { ...ITEM, item_id: 'vw_app', path: 'src/app.py', kind: 'code', line: 42 }, reused: false, delivered: true, evicted: [] }),
    }));
    await act(async () => { links[0].activate(new MouseEvent('click'), links[0].text); });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/sessions/projA::claude/viewer');
    expect(JSON.parse(init.body)).toEqual({ caminho: 'src/app.py', linha: 42 });
  });

  it('sem ViewerProvider o provider não sublinha nada', () => {
    render(<TerminalPanel sessionKey="projA::claude" projectId="projA" agentId="claude" visible />);
    const term = Terminal.instances[0];
    term.lines = ['docs/plano.md'];
    const callback = vi.fn();
    term.linkProviders[0].provideLinks(1, callback);
    expect(callback).toHaveBeenCalledWith(undefined);
  });
});
