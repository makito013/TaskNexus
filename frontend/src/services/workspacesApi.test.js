import { describe, it, expect, vi, afterEach } from 'vitest'
import { workspacesApi } from './workspacesApi.js'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

describe('workspacesApi.fetchWorkspaces', () => {
  afterEach(() => vi.restoreAllMocks())

  it('asks for the active registry by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ workspaces: [] }))
    await expect(workspacesApi.fetchWorkspaces()).resolves.toEqual({ workspaces: [] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/workspaces?include_archived=0')
    expect(fetchSpy.mock.calls[0][1]).toBeUndefined()
  })

  it('sends include_archived=1 when archived rows are requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ workspaces: [] }))
    await workspacesApi.fetchWorkspaces({ includeArchived: true })
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/workspaces?include_archived=1')
  })

  it('rejects with status, code and problems taken from the error detail', async () => {
    const detail = { message: 'Nome inválido', code: 'invalid_name', problems: [{ path: 'name', code: 'invalid_name' }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail }, { ok: false, status: 400 }))
    await expect(workspacesApi.fetchWorkspaces()).rejects.toMatchObject({
      message: 'Nome inválido',
      status: 400,
      code: 'invalid_name',
      problems: [{ path: 'name', code: 'invalid_name' }],
    })
  })

  it('falls back to the HTTP status when the body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new SyntaxError('Unexpected token') },
    })
    await expect(workspacesApi.fetchWorkspaces()).rejects.toMatchObject({
      message: 'HTTP 503',
      status: 503,
      code: null,
      problems: [],
    })
  })

  it('uses a string detail as the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'Not found' }, { ok: false, status: 404 }))
    await expect(workspacesApi.fetchWorkspaces()).rejects.toMatchObject({ message: 'Not found', status: 404, code: null })
  })
})
