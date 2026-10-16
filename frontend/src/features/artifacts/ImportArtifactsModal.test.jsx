// frontend/src/features/artifacts/ImportArtifactsModal.test.jsx
// Fase A (passo 8 da 7.6): "Importar do projeto…" — candidatos do projeto do
// filtro, caixas de seleção, "Selecionar todos", POST /api/artifacts/import,
// sucesso parcial com o motivo, e os novos cartões na tela.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { ViewerProvider } from '../viewer/ViewerContext.jsx';
import { ViewerToast } from '../viewer/ViewerToast.jsx';
import { ArtefatosV2 } from './ArtefatosV2.jsx';
import { ARTIFACT_TABS_KEY } from './useArtifactTabsStorage.js';

function art(id, extra = {}) {
  return {
    artifact_id: id, project_id: 'cli/site', cliente_id: 'cli', path: `docs/${id}.md`, kind: 'markdown',
    title: `Título ${id}`, description: null, excerpt: null, size: 10, mtime: 1, exists: true,
    created_by: 'user', agent_label: null, created_at: 1, updated_at: 1, ...extra,
  };
}

const PROJECTS = [
  { id: 'cli', nome: 'Cliente', path: '/p/cli', sub_projetos: ['cli/site', 'cli/api'] },
  { id: 'cli/site', nome: 'site', path: '/p/cli/site', sub_projetos: [] },
  { id: 'cli/api', nome: 'api', path: '/p/cli/api', sub_projetos: [] },
  { id: 'outro', nome: 'Outro', path: '/p/outro', sub_projetos: [] },
];

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

const NOW_S = Math.floor(Date.now() / 1000);
const SINCE = NOW_S - 5 * 86400;

function cand(path, mtime, extra = {}) {
  let kind = 'markdown';
  if (path.endsWith('.pdf')) kind = 'pdf';
  else if (path.endsWith('.html')) kind = 'html';
  return { path, kind, size: 2048, mtime, ...extra };
}

const RECENT = [
  cand('docs/antigo.md', NOW_S - 100),
  cand('docs/relatorio.html', NOW_S - 200),
  cand('entregas/p.pdf', NOW_S - 300),
];
const OLDER = [cand('velho/um.md', SINCE - 1000), cand('velho/dois.md', SINCE - 2000)];

let calls;
let list;
let importResult;
// Per-test override: (url, projectId, windowed) => body | { __status, body } | Promise | Error
let candidatesHandler;
function defaultCandidates(url, projectId, windowed) {
  if (windowed) {
    return {
      candidates: RECENT, truncated: projectId === 'cli/api', since: SINCE, has_older: true,
    };
  }
  return { candidates: [...RECENT, ...OLDER], truncated: false };
}

function installFetch() {
  calls = [];
  candidatesHandler = defaultCandidates;
  global.fetch = vi.fn((url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url === '/api/artifacts/import') return Promise.resolve(jsonResponse(importResult));
    const match = /^\/api\/projects\/(.+)\/artifact-candidates(\?window_days=5)?$/.exec(url);
    if (match) {
      const result = candidatesHandler(url, match[1], !!match[2]);
      if (result instanceof Promise) return result;
      if (result instanceof Error) return Promise.reject(result);
      if (result && result.__status) return Promise.resolve(jsonResponse(result.body, result.__status));
      return Promise.resolve(jsonResponse(result));
    }
    if (url.startsWith('/api/artifacts')) return Promise.resolve(jsonResponse({ artifacts: list }));
    return Promise.resolve(jsonResponse({}, 404));
  });
}

function deferred() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  return { promise, resolve: (body, status = 200) => settle(jsonResponse(body, status)) };
}

async function mount(props = {}) {
  await act(async () => {
    render(
      <ViewerProvider>
        <ArtefatosV2 projects={PROJECTS} selectedClienteId="cli" selectedProjetoId="cli/site" {...props} />
        <ViewerToast />
      </ViewerProvider>,
    );
  });
}

