import { describe, it, expect } from 'vitest'
import { countSituations, filterItems, projectLabel, tasksIslandMessage, toTaskItems } from './taskItems.js'

// Thursday, 2026-10-15, local time. The clock is never read.
const today = new Date(2026, 9, 15, 10, 30)

const projects = [{ id: 'acme/site', nome: 'Site' }]

const task = (overrides = {}) => ({
  id: 1,
  session_key: 'acme/site::claude',
  titulo: 'Validar login',
  descricao_markdown: 'Passos',
  status: 'pending',
  created_at: 1000,
  completed_at: null,
  projeto_id: 'acme/site',
  ...overrides,
})

const card = (overrides = {}) => ({
  id: 1,
  titulo: 'Corrigir cadastro',
  projeto_id: 'acme/site',
  status: 'a_fazer',
  descricao: null,
  criado_em: 2000,
  tipo: null,
  prazo: null,
  ...overrides,
})

const build = (input) => toTaskItems({ doneSlug: 'feito', projects, today, ...input })

describe('toTaskItems', () => {
  it('maps validation tasks and cards with non-colliding ids', () => {
    const items = build({ tasks: [task({ id: 7 })], cards: [card({ id: 7 })] })
    expect(items.map((item) => item.id).sort()).toEqual(['card:7', 'task:7'])
    const validation = items.find((item) => item.source === 'validation')
    expect(validation).toMatchObject({
      title: 'Validar login',
      projectId: 'acme/site',
      projectName: 'Site',
      done: false,
      due: null,
      overdue: false,
      kind: null,
      descriptionMarkdown: 'Passos',
      createdAt: 1000,
      taskId: 7,
      sessionKey: 'acme/site::claude',
      cardId: null,
    })
    expect(items.find((item) => item.source === 'card')).toMatchObject({ cardId: 7, taskId: null, sessionKey: null })
  })

  it('marks a card done only when its status equals doneSlug', () => {
    const items = build({
      cards: [card({ id: 1, status: 'feito' }), card({ id: 2, status: 'em_andamento' })],
    })
    expect(items.find((item) => item.id === 'card:1').done).toBe(true)
    expect(items.find((item) => item.id === 'card:2').done).toBe(false)
  })

  it('never marks overdue while doneSlug is unknown', () => {
    const items = build({ doneSlug: null, cards: [card({ prazo: '2026-10-01', status: 'feito' })] })
    expect(items[0].overdue).toBe(false)
    expect(items[0].done).toBe(false)
    expect(items[0].due).toBe('2026-10-01')
  })

  it('marks a past-due open card overdue and a delivered one not', () => {
    const items = build({
      cards: [
        card({ id: 1, prazo: '2026-10-14' }),
        card({ id: 2, prazo: '2026-10-14', status: 'feito' }),
        card({ id: 3, prazo: '2026-10-15' }),
      ],
    })
    expect(items.find((item) => item.id === 'card:1').overdue).toBe(true)
    expect(items.find((item) => item.id === 'card:2').overdue).toBe(false)
    expect(items.find((item) => item.id === 'card:3').overdue).toBe(false)
  })

  it('keeps due null for validation tasks and for unparseable prazo', () => {
    const items = build({
      tasks: [task()],
      cards: [
        card({ id: 1, prazo: '31/02' }),
        card({ id: 2, prazo: 'semana que vem' }),
        card({ id: 3, prazo: '2026-02-31' }),
      ],
    })
    expect(items.every((item) => item.due === null && item.overdue === false)).toBe(true)
  })

  it('keeps only the known card kinds', () => {
    const items = build({
      cards: [
        card({ id: 1, tipo: 'bug' }),
        card({ id: 2, tipo: 'historia' }),
        card({ id: 3, tipo: 'epic' }),
        card({ id: 4, tipo: null }),
      ],
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item.kind]))
    expect(byId).toEqual({ 'card:1': 'bug', 'card:2': 'historia', 'card:3': null, 'card:4': null })
  })

  it('resolves projectName and keeps null for unknown projects', () => {
    const items = build({
      tasks: [task({ id: 1, projeto_id: 'ghost/x' }), task({ id: 2, projeto_id: null })],
    })
    expect(items.every((item) => item.projectName === null)).toBe(true)
    expect(items.find((item) => item.id === 'task:1').projectId).toBe('ghost/x')
    expect(items.find((item) => item.id === 'task:2').projectId).toBeNull()
  })

  it('treats empty descriptions as absent and ISO created_at as epoch seconds', () => {
    const [item] = build({
      tasks: [task({ descricao_markdown: '   ', created_at: '2026-10-10T00:00:00Z' })],
    })
    expect(item.descriptionMarkdown).toBeNull()
    expect(item.createdAt).toBe(Date.parse('2026-10-10T00:00:00Z') / 1000)
  })

  it('sorts validation tasks first, then overdue, then due ascending with null last, then createdAt descending', () => {
    const items = build({
      tasks: [task({ id: 1, created_at: 10 }), task({ id: 2, created_at: 20 })],
      cards: [
        card({ id: 1, prazo: '2026-10-20' }),
        card({ id: 2, prazo: '2026-10-10' }),
        card({ id: 3, prazo: '2026-10-16' }),
        card({ id: 4, prazo: '2026-10-12' }),
      ],
    })
    expect(items.map((item) => item.id)).toEqual([
      'task:2', 'task:1', // validation first, newest first
      'card:2', 'card:4', // overdue, earliest first
      'card:3', 'card:1', // upcoming, earliest first
    ])
  })
})

