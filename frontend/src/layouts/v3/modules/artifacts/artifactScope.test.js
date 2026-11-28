import { describe, it, expect } from 'vitest'
import { NO_WORKSPACE_VALUE } from '../projects/registryIndex.js'
import { ARTIFACTS, artifact, registry } from './artifactFixtures.js'
import {
  ALL_PROJECTS,
  DO_WORKSPACE,
  buildArtifactScope,
  groupArtifacts,
  importableProjects,
  isUnassignedKey,
  placeLabel,
} from './artifactScope.js'

const index = registry()
const keysIn = (scope) => ARTIFACTS.filter((entry) => scope.matches(entry.project_id)).map((entry) => entry.artifact_id)

describe('buildArtifactScope', () => {
  it('"Todos" asks the server for everything and keeps every non archived place', () => {
    const scope = buildArtifactScope({ registry: index })
    expect(scope.clienteId).toBeNull()
    // the archived project (Pessoal/old) and the archived workspace (Velho) are out
    expect(keysIn(scope)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
  })

  it('"Mostrar arquivados" brings the archived project and the archived workspace back', () => {
    const scope = buildArtifactScope({ registry: index, showArchived: true })
    expect(keysIn(scope)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'])
  })

  it('a real workspace asks for its key and keeps only its own places (the minted ones included)', () => {
    const scope = buildArtifactScope({ registry: index, workspaceKey: '.w12' })
    expect(scope.clienteId).toBe('.w12')
    expect(keysIn(scope)).toEqual(['a3', 'a4'])
    const legacy = buildArtifactScope({ registry: index, workspaceKey: 'Pessoal' })
    expect(legacy.clienteId).toBe('Pessoal')
    expect(keysIn(legacy)).toEqual(['a1', 'a2', 'a5'])
  })

  it('"Sem workspace" asks for no client and cuts the stray bucket and the unknown key here', () => {
    const scope = buildArtifactScope({ registry: index, workspaceKey: NO_WORKSPACE_VALUE })
    expect(scope.clienteId).toBeNull()
    expect(keysIn(scope)).toEqual(['a6', 'a7'])
  })

  it('a project is the EXACT key: ".w12" does not take ".w12/.p38" and "Pessoal/.p3" does not take "Pessoal/.p37"', () => {
    const root = buildArtifactScope({ registry: index, workspaceKey: '.w12', projectKey: DO_WORKSPACE })
    expect(keysIn(root)).toEqual(['a4'])
    const minted = buildArtifactScope({ registry: index, workspaceKey: '.w12', projectKey: '.w12/.p38' })
    expect(keysIn(minted)).toEqual(['a3'])
    const prefix = buildArtifactScope({ registry: index, workspaceKey: 'Pessoal', projectKey: 'Pessoal/.p3' })
    expect(keysIn(prefix)).toEqual([])
    const docs = buildArtifactScope({ registry: index, workspaceKey: 'Pessoal', projectKey: 'Pessoal/.p37' })
    expect(keysIn(docs)).toEqual(['a2'])
  })

  it('an unregistered sub-folder stays inside its workspace', () => {
    const scope = buildArtifactScope({ registry: index, workspaceKey: 'Pessoal' })
    expect(scope.matches('Pessoal/lab-voz')).toBe(true)
    expect(buildArtifactScope({ registry: index, workspaceKey: '.w12' }).matches('Pessoal/lab-voz')).toBe(false)
  })

  it('offers the project select only for a real workspace, with "Do workspace" last', () => {
    expect(buildArtifactScope({ registry: index }).hasProjectChoice).toBe(false)
    const scope = buildArtifactScope({ registry: index, workspaceKey: 'Pessoal' })
    expect(scope.hasProjectChoice).toBe(true)
    expect(scope.projectOptions.map((option) => option.label)).toEqual(['Todos os projetos', 'tn-sandbox', 'Docs', 'Do workspace'])
    expect(scope.projectOptions[0].value).toBe(ALL_PROJECTS)
  })
})

describe('placeLabel and groupArtifacts', () => {
  it('names a place by the registry, never by the key (a minted key is not printed)', () => {
    expect(placeLabel('Pessoal/tn-sandbox', index)).toBe('Pessoal / tn-sandbox')
    expect(placeLabel('.w12/.p38', index)).toBe('Estudos / Lab')
    expect(placeLabel('Pessoal/.p37', index)).toBe('Pessoal / Docs')
    expect(placeLabel('.w12', index)).toBe('Estudos / Do workspace')
    expect(placeLabel('Pessoal/lab-voz', index)).toBe('Pessoal / lab-voz (não cadastrada)')
    expect(placeLabel('NewCo/x', index)).toBe('Sem workspace / NewCo/x')
    expect(placeLabel('.w9/.p9', index)).toBe('Projeto não encontrado / .w9/.p9')
    for (const key of ['.w12/.p38', 'Pessoal/.p37']) expect(placeLabel(key, index)).not.toMatch(/\.[wp]\d/)
  })

  it('one group per place in the order of the list, the buckets and the archived ones marked', () => {
    const groups = groupArtifacts(ARTIFACTS, index, 'recentes')
    expect(groups.map((group) => group.key)).toEqual([
      'Pessoal/tn-sandbox', 'Pessoal/.p37', '.w12/.p38', '.w12', 'Pessoal/lab-voz', 'NewCo/x', '.w9/.p9', 'Pessoal/old', 'Velho/legacy',
    ])
    const bucket = Object.fromEntries(groups.map((group) => [group.key, group.bucket]))
    expect(bucket['Pessoal/lab-voz']).toBe('unregistered')
    expect(bucket['NewCo/x']).toBe('unassigned')
    expect(bucket['.w9/.p9']).toBe('unknown')
    expect(bucket['Pessoal/tn-sandbox']).toBeNull()
    expect(groups.filter((group) => group.archived).map((group) => group.key)).toEqual(['Pessoal/old', 'Velho/legacy'])
  })

  it('"nome" sorts the groups by label without accents or case', () => {
    const groups = groupArtifacts(ARTIFACTS, index, 'nome')
    expect(groups.map((group) => group.label)).toEqual([
      'Estudos / Do workspace',
      'Estudos / Lab',
      'Pessoal / Docs',
      'Pessoal / lab-voz (não cadastrada)',
      'Pessoal / old',
      'Pessoal / tn-sandbox',
      'Projeto não encontrado / .w9/.p9',
      'Sem workspace / NewCo/x',
      'Velho / legacy',
    ])
  })

  it('keeps the order of the items inside a group and merges the same place', () => {
    const list = [artifact(1, 'Pessoal/.p37'), artifact(2, '.w12/.p38'), artifact(3, 'Pessoal/.p37')]
    const groups = groupArtifacts(list, index)
    expect(groups.map((group) => group.items.map((item) => item.artifact_id))).toEqual([['a1', 'a3'], ['a2']])
  })

  it('an empty or missing list is no group', () => {
    expect(groupArtifacts([], index)).toEqual([])
    expect(groupArtifacts(null, index)).toEqual([])
  })
})

describe('isUnassignedKey and importableProjects', () => {
  it('a key outside every workspace (or unknown) needs the "Sem workspace" option', () => {
    expect(isUnassignedKey('NewCo/x', index)).toBe(true)
    expect(isUnassignedKey('.w9/.p9', index)).toBe(true)
    expect(isUnassignedKey('Pessoal/lab-voz', index)).toBe(false)
    expect(isUnassignedKey('.w12', index)).toBe(false)
  })

  it('offers only registered, not archived projects with a folder, inside the workspace of the header', () => {
    expect(importableProjects(index).map((project) => project.key)).toEqual(['Pessoal/tn-sandbox', 'Pessoal/.p37', '.w12/.p38'])
    expect(importableProjects(index, '.w12').map((project) => project.key)).toEqual(['.w12/.p38'])
    expect(importableProjects(index, 'Velho')).toEqual([])
    expect(importableProjects(index, NO_WORKSPACE_VALUE)).toEqual([])
  })

  it('a project without a primary folder cannot be imported', () => {
    const bare = registry()
    bare.projects.find((project) => project.key === 'Pessoal/.p37').primaryPath = null
    expect(importableProjects(bare, 'Pessoal').map((project) => project.key)).toEqual(['Pessoal/tn-sandbox'])
  })
})