describe('Importar do projeto', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    list = [art('a1')];
    importResult = { created: 2, artifacts: [art('n1', { path: 'docs/antigo.md', title: 'Antigo' }), art('n2', { path: 'entregas/p.pdf', kind: 'pdf', title: 'P' })], errors: [] };
    installFetch();
    window.sessionStorage.removeItem(ARTIFACT_TABS_KEY);
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('lista os candidatos do projeto do filtro, importa os marcados e mostra os cartões novos', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importar do projeto/ })); });
    const modal = screen.getByTestId('import-artifacts-modal');
    expect(within(modal).getByRole('combobox').value).toBe('cli/site');
    expect(calls.some((c) => c.url === '/api/projects/cli/site/artifact-candidates?window_days=5')).toBe(true);
    const importButton = within(modal).getByRole('button', { name: /^Importar/ });
    expect(importButton.disabled).toBe(true);
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    fireEvent.click(within(modal).getByText('entregas/p.pdf'));
    expect(importButton.textContent).toBe('Importar 2');
    await act(async () => { fireEvent.click(importButton); });
    const post = calls.find((c) => c.url === '/api/artifacts/import');
    expect(post.body).toEqual({ project_id: 'cli/site', caminhos: ['docs/antigo.md', 'entregas/p.pdf'] });
    expect(screen.queryByTestId('import-artifacts-modal')).toBeNull();
    expect(screen.getByTestId('artifact-card-n1')).toBeTruthy();
    expect(screen.getByTestId('artifact-card-n2')).toBeTruthy();
    expect(screen.getByTestId('viewer-toast').textContent).toContain('2 artefatos importados.');
  });

  it('"Selecionar todos", troca de projeto e aviso de lista cortada', async () => {
    await mount({ selectedProjetoId: null });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importar do projeto/ })); });
    const modal = screen.getByTestId('import-artifacts-modal');
    const select = within(modal).getByRole('combobox');
    // Cliente inteiro: o próprio cliente vem marcado e só projetos dele aparecem.
    expect(select.value).toBe('cli');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['cli', 'cli/api', 'cli/site']);
    fireEvent.click(within(modal).getByText(/Selecionar todos \(3\)/));
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 3');
    await act(async () => { fireEvent.change(select, { target: { value: 'cli/api' } }); });
    expect(within(modal).getByText('Mostrando os 300 arquivos mais recentes. Há mais arquivos além desse limite.')).toBeTruthy();
    // Trocar de projeto desmarca tudo.
    expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(true);
  });

  it('sucesso parcial: os que falharam ficam no modal com o motivo', async () => {
    importResult = {
      created: 1,
      artifacts: [art('n1', { path: 'docs/antigo.md' })],
      errors: [{ caminho: 'docs/relatorio.html', erro: 'Arquivo não encontrado: docs/relatorio.html' }],
    };
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importar do projeto/ })); });
    const modal = screen.getByTestId('import-artifacts-modal');
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    fireEvent.click(within(modal).getByText('docs/relatorio.html'));
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    expect(screen.getByTestId('import-artifacts-modal')).toBeTruthy();
    expect(within(modal).getByRole('alert').textContent).toContain('Arquivo não encontrado: docs/relatorio.html');
    expect(within(modal).queryByText('docs/antigo.md')).toBeNull();
    expect(screen.getByTestId('artifact-card-n1')).toBeTruthy();
  });

  it('o estado vazio também oferece "Importar do projeto"', async () => {
    list = [];
    await mount();
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('artifacts-empty')).getByRole('button', { name: 'Importar do projeto' }));
    });
    expect(screen.getByTestId('import-artifacts-modal')).toBeTruthy();
  });

  async function openModal(props = {}) {
    await mount(props);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importar do projeto/ })); });
    return screen.getByTestId('import-artifacts-modal');
  }

  it('shows the rows newest first with date and size, under the recent group', async () => {
    const modal = await openModal();
    const group = within(modal).getByTestId('import-group-recent');
    expect(within(group).getByRole('heading', { name: 'Últimos 5 dias (3)' })).toBeTruthy();
    const paths = Array.from(group.querySelectorAll('.af-candidate-path')).map((n) => n.textContent);
    expect(paths).toEqual(['docs/antigo.md', 'docs/relatorio.html', 'entregas/p.pdf']);
    const firstMeta = group.querySelector('.af-candidate-meta');
    expect(firstMeta.textContent).toMatch(/^(hoje|ontem) \d{2}:\d{2} · 2,0 KB$/);
    expect(firstMeta.querySelector('time').getAttribute('datetime')).toBeTruthy();
    expect(within(modal).queryByTestId('import-group-older')).toBeNull();
  });

  it('empty window with older files shows the message and the search button (state 3)', async () => {
    candidatesHandler = (url, id, windowed) => (windowed
      ? { candidates: [], truncated: false, since: SINCE, has_older: true }
      : defaultCandidates(url, id, windowed));
    const modal = await openModal();
    expect(within(modal).getByText('Nada novo nos últimos 5 dias.')).toBeTruthy();
    expect(within(modal).getByTestId('import-load-older').textContent).toBe('Buscar mais antigos');
    expect(within(modal).queryByText(/Selecionar todos/)).toBeNull();
    expect(within(modal).getByTestId('import-footer-hint').textContent).toBe('Busque os mais antigos para escolher arquivos');
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getByTestId('import-group-older')).toBeTruthy();
    expect(within(modal).getByRole('heading', { name: 'Mais antigos (2)' })).toBeTruthy();
  });

  it('no candidates at all shows the empty state without the search button (state 4)', async () => {
    candidatesHandler = () => ({ candidates: [], truncated: false, since: SINCE, has_older: false });
    const modal = await openModal({ selectedProjetoId: null });
    expect(within(modal).getByText('Nenhum arquivo para importar neste projeto.')).toBeTruthy();
    expect(within(modal).queryByTestId('import-load-older')).toBeNull();
    expect(within(modal).getByText(/Tente escolher outro projeto/)).toBeTruthy();
  });

  it('a failed load shows the error and "Tentar de novo" reloads until ready (state 5)', async () => {
    let attempt = 0;
    candidatesHandler = (url, id, windowed) => {
      attempt += 1;
      if (attempt === 1) return { __status: 500, body: { success: false, error: 'Disco ocupado.' } };
      return defaultCandidates(url, id, windowed);
    };
    const modal = await openModal();
    expect(within(modal).getByRole('alert').textContent).toContain('Não consegui listar os arquivos.');
    expect(within(modal).getByText('Disco ocupado.')).toBeTruthy();
    const retry = within(modal).getByRole('button', { name: 'Tentar de novo' });
    expect(document.activeElement).toBe(retry);
    await act(async () => { fireEvent.click(retry); });
    expect(within(modal).getByTestId('import-group-recent')).toBeTruthy();
    expect(calls.filter((c) => c.url.endsWith('?window_days=5'))).toHaveLength(2);
  });

  it('"Buscar mais antigos" calls without window, keeps the selection and hides the button', async () => {
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    const unwindowed = calls.filter((c) => c.url === '/api/projects/cli/site/artifact-candidates');
    expect(unwindowed).toHaveLength(1);
    expect(within(modal).getByRole('heading', { name: 'Últimos 5 dias (3)' })).toBeTruthy();
    expect(within(modal).getByRole('heading', { name: 'Mais antigos (2)' })).toBeTruthy();
    expect(within(modal).queryByTestId('import-load-older')).toBeNull();
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
    expect(within(modal).getByText(/Selecionar todos \(5\)/)).toBeTruthy();
    expect(within(modal).getByTestId('import-announcement').textContent).toBe('2 arquivos mais antigos adicionados.');
    expect(document.activeElement.textContent).toContain('Mais antigos');
  });

  it('loading older with zero results says there is nothing older', async () => {
    candidatesHandler = (url, id, windowed) => (windowed
      ? defaultCandidates(url, id, true)
      : { candidates: RECENT, truncated: false });
    const modal = await openModal();
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(modal.querySelector('.af-hint').textContent).toBe('Nada mais antigo neste projeto.');
    expect(within(modal).queryByTestId('import-group-older')).toBeNull();
  });

  it('an error while fetching older keeps list and selection and turns the button into retry (state 12)', async () => {
    let fail = true;
    candidatesHandler = (url, id, windowed) => {
      if (!windowed && fail) return { __status: 500, body: { success: false, error: 'x' } };
      return defaultCandidates(url, id, windowed);
    };
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getByRole('alert').textContent).toBe('Não consegui buscar os mais antigos.');
    const button = within(modal).getByTestId('import-load-older');
    expect(button.textContent).toBe('Tentar de novo');
    expect(document.activeElement).toBe(button);
    expect(within(modal).getByTestId('import-group-recent')).toBeTruthy();
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
    fail = false;
    await act(async () => { fireEvent.click(button); });
    expect(within(modal).getByTestId('import-group-older')).toBeTruthy();
  });

  it('while older files load the button is aria-disabled and a double click makes one request (state 6)', async () => {
    const pending = deferred();
    candidatesHandler = (url, id, windowed) => (windowed ? defaultCandidates(url, id, true) : pending.promise);
    const modal = await openModal();
    const button = within(modal).getByTestId('import-load-older');
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Buscando…');
    expect(calls.filter((c) => c.url === '/api/projects/cli/site/artifact-candidates')).toHaveLength(1);
    // The list stays visible while waiting.
    expect(within(modal).getByTestId('import-group-recent')).toBeTruthy();
    await act(async () => { pending.resolve({ candidates: [...RECENT, ...OLDER], truncated: false }); });
    expect(within(modal).getByTestId('import-group-older')).toBeTruthy();
  });

  it('disables Importar with a hint while older files load, then re-enables it', async () => {
    const pending = deferred();
    candidatesHandler = (url, id, windowed) => (windowed ? defaultCandidates(url, id, true) : pending.promise);
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    const importButton = within(modal).getByRole('button', { name: /^Importar/ });
    expect(importButton.disabled).toBe(false);
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(importButton.disabled).toBe(true);
    expect(within(modal).getByTestId('import-footer-hint').textContent).toBe('Aguarde a busca terminar');
    await act(async () => { fireEvent.click(importButton); });
    expect(calls.some((c) => c.url === '/api/artifacts/import')).toBe(false);
    await act(async () => { pending.resolve({ candidates: [...RECENT, ...OLDER], truncated: false }); });
    expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(false);
    expect(within(modal).getByTestId('import-footer-hint').textContent).toBe('1 selecionado');
  });

  it('truncated inside the window shows only the notice, with no search button (state 8)', async () => {
    candidatesHandler = (url, id, windowed) => ({ ...defaultCandidates(url, id, windowed), truncated: true });
    const modal = await openModal();
    expect(within(modal).getByText(/Mostrando os 300 arquivos mais recentes/)).toBeTruthy();
    expect(within(modal).queryByTestId('import-load-older')).toBeNull();
  });

  it('the footer hint follows the selection and the import', async () => {
    const modal = await openModal();
    const hint = within(modal).getByTestId('import-footer-hint');
    expect(hint.textContent).toBe('Marque ao menos um arquivo');
    expect(within(modal).getByRole('button', { name: /^Importar/ }).getAttribute('aria-describedby')).toBe(hint.id);
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    expect(hint.textContent).toBe('1 selecionado');
    fireEvent.click(within(modal).getByText('docs/relatorio.html'));
    expect(hint.textContent).toBe('2 selecionados');
    const pending = deferred();
    global.fetch.mockImplementationOnce(() => pending.promise);
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    expect(hint.textContent).toBe('Importando 2 arquivos…');
    expect(within(modal).getByRole('button', { name: 'Importando…' }).disabled).toBe(true);
    expect(within(modal).getByRole('combobox').disabled).toBe(true);
    await act(async () => { pending.resolve({ created: 0, artifacts: [], errors: [] }); });
  });

  it('"Selecionar todos" counts only what is visible and is indeterminate on a partial selection', async () => {
    const modal = await openModal();
    const selectAll = within(modal).getByText(/Selecionar todos \(3\)/).previousSibling;
    expect(selectAll.indeterminate).toBe(false);
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
    fireEvent.click(selectAll);
    expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(true);
  });

  it('partial success reports the summary and keeps only the failed ones marked (state 10)', async () => {
    importResult = {
      created: 1,
      artifacts: [art('n1', { path: 'docs/antigo.md' })],
      errors: [{ caminho: 'docs/relatorio.html', erro: 'Arquivo não encontrado: docs/relatorio.html' }],
    };
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    fireEvent.click(within(modal).getByText('docs/relatorio.html'));
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    const alert = within(modal).getByRole('alert');
    expect(alert.textContent).toContain('1 importado(s). Não consegui importar estes 1:');
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
  });

  it('a rejected import keeps list and selection and shows the message (state 11)', async () => {
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    global.fetch.mockImplementationOnce(() => Promise.resolve(jsonResponse({ success: false, error: 'Banco indisponível.' }, 500)));
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    expect(within(modal).getByRole('alert').textContent).toContain('Banco indisponível.');
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
    expect(within(modal).getByText('docs/antigo.md')).toBeTruthy();
  });

  it('after 2.5 s of loading the text changes to the slow-search hint (state 1)', async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred();
      candidatesHandler = () => pending.promise;
      await mount();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importar do projeto/ })); });
      const modal = screen.getByTestId('import-artifacts-modal');
      expect(within(modal).getByText('Procurando arquivos recentes…')).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(2600); });
      expect(within(modal).getByText('Ainda procurando… projetos grandes demoram um pouco.')).toBeTruthy();
      expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('switching project resets the window, the older files and the selection', async () => {
    const modal = await openModal({ selectedProjetoId: null });
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    fireEvent.click(within(modal).getByText('velho/um.md'));
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
    await act(async () => { fireEvent.change(within(modal).getByRole('combobox'), { target: { value: 'cli/api' } }); });
    expect(within(modal).queryByTestId('import-group-older')).toBeNull();
    expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(true);
    const windowed = calls.filter((c) => c.url === '/api/projects/cli/api/artifact-candidates?window_days=5');
    expect(windowed).toHaveLength(1);
  });

  it('switching project during "Buscar mais antigos" drops the late response', async () => {
    const pending = deferred();
    candidatesHandler = (url, id, windowed) => (windowed ? defaultCandidates(url, id, true) : pending.promise);
    const modal = await openModal({ selectedProjetoId: null });
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    await act(async () => { fireEvent.change(within(modal).getByRole('combobox'), { target: { value: 'cli/api' } }); });
    await act(async () => { pending.resolve({ candidates: [...RECENT, ...OLDER], truncated: false }); });
    expect(within(modal).queryByTestId('import-group-older')).toBeNull();
  });

  it('a selected file that vanished from the refreshed list does not reach the POST', async () => {
    candidatesHandler = (url, id, windowed) => (windowed
      ? defaultCandidates(url, id, true)
      : { candidates: [RECENT[1], RECENT[2], ...OLDER], truncated: false });
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    fireEvent.click(within(modal).getByText('docs/relatorio.html'));
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 1');
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    const post = calls.find((c) => c.url === '/api/artifacts/import');
    expect(post.body.caminhos).toEqual(['docs/relatorio.html']);
  });
  it('groups are labelled landmarks and the older heading is programmatically focusable', async () => {
    const modal = await openModal();
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    const recent = within(modal).getByTestId('import-group-recent');
    const older = within(modal).getByTestId('import-group-older');
    expect(recent.getAttribute('role')).toBe('group');
    expect(within(modal).getByRole('group', { name: 'Últimos 5 dias (3)' })).toBe(recent);
    expect(within(modal).getByRole('group', { name: 'Mais antigos (2)' })).toBe(older);
    expect(older.querySelector('h3').getAttribute('tabindex')).toBe('-1');
  });

  it('"Selecionar todos" after loading older selects both groups and the POST carries all of them', async () => {
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('entregas/p.pdf'));
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    const selectAll = within(modal).getByText(/Selecionar todos \(5\)/).previousSibling;
    expect(selectAll.indeterminate).toBe(true);
    fireEvent.click(selectAll);
    expect(within(modal).getByRole('button', { name: /^Importar/ }).textContent).toBe('Importar 5');
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    const post = calls.find((c) => c.url === '/api/artifacts/import');
    expect(post.body.caminhos.slice().sort()).toEqual(
      [...RECENT, ...OLDER].map((c) => c.path).sort(),
    );
  });

  it('a failure fetching older from the empty-window state keeps the message and offers retry (states 3 and 12)', async () => {
    let fail = true;
    candidatesHandler = (url, id, windowed) => {
      if (windowed) return { candidates: [], truncated: false, since: SINCE, has_older: true };
      if (fail) return { __status: 500, body: { success: false, error: 'x' } };
      return defaultCandidates(url, id, windowed);
    };
    const modal = await openModal();
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getByText('Nada novo nos últimos 5 dias.')).toBeTruthy();
    expect(within(modal).getByRole('alert').textContent).toBe('Não consegui buscar os mais antigos.');
    const retry = within(modal).getByTestId('import-load-older');
    expect(retry.textContent).toBe('Tentar de novo');
    expect(document.activeElement).toBe(retry);
    expect(within(modal).getByRole('button', { name: /^Importar/ }).disabled).toBe(true);
    fail = false;
    await act(async () => { fireEvent.click(retry); });
    expect(within(modal).getByTestId('import-group-older')).toBeTruthy();
  });

  it('empty window where the unwindowed call also returns nothing ends in the empty state (3 to 4)', async () => {
    candidatesHandler = (url, id, windowed) => (windowed
      ? { candidates: [], truncated: false, since: SINCE, has_older: true }
      : { candidates: [], truncated: false });
    const modal = await openModal();
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getByText('Nenhum arquivo para importar neste projeto.')).toBeTruthy();
    expect(within(modal).queryByTestId('import-load-older')).toBeNull();
  });

  it('the truncation notice is still shown after the older files are loaded (state 8 after state 7)', async () => {
    candidatesHandler = (url, id, windowed) => (windowed
      ? defaultCandidates(url, id, true)
      : { candidates: [...RECENT, ...OLDER], truncated: true });
    const modal = await openModal();
    expect(within(modal).queryByText(/Mostrando os 300 arquivos mais recentes/)).toBeNull();
    await act(async () => { fireEvent.click(within(modal).getByTestId('import-load-older')); });
    expect(within(modal).getAllByText(/Mostrando os 300 arquivos mais recentes/)).toHaveLength(1);
    expect(within(modal).queryByTestId('import-load-older')).toBeNull();
  });

  it('partial success moves focus to the summary line (state 10)', async () => {
    importResult = {
      created: 1,
      artifacts: [art('n1', { path: 'docs/antigo.md' })],
      errors: [{ caminho: 'docs/relatorio.html', erro: 'Arquivo não encontrado: docs/relatorio.html' }],
    };
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    fireEvent.click(within(modal).getByText('docs/relatorio.html'));
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: /^Importar/ })); });
    expect(document.activeElement.textContent).toContain('1 importado(s). Não consegui importar estes 1:');
    // The imported file left the list; the failed one stays checked.
    expect(within(modal).queryByText('docs/antigo.md')).toBeNull();
    expect(within(modal).getByText('docs/relatorio.html').closest('label').querySelector('input').checked).toBe(true);
  });

  it('keyboard order follows the spec: select, select all, rows, load older, cancel, import', async () => {
    const modal = await openModal();
    fireEvent.click(within(modal).getByText('docs/antigo.md'));
    const focusables = Array.from(
      modal.querySelectorAll('button, select, input, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.disabled);
    const labels = focusables.map((el) => {
      if (el.tagName === 'SELECT') return 'select';
      if (el.type === 'checkbox') return el.closest('label').textContent.startsWith('Selecionar') ? 'all' : 'row';
      return el.getAttribute('aria-label') || el.textContent.trim();
    });
    expect(labels).toEqual([
      'Fechar', 'select', 'all', 'row', 'row', 'row', 'Buscar mais antigos', 'Cancelar', 'Importar 1',
    ]);
  });

  it('a slow initial response from a previous project never overrides the current project list', async () => {
    const pending = deferred();
    let first = true;
    candidatesHandler = (url, id, windowed) => {
      if (first) { first = false; return pending.promise; }
      return defaultCandidates(url, id, windowed);
    };
    const modal = await openModal({ selectedProjetoId: null });
    await act(async () => {
      fireEvent.change(within(modal).getByRole('combobox'), { target: { value: 'cli/api' } });
    });
    expect(within(modal).getByTestId('import-group-recent')).toBeTruthy();
    await act(async () => { pending.resolve({ candidates: [cand('x/stale.md', NOW_S)], truncated: false, since: SINCE, has_older: false }); });
    expect(within(modal).queryByText('x/stale.md')).toBeNull();
  });
});
