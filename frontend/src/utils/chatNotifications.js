// frontend/src/utils/chatNotifications.js
// PURE decisions of the V3 shell for chat attention: who notifies now, and when to ack.
//
// The notification rules are the V2 ones on purpose (same sound, same Web Notification, same
// quiet-hours window, same push ledger): this file only composes utils/sessionNotifications.js and
// utils/quietHours.js, which stay untouched. Nothing here reads the document or a browser API; the
// caller passes them in. The clock is read only through `isQuietNow` (it falls back to Date.now()
// when `nowEpochSeconds` is not given).

import { buildSessionNotification, decideSessionsToNotify } from './sessionNotifications.js'
import { isQuietNow } from './quietHours.js'

/**
 * One poll tick -> what to play and show.
 *
 * TRANSITION detection (not state): `notifiedKeys` is the set of keys already notified, `null` is
 * "no baseline yet" (first tick: record only). A key notifies once when it becomes pending and
 * again only after it stopped being pending.
 *
 * @param {object} params
 * @param {Record<string, {needs_attention?: boolean, push_notified?: boolean, display_name?: string|null}>} params.persisted
 * @param {string[]|null} params.notifiedKeys
 * @param {string|null} params.focusedKey the conversation the user is looking at right now (or null)
 * @param {string|null} params.heldKey the conversation OPEN on the screen, looked at or not (a hidden tab
 *   clears `focusedKey` but not this one). A mark it carries stays in `nextNotifiedKeys`: the user saw
 *   it (or could not clear it: approval pending, terminal view), so hiding the tab or leaving the
 *   conversation must not read it as a new transition. Only the mark going away and coming back
 *   notifies again.
 * @param {object|null} params.settings GET /api/settings/notifications (null = not loaded: no window)
 * @param {number} [params.nowEpochSeconds]
 * @param {boolean} params.hasPushSubscription this device receives Web Push (gates the ledger)
 * @returns {{playSound: boolean, notifications: Array<{tag: string, title: string, body: string}>, nextNotifiedKeys: string[]}}
 */
export function planChatNotifications({
  persisted,
  notifiedKeys,
  focusedKey = null,
  heldKey = null,
  settings = null,
  nowEpochSeconds,
  hasPushSubscription = false,
}) {
  const { toNotify, toSound, nextNotifiedKeys } = decideSessionsToNotify({
    sessions: persisted,
    notifiedKeys,
    focusedKey,
    quietHoursActive: isQuietNow(settings, nowEpochSeconds),
    hasPushSubscription,
  })
  const held = heldKey && persisted?.[heldKey]?.needs_attention === true && !nextNotifiedKeys.includes(heldKey)
  return {
    // One sound for the whole tick, even when several chats finished together.
    playSound: toSound.length > 0,
    notifications: toNotify.map((key) => buildSessionNotification(key, persisted[key])),
    nextNotifiedKeys: held ? [...nextNotifiedKeys, heldKey] : nextNotifiedKeys,
  }
}

/**
 * The sessions the notification channel watches: the chat rows (V2 shape) plus the sessions that live
 * in the terminal (`GET /api/sessions/persisted`: codex, agy, the plain terminal, a Claude conversation
 * sent to the terminal), as the V2 poll reads them. A key in both is pending when either says so.
 *
 * @param {Record<string, object>} chatPersisted
 * @param {Record<string, object>|null} ptyPersisted
 */
export function mergeAttentionRows(chatPersisted, ptyPersisted) {
  if (!ptyPersisted || Object.keys(ptyPersisted).length === 0) return chatPersisted
  const merged = { ...chatPersisted }
  for (const [key, row] of Object.entries(ptyPersisted)) {
    const known = merged[key]
    merged[key] = known
      ? {
          ...known,
          needs_attention: known.needs_attention === true || row?.needs_attention === true,
          push_notified: known.push_notified === true || row?.push_notified === true,
        }
      : {
          display_name: row?.display_name ?? null,
          needs_attention: row?.needs_attention === true,
          push_notified: row?.push_notified === true,
        }
  }
  return merged
}

/**
 * Whether the open conversation must send `ack` now: the server still marks it as needing attention
 * (and no approval is pending: that one is cleared by the decision itself), the user is looking at
 * it (it is the open conversation of the screen and the tab is visible) and the socket is open.
 *
 * @param {{chat?: {needs_attention?: boolean, live_status?: string, pending_permissions?: number}|null,
 *   focused: boolean, documentVisible: boolean, socketOpen: boolean}} params
 */
export function shouldAckChat({ chat, focused, documentVisible, socketOpen }) {
  if (!chat?.needs_attention) return false
  if (chat.live_status === 'awaiting_permission' || (chat.pending_permissions ?? 0) > 0) return false
  return Boolean(focused && documentVisible && socketOpen)
}

/**
 * Whether the terminal view of the open conversation must ack over REST (`api.ackSession`): same rule
 * as the chat view, with no socket involved (the terminal has none of the chat). The row is a chat row
 * or a terminal session row; an approval pending on a chat row is never acked (the decision clears it).
 */
export function shouldAckTerminal({ row, focused, documentVisible }) {
  return shouldAckChat({ chat: row, focused, documentVisible, socketOpen: true })
}
