import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../../services/api.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { buildAgentBoard, listSessions } from './agentBoard.js'
import { buildBoardSummary } from './boardSummary.js'
import { buildRegistryIndex } from './registryIndex.js'

// Same cadence as the V2 poll (TerminalContext), so an ack done there shows up
// here within one tick.
export const POLL_INTERVAL_MS = 7000

const EMPTY_STATIC = {
  response: null,
  agents: [],
  cards: [],
  columns: [],
  errors: { workspaces: null, agents: null, cards: null, columns: null },
  loaded: false,
}
const EMPTY_LIVE = { active: null, persisted: null, activeError: null, persistedError: null, loaded: false }

// Composes the read APIs of the screen. READ-ONLY by construction: nothing here
// acks, renames, resets, notifies or touches the document title (the V2 poll
// does all of that; see readOnlyGuard.test.js).
//   mount / refetch():  registry (archived included - the toggle filters on the
//                       client), agents, cards, board columns
//   every 7 s:          /sessions/active + /sessions/persisted, paused while the
//                       tab is hidden, immediate tick when it becomes visible
// Each live source keeps its last known value when a tick fails; `active ===
// null` (never loaded) is "live state unavailable", never "nothing is running".
export function useProjectsOverview({ workspaceKey = '' } = {}) {
  const [stat, setStat] = useState(EMPTY_STATIC)
  const [live, setLive] = useState(EMPTY_LIVE)
  const mountedRef = useRef(true)
  const liveInFlightRef = useRef(false)

  const loadStatic = useCallback(async () => {
    const [workspaces, agents, cards, columns] = await Promise.allSettled([
      workspacesApi.fetchWorkspaces({ includeArchived: true }),
      api.fetchAgents(),
      api.fetchCards(),
      api.fetchBoardColumns(),
    ])
    if (!mountedRef.current) return
    const value = (result, previous) => (result.status === 'fulfilled' ? result.value : previous)
    const error = (result) => (result.status === 'rejected' ? result.reason : null)
    setStat((previous) => ({
      response: value(workspaces, previous.response),
      agents: value(agents, previous.agents),
      cards: value(cards, previous.cards),
      columns: value(columns, previous.columns),
      errors: {
        workspaces: error(workspaces),
        agents: error(agents),
        cards: error(cards),
        columns: error(columns),
      },
      loaded: true,
    }))
  }, [])

  // One tick never overlaps the previous one (a slow tick is skipped, not queued).
  const loadLive = useCallback(async () => {
    if (liveInFlightRef.current) return
    liveInFlightRef.current = true
    try {
      const [active, persisted] = await Promise.allSettled([
        api.fetchActiveSessions(),
        api.fetchPersistedSessions(),
      ])
      if (!mountedRef.current) return
      setLive((previous) => ({
        active: active.status === 'fulfilled' ? active.value : previous.active,
        persisted: persisted.status === 'fulfilled' ? persisted.value : previous.persisted,
        activeError: active.status === 'rejected' ? active.reason : null,
        persistedError: persisted.status === 'rejected' ? persisted.reason : null,
        loaded: true,
      }))
    } finally {
      liveInFlightRef.current = false
    }
  }, [])

  const refetch = useCallback(() => {
    // Retrying a failed first load shows the loading state again.
    setStat((previous) => (previous.response ? previous : { ...previous, loaded: false }))
    return Promise.all([loadStatic(), loadLive()]).then(() => undefined)
  }, [loadStatic, loadLive])

  useEffect(() => {
    mountedRef.current = true
    refetch()

    const tick = () => {
      if (document.visibilityState === 'hidden') return
      loadLive()
    }
    const intervalId = setInterval(tick, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      mountedRef.current = false
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refetch, loadLive])

  const registry = useMemo(
    () => (stat.response ? buildRegistryIndex(stat.response) : null),
    [stat.response],
  )
  const board = useMemo(
    () => (registry
      ? buildAgentBoard({ registry, agents: stat.agents, active: live.active, persisted: live.persisted })
      : null),
    [registry, stat.agents, live.active, live.persisted],
  )
  const sessions = useMemo(
    () => (registry
      ? listSessions({ registry, agents: stat.agents, active: live.active, persisted: live.persisted })
      : []),
    [registry, stat.agents, live.active, live.persisted],
  )
  const boardSummary = useMemo(
    () => (registry && !stat.errors.cards
      ? buildBoardSummary({ cards: stat.cards, columns: stat.columns, registry, workspaceKey })
      : null),
    [registry, stat.cards, stat.columns, stat.errors.cards, workspaceKey],
  )

  return {
    registry,
    board,
    sessions,
    boardSummary,
    loading: !stat.loaded || !live.loaded,
    errors: {
      ...stat.errors,
      active: live.activeError,
      persisted: live.persistedError,
    },
    liveAvailable: live.active != null,
    refetch,
  }
}
