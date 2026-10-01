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

let calls;
let list;
let importResult;
function installFetch() {
  calls = [];
  global.fetch = vi.fn((url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url === '/api/artifacts/import') return Promise.resolve(jsonResponse(importResult));
    if (url.startsWith('/api/artifacts')) return Promise.resolve(jsonResponse({ artifacts: list }));
    const cand = /^\/api\/projects\/(.+)\/artifact-candidates$/.exec(url);
    if (cand) {
      return Promise.resolve(jsonResponse({
        candidates: [
          { path: 'docs/antigo.md', kind: 'markdown', size: 2048, mtime: 1 },
          { path: 'docs/relatorio.html', kind: 'html', size: 512, mtime: 1 },
          { path: 'entregas/p.pdf', kind: 'pdf', size: 99999, mtime: 1 },
        ],
        truncated: cand[1] === 'cli/api',
      }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
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
    expect(calls.some((c) => c.url === '/api/projects/cli/site/artifact-candidates')).toBe(true);
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
    expect(within(modal).getByText('Mostrando os primeiros 300 arquivos.')).toBeTruthy();
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
});
