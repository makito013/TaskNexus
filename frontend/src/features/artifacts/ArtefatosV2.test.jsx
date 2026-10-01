// frontend/src/features/artifacts/ArtefatosV2.test.jsx
// Fase A (7.7, "Frontend"): a tela Artefatos com o ViewerContext de verdade e
// o fetch dublado — grupos em "Todos os projetos", grade com projeto escolhido,
// chips e busca, estados (carregando, vazio, erro, arquivo não encontrado),
// abrir no painel (1 e 2 abas), abas guardadas no sessionStorage e links
// relativos dentro de um artefato.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { ViewerProvider, useViewer } from '../viewer/ViewerContext.jsx';
import { clearViewerContentCache } from '../viewer/useViewerContent.js';
import { ArtefatosV2 } from './ArtefatosV2.jsx';
import { ARTIFACT_TABS_KEY } from './useArtifactTabsStorage.js';

vi.mock('../viewer/highlight.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, highlightToTokens: () => Promise.resolve(null) };
});

const NOW_S = Date.now() / 1000;

function art(id, extra = {}) {
  return {
    artifact_id: id,
    project_id: 'podesubir/site',
    cliente_id: 'podesubir',
    path: `docs/${id}.md`,
    kind: 'markdown',
    title: `Título ${id}`,
    description: null,
    excerpt: `Trecho ${id}`,
    size: 1024,
    mtime: NOW_S - 3600,
    exists: true,
    created_by: 'agent',
    agent_label: 'claude',
    created_at: NOW_S - 3600,
    updated_at: NOW_S - 3600,
    ...extra,
  };
}

const PROJECTS = [
  { id: 'podesubir', nome: 'Pode Subir', path: '/p/podesubir', sub_projetos: ['podesubir/site', 'podesubir/api'] },
  { id: 'podesubir/site', nome: 'site', path: '/p/podesubir/site', sub_projetos: [] },
  { id: 'podesubir/api', nome: 'api', path: '/p/podesubir/api', sub_projetos: ['podesubir/api/v2'] },
  { id: 'podesubir/api/v2', nome: 'v2', path: '/p/podesubir/api/v2', sub_projetos: [] },
  { id: 'outro', nome: 'Outro', path: '/p/outro', sub_projetos: [] },
];

const LIST = [
  art('a1', { title: 'Plano de release' }),
  art('a2', { kind: 'html', path: 'docs/relatorio.html', title: 'Relatório de testes', updated_at: NOW_S - 60, mtime: NOW_S - 60 }),
  art('b1', { project_id: 'podesubir/api/v2', kind: 'pdf', path: 'entregas/proposta.pdf', title: 'Proposta', excerpt: '4 páginas' }),
  art('b2', { project_id: 'podesubir/api', path: 'docs/fluxo.md', title: 'Fluxo', exists: false }),
];

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

