import { describe, it, expect } from 'vitest'
import {
  chatStateOf,
  chatTitle,
  clockTime,
  elapsedLabel,
  islandFor,
  modeLabel,
  orderChats,
  projectLabel,
  relativeTime,
  turnMeta,
} from './chatLabels.js'

const NOW = 1_800_000_000_000 // ms
const ago = (seconds) => NOW / 1000 - seconds

describe('relativeTime', () => {
  it.each([
    [10, 'agora'],
    [59, 'agora'],
    [60, 'há 1 min'],
    [300, 'há 5 min'],
    [3599, 'há 59 min'],
    [3600, 'há 1 h'],
    [7200, 'há 2 h'],
    [86399, 'há 23 h'],
    [86400, 'ontem'],
    [2 * 86400, 'há 2 dias'],
    [6 * 86400, 'há 6 dias'],
  ])('%i s ago is "%s"', (seconds, text) => {
    expect(relativeTime(ago(seconds), NOW)).toBe(text)
  })

  it('older than a week is a short date, and a missing time is empty', () => {
    expect(relativeTime(ago(30 * 86400), NOW)).toMatch(/^\d{1,2} de [a-zç]{3}\.$/)
    expect(relativeTime(null, NOW)).toBe('')
    expect(relativeTime(undefined, NOW)).toBe('')
  })

  it('a time in the future is "agora", never negative', () => {
    expect(relativeTime(ago(-500), NOW)).toBe('agora')
  })
})

describe('small formatters', () => {
  it('clockTime is HH:mm and empty without a time', () => {
    expect(clockTime(new Date(2026, 10, 4, 9, 5).getTime() / 1000)).toBe('09:05')
    expect(clockTime(null)).toBe('')
  })

  it('turnMeta: seconds, minutes, cost only when reported, nothing for an error', () => {
    expect(turnMeta({ durationMs: 42000, costUsd: 0.03 })).toBe('Concluído em 42 s · US$ 0,03')
    expect(turnMeta({ durationMs: 65000 })).toBe('Concluído em 1 min 5 s')
    expect(turnMeta({ durationMs: 1000, costUsd: 0 })).toBe('Concluído em 1 s')
    expect(turnMeta({ durationMs: 1000, isError: true })).toBe('')
    expect(turnMeta(null)).toBe('')
  })

  it('elapsedLabel is m:ss', () => {
    expect(elapsedLabel(NOW - 42000, NOW)).toBe('0:42')
    expect(elapsedLabel(NOW - 125000, NOW)).toBe('2:05')
    expect(elapsedLabel(null, NOW)).toBe('0:00')
  })

  it('projectLabel is the last segment of the key', () => {
    expect(projectLabel('Pessoal/tn-sandbox')).toBe('tn-sandbox')
    expect(projectLabel('solo')).toBe('solo')
    expect(projectLabel('')).toBe('')
  })

  it('modeLabel: the default mode asks for approval; unknown falls back to it', () => {
    expect(modeLabel('default')).toBe('Pede aprovação')
    expect(modeLabel('acceptEdits')).toBe('Aceita edições')
    expect(modeLabel('plan')).toBe('Modo plano')
    expect(modeLabel('bypassPermissions')).toBe('Pede aprovação')
  })
})

describe('chatTitle', () => {
  it('prefers the name, then the first message clipped to one line, then "Nova conversa"', () => {
    expect(chatTitle({ display_name: '  Meu chat ' }, 'ignorada')).toBe('Meu chat')
    expect(chatTitle({ display_name: null }, 'linha 1\n\nlinha   2')).toBe('linha 1 linha 2')
    expect(chatTitle({}, 'x'.repeat(100))).toHaveLength(60)
    expect(chatTitle({}, 'x'.repeat(100)).endsWith('…')).toBe(true)
    expect(chatTitle(null, '')).toBe('Nova conversa')
    expect(chatTitle({ display_name: '   ' }, '   ')).toBe('Nova conversa')
  })
})

describe('chatStateOf priorities', () => {
  it('pending approvals beat running, and "needs attention" alone reads "Turno concluído"', () => {
    expect(chatStateOf({ live_status: 'running', pending_permissions: 1 }).state).toBe('needs_you')
    expect(chatStateOf({ live_status: 'awaiting_permission' }).detail).toBe('Turno concluído')
    expect(chatStateOf({ live_status: 'idle', needs_attention: true }).state).toBe('needs_you')
  })

  it('the open conversation can mark the attention as seen', () => {
    expect(chatStateOf({ live_status: 'idle', needs_attention: true }, { attentionSeen: true }).state).toBe('stopped')
  })

  it('failed beats nothing live; a failed row with a live process is not "failed"', () => {
    expect(chatStateOf({ status: 'failed', live_status: null, last_error: { reason: 'folder_unavailable' } })).toMatchObject({
      state: 'failed',
      detail: 'pasta não encontrada',
    })
    expect(chatStateOf({ status: 'failed', live_status: 'idle' }).state).toBe('stopped')
  })

  it('an unknown failure reason gets a neutral detail', () => {
    expect(chatStateOf({ status: 'failed', last_error: { reason: 'weird' } }).detail).toBe('Tente de novo.')
  })

  it('no live process is resumable, with the last activity', () => {
    const info = chatStateOf({ status: 'stopped', updated_at: ago(7200) }, { now: NOW })
    expect(info).toMatchObject({ state: 'resumable', label: 'Retomável', detail: 'Última atividade há 2 h' })
  })
})

describe('orderChats', () => {
  it('sorts by the fixed state order, then by recency', () => {
    const rows = [
      { session_key: 'f', status: 'failed', updated_at: 5 },
      { session_key: 'r2', status: 'stopped', updated_at: 1 },
      { session_key: 'r1', status: 'stopped', updated_at: 9 },
      { session_key: 'n', live_status: 'awaiting_permission', pending_permissions: 1, updated_at: 0 },
      { session_key: 'run', live_status: 'running', updated_at: 3 },
      { session_key: 'idle', live_status: 'idle', updated_at: 2 },
    ]
    expect(orderChats(rows).map(({ session }) => session.session_key)).toEqual(['n', 'run', 'idle', 'r1', 'r2', 'f'])
  })
})

describe('islandFor', () => {
  it('speaks as the Designer wrote, by priority', () => {
    expect(islandFor({ agentName: 'Claude', pendingCount: 1, running: true })).toEqual({ message: 'Claude está esperando você.', state: 'alert' })
    expect(islandFor({ agentName: 'Claude', pendingCount: 0, running: true })).toEqual({ message: 'Claude está trabalhando. Aviso quando terminar.', state: 'thinking' })
    expect(islandFor({ agentName: 'Claude', pendingCount: 0, running: false })).toEqual({ message: 'Chat aberto com Claude.', state: 'idle' })
    expect(islandFor({ agentName: 'Claude', failed: true, pendingCount: 2 })).toEqual({ message: 'Esse chat não abriu. Veja o aviso.', state: 'alert' })
    expect(islandFor({ notFound: true, failed: true })).toEqual({ message: 'Essa conversa não foi encontrada.', state: 'alert' })
  })
})
