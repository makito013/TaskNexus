import { useCallback, useEffect, useRef } from 'react'

export const LONG_PRESS_MS = 500
// More movement than this means the finger is scrolling the list, not holding.
export const MOVE_TOLERANCE_PX = 10
// The click a browser sends after the press ends comes at once; a flag older than this is not about it.
const RESIDUAL_CLICK_MS = 1000

// A long press with Pointer Events (finger, Pencil, mouse). `onLongPress(target, { x, y })` fires once the
// press has been held for 500 ms inside the tolerance. After it fires, the click the browser sends on
// release is swallowed ONCE: `consumeClick()` says so (the card would open the file under the menu).
export default function useLongPress(onLongPress) {
  const timer = useRef(null)
  const resetTimer = useRef(null)
  const start = useRef(null)
  const fired = useRef(false)
  const callback = useRef(onLongPress)
  callback.current = onLongPress

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => () => {
    clearTimeout(timer.current)
    clearTimeout(resetTimer.current)
  }, [])

  const handlers = {
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      fired.current = false
      clearTimeout(resetTimer.current)
      start.current = { x: event.clientX, y: event.clientY }
      const target = event.currentTarget
      const point = { x: event.clientX, y: event.clientY }
      cancel()
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => { fired.current = false }, RESIDUAL_CLICK_MS)
        callback.current?.(target, point)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      if (!timer.current || !start.current) return
      const dx = Math.abs(event.clientX - start.current.x)
      const dy = Math.abs(event.clientY - start.current.y)
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  }

  const consumeClick = useCallback(() => {
    if (!fired.current) return false
    fired.current = false
    return true
  }, [])

  return { handlers, consumeClick }
}
