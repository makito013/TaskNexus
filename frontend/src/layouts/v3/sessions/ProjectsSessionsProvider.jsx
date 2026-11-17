import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chatApi } from '../../../services/chatApi.js'
import { EMPTY_PROJECTS_LIVE, ProjectsSessionsContext } from './useProjectsSessions.js'
import { CREATED_GRACE_MS, createSessionsPoll } from './sessionsPoll.js'

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

// Shared, read-only view of the sessions for the whole v3 shell: the chat list, the live state
// of every session and the health of the chat engine. It polls (7 s, paused while the tab is
// hidden), never writes and never opens a WebSocket (the socket of the open conversation
// belongs to the chat screen, so switching modules and coming back keeps the same socket).
//
// Every failure is swallowed into `liveAvailable = false`: the shell must keep working when the
// chat backend is missing or old. The last known values stay on screen while a tick fails.
//
// `navigate` comes from the shell (useRoute's pushState does not notify other instances).
export default function ProjectsSessionsProvider({ navigate, children }) {
  const [chats, setChats] = useState([])
  const [liveByKey, setLiveByKey] = useState({})
  const [health, setHealth] = useState(null)
  const [liveAvailable, setLiveAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [focusedKey, setFocusedKey] = useState(null)
  const [graceKeys, setGraceKeys] = useState([])
  const mountedRef = useRef(true)
  const pollRef = useRef(null)
  const graceTimersRef = useRef(new Map())

  useEffect(() => {
    mountedRef.current = true
    const graceTimers = graceTimersRef.current
    const poll = createSessionsPoll({
      run: async ({ withHealth }) => {
        const [live, list, healthResult] = await Promise.allSettled([
          chatApi.listLiveSessions(),
          chatApi.listSessions(),
          withHealth ? chatApi.health() : Promise.resolve(undefined),
        ])
        if (!mountedRef.current) return
        if (live.status === 'fulfilled') setLiveByKey(live.value ?? {})
        if (list.status === 'fulfilled') setChats(Array.isArray(list.value) ? list.value : [])
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

  const value = useMemo(
    () => ({
      chats,
      liveByKey,
      projectsLive,
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
    }),
    [chats, liveByKey, projectsLive, health, liveAvailable, loaded, graceKeys, focusedKey, openChat, navigate, registerCreated, refresh],
  )

  return <ProjectsSessionsContext.Provider value={value}>{children}</ProjectsSessionsContext.Provider>
}
