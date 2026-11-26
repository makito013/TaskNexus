import { describe, it, expect } from 'vitest'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import { ALL_PROJECTS, DO_WORKSPACE, buildScope, isUnassignedKey, placeOf } from './boardScope.js'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import { CARDS, registry } from './boardFixtures.js'

const idsIn = (scope) => CARDS.filter((card) => scope.matches(card.projeto_id)).map((card) => card.id)
const build = (options) => buildScope({ registry: registry(), ...options })

describe('buildScope: workspace', () => {
  it('all workspaces, archived hidden: everything but the archived places', () => {
    expect(idsIn(build({}))).toEqual([1, 2, 3, 4, 5, 6, 10])
  })

  it('all workspaces, archived shown: nothing is hidden', () => {
    expect(idsIn(build({ showArchived: true }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('a workspace keeps its projects, its root and its unregistered sub-folders, by the real key', () => {
    expect(idsIn(build({ workspaceKey: 'Pessoal' }))).toEqual([1, 2, 3])
  })

  it('does not match a workspace by the prefix of another key', () => {
    // "Pessoal" must not swallow a card of a workspace whose key merely starts with it
    const scope = build({ workspaceKey: 'Pessoal' })
    expect(scope.matches('PessoalExtra/x')).toBe(false)
  })

  it('"Sem workspace" holds the strays and the unknown keys', () => {
    expect(idsIn(build({ workspaceKey: NO_WORKSPACE_VALUE }))).toEqual([4, 5])
  })

  it('an archived workspace appears only with the switch on', () => {
    expect(idsIn(build({ workspaceKey: 'Velho' }))).toEqual([])
    expect(idsIn(build({ workspaceKey: 'Velho', showArchived: true }))).toEqual([8, 9])
  })
})

describe('buildScope: project refinement (exact key, ADR-65)', () => {
  it('a project is the exact key, never a prefix', () => {
    const scope = build({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' })
    expect(idsIn(scope)).toEqual([1])
    expect(scope.matches('Pessoal/tn-sandbox/sub')).toBe(false)
  })

  it('"Do workspace" is the workspace root only', () => {
    expect(idsIn(build({ workspaceKey: 'Pessoal', projectKey: DO_WORKSPACE }))).toEqual([2])
  })

  it('the unregistered sub-folder shows under "Todos os projetos" but is not a project', () => {
    const scope = build({ workspaceKey: 'Pessoal', projectKey: ALL_PROJECTS })
    expect(scope.matches('Pessoal/lab-voz')).toBe(true)
    expect(scope.projectOptions.map((option) => option.value)).not.toContain('Pessoal/lab-voz')
  })

  it('an archived project is hidden even when chosen, unless archived are shown', () => {
    expect(idsIn(build({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/old' }))).toEqual([])
    expect(idsIn(build({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/old', showArchived: true }))).toEqual([7])
  })
})

describe('buildScope: project options and request', () => {
  it('lists the projects of the workspace, then "Do workspace"', () => {
    expect(build({ workspaceKey: 'Pessoal' }).projectOptions).toEqual([
      { value: '', label: 'Todos os projetos' },
      { value: 'Pessoal/tn-sandbox', label: 'tn-sandbox' },
      { value: 'Pessoal/silent-a', label: 'silent-a' },
      { value: DO_WORKSPACE, label: 'Do workspace' },
    ])
  })

  it('shows archived projects, marked, only with the switch on', () => {
    const labels = build({ workspaceKey: 'Pessoal', showArchived: true }).projectOptions.map((option) => option.label)
    expect(labels).toContain('old (arquivado)')
  })

  it('has only "Todos os projetos" without a real workspace', () => {
    for (const workspaceKey of ['', NO_WORKSPACE_VALUE, 'ghost']) {
      const scope = build({ workspaceKey })
      expect(scope.projectOptions).toEqual([{ value: '', label: 'Todos os projetos' }])
      expect(scope.hasProjectChoice).toBe(false)
    }
  })

  it('asks the server for every card unless a project is chosen', () => {
    expect(build({ workspaceKey: 'Pessoal' }).fetchIds).toEqual([])
    expect(build({}).fetchIds).toEqual([])
  })

  it('asks for the exact project, or for the workspace key when it is "Do workspace"', () => {
    expect(build({ workspaceKey: 'Pessoal', projectKey: 'Pessoal/tn-sandbox' }).fetchIds).toEqual(['Pessoal/tn-sandbox'])
    expect(build({ workspaceKey: 'Pessoal', projectKey: DO_WORKSPACE }).fetchIds).toEqual(['Pessoal'])
  })
})

describe('placeOf and isUnassignedKey', () => {
  const index = registry()

  it.each([
    ['Pessoal/tn-sandbox', { workspace: 'Pessoal', project: 'tn-sandbox' }],
    ['Pessoal', { workspace: 'Pessoal', project: null }],
    ['Pessoal/lab-voz', { workspace: 'Pessoal', project: 'lab-voz (não cadastrada)' }],
    ['NewCo/x', { workspace: 'Sem workspace', project: 'NewCo/x' }],
    ['.w9/.p9', { workspace: 'Projeto não encontrado', project: '.w9/.p9' }],
  ])('names the place of %s', (key, expected) => {
    expect(placeOf(key, index)).toEqual(expected)
  })

  it('flags the keys that live outside every workspace', () => {
    expect(isUnassignedKey('NewCo/x', index)).toBe(true)
    expect(isUnassignedKey('.w9/.p9', index)).toBe(true)
    expect(isUnassignedKey('Pessoal/lab-voz', index)).toBe(false)
    expect(isUnassignedKey('Pessoal/tn-sandbox', index)).toBe(false)
  })
})

describe('legacy workspace whose root is a project keyed like the workspace', () => {
  const legacy = buildRegistryIndex({
    seeded: null,
    workspaces: [{
      id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false,
      projects: [
        { id: 5, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, primary_locked: false, folders: [] },
        { id: 6, key: 'podesubir/ymci', name: 'ymci', origin: 'seed', archived: false, primary_locked: false, folders: [] },
      ],
    }],
  })
  const scope = buildScope({ registry: legacy, workspaceKey: 'podesubir', projectKey: DO_WORKSPACE })

  it('"Do workspace" matches the root card, which resolves to a project', () => {
    expect(scope.matches('podesubir')).toBe(true)
    expect(scope.matches('podesubir/ymci')).toBe(false)
    expect(scope.fetchIds).toEqual(['podesubir'])
  })

  it('keeps the root project reachable by its own key, next to "Do workspace"', () => {
    expect(scope.projectOptions.map((option) => option.value)).toEqual(['', 'podesubir', 'podesubir/ymci', DO_WORKSPACE])
    expect(buildScope({ registry: legacy, workspaceKey: 'podesubir', projectKey: 'podesubir' }).matches('podesubir')).toBe(true)
  })
})
