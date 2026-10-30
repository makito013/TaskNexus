import { describe, it, expect, vi, afterEach } from 'vitest'
import { workspacesApi } from './workspacesApi.js'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

function lastCall(fetchSpy) {
  const [url, init] = fetchSpy.mock.calls.at(-1)
  return { url, init, body: init?.body === undefined ? undefined : JSON.parse(init.body) }
}

describe('workspacesApi writes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('createWorkspace POSTs the name and omits adopt_legacy_key when not adopting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ workspace: { id: 7 } }, { status: 201 }))
    await expect(workspacesApi.createWorkspace({ name: 'Estudos' })).resolves.toEqual({ workspace: { id: 7 } })
    const call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/workspaces')
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(call.body).toEqual({ name: 'Estudos' })
  })

  it('createWorkspace sends adopt_legacy_key (snake case) when adopting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ workspace: { id: 8 } }, { status: 201 }))
    await workspacesApi.createWorkspace({ name: 'NewCo', adoptLegacyKey: 'NewCo' })
    expect(lastCall(fetchSpy).body).toEqual({ name: 'NewCo', adopt_legacy_key: 'NewCo' })
  })

  it('updateWorkspace PATCHes only the fields that were set (the endpoint rejects extras)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ workspace: { id: 3 } }))
    await workspacesApi.updateWorkspace(3, { archived: true })
    let call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/workspaces/3')
    expect(call.init.method).toBe('PATCH')
    expect(call.body).toEqual({ archived: true })
    await workspacesApi.updateWorkspace(3, { name: 'Novo nome' })
    call = lastCall(fetchSpy)
    expect(call.body).toEqual({ name: 'Novo nome' })
    expect('archived' in call.body).toBe(false)
  })

  it('createProject POSTs name and folders with is_primary in snake case', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ project: { id: 1 }, warnings: [] }, { status: 201 }))
    await workspacesApi.createProject(4, {
      name: 'qa-a',
      folders: [{ path: 'C:\\a', isPrimary: true }, { path: 'C:\\b', isPrimary: false }],
    })
    const call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/workspaces/4/projects')
    expect(call.init.method).toBe('POST')
    expect(call.body).toEqual({
      name: 'qa-a',
      folders: [{ path: 'C:\\a', is_primary: true }, { path: 'C:\\b', is_primary: false }],
    })
  })

  it('updateProject sends a rename alone, an archive alone, or the folders when they are given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ project: { id: 9 }, warnings: [] }))
    await workspacesApi.updateProject(9, { name: 'renamed' })
    let call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/workspace-projects/9')
    expect(call.init.method).toBe('PATCH')
    expect(call.body).toEqual({ name: 'renamed' })

    await workspacesApi.updateProject(9, { archived: false })
    expect(lastCall(fetchSpy).body).toEqual({ archived: false })

    await workspacesApi.updateProject(9, { folders: [{ path: 'C:\\a', isPrimary: true }] })
    call = lastCall(fetchSpy)
    expect(call.body).toEqual({ folders: [{ path: 'C:\\a', is_primary: true }] })
    expect('name' in call.body).toBe(false)
  })

  it('discoverFolders is a plain GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ root: 'D:\\projetos', entries: [] }))
    await workspacesApi.discoverFolders()
    expect(lastCall(fetchSpy).url).toBe('/api/folders/discover')
    expect(lastCall(fetchSpy).init).toBeUndefined()
  })

  it('inspectFolders POSTs the paths and exclude_project_id only when given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ results: [] }))
    await workspacesApi.inspectFolders({ paths: ['C:\\a'] })
    let call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/folders/inspect')
    expect(call.init.method).toBe('POST')
    expect(call.body).toEqual({ paths: ['C:\\a'] })
    await workspacesApi.inspectFolders({ paths: ['C:\\a'], excludeProjectId: 12 })
    call = lastCall(fetchSpy)
    expect(call.body).toEqual({ paths: ['C:\\a'], exclude_project_id: 12 })
  })

  it('browseFolder POSTs to the projects-root picker without a body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ path: 'C:\\picked' }))
    await expect(workspacesApi.browseFolder()).resolves.toEqual({ path: 'C:\\picked' })
    const call = lastCall(fetchSpy)
    expect(call.url).toBe('/api/settings/projects-root/browse')
    expect(call.init).toEqual({ method: 'POST' })
  })

  it('surfaces the 400 problems and the 409 code of a failed write', async () => {
    const problems = [{ path: 'C:\\x', code: 'not_found', message: 'A pasta não existe nesta máquina.' }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(
      { detail: { message: 'A pasta não existe nesta máquina.', problems } },
      { ok: false, status: 400 },
    ))
    await expect(workspacesApi.createProject(1, { name: 'x', folders: [{ path: 'C:\\x', isPrimary: true }] }))
      .rejects.toMatchObject({ status: 400, problems })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(
      { detail: { code: 'adopt_conflict', message: 'Esse projeto já existe arquivado.', archived_project_id: 5 } },
      { ok: false, status: 409 },
    ))
    await expect(workspacesApi.createProject(1, { name: 'x', folders: [{ path: 'C:\\x', isPrimary: true }] }))
      .rejects.toMatchObject({ status: 409, code: 'adopt_conflict', message: 'Esse projeto já existe arquivado.' })
  })
})
