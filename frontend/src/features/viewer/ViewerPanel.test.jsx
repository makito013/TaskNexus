// frontend/src/features/viewer/ViewerPanel.test.jsx
// Fase V-2 (6.2, tabela "Estados"): o painel com o ViewerContext de verdade e
// o fetch dublado — vazio, carregando, markdown, arquivo apagado, erro de rede,
// arquivo grande, abas (trocar/fechar) e a barra (Baixar/Abrir no navegador).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { ViewerProvider, useViewer, useViewerHost } from './ViewerContext.jsx';
import { ViewerPanel } from './ViewerPanel.jsx';
import { ViewerButton } from './ViewerButton.jsx';
import { clearViewerContentCache } from './useViewerContent.js';

vi.mock('./highlight.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, highlightToTokens: () => Promise.resolve(null) };
});

const SK = 'projA::claude';
const SCOPE = `session:${SK}`;

function item(id, extra = {}) {
  return {
    item_id: id, session_key: SK, project_id: 'projA', path: `docs/${id}.md`, title: `${id}.md`,
    line: null, kind: 'markdown', language: 'markdown', opened_by: 'agent', created_at: 1, updated_at: 1, ...extra,
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

// Rotas dubladas: lista de abas + /content por item.
let listItems = [];
let contents = {};
function installFetch() {
  global.fetch = vi.fn((url, init) => {
    if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ status: 'closed' }));
    if (url === `/api/sessions/${SK}/viewer`) return Promise.resolve(jsonResponse({ items: listItems }));
    const match = /^\/api\/viewer\/([^/]+)\/content$/.exec(url);
    if (match) {
      const entry = contents[match[1]];
      if (entry instanceof Error) return Promise.reject(entry);
      if (entry?.status) return Promise.resolve(jsonResponse({ detail: entry.detail }, entry.status));
      return Promise.resolve(jsonResponse(entry));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
}

let viewer;
function Harness({ scope = SCOPE }) {
  viewer = useViewer();
  useViewerHost({ activeSessionKey: SK, chatVisible: true, isMobile: false });
  return (
    <>
      <ViewerButton scope={scope} />
      <ViewerPanel scope={scope} variant="dock" onClose={() => viewer.setOpen('chat', false)} />
    </>
  );
}

async function mount() {
  await act(async () => {
    render(<ViewerProvider><Harness /></ViewerProvider>);
  });
}

describe('ViewerPanel', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    listItems = [];
    contents = {};
    clearViewerContentCache();
    installFetch();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('estado vazio orienta a pedir ao agente', async () => {
    await mount();
    expect(screen.getByText('Nenhum arquivo aberto ainda')).toBeTruthy();
    expect(screen.getByText('abre o README no visualizador')).toBeTruthy();
  });

  it('sem conversa: pede para abrir um chat', async () => {
    await act(async () => {
      render(<ViewerProvider><Harness scope={null} /></ViewerProvider>);
    });
    expect(screen.getByText('Nenhuma conversa aberta')).toBeTruthy();
  });

  it('mostra o markdown da aba ativa, com a barra do arquivo', async () => {
    listItems = [item('plano')];
    contents.plano = { kind: 'markdown', text: '# Plano\n\nTexto', size: 12 * 1024, name: 'plano.md', is_text: true, truncated: false };
    await mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Plano' })).toBeTruthy());
    expect(screen.getByText('docs/plano.md')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Baixar' }).getAttribute('href')).toBe('/api/viewer/plano/f/docs/plano.md?download=1');
    const open = screen.getByRole('link', { name: 'Abrir no navegador' });
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('href')).toBe('/api/viewer/plano/f/docs/plano.md');
    // Contador do botão do cabeçalho: uma aba.
    expect(screen.getByTestId('viewer-button-badge').textContent).toBe('1');
  });

  it('arquivo apagado (404): mensagem e "Fechar aba" fecha a aba', async () => {
    listItems = [item('sumiu')];
    contents.sumiu = { status: 404, detail: 'Arquivo não encontrado: docs/sumiu.md' };
    await mount();
    await waitFor(() => expect(screen.getByText('Este arquivo não existe mais')).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar aba' })); });
    expect(viewer.getScope(SCOPE).items).toEqual([]);
  });

  it('erro de rede: "Tentar de novo" refaz a busca', async () => {
    listItems = [item('a')];
    contents.a = new TypeError('Failed to fetch');
    await mount();
    await waitFor(() => expect(screen.getByText('Não consegui carregar o arquivo')).toBeTruthy());
    contents.a = { kind: 'markdown', text: 'voltou', size: 6, is_text: true, truncated: false };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })); });
    await waitFor(() => expect(screen.getByText('voltou')).toBeTruthy());
  });

  it('arquivo > 1 MB: cartão de download, e "Mostrar o começo" mostra o texto', async () => {
    listItems = [item('grande', { kind: 'code', language: 'text', path: 'logs/grande.log' })];
    contents.grande = { kind: 'code', language: 'text', text: 'primeira linha', size: 5_000_000, name: 'grande.log', mime: 'text/plain', is_text: true, truncated: true };
    await mount();
    await waitFor(() => expect(screen.getByText('O arquivo é grande demais para mostrar aqui.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar o começo' }));
    expect(screen.getByText('primeira linha')).toBeTruthy();
    expect(screen.getByText(/Mostrando só o primeiro 1 MB/)).toBeTruthy();
  });

  it('abas: trocar ativa outra e × fecha', async () => {
    listItems = [item('a'), item('b', { updated_at: 2 })];
    contents.a = { kind: 'markdown', text: 'conteúdo A', is_text: true, truncated: false };
    contents.b = { kind: 'markdown', text: 'conteúdo B', is_text: true, truncated: false };
    await mount();
    await waitFor(() => expect(screen.getByText('conteúdo B')).toBeTruthy());
    const bodyB = screen.getByTestId('viewer-body');
    bodyB.scrollTop = 300;
    fireEvent.click(screen.getByRole('tab', { name: 'a.md' }));
    await waitFor(() => expect(screen.getByText('conteúdo A')).toBeTruthy());
    // Corpo novo por aba: a rolagem da aba anterior não vaza para esta.
    expect(screen.getByTestId('viewer-body')).not.toBe(bodyB);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar aba a.md' })); });
    expect(screen.queryByRole('tab', { name: 'a.md' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'b.md' }).getAttribute('aria-selected')).toBe('true');
  });

  it('aba de código mostra "arquivo:linha" e o código com a linha destacada', async () => {
    listItems = [item('app', { kind: 'code', language: 'python', path: 'src/app.py', title: 'app.py', line: 2 })];
    contents.app = { kind: 'code', language: 'python', text: 'a = 1\nb = 2\n', is_text: true, truncated: false };
    await mount();
    expect(screen.getByRole('tab', { name: 'app.py:2' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-line="2"]').className).toContain('vw-line--target'));
  });

  it('o selo do botão destaca abas não vistas', async () => {
    await mount();
    act(() => {
      viewer.hostRef.current = { ...viewer.hostRef.current, chatVisible: false };
      viewer.receiveOpen(SK, item('novo'));
    });
    expect(screen.getByTestId('viewer-button-badge').getAttribute('data-unseen')).toBe('true');
    fireEvent.click(screen.getByTestId('viewer-button'));
    expect(screen.getByTestId('viewer-button-badge').getAttribute('data-unseen')).toBe('false');
  });

  it('Fase A: onOpenPath do contêiner substitui o openByPath (escopo local) e recebe a aba ativa', async () => {
    const onOpenPath = vi.fn();
    global.fetch = vi.fn((url) => {
      if (url === '/api/artifacts/af_1/content') {
        return Promise.resolve(jsonResponse({ kind: 'markdown', text: '[plano](plano.md)', size: 20 }));
      }
      return Promise.resolve(jsonResponse({ items: [] }));
    });
    function Local() {
      viewer = useViewer();
      return <ViewerPanel scope="artefatos" variant="dock" onClose={() => {}} onOpenPath={onOpenPath} />;
    }
    await act(async () => { render(<ViewerProvider><Local /></ViewerProvider>); });
    await act(async () => {
      viewer.openItem('artefatos', { artifact_id: 'af_1', project_id: 'projA', path: 'docs/a.md', kind: 'markdown', updated_at: 1 }, { source: 'artifact' });
    });
    await waitFor(() => expect(screen.getByText('plano')).toBeTruthy());
    fireEvent.click(screen.getByText('plano'));
    expect(onOpenPath).toHaveBeenCalledWith('plano.md', { relativoA: 'docs/a.md' }, expect.objectContaining({ id: 'af_1', source: 'artifact' }));
  });
});
