import { useCallback, useEffect, useState } from 'react'
import { chatApi } from '../../../../services/chatApi.js'
import { selectableCommands } from './slashCommands.js'

// The commands of ONE conversation for the "/" menu (GET /api/chat/sessions/{key}/commands, a read).
// Lazy: nothing is requested until the composer asks for the menu (`request()`), then the list is read
// once and read again whenever the server says it changed (`commands.changed` bumps `version`). While a
// list is being refreshed the old one stays on screen. A failure is a state, never an exception; the
// next `commands.changed` or the next conversation reads it again.
//   -> { status: 'idle' | 'loading' | 'ready' | 'error', items, request() }
export function useChatCommands(sessionKey, version) {
  const [wanted, setWanted] = useState(false)
  const [result, setResult] = useState({ status: 'idle', items: [] })

  useEffect(() => {
    if (!wanted || !sessionKey) return undefined
    let cancelled = false
    setResult((previous) => (previous.status === 'ready' ? previous : { status: 'loading', items: [] }))
    chatApi.fetchSessionCommands(sessionKey).then(
      (list) => {
        if (!cancelled) setResult({ status: 'ready', items: selectableCommands(list) })
      },
      () => {
        if (!cancelled) setResult((previous) => (previous.status === 'ready' ? previous : { status: 'error', items: [] }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [wanted, sessionKey, version])

  const request = useCallback(() => setWanted(true), [])
  return { status: result.status, items: result.items, request }
}
