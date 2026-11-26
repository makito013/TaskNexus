// QA additions for the read-only board (F1). Kept apart from BoardTab.test.jsx: these cover V2 parity
// of what the board does with cards that match no column, the shape of the real registry (a root
// project that shares the key of its workspace), and recovery from a stale remembered view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { BOARD_VIEW_STORAGE_KEY, DEFAULT_BOARD_VIEW } from '../../../../utils/boardView.js'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import BoardTab from './BoardTab.jsx'
import { COLUMNS, card } from './boardFixtures.js'

const folder = (id, path) => ({ id, path, is_primary: true, position: 0, exists: true })
const project = (id, key, name) => ({
  id, key, name, origin: 'legacy_seed', archived: false, primary_locked: true, folders: [folder(id, `D:\\projetos\\${key}`)],
})

// The shape the real database has: every legacy workspace owns a project with the same key.
const LEGACY_REGISTRY = buildRegistryIndex({
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'podesubir', name: 'podesubir', origin: 'legacy_seed', archived: false,
      projects: [project(1, 'podesubir', 'podesubir'), project(2, 'podesubir/gateway', 'gateway')],
    },
  ],
})

function setup(cards, props = {}) {
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(COLUMNS)
  vi.spyOn(api, 'fetchCards').mockResolvedValue(cards)
  return render(<BoardTab registry={LEGACY_REGISTRY} workspaceKey="" showArchived={false} {...props} />)
}

const column = (name) => screen.getByRole('group', { name: `Coluna ${name}` })
const titlesIn = (name) => within(column(name)).queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
const select = (name) => screen.getByRole('combobox', { name })
const loaded = () => screen.findByRole('region', { name: 'Board' })

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('BoardTab QA: cards that match no column (same rule as the V2: status === slug)', () => {
  const cards = [
    card(1, 'podesubir/gateway', { status: 'a_fazer' }),
    card(2, 'podesubir/gateway', { status: 'zz_orphan_status' }),
    card(3, 'podesubir/gateway', { status: 'A_FAZER' }),
    card(4, 'podesubir/gateway', { status: null }),
    card(5, 'podesubir/gateway', { status: 'feito' }),
  ]

  it('draws only the cards whose status is exactly a column slug, and never throws for the others', async () => {
    setup(cards)
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1']))
    expect(titlesIn('Feito')).toEqual(['Card 5'])
    expect(screen.queryByText('Card 2')).toBeNull()
    expect(screen.queryByText('Card 3')).toBeNull()
    expect(screen.queryByText('Card 4')).toBeNull()
  })

  it('column titles equal the V2 rule applied to the same cards, column by column', async () => {
    setup(cards)
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toHaveLength(1))
    for (const col of COLUMNS) {
      const v2Titles = cards.filter((c) => c.status === col.slug).map((c) => c.titulo)
      expect(titlesIn(col.label)).toEqual(v2Titles)
    }
  })

  it('the counts add up to the drawn cards only (the stray status is in no count)', async () => {
    setup(cards)
    await loaded()
    await waitFor(() => expect(within(column('A fazer')).getByLabelText('1 cards')).toBeTruthy())
    const total = COLUMNS.reduce((sum, col) => sum + titlesIn(col.label).length, 0)
    expect(total).toBe(2)
  })
})

describe('BoardTab QA: subcards stay inside their parent', () => {
  it('a card with subcards shows one face, not one per subcard', async () => {
    const child = card(11, 'podesubir/gateway', { parent_id: 10, titulo: 'Child' })
    setup([card(10, 'podesubir/gateway', { titulo: 'Parent', subcards: [child] })])
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Parent']))
    expect(screen.queryByText('Child')).toBeNull()
  })
})

describe('BoardTab QA: recovering from a stale remembered view', () => {
  it('values the selects do not offer go back to the default, so no card is hidden', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ prioridade: 'zzz', tipo: '', prazo: '', sort: 'manual' }))
    setup([card(1, 'podesubir/gateway'), card(2, 'podesubir/gateway')])
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Card 1', 'Card 2']))
    expect(screen.queryByText('Nenhum card com esses filtros.')).toBeNull()
    expect(select('Prioridade').value).toBe('')
  })

  it('an unknown remembered sort keeps the manual order instead of reordering', async () => {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({ prioridade: '', tipo: '', prazo: '', sort: 'xyz' }))
    setup([card(2, 'podesubir/gateway', { titulo: 'B' }), card(1, 'podesubir/gateway', { titulo: 'A' })])
    await loaded()
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['B', 'A']))
  })
})

describe('BoardTab QA: the real registry shape (a root project with the key of its workspace)', () => {
  const cards = [
    card(1, 'podesubir', { titulo: 'Root card' }),
    card(2, 'podesubir/gateway', { titulo: 'Gateway card' }),
  ]

  it('the root project is reachable by its own option', async () => {
    setup(cards, { workspaceKey: 'podesubir' })
    await loaded()
    fireEvent.change(select('Projeto'), { target: { value: 'podesubir' } })
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Root card']))
  })

  // QA finding F1-QA-1 (fixed): with the real data a card keyed "podesubir" resolves to the root PROJECT,
  // never to the workspace itself, and "Do workspace" has to list it anyway.
  it('"Do workspace" lists the cards that sit at the root of a legacy workspace', async () => {
    setup(cards, { workspaceKey: 'podesubir' })
    await loaded()
    fireEvent.change(select('Projeto'), { target: { value: '__workspace' } })
    await waitFor(() => expect(api.fetchCards).toHaveBeenLastCalledWith(['podesubir']))
    await waitFor(() => expect(titlesIn('A fazer')).toEqual(['Root card']))
  })
})
