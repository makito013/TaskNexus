import { describe, it, expect } from 'vitest'
import { mergeAttentionRows, planChatNotifications, shouldAckTerminal } from './chatNotifications.js'

const KEY = 'Pessoal/p::claude::k3x9q2'
const OTHER = 'Pessoal/p::claude::zz9988'

describe('planChatNotifications heldKey', () => {
  const pending = { [KEY]: { needs_attention: true }, [OTHER]: { needs_attention: false } }

  it('keeps the open conversation pending mark recorded even when the tab is hidden (nothing looks at it)', () => {
    const first = planChatNotifications({ persisted: pending, notifiedKeys: [], focusedKey: KEY, heldKey: KEY })
    expect(first.notifications).toEqual([])
    expect(first.nextNotifiedKeys).toEqual([KEY])
    // Tab hidden: nobody "looks at" it, but it is still the open one.
    const hiddenTab = planChatNotifications({ persisted: pending, notifiedKeys: first.nextNotifiedKeys, focusedKey: null, heldKey: KEY })
    expect(hiddenTab.playSound).toBe(false)
    expect(hiddenTab.notifications).toEqual([])
    expect(hiddenTab.nextNotifiedKeys).toEqual([KEY])
  })

  it('does not record a held key that is not pending, and never duplicates one that is', () => {
    expect(planChatNotifications({ persisted: pending, notifiedKeys: [], heldKey: OTHER }).nextNotifiedKeys).toEqual([KEY])
    expect(planChatNotifications({ persisted: pending, notifiedKeys: [], heldKey: KEY }).nextNotifiedKeys).toEqual([KEY])
    expect(planChatNotifications({ persisted: pending, notifiedKeys: [], heldKey: 'gone' }).nextNotifiedKeys).toEqual([KEY])
  })

  it('without a baseline the held key is still recorded', () => {
    const plan = planChatNotifications({ persisted: pending, notifiedKeys: null, focusedKey: KEY, heldKey: KEY })
    expect(plan.nextNotifiedKeys).toEqual([KEY])
    expect(plan.notifications).toEqual([])
  })

  it('a key that stops being pending leaves the record, so it notifies again when it returns', () => {
    const cleared = planChatNotifications({ persisted: { [KEY]: { needs_attention: false } }, notifiedKeys: [KEY], heldKey: KEY })
    expect(cleared.nextNotifiedKeys).toEqual([])
    const back = planChatNotifications({ persisted: pending, notifiedKeys: cleared.nextNotifiedKeys, heldKey: null })
    expect(back.notifications).toHaveLength(1)
  })
})

describe('mergeAttentionRows', () => {
  it('hands back the chat rows as they are when no terminal session exists', () => {
    const chats = { [KEY]: { needs_attention: false } }
    expect(mergeAttentionRows(chats, {})).toBe(chats)
    expect(mergeAttentionRows(chats, null)).toBe(chats)
  })

  it('adds the terminal sessions and ORs the marks of a key on both lists', () => {
    const merged = mergeAttentionRows(
      { [KEY]: { display_name: 'a', needs_attention: false, push_notified: false } },
      { [KEY]: { needs_attention: true, push_notified: true }, 'P::codex': { display_name: 'x', needs_attention: true } },
    )
    expect(merged[KEY]).toEqual({ display_name: 'a', needs_attention: true, push_notified: true })
    expect(merged['P::codex']).toEqual({ display_name: 'x', needs_attention: true, push_notified: false })
  })
})

describe('shouldAckTerminal', () => {
  const base = { row: { needs_attention: true }, focused: true, documentVisible: true }
  it('acks a focused, visible row that needs attention, with no socket involved', () => {
    expect(shouldAckTerminal(base)).toBe(true)
  })
  it.each([
    ['not focused', { focused: false }],
    ['tab hidden', { documentVisible: false }],
    ['nothing pending', { row: { needs_attention: false } }],
    ['no row', { row: null }],
    ['an approval pending', { row: { needs_attention: true, pending_permissions: 1 } }],
    ['awaiting permission', { row: { needs_attention: true, live_status: 'awaiting_permission' } }],
  ])('does not ack: %s', (_label, change) => {
    expect(shouldAckTerminal({ ...base, ...change })).toBe(false)
  })
})
