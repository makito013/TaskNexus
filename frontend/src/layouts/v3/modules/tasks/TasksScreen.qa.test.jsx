import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { api } from '../../../../services/api.js'
import { IslandProvider } from '../../IslandContext.jsx'
import TasksScreen from './TasksScreen.jsx'
import { toTaskItems, countSituations, filterItems } from './taskItems.js'
import { demoteHeadings } from './demoteHeadings.js'

// QA (phase 5): hostile markdown reaching the detail panel, and date edge cases.
const NOW = new Date(2026, 9, 15, 10, 0)
const columns = [
  { slug: 'a_fazer', label: 'A fazer', position: 0, is_done: false },
  { slug: 'feito', label: 'Feito', position: 1, is_done: true },
]

const HOSTILE = [
  '# Real title',
  '<img src="x" onerror="window.__pwned=1">',
  '[click](javascript:window.__pwned=2)',
  '<a href="javascript:window.__pwned=3">raw</a>',
  '<svg onload="window.__pwned=4"></svg>',
  '<iframe src="javascript:window.__pwned=5"></iframe>',
  '<h1 onclick="window.__pwned=6">injected</h1>',
  '<form action="javascript:1"><input></form>',
  'Literal &lt;h1&gt; text',
].join('\n\n')

function mountWith(descricao) {
  vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
  vi.spyOn(api, 'fetchCards').mockResolvedValue([
    { id: 1, titulo: 'Hostile card', projeto_id: null, status: 'a_fazer', descricao, criado_em: 1, tipo: 'bug', prazo: '2026-10-20' },
  ])
  vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns)
  vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  return render(<IslandProvider value={vi.fn()}><TasksScreen /></IslandProvider>)
}

describe('TasksScreen QA: hostile markdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete window.__pwned
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('strips event handlers, javascript: URLs and active elements from the description', async () => {
    const { container } = mountWith(HOSTILE)
    await waitFor(() => expect(screen.queryByText('Carregando tarefas…')).toBeNull())
    fireEvent.click(within(screen.getByRole('list', { name: 'Tarefas' })).getByText('Hostile card'))

    const prose = container.querySelector('.v3-prose')
    const html = prose.innerHTML
    expect(html).not.toMatch(/onerror|onload|onclick/i)
    expect(html).not.toMatch(/javascript:/i)
    expect(prose.querySelector('iframe, script, object, embed')).toBeNull()
    // DOMPurify keeps a bare form/input (same as the v2 modal) but drops the hostile action.
    prose.querySelectorAll('form').forEach((form) => expect(form.hasAttribute('action')).toBe(false))
    expect(window.__pwned).toBeUndefined()
    prose.querySelectorAll('a').forEach((a) => {
      expect(a.getAttribute('href') || '').not.toMatch(/^javascript:/i)
    })
  })

  it('keeps exactly one h1 and demotes injected headings; escaped text stays text', async () => {
    const { container } = mountWith(HOSTILE)
    await waitFor(() => expect(screen.queryByText('Carregando tarefas…')).toBeNull())
    fireEvent.click(within(screen.getByRole('list', { name: 'Tarefas' })).getByText('Hostile card'))

    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('.v3-prose h1, .v3-prose h2')).toBeNull()
    expect(container.querySelector('.v3-prose').textContent).toContain('Literal <h1> text')
  })
})

describe('demoteHeadings QA', () => {
  it('does not touch hr, header or hgroup-like tags', () => {
    expect(demoteHeadings('<hr><header>x</header><h2>a</h2>')).toBe('<hr><header>x</header><h4>a</h4>')
  })
})

describe('toTaskItems QA: date edge cases', () => {
  const card = (prazo, status = 'a_fazer') => ({ id: 1, titulo: 'c', projeto_id: null, status, prazo, criado_em: 1, tipo: null, descricao: null })

  it('treats an impossible or free-form prazo as no due date (never overdue, never today)', () => {
    const today = new Date(2026, 2, 3, 9, 0)
    const items = toTaskItems({ tasks: [], cards: [card('2026-02-31'), card('amanhã'), card('2026-13-01')], doneSlug: 'feito', projects: [], today })
    expect(items.every((item) => item.due === null && item.overdue === false)).toBe(true)
    expect(countSituations(items, today)).toMatchObject({ today: 0, overdue: 0, pending: 3 })
  })

  it('uses the local calendar day at 23:59 and at 00:00', () => {
    const late = new Date(2026, 9, 15, 23, 59)
    const early = new Date(2026, 9, 16, 0, 0)
    const items = (today) => toTaskItems({ tasks: [], cards: [card('2026-10-15')], doneSlug: 'feito', projects: [], today })
    expect(filterItems(items(late), 'today', late)).toHaveLength(1)
    expect(filterItems(items(late), 'overdue', late)).toHaveLength(0)
    expect(filterItems(items(early), 'today', early)).toHaveLength(0)
    expect(filterItems(items(early), 'overdue', early)).toHaveLength(1)
  })

  it('a delivered card with a past prazo is neither overdue nor pending', () => {
    const today = new Date(2026, 9, 15, 9, 0)
    const items = toTaskItems({ tasks: [], cards: [card('2026-10-01', 'feito')], doneSlug: 'feito', projects: [], today })
    expect(items[0]).toMatchObject({ done: true, overdue: false })
    expect(countSituations(items, today)).toMatchObject({ pending: 0, overdue: 0, done: 1 })
  })
})
