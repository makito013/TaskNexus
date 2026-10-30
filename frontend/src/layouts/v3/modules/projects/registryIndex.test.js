import { describe, it, expect } from 'vitest'
import {
  NO_WORKSPACE_VALUE,
  buildRegistryIndex,
  isSyntheticKey,
  locationLabel,
  placeName,
  resolveKey,
  scopeOf,
  workspaceOptions,
} from './registryIndex.js'

const folder = (id, path, extra = {}) => ({ id, path, is_primary: true, position: 0, exists: true, ...extra })
const project = (id, key, name, extra = {}) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: false, folders: [folder(id, `D:\\projetos\\${key}`)], ...extra,
})

const RESPONSE = {
  seeded: { at: 1, root: 'D:\\projetos', workspaces: 3, projects: 4 },
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        project(1, 'Pessoal/tn-sandbox', 'tn-sandbox', { primary_locked: true }),
        project(2, 'Pessoal/.p5', 'Studio', { folders: [folder(2, 'D:\\estudio', { exists: false })] }),
      ],
    },
    { id: 2, key: '.w3', name: 'Estudos', origin: 'user', archived: false, projects: [] },
    {
      id: 3, key: 'RD_Station', name: 'RD Station', origin: 'seed', archived: true,
      projects: [project(3, 'RD_Station/rd-legado', 'rd-legado', { archived: true })],
    },
  ],
}

describe('isSyntheticKey', () => {
  it.each(['.w12', '.w12/.p38', 'Pessoal/.p37'])('is true for the minted shape %s', (key) => {
    expect(isSyntheticKey(key)).toBe(true)
  })

  it.each(['Pessoal', 'Pessoal/tn-sandbox', 'Pessoal/.hidden', '.w1/.hidden', '.w1/x/.p2', '.p3', '', 'Pessoal/.p'])(
    'is false for the legacy or malformed key %j',
    (key) => {
      expect(isSyntheticKey(key)).toBe(false)
    },
  )

  it('is false for non-strings', () => {
    expect(isSyntheticKey(null)).toBe(false)
    expect(isSyntheticKey(undefined)).toBe(false)
  })
})

describe('buildRegistryIndex', () => {
  const index = buildRegistryIndex(RESPONSE)

  it('indexes workspaces and projects by key and id, archived ones included', () => {
    expect(index.workspaces.map((w) => w.key)).toEqual(['Pessoal', '.w3', 'RD_Station'])
    expect(index.projects.map((p) => p.key)).toEqual(['Pessoal/tn-sandbox', 'Pessoal/.p5', 'RD_Station/rd-legado'])
    expect(index.workspaceByKey.get('.w3').name).toBe('Estudos')
    expect(index.workspaceById.get(3).archived).toBe(true)
    expect(index.projectByKey.get('RD_Station/rd-legado').archived).toBe(true)
    expect(index.projectsByWorkspaceId.get(1)).toHaveLength(2)
    expect(index.projectsByWorkspaceId.get(2)).toEqual([])
    expect(index.seeded.projects).toBe(4)
  })

  it('decorates each project with its workspace, primary path and folder existence', () => {
    const sandbox = index.projectByKey.get('Pessoal/tn-sandbox')
    expect(sandbox).toMatchObject({
      workspaceKey: 'Pessoal', workspaceName: 'Pessoal', primaryPath: 'D:\\projetos\\Pessoal/tn-sandbox',
      exists: true, primaryLocked: true,
    })
    expect(index.projectByKey.get('Pessoal/.p5')).toMatchObject({ exists: false, primaryLocked: false })
    expect(index.projectByKey.get('RD_Station/rd-legado').workspaceArchived).toBe(true)
  })

  it('takes the first folder when none is marked primary and tolerates a project without folders', () => {
    const odd = buildRegistryIndex({
      workspaces: [{
        id: 1, key: 'A', name: 'A', archived: false,
        projects: [
          { id: 1, key: 'A/x', name: 'x', folders: [{ id: 1, path: '/a', is_primary: false, position: 0 }] },
          { id: 2, key: 'A/y', name: 'y', folders: [] },
        ],
      }],
    })
    expect(odd.projectByKey.get('A/x')).toMatchObject({ primaryPath: '/a', exists: true })
    expect(odd.projectByKey.get('A/y')).toMatchObject({ primaryPath: null, exists: true })
  })

  it('builds an empty index from an empty or missing response', () => {
    expect(buildRegistryIndex({ seeded: null, workspaces: [] }).workspaces).toEqual([])
    expect(buildRegistryIndex(null).projects).toEqual([])
  })
})

