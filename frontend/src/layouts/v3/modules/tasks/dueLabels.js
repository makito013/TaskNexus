// pt-BR labels for due dates, always in LOCAL time. Hand-rolled name tables
// (no toLocaleDateString) so the output does not depend on the ICU build.
// "today" is always a parameter.
import { formatPrazo, parseIsoDate } from '../../../../utils/cardMeta.js'

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]
const DAY_MS = 24 * 60 * 60 * 1000

function localDate(due) {
  const parsed = parseIsoDate(due)
  return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : null
}

// Whole calendar days from today to the due date (negative = in the past).
function daysUntil(due, today) {
  const dueDate = localDate(due)
  if (!dueDate) return null
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((dueDate - startOfToday) / DAY_MS)
}

export function dueRowLabel(due, { done, overdue, today }) {
  if (!due) return 'Sem prazo'
  const short = formatPrazo(due, today)
  if (overdue) return `Atrasada · ${short}`
  if (done) return short
  const days = daysUntil(due, today)
  if (days === 0) return 'Hoje'
  if (days === 1) return 'Amanhã'
  if (days !== null && days >= 2 && days <= 6) return WEEKDAYS[localDate(due).getDay()]
  return short
}

// "Quinta, 8 de outubro" (the year is added when it is not the current one).
export function dueLongDate(due, today = new Date()) {
  const date = localDate(due)
  if (!date) return ''
  const base = `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === today.getFullYear() ? base : `${base} de ${date.getFullYear()}`
}

export function dueRelative(due, today) {
  const days = daysUntil(due, today)
  if (days === null) return ''
  if (days === 0) return 'Vence hoje'
  if (days === 1) return 'Vence amanhã'
  if (days > 1) return `Faltam ${days} dias`
  const late = -days
  return `Atrasada há ${late} ${late === 1 ? 'dia' : 'dias'}`
}

const count = (value, singular, pluralForm) => `${value} ${value === 1 ? singular : pluralForm}`

// "3 pendentes · 1 com prazo hoje · 2 atrasadas"
export function summaryLine({ pending, today, overdue }) {
  return [
    count(pending, 'pendente', 'pendentes'),
    `${today} com prazo hoje`,
    count(overdue, 'atrasada', 'atrasadas'),
  ].join(' · ')
}
