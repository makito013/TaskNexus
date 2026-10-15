// Pure translation layer of the Tarefas screen: the PT-BR API contracts
// (`titulo`, `prazo`, `tipo`, `projeto_id`, ...) become English `TaskItem`s here
// and nowhere else. No React, no clock: "today" is always a parameter.
import { isPrazoAtrasado, parseIsoDate } from '../../../../utils/cardMeta.js'
import { resolveProjectName } from '../../../../utils/projectNames.js'

/**
 * @typedef {{
 *  id: string,                  // "task:<id>" | "card:<id>" - never collides
 *  source: 'validation' | 'card',
 *  title: string,
 *  projectId: string | null,
 *  projectName: string | null,
 *  done: boolean,
 *  due: string | null,          // "YYYY-MM-DD" when the card prazo parses
 *  overdue: boolean,
 *  kind: 'bug' | 'hotfix' | 'historia' | null,
 *  descriptionMarkdown: string | null,
 *  createdAt: number | null,    // epoch seconds
 *  taskId: number | null,       // validation only
 *  sessionKey: string | null,   // validation only (complete/reopen)
 *  cardId: number | null,       // card only (chip "#<id>")
 * }} TaskItem
 */

// Sub line of a row / detail. A project that is set but has no resolvable name
// (removed or unknown) shows nothing: the raw id never stands in for a name.
export function projectLabel(item) {
  if (item.projectName) return item.projectName
  return item.projectId ? null : 'Sem projeto'
}

export const SITUATIONS = ['pending', 'today', 'overdue', 'done']

const KINDS = new Set(['bug', 'hotfix', 'historia'])

const pad = (value) => String(value).padStart(2, '0')

// Local calendar day as "YYYY-MM-DD" (never toISOString: that is UTC).
export function localIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// created_at is epoch seconds from the backend; tolerate an ISO string.
function toEpochSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed / 1000
  }
  return null
}

function normalizedDue(prazo) {
  const parsed = parseIsoDate(prazo)
  if (!parsed) return null
  return `${String(parsed.year).padStart(4, '0')}-${pad(parsed.month)}-${pad(parsed.day)}`
}

function nonEmpty(text) {
  return typeof text === 'string' && text.trim() ? text : null
}

function fromTask(task, projects) {
  const projectId = task.projeto_id ?? null
  return {
    id: `task:${task.id}`,
    source: 'validation',
    title: task.titulo,
    projectId,
    projectName: projectId ? resolveProjectName(projectId, projects) : null,
    done: task.status === 'done',
    due: null,
    overdue: false,
    kind: null,
    descriptionMarkdown: nonEmpty(task.descricao_markdown),
    createdAt: toEpochSeconds(task.created_at),
    taskId: task.id,
    sessionKey: task.session_key ?? null,
    cardId: null,
  }
}

function fromCard(card, doneSlug, projects, today) {
  const projectId = card.projeto_id ?? null
  const knowsDone = doneSlug != null
  return {
    id: `card:${card.id}`,
    source: 'card',
    title: card.titulo,
    projectId,
    projectName: projectId ? resolveProjectName(projectId, projects) : null,
    done: knowsDone && card.status === doneSlug,
    due: normalizedDue(card.prazo),
    // Without the done column nothing is known to be delivered, so no card is
    // ever called late (isPrazoAtrasado alone would flag every past prazo).
    overdue: knowsDone && isPrazoAtrasado(card.prazo, card.status, doneSlug, today),
    kind: KINDS.has(card.tipo) ? card.tipo : null,
    descriptionMarkdown: nonEmpty(card.descricao),
    createdAt: toEpochSeconds(card.criado_em),
    taskId: null,
    sessionKey: null,
    cardId: card.id,
  }
}

// Validation tasks first (the only actionable items), then overdue, then due
// ascending (no prazo last), then newest first.
function compareItems(a, b) {
  if (a.source !== b.source) return a.source === 'validation' ? -1 : 1
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
  if (a.due !== b.due) {
    if (a.due === null) return 1
    if (b.due === null) return -1
    return a.due < b.due ? -1 : 1
  }
  return (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity) || 0
}

export function toTaskItems({ tasks, cards, doneSlug, projects, today = new Date() }) {
  const items = [
    ...(tasks || []).map((task) => fromTask(task, projects)),
    ...(cards || []).map((card) => fromCard(card, doneSlug, projects, today)),
  ]
  return items.sort(compareItems)
}

export function filterItems(items, situation, today) {
  const todayIso = localIsoDate(today)
  switch (situation) {
    case 'pending':
      return items.filter((item) => !item.done)
    case 'today':
      return items.filter((item) => !item.done && item.due === todayIso)
    case 'overdue':
      return items.filter((item) => item.overdue && !item.done)
    case 'done':
      return items.filter((item) => item.done)
    default:
      return items
  }
}

export function countSituations(items, today) {
  const counts = {}
  for (const situation of SITUATIONS) counts[situation] = filterItems(items, situation, today).length
  return counts
}

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`

// The phrase of Tiq on the island and the pet state that goes with it
// ("talking" settles back to idle in the shell). Voice and wording: Designer 3.3.
export function tasksIslandMessage({ loading, failed, counts }) {
  if (loading) return { text: 'Separando suas tarefas…', state: 'thinking' }
  if (failed) return { text: 'Não consegui buscar as tarefas. Tenta de novo?', state: 'alert' }

  const { pending, today, overdue } = counts
  if (pending === 0) return { text: 'Tudo em dia. Nenhuma tarefa pendente.', state: 'idle' }

  const lateText = plural(overdue, 'atrasada', 'atrasadas')
  if (overdue > 0 && today > 0) {
    return { text: `${today} pra hoje e ${lateText}. Quer ver as atrasadas?`, state: 'alert' }
  }
  if (overdue > 0) return { text: `${lateText}. Quer ver?`, state: 'alert' }
  if (today > 0) return { text: `${today} com prazo pra hoje. Tô de olho no resto.`, state: 'talking' }
  return {
    text: `${plural(pending, 'pendente', 'pendentes')} e nenhuma com prazo pra hoje.`,
    state: 'talking',
  }
}
