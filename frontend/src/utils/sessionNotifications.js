// frontend/src/utils/sessionNotifications.js
// PURE decision of "which sessions should notify now" (channel A of the
// end-of-chat notification feature: sound + Web Notification on the open
// tab).
//
// No reference to `Notification`, `Audio`, `AudioContext`, or `navigator`
// lives here on purpose — whoever plays the sound and shows the notification
// is the injectable adapter services/notifier.js. That way this logic (the
// part that actually has edge cases) is testable without simulating browser
// APIs.
//
// The central point: **TRANSITION detection, not state detection.** The 7s
// poll (components/TerminalContext.jsx) returns `needs_attention: true` on
// every tick until the user opens the chat. Notifying by state would play
// the sound every 7 seconds — the Web Notification's `tag` masks this on the
// visual side (silently replaces the previous notification), but the audio
// has no deduplication at all. That's why `notifiedKeys` tracks who has
// already notified, and a key only becomes eligible to notify again after it
// stops being pending (acked by opening the chat, or session end).

/**
 * @param {object} params
 * @param {Record<string, {needs_attention?: boolean, display_name?: string|null}>} params.sessions
 *   Session map from the last tick (persistedSessions).
 * @param {string[]|null} params.notifiedKeys Keys that already notified.
 *   `null` = there's no baseline yet (first tick after opening the page):
 *   nothing notifies, it just records the current state. Without this,
 *   opening the app in the morning would fire a volley of sounds for
 *   everything that finished overnight — none of those is a transition THIS
 *   tab observed.
 * @param {string|null} params.focusedKey Focused session. Never notifies:
 *   the poll's own tick already acks it ("the focused chat doesn't notify
 *   itself", UI-SPEC section 3).
 * @param {boolean} params.quietHoursActive Whether the quiet-hours window is
 *   active right now.
 * @param {boolean} params.hasPushSubscription Whether THIS device has an
 *   active Web Push subscription. This is the guard on the anti-double-sound
 *   ledger below, and it has to be a per-device fact: `push_notified` says
 *   the server pushed to SOME device, which tells this tab nothing unless it
 *   is one of them.
 * @returns {{toNotify: string[], toSound: string[], nextNotifiedKeys: string[]}}
 *   `toNotify` = show the in-tab Web Notification; `toSound` = play the
 *   sound. They differ only for chats already delivered by push.
 */
export function decideSessionsToNotify({
  sessions,
  notifiedKeys,
  focusedKey = null,
  quietHoursActive = false,
  hasPushSubscription = false,
}) {
  const pending = Object.keys(sessions || {}).filter(
    (key) => sessions[key]?.needs_attention === true && key !== focusedKey,
  );

  // Every pending key goes into `nextNotifiedKeys`, whether it was delivered
  // or suppressed by the window. The quiet-hours window DISCARDS the
  // notification, it doesn't defer it: waking up at 7am to a volley of
  // sounds for what finished overnight is exactly what the window exists to
  // prevent — the badge/title keeps marking what's pending (that part is
  // never silenced).
  // Keys that dropped out of `pending` disappear from here, so a new
  // `needs_attention` for the same session becomes a transition again and
  // notifies once more.
  const nextNotifiedKeys = pending;

  if (notifiedKeys === null || quietHoursActive) {
    return { toNotify: [], toSound: [], nextNotifiedKeys };
  }
  const already = new Set(notifiedKeys);
  const toNotify = pending.filter((key) => !already.has(key));

  // Anti-double-sound ledger (Phase 3). The backend sets `push_notified`
  // the moment it DECIDES to send a Web Push for a pause; a device that
  // receives that push already gets an OS notification with its own sound,
  // so playing the in-tab sound on top of it would alert twice for one
  // pause.
  //
  // The `hasPushSubscription` guard is the whole point, and the critical
  // case is the negative one: a browser WITHOUT a subscription of its own is
  // not one of the devices that push reached, so it must keep playing the
  // sound even with `push_notified` true — otherwise enabling push on the
  // phone would silently mute the desktop.
  //
  // Only the SOUND is suppressed. The in-tab Web Notification still fires:
  // it shares `tag = session_key` with the push, so on a device that got
  // both, the second one silently replaces the first instead of stacking.
  const toSound = hasPushSubscription
    ? toNotify.filter((key) => sessions[key]?.push_notified !== true)
    : toNotify;

  return { toNotify, toSound, nextNotifiedKeys };
}

/**
 * Content of a session's Web Notification. `tag` is the `session_key`: the
 * Web Notification API itself implements the "one notification per session"
 * requested by the PO this way — a new notification with the same `tag`
 * replaces the previous one instead of stacking. Without `renotify`, that
 * replacement is silent (doesn't repeat the system's sound/vibration).
 *
 * @param {string} sessionKey `projectId::agentId[::suffix]`
 * @param {{display_name?: string|null}} meta Row from persistedSessions.
 */
export function buildSessionNotification(sessionKey, meta = {}) {
  // projectId can contain '/' (sub-projects), but never '::' — the
  // positional split is safe. The third segment (random suffix of a second
  // chat for the same agent) doesn't go into the text: it's noise to the
  // user.
  const [projectId, agentId] = String(sessionKey).split('::');
  const customName = (meta?.display_name || '').trim();
  const label = customName || agentId || sessionKey;
  const location = [projectId, !customName || !agentId ? null : agentId]
    .filter(Boolean)
    .join(' · ');
  return {
    tag: sessionKey,
    title: `${label} terminou`,
    body: location ? `Projeto ${location}` : sessionKey,
  };
}