describe('projectLabel', () => {
  it('shows the name, "Sem projeto" without a project, and nothing for an unresolvable project', () => {
    expect(projectLabel({ projectName: 'Site', projectId: 'acme/site' })).toBe('Site')
    expect(projectLabel({ projectName: null, projectId: null })).toBe('Sem projeto')
    expect(projectLabel({ projectName: null, projectId: 'ghost/x' })).toBeNull()
  })
})

describe('filterItems and countSituations', () => {
  const items = build({
    tasks: [task({ id: 1 }), task({ id: 2, status: 'done' })],
    cards: [
      card({ id: 1, prazo: '2026-10-15' }),
      card({ id: 2, prazo: '2026-10-01' }),
      card({ id: 3, prazo: '2026-10-15', status: 'feito' }),
      card({ id: 4 }),
    ],
  })

  it('filters today using the local date', () => {
    expect(filterItems(items, 'today', today).map((item) => item.id)).toEqual(['card:1'])
    // 23:30 local on the 15th is still "today" even though it is already the 16th in UTC.
    const lateEvening = new Date(2026, 9, 15, 23, 30)
    expect(filterItems(items, 'today', lateEvening).map((item) => item.id)).toEqual(['card:1'])
    expect(filterItems(items, 'today', new Date(2026, 9, 16, 0, 5))).toEqual([])
  })

  it('filters pending, overdue and done', () => {
    expect(filterItems(items, 'pending', today).map((item) => item.id).sort()).toEqual(['card:1', 'card:2', 'card:4', 'task:1'])
    expect(filterItems(items, 'overdue', today).map((item) => item.id)).toEqual(['card:2'])
    expect(filterItems(items, 'done', today).map((item) => item.id).sort()).toEqual(['card:3', 'task:2'])
  })

  it('counts situations', () => {
    expect(countSituations(items, today)).toEqual({ pending: 4, today: 1, overdue: 1, done: 2 })
  })
})

describe('tasksIslandMessage', () => {
  const counts = (pending, todayCount, overdue) => ({ pending, today: todayCount, overdue, done: 0 })

  it('covers loading, failure, empty, overdue and today, overdue only, today only and pending only', () => {
    expect(tasksIslandMessage({ loading: true, failed: false, counts: counts(0, 0, 0) })).toEqual({
      text: 'Separando suas tarefas…',
      state: 'thinking',
    })
    expect(tasksIslandMessage({ loading: false, failed: true, counts: counts(0, 0, 0) })).toEqual({
      text: 'Não consegui buscar as tarefas. Tenta de novo?',
      state: 'alert',
    })
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(0, 0, 0) })).toEqual({
      text: 'Tudo em dia. Nenhuma tarefa pendente.',
      state: 'idle',
    })
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(6, 3, 2) })).toEqual({
      text: '3 pra hoje e 2 atrasadas. Quer ver as atrasadas?',
      state: 'alert',
    })
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(4, 0, 2) })).toEqual({
      text: '2 atrasadas. Quer ver?',
      state: 'alert',
    })
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(4, 2, 0) })).toEqual({
      text: '2 com prazo pra hoje. Tô de olho no resto.',
      state: 'talking',
    })
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(5, 0, 0) })).toEqual({
      text: '5 pendentes e nenhuma com prazo pra hoje.',
      state: 'talking',
    })
  })

  it('pluralizes counts in the island message', () => {
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(3, 1, 1) }).text)
      .toBe('1 pra hoje e 1 atrasada. Quer ver as atrasadas?')
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(1, 0, 1) }).text)
      .toBe('1 atrasada. Quer ver?')
    expect(tasksIslandMessage({ loading: false, failed: false, counts: counts(1, 0, 0) }).text)
      .toBe('1 pendente e nenhuma com prazo pra hoje.')
  })

  it('prefers the failure message over the counts', () => {
    expect(tasksIslandMessage({ loading: false, failed: true, counts: counts(3, 1, 1) }).state).toBe('alert')
  })
})
