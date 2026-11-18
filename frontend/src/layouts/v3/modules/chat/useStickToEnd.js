import { useEffect } from 'react'

// The thread follows the end of the conversation by itself when messages arrive (MessageList). It does
// not when the thread merely gets SHORTER: the soft keyboard of a phone or iPad opens, the shell shrinks
// to the visible viewport, and the last message would stay below the new bottom edge. This keeps the end
// in view across such a resize, but only for a reader who was at the end (within 80px): someone reading
// older messages is never dragged down.
//   threadRef   ref of the scrolling thread (it only exists once the conversation is shown)
//   mountKey    changes when the thread element is (re)created, so the observer is attached again
const NEAR_END_PX = 80

export function useStickToEnd(threadRef, mountKey) {
  useEffect(() => {
    const element = threadRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    let nearEnd = true
    const measure = () => {
      nearEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_END_PX
    }
    const follow = () => {
      if (nearEnd) element.scrollTop = element.scrollHeight
    }

    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(follow)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [threadRef, mountKey])
}
