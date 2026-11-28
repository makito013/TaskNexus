import { describe, it, expect } from 'vitest'
import { listDestinations } from './destinations.js'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import { registry } from './boardFixtures.js'

const index = registry()
const keysOf = (groups) => groups.flatMap((group) => group.projects.map((project) => project.key))

describe('listDestinations', () => {
  it('lists the active workspaces with their root and their active projects', () => {
    expect(listDestinations(index)).toEqual([
      {
        workspaceKey: 'Pessoal',
        label: 'Pessoal',
        projects: [
          { key: 'Pessoal', label: 'Do workspace' },
          { key: 'Pessoal/tn-sandbox', label: 'tn-sandbox' },
          { key: 'Pessoal/silent-a', label: 'silent-a' },
        ],
      },
      {
        workspaceKey: 'podesubir',
        label: 'podesubir',
        projects: [
          { key: 'podesubir', label: 'Do workspace' },
          { key: 'podesubir/ymci', label: 'ymci' },
        ],
      },
      { workspaceKey: '.w3', label: 'Estudos', projects: [{ key: '.w3', label: 'Do workspace' }] },
    ])
  })

  it('never offers an archived project or an archived workspace as a destination', () => {
    const keys = keysOf(listDestinations(index))
    expect(keys).not.toContain('Pessoal/old')
    expect(keys).not.toContain('Velho')
    expect(keys).not.toContain('Velho/legacy')
  })

  it('marks the current place when it is already a destination', () => {
    const groups = listDestinations(index, 'Pessoal/tn-sandbox')
    const current = groups.flatMap((group) => group.projects).filter((project) => project.current)
    expect(current).toEqual([{ key: 'Pessoal/tn-sandbox', label: 'tn-sandbox', current: true }])
    expect(keysOf(groups)).toEqual(keysOf(listDestinations(index)))
  })

  it('adds an unregistered sub-folder as "(atual)" inside its workspace', () => {
    const groups = listDestinations(index, 'Pessoal/lab-voz')
    const pessoal = groups.find((group) => group.workspaceKey === 'Pessoal')
    expect(pessoal.projects.at(-1)).toEqual({ key: 'Pessoal/lab-voz', label: 'lab-voz (não cadastrada) (atual)', current: true })
  })

  it('adds a stray bucket as its own group', () => {
    const groups = listDestinations(index, 'NewCo/x')
    expect(groups.at(-1)).toEqual({
      workspaceKey: null,
      label: 'Sem workspace',
      projects: [{ key: 'NewCo/x', label: 'NewCo/x (atual)', current: true }],
    })
  })

  it('adds a key that does not exist as a "not found" group', () => {
    const groups = listDestinations(index, '.w9/.p9')
    expect(groups.at(-1).label).toBe('Projeto não encontrado')
    expect(groups.at(-1).projects[0].current).toBe(true)
  })

  it('adds the archived place the card is in, so saving keeps it', () => {
    const groups = listDestinations(index, 'Pessoal/old')
    const pessoal = groups.find((group) => group.workspaceKey === 'Pessoal')
    expect(pessoal.projects.at(-1)).toMatchObject({ key: 'Pessoal/old', current: true })
    const archivedWorkspace = listDestinations(index, 'Velho/legacy').at(-1)
    expect(archivedWorkspace.label).toBe('Velho')
    expect(archivedWorkspace.projects[0]).toMatchObject({ key: 'Velho/legacy', current: true })
  })
})

describe('legacy root project', () => {
  it('is offered once, as "Do workspace"', () => {
    const legacy = buildRegistryIndex({
      seeded: null,
      workspaces: [{
        id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false,
        projects: [
          { id: 5, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, primary_locked: false, folders: [] },
        ],
      }],
    })
    expect(listDestinations(legacy)[0].projects).toEqual([{ key: 'podesubir', label: 'Do workspace' }])
  })
})
