import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../services/api.js'
import { chatApi } from '../../../services/chatApi.js'
import { createBrowserNotifier, installUnlockOnFirstGesture } from '../../../services/notifier.js'
import { PUSH_SUBSCRIPTION_CHANGED_EVENT, reconcilePushSubscription } from '../../../services/pushSubscription.js'
import { mergeAttentionRows, planChatNotifications } from '../../../utils/chatNotifications.js'
import { NOTIFICATION_SETTINGS_CHANGED_EVENT } from '../../../hooks/useNotificationSettings.js'
import { EMPTY_PROJECTS_LIVE, ProjectsSessionsContext } from './useProjectsSessions.js'
import { CREATED_GRACE_MS, createSessionsPoll } from './sessionsPoll.js'

const NO_PTY_SESSIONS = Object.freeze({})

export function chatPath(sessionKey) {
  return `/projects/chat/${encodeURIComponent(sessionKey)}`
}

// The chats as the Projects screen reads sessions (the V2 shape), chat keys only. A chat with an
// approval pending is "needs attention" even before the server marks it: `persisted` is where the
// board reads that from. `awaiting_permission` is `idle` + needs_attention, like a PTY waiting.
// No chat at all: the shared empty constant (same reference).
export function buildProjectsLive(chats, liveByKey) {
  if (!Array.isArray(chats) || chats.length === 0) return EMPTY_PROJECTS_LIVE
  const active = {}
  const persisted = {}
  for (const chat of chats) {
    const key = chat?.session_key
    if (!key) continue
    const awaiting = chat.live_status === 'awaiting_permission'
    const needsAttention = Boolean(chat.needs_attention) || awaiting || (chat.pending_permissions ?? 0) > 0
    persisted[key] = {
      display_name: chat.display_name ?? null,
      needs_attention: needsAttention,
      push_notified: Boolean(chat.push_notified),
    }
    if (chat.live_status) {
      active[key] = {
        status: chat.live_status === 'running' ? 'running' : 'idle',
        connected: Boolean(liveByKey?.[key]?.connected),
        needs_attention: needsAttention,
        display_name: chat.display_name ?? null,
      }
    }
  }
  return { active, persisted }
}

