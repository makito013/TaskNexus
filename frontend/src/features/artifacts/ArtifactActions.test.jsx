// frontend/src/features/artifacts/ArtifactActions.test.jsx
// Fase A (7.7, "Frontend" e passo 7 da 7.6): menu do cartão (⋯, toque longo e
// botão direito) — Copiar caminho, Citar no chat (paste sem enviar), Renomear
// (PATCH), Remover da lista com 2 toques (DELETE, aba fechada) — e o
// "☆ Salvar em Artefatos" do visualizador do chat.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { ViewerProvider, useViewer } from '../viewer/ViewerContext.jsx';
import { ViewerToolbar } from '../viewer/ViewerToolbar.jsx';
import { ViewerToast } from '../viewer/ViewerToast.jsx';
import { clearViewerContentCache } from '../viewer/useViewerContent.js';
import { ArtefatosV2 } from './ArtefatosV2.jsx';
import { ARTIFACT_TABS_KEY } from './useArtifactTabsStorage.js';
import { clearArtifactStatusCache } from './useSaveToArtifacts.js';
import { placeMenu } from './ArtifactActionsMenu.jsx';

vi.mock('../viewer/highlight.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, highlightToTokens: () => Promise.resolve(null) };
});

const copyMock = vi.fn(() => Promise.resolve(true));
vi.mock('../../utils/clipboard.js', () => ({
  copyTextToClipboard: (...args) => copyMock(...args),
}));

function art(id, extra = {}) {
  return {
    artifact_id: id, project_id: 'cli/site', cliente_id: 'cli', path: `docs/${id}.md`, kind: 'markdown',
    title: `Título ${id}`, description: null, excerpt: null, size: 10, mtime: 1, exists: true,
    created_by: 'agent', agent_label: 'claude', created_at: 1, updated_at: 1, ...extra,
  };
}

const PROJECTS = [
  { id: 'cli', nome: 'Cliente', path: '/p/cli', sub_projetos: ['cli/site'] },
  { id: 'cli/site', nome: 'site', path: '/p/cli/site', sub_projetos: [] },
];

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

let calls;
let list;
function installFetch() {
  calls = [];
  global.fetch = vi.fn((url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url === '/api/artifacts' && init.method === 'POST') {
      return Promise.resolve(jsonResponse(art('novo', { path: 'docs/aberto.md' }), 201));
    }
    if (url.startsWith('/api/artifacts?') || url === '/api/artifacts') {
      return Promise.resolve(jsonResponse({ artifacts: list }));
    }
    const one = /^\/api\/artifacts\/([^/]+)$/.exec(url);
    if (one && init.method === 'PATCH') {
      return Promise.resolve(jsonResponse({ ...list.find((a) => a.artifact_id === one[1]), title: JSON.parse(init.body).titulo }));
    }
    if (one && init.method === 'DELETE') return Promise.resolve(jsonResponse({ status: 'removed' }));
    if (/\/paste$/.test(url)) return Promise.resolve(jsonResponse({ status: 'ok' }));
    if (/\/content$/.test(url)) return Promise.resolve(jsonResponse({ kind: 'markdown', text: '# x', size: 3 }));
    return Promise.resolve(jsonResponse({}, 404));
  });
}

let viewer;
function Probe() {
  viewer = useViewer();
  return null;
}

async function mountScreen(props = {}) {
  await act(async () => {
    render(
      <ViewerProvider>
        <Probe />
        <ArtefatosV2 projects={PROJECTS} selectedClienteId={null} selectedProjetoId={null} {...props} />
        <ViewerToast />
      </ViewerProvider>,
    );
  });
}

