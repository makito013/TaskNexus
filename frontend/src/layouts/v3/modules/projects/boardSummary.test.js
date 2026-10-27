import { describe, it, expect } from 'vitest'
import { buildBoardSummary } from './boardSummary.js'
import { buildRegistryIndex } from './registryIndex.js'

const registry = buildRegistryIndex({
  workspaces: [
    { id: 1, key: 'Pessoal', name: 'Pessoal', archived: false, projects: [{ id: 1, key: 'Pessoal/tn', name: 'tn', folders: [] }] },
    { id: 2, key: 'podesubir', name: 'podesubir', archived: false, projects: [{ id: 2, key: 'podesubir/api', name: 'api', folders: [] }] },
  ],
})

const columns = [
  { slug: 'feito', label: 'Feito', position: 2, is_done: true },
  { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
  { slug: 'fazendo', label: 'Fazendo', position: 1, is_done: false },
]

const card = (id, projeto_id, status, extra = {}) => ({ id, projeto_id, status, parent_id: null, ...extra })

describe('buildBoardSummary', () => {
  it('returns null when the board has no columns (told apart from an empty board)', () => {
    expect(buildBoardSummary({ cards: [], columns: [], registry })).toBeNull()
    expect(buildBoardSummary({ cards: [], columns: undefined, registry })).toBeNull()
  })

  it('an empty board has every column at zero', () => {
    expect(buildBoardSummary({ cards: [], columns, registry })).toEqual({
      columns: [
        { slug: 'a_fazer', label: 'A fazer', count: 0 },
        { slug: 'fazendo', label: 'Fazendo', count: 0 },
        { slug: 'feito', label: 'Feito', count: 0 },
      ],
      other: 0,
      total: 0,
    })
  })

  it('counts top-level cards per column, in the order of position', () => {
    const summary = buildBoardSummary({
      cards: [card(1, 'Pessoal/tn', 'a_fazer'), card(2, 'Pessoal/tn', 'a_fazer'), card(3, 'podesubir/api', 'feito')],
      columns,
      registry,
    })
    expect(summary.columns.map((c) => [c.slug, c.count])).toEqual([['a_fazer', 2], ['fazendo', 0], ['feito', 1]])
    expect(summary.total).toBe(3)
  })

  it('does not count subcards', () => {
    const summary = buildBoardSummary({
      cards: [card(1, 'Pessoal/tn', 'a_fazer'), card(2, 'Pessoal/tn', 'a_fazer', { parent_id: 1 })],
      columns,
      registry,
    })
    expect(summary.total).toBe(1)
    expect(summary.columns[0].count).toBe(1)
  })

  it('puts an unknown status in "other"', () => {
    const summary = buildBoardSummary({ cards: [card(1, 'Pessoal/tn', 'arquivado')], columns, registry })
    expect(summary.other).toBe(1)
    expect(summary.total).toBe(1)
    expect(summary.columns.every((c) => c.count === 0)).toBe(true)
  })

  it('scopes by the workspace the card key resolves to', () => {
    const cards = [
      card(1, 'Pessoal/tn', 'a_fazer'),
      card(2, 'Pessoal/lab-voz', 'a_fazer'), // unregistered folder under Pessoal
      card(3, 'Pessoal', 'fazendo'), // card of the workspace itself
      card(4, 'podesubir/api', 'feito'),
      card(5, 'NewCo/x', 'feito'), // no workspace
    ]
    expect(buildBoardSummary({ cards, columns, registry, workspaceKey: 'Pessoal' }).total).toBe(3)
    expect(buildBoardSummary({ cards, columns, registry, workspaceKey: 'podesubir' }).total).toBe(1)
    expect(buildBoardSummary({ cards, columns, registry, workspaceKey: '__none' }).total).toBe(1)
    expect(buildBoardSummary({ cards, columns, registry, workspaceKey: '' }).total).toBe(5)
  })
})