let listResponse;
let calls;
function installFetch() {
  calls = [];
  global.fetch = vi.fn((url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith('/api/artifacts?') || url === '/api/artifacts') {
      if (listResponse instanceof Error) return Promise.reject(listResponse);
      return Promise.resolve(jsonResponse({ artifacts: listResponse }));
    }
    const content = /^\/api\/artifacts\/([^/]+)\/content$/.exec(url);
    if (content) {
      return Promise.resolve(jsonResponse({ kind: 'markdown', text: '# Doc\n\n[outro](relatorio.html) [solto](solto.md)', size: 40 }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
}

let viewer;
function Probe() {
  viewer = useViewer();
  return null;
}

async function mount(props = {}) {
  await act(async () => {
    render(
      <ViewerProvider>
        <Probe />
        <ArtefatosV2 projects={PROJECTS} selectedClienteId={null} selectedProjetoId={null} {...props} />
      </ViewerProvider>,
    );
  });
}

describe('ArtefatosV2', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    listResponse = LIST;
    clearViewerContentCache();
    installFetch();
    window.sessionStorage.removeItem(ARTIFACT_TABS_KEY);
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    viewer = null;
  });

  it('em "Todos os projetos" agrupa por projeto com "CLIENTE / PROJETO · N"', async () => {
    await mount();
    expect(calls[0].url).toBe('/api/artifacts');
    const site = screen.getByTestId('artifacts-group-podesubir/site');
    expect(within(site).getByRole('heading').textContent).toBe('Pode Subir / site · 2');
    // Recentes: o relatório (há 1 min) antes do plano (há 1 h).
    const cards = within(site).getAllByRole('button', { name: /\((MD|HTML)\)/ });
    expect(cards[0].getAttribute('aria-label')).toMatch(/^Relatório de testes/);
    expect(screen.getByTestId('artifacts-group-podesubir/api/v2').textContent).toContain('Pode Subir / api / v2 · 1');
  });

  it('com um projeto da sidebar busca pelo cliente e mostra só a grade (com subprojetos)', async () => {
    await mount({ selectedClienteId: 'podesubir', selectedProjetoId: 'podesubir/api' });
    expect(calls[0].url).toBe('/api/artifacts?cliente_id=podesubir');
    expect(screen.queryByTestId(/^artifacts-group-/)).toBeNull();
    expect(screen.getByTestId('artifact-card-b1')).toBeTruthy();
    expect(screen.getByTestId('artifact-card-b2')).toBeTruthy();
    expect(screen.queryByTestId('artifact-card-a1')).toBeNull();
    // Subprojeto aparece no caminho do cartão.
    expect(screen.getByTestId('artifact-card-b1').textContent).toContain('v2 · entregas/proposta.pdf');
    // O select de projeto da barra vem preenchido com o da sidebar.
    expect(screen.getByLabelText('Filtrar por projeto').value).toBe('podesubir/api');
  });

  it('chips de tipo e busca filtram; sem resultado mostra "Limpar filtros"', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(screen.getByRole('button', { name: 'PDF' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('artifact-card-b1')).toBeTruthy();
    expect(screen.queryByTestId('artifact-card-a1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    fireEvent.change(screen.getByLabelText(/Buscar artefatos/), { target: { value: 'relatorio' } });
    expect(screen.getByTestId('artifact-card-a2')).toBeTruthy();
    expect(screen.queryByTestId('artifact-card-a1')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Buscar artefatos/), { target: { value: 'nada disso' } });
    expect(screen.getByTestId('artifacts-empty-filter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByTestId('artifact-card-a1')).toBeTruthy();
  });

  it('ordem "Nome" ordena pelo título', async () => {
    await mount({ selectedClienteId: 'podesubir', selectedProjetoId: 'podesubir/site' });
    fireEvent.change(screen.getByLabelText('Ordenar artefatos'), { target: { value: 'nome' } });
    const labels = screen.getAllByRole('button', { name: /\((MD|HTML)\)$/ }).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Plano de release (MD)', 'Relatório de testes (HTML)']);
  });

  it('cartão de arquivo sumido: borda tracejada e selo "arquivo não encontrado"', async () => {
    await mount();
    const card = screen.getByTestId('artifact-card-b2');
    expect(card.className).toContain('af-card--missing');
    expect(card.getAttribute('data-missing')).toBe('true');
    expect(within(card).getByText('arquivo não encontrado')).toBeTruthy();
    expect(card.textContent).not.toContain('Trecho b2');
  });

  it('estado vazio com o texto da especificação', async () => {
    listResponse = [];
    await mount();
    const empty = screen.getByTestId('artifacts-empty');
    expect(empty.textContent).toContain('Nenhum artefato aqui ainda.');
    expect(empty.textContent).toContain('Quando um agente criar um relatório, documento ou PDF, ele aparece nesta tela.');
  });

  it('carregando mostra 6 esqueletos; erro mostra "Tentar de novo"', async () => {
    let resolveList;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveList = resolve; }));
    await mount();
    expect(screen.getByTestId('artifacts-loading').children).toHaveLength(6);
    await act(async () => { resolveList(jsonResponse({ success: false, error: 'boom' }, 500)); });
    expect(screen.getByText('Não consegui carregar os artefatos.')).toBeTruthy();
    installFetch();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })); });
    expect(screen.getByTestId('artifact-card-a1')).toBeTruthy();
  });

  it('tocar num cartão abre o painel com a aba; outro cartão abre a segunda aba', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
    expect(screen.getByTestId('viewer-drawer')).toBeTruthy();
    expect(viewer.getScope('artefatos').items.map((i) => i.id)).toEqual(['a1']);
    expect(screen.getByTestId('artifact-card-a1').className).toContain('af-card--active');
    expect(calls.some((c) => c.url === '/api/artifacts/a1/content')).toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a2')); });
    const scope = viewer.getScope('artefatos');
    expect(scope.items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(scope.activeId).toBe('a2');
    expect(scope.items[0].source).toBe('artifact');
  });

  it('celular: abrir vai direto para a tela cheia', async () => {
    await mount({ isMobile: true });
    viewer.hostRef.current = { ...viewer.hostRef.current, isMobile: true };
    await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
    expect(screen.getByTestId('viewer-fullscreen')).toBeTruthy();
    expect(screen.queryByTestId('viewer-drawer')).toBeNull();
  });

  it('as abas ficam no sessionStorage e voltam sem abrir o painel', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
    const stored = JSON.parse(window.sessionStorage.getItem(ARTIFACT_TABS_KEY));
    expect(stored.items.map((i) => i.artifact_id)).toEqual(['a1']);
    expect(stored.activeId).toBe('a1');
    cleanup();
    await mount();
    expect(viewer.getScope('artefatos').items.map((i) => i.id)).toEqual(['a1']);
    expect(viewer.getSurface('artefatos').open).toBe(false);
  });

  it('sessionStorage inacessível não quebra a tela', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('privado'); });
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('privado'); });
    try {
      await mount();
      await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
      expect(viewer.getScope('artefatos').items).toHaveLength(1);
    } finally {
      spy.mockRestore();
      spySet.mockRestore();
    }
  });

  it('link para outro artefato da lista abre outra aba; link solto abre no navegador', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      await mount();
      await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
      await waitFor(() => expect(screen.getByText('outro')).toBeTruthy());
      await act(async () => { fireEvent.click(screen.getByText('outro')); });
      expect(viewer.getScope('artefatos').items.map((i) => i.id)).toEqual(['a1', 'a2']);
      expect(openSpy).not.toHaveBeenCalled();

      await act(async () => { viewer.setActive('artefatos', 'a1'); });
      await waitFor(() => expect(screen.getByText('solto')).toBeTruthy());
      fireEvent.click(screen.getByText('solto'));
      expect(openSpy).toHaveBeenCalledWith('/api/artifacts/a1/f/docs/solto.md', '_blank', 'noopener,noreferrer');
    } finally {
      openSpy.mockRestore();
    }
  });

  it('viewer_open de .md recarrega a lista; de .py não', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mount();
      const before = calls.filter((c) => c.url === '/api/artifacts').length;
      await act(async () => {
        viewer.receiveOpen('podesubir/site::claude', { item_id: 'v1', path: 'src/app.py', updated_at: 1 });
      });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(calls.filter((c) => c.url === '/api/artifacts').length).toBe(before);
      await act(async () => {
        viewer.receiveOpen('podesubir/site::claude', { item_id: 'v2', path: 'docs/novo.md', updated_at: 2 });
      });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(calls.filter((c) => c.url === '/api/artifacts').length).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
