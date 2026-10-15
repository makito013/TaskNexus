import { describe, it, expect } from 'vitest'
import { dueLongDate, dueRelative, dueRowLabel, summaryLine } from './dueLabels.js'

// Thursday, 2026-10-15, local time.
const today = new Date(2026, 9, 15, 10, 30)
const row = (due, flags = {}) => dueRowLabel(due, { done: false, overdue: false, today, ...flags })

describe('dueRowLabel', () => {
  it('labels today, tomorrow, weekday within six days and short date beyond', () => {
    expect(row('2026-10-15')).toBe('Hoje')
    expect(row('2026-10-16')).toBe('Amanhã')
    expect(row('2026-10-17')).toBe('Sábado')
    expect(row('2026-10-21')).toBe('Quarta')
    expect(row('2026-10-22')).toBe('22 out')
    expect(row('2027-01-05')).toBe('5 jan 2027')
    expect(row(null)).toBe('Sem prazo')
  })

  it('prefixes overdue rows with Atrasada', () => {
    expect(row('2026-10-05', { overdue: true })).toBe('Atrasada · 5 out')
  })

  it('does not raise the alarm for a done item', () => {
    expect(row('2026-10-15', { done: true })).toBe('15 out')
  })
})

describe('dueLongDate', () => {
  it('formats the long date in pt-BR', () => {
    expect(dueLongDate('2026-10-08', today)).toBe('Quinta, 8 de outubro')
    expect(dueLongDate('2026-12-25', today)).toBe('Sexta, 25 de dezembro')
    expect(dueLongDate('2027-03-02', today)).toBe('Terça, 2 de março de 2027')
    expect(dueLongDate('lixo', today)).toBe('')
  })
})

describe('dueRelative', () => {
  it('describes relative due as vence hoje, vence amanhã, faltam N dias or atrasada há N dias', () => {
    expect(dueRelative('2026-10-15', today)).toBe('Vence hoje')
    expect(dueRelative('2026-10-16', today)).toBe('Vence amanhã')
    expect(dueRelative('2026-10-20', today)).toBe('Faltam 5 dias')
    expect(dueRelative('2026-10-14', today)).toBe('Atrasada há 1 dia')
    expect(dueRelative('2026-10-05', today)).toBe('Atrasada há 10 dias')
  })

  it('counts calendar days across a month boundary', () => {
    expect(dueRelative('2026-11-02', today)).toBe('Faltam 18 dias')
  })
})

describe('summaryLine', () => {
  it('summaryLine uses singular when the count is 1', () => {
    expect(summaryLine({ pending: 3, today: 1, overdue: 2 })).toBe('3 pendentes · 1 com prazo hoje · 2 atrasadas')
    expect(summaryLine({ pending: 1, today: 0, overdue: 1 })).toBe('1 pendente · 0 com prazo hoje · 1 atrasada')
  })
})
