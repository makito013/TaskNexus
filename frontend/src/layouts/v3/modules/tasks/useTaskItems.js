import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGlobalTasks } from '../../../../hooks/useGlobalTasks.js'
import { useProjects } from '../../../../hooks/useProjects.js'
import { api } from '../../../../services/api.js'
import { toTaskItems } from './taskItems.js'

const EMPTY_BOARD = { cards: [], columns: [], loading: true, cardsError: null, columnsError: null }

// Composes the existing read APIs into TaskItem[] - no new backend.
//   validation tasks: useGlobalTasks (polls every 5 s, actionable)
//   cards + columns:  one fetch each on mount and on refetch(), no polling
//                     (cards only change through the board or MCP; "Tentar de
//                     novo"/F5 covers it)
// Each source reports its own error so the screen can say what is missing:
//   errors.tasks && errors.cards -> total failure
//   errors.columns only          -> doneSlug stays null, no card is "overdue"
// `now` is for tests; the screen uses the real clock.
export function useTaskItems({ now } = {}) {
  // { id, error }: the failure belongs to the item whose complete/reopen failed,
  // so the notice never shows up on another task.
  const [mutationError, setMutationError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const mutatingIdRef = useRef(null)
  const handleMutationError = useCallback((error) => {
    setMutationError({ id: mutatingIdRef.current, error })
  }, [])
  const globalTasks = useGlobalTasks({ onError: handleMutationError })
  const [projects, refreshProjects] = useProjects()
  const [board, setBoard] = useState(EMPTY_BOARD)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadBoard = useCallback(async () => {
    const [cardsResult, columnsResult] = await Promise.allSettled([
      api.fetchCards(),
      api.fetchBoardColumns(),
    ])
    if (!mountedRef.current) return
    setBoard({
      cards: cardsResult.status === 'fulfilled' ? cardsResult.value : [],
      columns: columnsResult.status === 'fulfilled' ? columnsResult.value : [],
      loading: false,
      cardsError: cardsResult.status === 'rejected' ? cardsResult.reason : null,
      columnsError: columnsResult.status === 'rejected' ? columnsResult.reason : null,
    })
  }, [])

  useEffect(() => { loadBoard() }, [loadBoard])

  const doneSlug = useMemo(
    () => board.columns.find((column) => column.is_done)?.slug ?? null,
    [board.columns],
  )

  const { tasks } = globalTasks
  // Recomputed whenever the data changes (every poll), which also keeps "today"
  // from going stale across midnight while the screen stays open.
  const today = useMemo(() => (now ? new Date(now) : new Date()), [now, tasks, board])

  const items = useMemo(
    () => toTaskItems({ tasks, cards: board.cards, doneSlug, projects, today }),
    [tasks, board.cards, doneSlug, projects, today],
  )

  const refetch = useCallback(
    () => Promise.all([globalTasks.refetch(), loadBoard(), refreshProjects()]).then(() => undefined),
    [globalTasks.refetch, loadBoard, refreshProjects],
  )

  const mutate = useCallback(
    async (item, action) => {
      if (item.source !== 'validation') return false
      setMutationError(null)
      mutatingIdRef.current = item.id
      setSavingId(item.id)
      try {
        return await action(item.sessionKey, item.taskId)
      } finally {
        mutatingIdRef.current = null
        if (mountedRef.current) setSavingId(null)
      }
    },
    [],
  )

  const clearMutationError = useCallback(() => setMutationError(null), [])

  const completeTask = useCallback((item) => mutate(item, globalTasks.completeTask), [mutate, globalTasks.completeTask])
  const reopenTask = useCallback((item) => mutate(item, globalTasks.reopenTask), [mutate, globalTasks.reopenTask])

  return {
    items,
    today,
    loading: globalTasks.loading || board.loading,
    doneSlug,
    errors: {
      tasks: globalTasks.error,
      cards: board.cardsError,
      columns: board.columnsError,
    },
    refetch,
    completeTask,
    reopenTask,
    savingId,
    mutationError,
    clearMutationError,
  }
}