describe('menu do cartão', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    list = [art('a1'), art('a2', { exists: false })];
    copyMock.mockClear();
    clearViewerContentCache();
    installFetch();
    window.sessionStorage.removeItem(ARTIFACT_TABS_KEY);
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('⋯ abre o menu com as 6 ações; Esc fecha', async () => {
    await mountScreen({ activeSessionKey: 'cli/site::claude' });
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toHaveLength(6);
    expect(items[0]).toContain('Abrir');
    expect(items[1]).toContain('Baixar');
    expect(items[5]).toContain('Remover da lista');
    const download = screen.getByRole('menuitem', { name: /Baixar/ });
    expect(download.getAttribute('href')).toBe('/api/artifacts/a1/f/docs/a1.md?download=1');
    // O menu é portal: não fica preso na lista que rola.
    expect(screen.getByTestId('artifact-menu').parentElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('artifact-menu')).toBeNull();
  });

  it('toque longo abre o menu e não abre o arquivo; botão direito também', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountScreen();
      const card = screen.getByTestId('artifact-card-a1');
      fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(screen.getByTestId('artifact-menu')).toBeTruthy();
      fireEvent.pointerUp(card);
      fireEvent.click(card);
      expect(viewer.getScope('artefatos').items).toHaveLength(0);
      fireEvent.click(screen.getByTestId('artifact-menu-scrim'));
      // Arrastar (rolar a lista) cancela o toque longo.
      fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 10, clientY: 60 });
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(screen.queryByTestId('artifact-menu')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    fireEvent.contextMenu(screen.getByTestId('artifact-card-a1'));
    expect(screen.getByTestId('artifact-menu')).toBeTruthy();
  });

  it('Abrir abre no painel; Copiar caminho copia o caminho relativo', async () => {
    await mountScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Abrir/ })); });
    expect(viewer.getScope('artefatos').items.map((i) => i.id)).toEqual(['a1']);
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Copiar caminho/ })); });
    expect(copyMock).toHaveBeenCalledWith('docs/a1.md');
    expect(screen.getByTestId('viewer-toast').textContent).toContain('Caminho copiado.');
  });

  it('Citar no chat cola o caminho absoluto no chat ativo, sem enviar', async () => {
    await mountScreen({ activeSessionKey: 'cli/site::claude' });
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Citar no chat/ })); });
    const paste = calls.find((c) => c.url.endsWith('/paste'));
    expect(paste.url).toBe('/api/sessions/cli/site::claude/paste');
    expect(paste.body).toEqual({ text: '/p/cli/site/docs/a1.md' });
    expect(paste.body.text.endsWith('\r')).toBe(false);
  });

  it('sem chat ativo, Citar no chat fica desabilitado', async () => {
    await mountScreen({ activeSessionKey: null });
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    const cite = screen.getByRole('menuitem', { name: /Citar no chat/ });
    expect(cite.getAttribute('aria-disabled')).toBe('true');
    expect(cite.textContent).toContain('Abra um chat para citar');
    await act(async () => { fireEvent.click(cite); });
    expect(calls.some((c) => c.url.endsWith('/paste'))).toBe(false);
  });

  it('arquivo não encontrado: sem Baixar e sem Citar', async () => {
    await mountScreen({ activeSessionKey: 'cli/site::claude' });
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a2' }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items.some((t) => t.includes('Baixar'))).toBe(false);
    expect(items.some((t) => t.includes('Citar'))).toBe(false);
    expect(items.some((t) => t.includes('Remover da lista'))).toBe(true);
  });

  it('Renomear manda PATCH com o título e o cartão muda', async () => {
    await mountScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Renomear/ }));
    const input = screen.getByLabelText('Título');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  Plano final ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })); });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.url).toBe('/api/artifacts/a1');
    expect(patch.body).toEqual({ titulo: 'Plano final' });
    expect(screen.getByTestId('artifact-card-a1').textContent).toContain('Plano final');
  });

  it('Remover da lista exige 2 toques, chama DELETE e fecha a aba aberta', async () => {
    await mountScreen();
    await act(async () => { fireEvent.click(screen.getByTestId('artifact-card-a1')); });
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Título a1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Remover da lista/ }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('menuitem', { name: /Toque de novo para remover/ })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Toque de novo para remover/ })); });
    expect(calls.find((c) => c.method === 'DELETE').url).toBe('/api/artifacts/a1');
    expect(screen.queryByTestId('artifact-card-a1')).toBeNull();
    expect(viewer.getScope('artefatos').items).toHaveLength(0);
    expect(viewer.getSurface('artefatos').open).toBe(false);
    expect(screen.getByTestId('viewer-toast').textContent).toContain('O arquivo continua no projeto.');
  });

  it('placeMenu abre embaixo, ou em cima quando não cabe, sempre dentro da janela', () => {
    const viewport = { width: 390, height: 844 };
    expect(placeMenu({ top: 100, bottom: 136, left: 300, right: 380 }, 300, viewport)).toEqual({ left: 140, top: 142, width: 240 });
    expect(placeMenu({ top: 700, bottom: 736, left: 0, right: 40 }, 300, viewport)).toEqual({ left: 8, top: 394, width: 240 });
  });
});

describe('"☆ Salvar em Artefatos" no visualizador do chat', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    clearArtifactStatusCache();
    list = [art('ja', { path: 'docs/ja.md' })];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  function chatItem(path, extra = {}) {
    return {
      item_id: `i_${path}`, id: `i_${path}`, source: 'viewer', session_key: 'cli/site::claude', project_id: 'cli/site',
      path, title: path, kind: 'markdown', opened_by: 'user', updated_at: 1, ...extra,
    };
  }

  async function mountToolbar(item) {
    await act(async () => {
      render(
        <ViewerProvider>
          <ViewerToolbar item={item} content={null} />
          <ViewerToast />
        </ViewerProvider>,
      );
    });
  }

  it('aparece para .md aberto no chat que ainda não é artefato e salva com POST', async () => {
    await mountToolbar(chatItem('docs/aberto.md'));
    expect(calls[0].url).toBe('/api/artifacts?projeto_id=cli%2Fsite');
    const button = await screen.findByTestId('viewer-save-artifact');
    expect(button.textContent).toBe('☆ Salvar');
    await act(async () => { fireEvent.click(button); });
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body).toEqual({ project_id: 'cli/site', caminho: 'docs/aberto.md' });
    expect(screen.getByTestId('viewer-save-artifact').textContent).toBe('★ Salvo');
    expect(screen.getByTestId('viewer-toast').textContent).toContain('Salvo em Artefatos');
  });

  it('não aparece se já é artefato, para .py, nem numa aba de artefato', async () => {
    await mountToolbar(chatItem('docs/ja.md'));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByTestId('viewer-save-artifact')).toBeNull();
    cleanup();
    calls = [];
    await mountToolbar(chatItem('src/app.py', { kind: 'code' }));
    expect(screen.queryByTestId('viewer-save-artifact')).toBeNull();
    expect(calls).toHaveLength(0);
    cleanup();
    await mountToolbar({ ...art('x'), id: 'x', source: 'artifact' });
    expect(screen.queryByTestId('viewer-save-artifact')).toBeNull();
  });
});
