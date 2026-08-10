// frontend/src/hooks/useAgentSettings.test.js
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 16): cobre o contrato do
// hook extraído de AgentSettingsModal.jsx — fetch inicial, e que
// create/update/delete chamam o endpoint certo e recarregam a lista.
// Mesmo padrão renderHook + global.fetch mockado usado em useCards.test.js.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentSettings } from './useAgentSettings.js';

function fakeAgent(overrides = {}) {
  return {
    id: 'claude-work',
    nome: 'Claude (Work)',
    papel: 'Assistente',
    ia: 'claude',
    cmd: ['claude', '--settings', '~/.claude-work'],
    default: false,
    ...overrides,
  };
}

describe('useAgentSettings — initial fetch', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('populates state with the agents returned by GET /api/agents', async () => {
    const agents = [fakeAgent()];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(agents) }));

    const { result } = renderHook(() => useAgentSettings());

    await waitFor(() => expect(result.current.agents).toEqual(agents));
    expect(result.current.loading).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith('/api/agents');
  });

  it('falls back to an empty list and loading=false when the fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }));

    const { result } = renderHook(() => useAgentSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual([]);
  });
});

describe('useAgentSettings — mutations', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('createAgent POSTs the payload and reloads the list', async () => {
    const created = fakeAgent();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(created) }) // POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([created]) }); // reload

    const { result } = renderHook(() => useAgentSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createAgent({ id: 'claude-work', nome: 'Claude (Work)', papel: 'Assistente', ia: 'claude', cmd: ['claude'] });
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/agents', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(result.current.agents).toEqual([created]));
  });

  it('updateAgent PUTs to the agent id and reloads the list', async () => {
    const updated = fakeAgent({ nome: 'Claude Work 2' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([fakeAgent()]) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(updated) }) // PUT
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([updated]) }); // reload

    const { result } = renderHook(() => useAgentSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateAgent('claude-work', { id: 'claude-work', nome: 'Claude Work 2', papel: 'Assistente', ia: 'claude', cmd: ['claude'] });
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/agents/claude-work', expect.objectContaining({ method: 'PUT' }));
    await waitFor(() => expect(result.current.agents).toEqual([updated]));
  });

  it('deleteAgent DELETEs the agent id and reloads the list', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([fakeAgent()]) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'deleted' }) }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // reload

    const { result } = renderHook(() => useAgentSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteAgent('claude-work');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/agents/claude-work', expect.objectContaining({ method: 'DELETE' }));
    await waitFor(() => expect(result.current.agents).toEqual([]));
  });
});