describe('resolveKey (table of section 2.8)', () => {
  const index = buildRegistryIndex(RESPONSE)

  it('maps a registered project key to its project and workspace', () => {
    const resolved = resolveKey('Pessoal/tn-sandbox', index)
    expect(resolved.kind).toBe('project')
    expect(resolved.project.name).toBe('tn-sandbox')
    expect(resolved.workspace.key).toBe('Pessoal')
    expect(resolved.clientKey).toBe('Pessoal')
    expect(resolveKey('Pessoal/.p5', index).kind).toBe('project')
  })

  it('maps a workspace key (a card only of the client) to the workspace', () => {
    const resolved = resolveKey('Pessoal', index)
    expect(resolved).toMatchObject({ kind: 'workspace', project: null, clientKey: 'Pessoal' })
    expect(resolveKey('.w3', index).kind).toBe('workspace')
  })

  it('maps a legacy key under a known workspace, with no project, to "unregistered"', () => {
    const resolved = resolveKey('Pessoal/lab-voz', index)
    expect(resolved).toMatchObject({ kind: 'unregistered', project: null, clientKey: 'Pessoal' })
    expect(resolved.workspace.key).toBe('Pessoal')
    // A "." segment that is not a minted shape is still a legacy key.
    expect(resolveKey('Pessoal/.hidden', index).kind).toBe('unregistered')
  })

  it('maps a legacy key whose first segment has no workspace to "unassigned"', () => {
    const resolved = resolveKey('NewCo/api-nova', index)
    expect(resolved).toMatchObject({ kind: 'unassigned', workspace: null, clientKey: null, rawClientKey: 'NewCo' })
    expect(resolveKey('NewCo', index).kind).toBe('unassigned')
  })

  it('maps a minted key that is not in the registry to "unknown"', () => {
    expect(resolveKey('.w9/.p9', index).kind).toBe('unknown')
    expect(resolveKey('Pessoal/.p99', index).kind).toBe('unknown')
    expect(resolveKey('.w9', index).kind).toBe('unknown')
  })

  it('maps an empty or non-string key to "unknown"', () => {
    expect(resolveKey('', index).kind).toBe('unknown')
    expect(resolveKey(null, index).kind).toBe('unknown')
  })

  it('still resolves projects of an archived workspace', () => {
    const resolved = resolveKey('RD_Station/rd-legado', index)
    expect(resolved.kind).toBe('project')
    expect(resolved.workspace.archived).toBe(true)
  })

  it('scopeOf gives the workspace key, or the "no workspace" value', () => {
    expect(scopeOf(resolveKey('Pessoal/tn-sandbox', index))).toBe('Pessoal')
    expect(scopeOf(resolveKey('NewCo/x', index))).toBe(NO_WORKSPACE_VALUE)
    expect(scopeOf(resolveKey('.w9/.p9', index))).toBe(NO_WORKSPACE_VALUE)
  })
})

describe('locationLabel and placeName', () => {
  const index = buildRegistryIndex(RESPONSE)

  it.each([
    ['Pessoal/tn-sandbox', 'Pessoal › tn-sandbox'],
    ['Pessoal/lab-voz', 'Pessoal › lab-voz (não cadastrada)'],
    ['Pessoal/a/b', 'Pessoal › a/b (não cadastrada)'],
    ['NewCo/x', 'Sem workspace › NewCo/x'],
    ['.w9/.p9', 'Projeto não encontrado › .w9/.p9'],
    ['Pessoal', 'Pessoal › Do workspace'],
  ])('labels %s as %s', (key, label) => {
    expect(locationLabel(key, index)).toBe(label)
  })

  it('names the place shortly', () => {
    expect(placeName('Pessoal/tn-sandbox', index)).toBe('tn-sandbox')
    expect(placeName('Pessoal/lab-voz', index)).toBe('lab-voz')
    expect(placeName('NewCo/x', index)).toBe('NewCo/x')
    expect(placeName('Pessoal', index)).toBe('Pessoal')
  })
})

describe('workspaceOptions', () => {
  const index = buildRegistryIndex(RESPONSE)

  it('lists all workspaces first and hides archived workspaces by default', () => {
    expect(workspaceOptions(index)).toEqual([
      { value: '', label: 'Todos os workspaces' },
      { value: 'Pessoal', label: 'Pessoal' },
      { value: '.w3', label: 'Estudos' },
    ])
  })

  it('adds "Sem workspace" only when something lives there', () => {
    const options = workspaceOptions(index, { hasUnassigned: true })
    expect(options[options.length - 1]).toEqual({ value: NO_WORKSPACE_VALUE, label: 'Sem workspace' })
    expect(workspaceOptions(index, { hasUnassigned: false }).some((o) => o.value === NO_WORKSPACE_VALUE)).toBe(false)
  })

  it('includes archived workspaces when archived rows are shown', () => {
    const labels = workspaceOptions(index, { showArchived: true }).map((o) => o.label)
    expect(labels).toEqual(['Todos os workspaces', 'Pessoal', 'Estudos', 'RD Station'])
  })
})
