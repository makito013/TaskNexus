// frontend/src/features/viewer/viewerApi.test.js
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  closeSessionItem,
  contentUrl,
  fileUrl,
  listSessionItems,
  normalizeItem,
  openSessionPath,
  sessionKeyFromScope,
  sessionScope,
  ViewerApiError,
} from './viewerApi.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

describe('viewerApi — URLs por origem', () => {
  it('item do visualizador usa /api/viewer/{item_id}', () => {
    const item = normalizeItem({ item_id: 'vw_1', path: 'docs/relatório.html' });
    expect(item).toMatchObject({ id: 'vw_1', source: 'viewer' });
    expect(contentUrl(item)).toBe('/api/viewer/vw_1/content');
    expect(fileUrl(item)).toBe('/api/viewer/vw_1/f/docs/relat%C3%B3rio.html');
    expect(fileUrl(item, item.path, { download: true })).toBe('/api/viewer/vw_1/f/docs/relat%C3%B3rio.html?download=1');
    expect(fileUrl(item, 'docs/style.css')).toBe('/api/viewer/vw_1/f/docs/style.css');
    // `version` força recarregar <img>/<iframe> quando o agente reabre o arquivo.
    expect(fileUrl(item, item.path, { version: 12.5 })).toBe('/api/viewer/vw_1/f/docs/relat%C3%B3rio.html?v=12.5');
    expect(fileUrl(item, 'a.pdf', { download: true, version: 3 })).toBe('/api/viewer/vw_1/f/a.pdf?download=1&v=3');
  });

  it('item de artefato (Fase A) usa /api/artifacts/{artifact_id}', () => {
    const item = normalizeItem({ artifact_id: 'af_9', path: 'a.pdf' }, 'artifact');
    expect(item).toMatchObject({ id: 'af_9', source: 'artifact' });
    expect(contentUrl(item)).toBe('/api/artifacts/af_9/content');
    expect(fileUrl(item, 'a.pdf', { download: true })).toBe('/api/artifacts/af_9/f/a.pdf?download=1');
  });

  it('escopo de sessão ida e volta (session_key com / e ::)', () => {
    const scope = sessionScope('cliente/proj::claude');
    expect(scope).toBe('session:cliente/proj::claude');
    expect(sessionKeyFromScope(scope)).toBe('cliente/proj::claude');
    expect(sessionKeyFromScope('artefatos')).toBeNull();
    expect(sessionScope(null)).toBeNull();
  });
});

describe('viewerApi — rotas', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('lista as abas normalizadas', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ items: [{ item_id: 'vw_1', path: 'a.md' }] })));
    const items = await listSessionItems('p::claude');
    expect(global.fetch).toHaveBeenCalledWith('/api/sessions/p::claude/viewer');
    expect(items).toEqual([{ item_id: 'vw_1', path: 'a.md', id: 'vw_1', source: 'viewer' }]);
  });

  it('abre caminho com linha e relativo_a', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({
      success: true, item: { item_id: 'vw_2', path: 'b.md' }, reused: true, delivered: true, evicted: ['vw_0'],
    })));
    const result = await openSessionPath('p::claude', '../b.md', { linha: 4, relativoA: 'docs/a.md' });
    const [, init] = global.fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ caminho: '../b.md', linha: 4, relativo_a: 'docs/a.md' });
    expect(result).toMatchObject({ reused: true, evicted: ['vw_0'], item: { id: 'vw_2' } });
  });

  it('erro do backend vira ViewerApiError com a mensagem dele', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ success: false, error: 'Arquivo não encontrado: x.md' }, 404)));
    await expect(openSessionPath('p::claude', 'x.md')).rejects.toMatchObject({
      name: 'ViewerApiError', status: 404, message: 'Arquivo não encontrado: x.md',
    });
    expect(new ViewerApiError('a', 1)).toBeInstanceOf(Error);
  });

  it('DELETE 404 = aba já fechada (sucesso)', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ detail: 'Aba não encontrada' }, 404)));
    await expect(closeSessionItem('p::claude', 'vw_x')).resolves.toEqual({ status: 'already_closed' });
  });
});
