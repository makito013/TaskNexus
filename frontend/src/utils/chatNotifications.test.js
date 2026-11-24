import { describe, it, expect } from 'vitest'
import { planChatNotifications, shouldAckChat } from './chatNotifications.js'

const KEY = 'Pessoal/p::claude::k3x9q2'
const OTHER = 'Pessoal/p::claude::zz9988'
const pending = (extra = {}) => ({ needs_attention: true, push_notified: false, display_name: null, ...extra })
const idle = () => ({ needs_attention: false, push_notified: false, display_name: null })

const at = (hour, minute = 0) => Date.UTC(2026, 0, 1, hour, minute) / 1000
const NOON = at(12)
const quiet = (start, end, offset = 0) => ({
  quiet_hours_enabled: true,
  quiet_hours_start: start,
  quiet_hours_end: end,
  server_utc_offset_minutes: offset,
})

describe('planChatNotifications', () => {
  it('does nothing on the first read (no baseline), even for a chat already pending', () => {
    const plan = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: null, nowEpochSeconds: NOON })
    expect(plan.playSound).toBe(false)
    expect(plan.notifications).toEqual([])
    expect(plan.nextNotifiedKeys).toEqual([KEY])
  })

  it('notifies once on the transition to needs_attention and never again while it stays pending', () => {
    const first = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], nowEpochSeconds: NOON })
    expect(first.playSound).toBe(true)
    expect(first.notifications).toHaveLength(1)
    expect(first.notifications[0]).toMatchObject({ tag: KEY })
    const second = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: first.nextNotifiedKeys, nowEpochSeconds: NOON })
    expect(second.playSound).toBe(false)
    expect(second.notifications).toEqual([])
  })

  it('notifies again after the chat stopped being pending', () => {
    const cleared = planChatNotifications({ persisted: { [KEY]: idle() }, notifiedKeys: [KEY], nowEpochSeconds: NOON })
    expect(cleared.nextNotifiedKeys).toEqual([])
    const again = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: cleared.nextNotifiedKeys, nowEpochSeconds: NOON })
    expect(again.playSound).toBe(true)
  })

  it('plays ONE sound for several chats of the same tick, with one notification each', () => {
    const plan = planChatNotifications({ persisted: { [KEY]: pending(), [OTHER]: pending() }, notifiedKeys: [], nowEpochSeconds: NOON })
    expect(plan.playSound).toBe(true)
    expect(plan.notifications.map((item) => item.tag).sort()).toEqual([KEY, OTHER].sort())
  })

  it('the conversation in focus never notifies itself', () => {
    const plan = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], focusedKey: KEY, nowEpochSeconds: NOON })
    expect(plan.playSound).toBe(false)
    expect(plan.notifications).toEqual([])
  })

  it('quiet hours that cross midnight silence 23:30 and 03:00 but not 12:00', () => {
    const run = (now) => planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], settings: quiet('22:00', '07:00'), nowEpochSeconds: now })
    expect(run(at(23, 30)).playSound).toBe(false)
    expect(run(at(23, 30)).notifications).toEqual([])
    expect(run(at(3, 0)).playSound).toBe(false)
    expect(run(at(12, 0)).playSound).toBe(true)
  })

  it('quiet hours use the SERVER offset', () => {
    // 12:00 UTC + 600 min = 22:00 on the server clock: quiet
    const plan = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], settings: quiet('22:00', '07:00', 600), nowEpochSeconds: NOON })
    expect(plan.playSound).toBe(false)
  })

  it('a quiet window discards the notification: it does not fire when the window ends', () => {
    const silenced = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], settings: quiet('11:00', '13:00'), nowEpochSeconds: NOON })
    expect(silenced.nextNotifiedKeys).toEqual([KEY])
    const later = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: silenced.nextNotifiedKeys, nowEpochSeconds: at(15) })
    expect(later.playSound).toBe(false)
    expect(later.notifications).toEqual([])
  })

  it('push ledger: push_notified mutes the sound only with a subscription of its own; the notification stays', () => {
    const persisted = { [KEY]: pending({ push_notified: true }) }
    const withPush = planChatNotifications({ persisted, notifiedKeys: [], hasPushSubscription: true, nowEpochSeconds: NOON })
    expect(withPush.playSound).toBe(false)
    expect(withPush.notifications).toHaveLength(1)
    const withoutPush = planChatNotifications({ persisted, notifiedKeys: [], hasPushSubscription: false, nowEpochSeconds: NOON })
    expect(withoutPush.playSound).toBe(true)
  })

  it('settings not loaded (null) means no quiet window', () => {
    const plan = planChatNotifications({ persisted: { [KEY]: pending() }, notifiedKeys: [], settings: null, nowEpochSeconds: NOON })
    expect(plan.playSound).toBe(true)
  })
})

describe('shouldAckChat', () => {
  const base = { chat: { session_key: KEY, needs_attention: true }, focused: true, documentVisible: true, socketOpen: true }

  it('acks a focused, visible, connected conversation that needs attention', () => {
    expect(shouldAckChat(base)).toBe(true)
  })

  it.each([
    ['not needing attention', { chat: { needs_attention: false } }],
    ['no chat row', { chat: null }],
    ['not focused', { focused: false }],
    ['tab hidden', { documentVisible: false }],
    ['socket not open', { socketOpen: false }],
    ['approval pending (live_status)', { chat: { needs_attention: true, live_status: 'awaiting_permission' } }],
    ['approval pending (count)', { chat: { needs_attention: true, pending_permissions: 1 } }],
  ])('does not ack: %s', (_label, patch) => {
    expect(shouldAckChat({ ...base, ...patch })).toBe(false)
  })
})