// Shared view of the sessions for the whole v3 shell: the chat list, the live state of every
// session, the terminal sessions (`ptyPersisted`) and the health of the chat engine. It polls every
// 7 s, also while the tab is hidden (as the V2: the sound and the browser notification depend on it),
// and never opens a WebSocket (the socket of the open conversation belongs to the chat screen, so
// switching modules and coming back keeps the same socket). Its only writes are the browser
// notification/sound and the re-registration of this device's push subscription (as the V2).
//
// Every failure is swallowed into `liveAvailable = false`: the shell must keep working when the
// chat backend is missing or old. The last known values stay on screen while a tick fails.
//
// It also owns the sound and the browser notification for the sessions that start needing the user
// (the same rules as the V2 poll, utils/chatNotifications.js; chats AND terminal sessions): one per
// TRANSITION, never per poll.
//
// `navigate` comes from the shell (useRoute's pushState does not notify other instances).
// `notifier` is injectable for tests only (a stub in place of Notification/AudioContext).
export default function ProjectsSessionsProvider({ navigate, notifier = null, children }) {
  const [chats, setChats] = useState([])
  const [liveByKey, setLiveByKey] = useState({})
  const [health, setHealth] = useState(null)
  const [liveAvailable, setLiveAvailable] = useState(false)
  // Sessions of the terminal (GET /api/sessions/persisted, V2 shape). The last good answer stays while a
  // tick fails; `null` until the first one, and the notification channel waits for it (no baseline
  // without it, or a key pending all along would read as a transition later).
  const [ptyPersisted, setPtyPersisted] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [focusedKey, setFocusedKey] = useState(null)
  const [graceKeys, setGraceKeys] = useState([])
  const mountedRef = useRef(true)
  const pollRef = useRef(null)
  const graceTimersRef = useRef(new Map())

  // Everything the notification decision reads lives in refs: it runs inside an effect of the poll
  // result and must not restart anything when one of them changes.
  const notifierRef = useRef(null)
  if (notifierRef.current === null) notifierRef.current = notifier || createBrowserNotifier()
  const notificationSettingsRef = useRef(null) // null = not loaded: no quiet-hours window (fail-open)
  const hasPushSubscriptionRef = useRef(false) // fail-open: false keeps the sound playing
  const notifiedKeysRef = useRef(null) // null = no baseline yet: the first tick only records
  const focusedKeyRef = useRef(null)
  focusedKeyRef.current = focusedKey

  // Audio and notification permission both need a user gesture.
  useEffect(() => installUnlockOnFirstGesture(notifierRef.current), [])

  useEffect(() => {
    let cancelled = false
    api.fetchNotificationSettings()
      .then((data) => { if (!cancelled) notificationSettingsRef.current = data })
      .catch(() => { /* no window: a network failure never mutes the sound */ })
    const onSettings = (event) => {
      if (event.detail) notificationSettingsRef.current = event.detail
    }
    window.addEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, onSettings)
    return () => {
      cancelled = true
      window.removeEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, onSettings)
    }
  }, [])

  // Whether THIS device receives Web Push (the ledger only suppresses the sound on such a device).
  useEffect(() => {
    let cancelled = false
    reconcilePushSubscription({ registerSubscription: api.registerPushSubscription })
      .then((active) => { if (!cancelled) hasPushSubscriptionRef.current = active })
      .catch(() => { /* stays false: the sound keeps playing */ })
    const onPush = (event) => {
      hasPushSubscriptionRef.current = Boolean(event.detail?.active)
    }
    window.addEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, onPush)
    return () => {
      cancelled = true
      window.removeEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, onPush)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const graceTimers = graceTimersRef.current
    const poll = createSessionsPoll({
      run: async ({ withHealth }) => {
        const [live, list, terminal, healthResult] = await Promise.allSettled([
          chatApi.listLiveSessions(),
          chatApi.listSessions(),
          api.fetchPersistedSessions(),
          withHealth ? chatApi.health() : Promise.resolve(undefined),
        ])
        if (!mountedRef.current) return
        if (live.status === 'fulfilled') setLiveByKey(live.value ?? {})
        if (list.status === 'fulfilled') setChats(Array.isArray(list.value) ? list.value : [])
        if (terminal.status === 'fulfilled' && terminal.value && typeof terminal.value === 'object') {
          setPtyPersisted(terminal.value)
        }
        if (healthResult.status === 'fulfilled' && healthResult.value !== undefined) {
          setHealth(healthResult.value)
        }
        setLiveAvailable(live.status === 'fulfilled' && list.status === 'fulfilled')
        setLoaded(true)
      },
    })
    pollRef.current = poll
    poll.start()
    return () => {
      mountedRef.current = false
      poll.stop()
      pollRef.current = null
      for (const timer of graceTimers.values()) clearTimeout(timer)
      graceTimers.clear()
    }
  }, [])

  const refresh = useCallback(() => {
    pollRef.current?.trigger()
  }, [])

  const openChat = useCallback(
    (sessionKey) => {
      if (!sessionKey) return
      setFocusedKey(sessionKey)
      navigate(chatPath(sessionKey))
    },
    [navigate],
  )

  // A chat just created by this client may not be in the next poll yet: it counts as "in grace"
  // for 15 s, so the screen shows "starting" instead of "not found".
  const registerCreated = useCallback((sessionKey) => {
    if (!sessionKey || !mountedRef.current) return
    const timers = graceTimersRef.current
    clearTimeout(timers.get(sessionKey))
    setGraceKeys((keys) => (keys.includes(sessionKey) ? keys : [...keys, sessionKey]))
    timers.set(
      sessionKey,
      setTimeout(() => {
        timers.delete(sessionKey)
        if (mountedRef.current) setGraceKeys((keys) => keys.filter((key) => key !== sessionKey))
      }, CREATED_GRACE_MS),
    )
    pollRef.current?.trigger()
  }, [])

  const projectsLive = useMemo(() => buildProjectsLive(chats, liveByKey), [chats, liveByKey])

  // What the notification channel watches: chats + terminal sessions.
  const attentionRows = useMemo(
    () => (ptyPersisted === null ? null : mergeAttentionRows(projectsLive.persisted, ptyPersisted)),
    [projectsLive, ptyPersisted],
  )

  // The conversation was acked (over its socket, or by REST in the terminal view): drop the mark now
  // instead of waiting for the poll.
  const clearAttention = useCallback((sessionKey) => {
    if (!sessionKey) return
    setChats((current) =>
      current.some((chat) => chat?.session_key === sessionKey && chat.needs_attention)
        ? current.map((chat) => (chat?.session_key === sessionKey ? { ...chat, needs_attention: false } : chat))
        : current,
    )
    setPtyPersisted((current) =>
      current?.[sessionKey]?.needs_attention ? { ...current, [sessionKey]: { ...current[sessionKey], needs_attention: false } } : current,
    )
  }, [])

  // Channel A: runs only while the poll works (`liveAvailable` and the terminal sessions known; a
  // failed tick keeps the last rows and must not reset the baseline). A conversation the user is
  // looking at (open, tab visible) never notifies itself; a hidden tab counts as "not looking", but
  // the mark the open conversation already carried stays recorded (`heldKey`): hiding the tab or
  // leaving the conversation never notifies a mark the user had in front of them.
  useEffect(() => {
    if (!liveAvailable || attentionRows === null) return
    const lookingAt = document.visibilityState === 'hidden' ? null : focusedKeyRef.current
    const { playSound, notifications, nextNotifiedKeys } = planChatNotifications({
      persisted: attentionRows,
      notifiedKeys: notifiedKeysRef.current,
      focusedKey: lookingAt,
      heldKey: focusedKeyRef.current,
      settings: notificationSettingsRef.current,
      hasPushSubscription: hasPushSubscriptionRef.current,
    })
    notifiedKeysRef.current = nextNotifiedKeys
    if (playSound) notifierRef.current.playSound()
    for (const content of notifications) notifierRef.current.notify(content)
  }, [liveAvailable, attentionRows])

  const value = useMemo(
    () => ({
      chats,
      liveByKey,
      projectsLive,
      ptyPersisted: ptyPersisted ?? NO_PTY_SESSIONS,
      health,
      liveAvailable,
      loaded,
      graceKeys,
      focusedKey,
      setFocusedKey,
      openChat,
      goTo: navigate,
      registerCreated,
      refresh,
      clearAttention,
    }),
    [chats, liveByKey, projectsLive, ptyPersisted, health, liveAvailable, loaded, graceKeys, focusedKey, openChat, navigate, registerCreated, refresh, clearAttention],
  )

  return <ProjectsSessionsContext.Provider value={value}>{children}</ProjectsSessionsContext.Provider>
}
