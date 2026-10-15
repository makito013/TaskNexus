import { useEffect, useState } from 'react'

// How long the pet "talks" after a new phrase (4 cycles of the 0.6s smile).
export const TALK_DURATION_MS = 2400

// "talking" is a transient pet state: it holds for TALK_DURATION_MS after the
// phrase changes and then settles back to idle. Every other state is returned
// untouched.
export function useTalkingPulse(state, message) {
  const [settledMessage, setSettledMessage] = useState(null)

  useEffect(() => {
    if (state !== 'talking') {
      setSettledMessage(null)
      return undefined
    }
    const timer = setTimeout(() => setSettledMessage(message), TALK_DURATION_MS)
    return () => clearTimeout(timer)
  }, [state, message])

  return state === 'talking' && settledMessage === message ? 'idle' : state
}
