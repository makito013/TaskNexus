import { useEffect, useRef, useState } from 'react'

// A box that scrolls hides what lies below its edge, and on a phone the scrollbar only shows while the
// finger moves: nothing tells the reader there is more. This reports whether any of the scrollers still
// has content below the visible part, so the surface can say so (the approval sheet must never cut a
// command without warning, Designer 5.1).
//   getScrollers()  the scrolling elements to watch (read inside the effect, after the dialog is shown:
//                   a closed <dialog> has no layout, so the first measure would read zeros)
//   mountKey        changes when the watched elements are replaced (a tab switch), to attach again
// Evaluated on mount, on scroll, on window resize and, where the browser has it, when a watched box
// changes size (the dialog being shown, the soft keyboard, a rotation).
const SLACK_PX = 1

export const continuesBelow = (element) => element.scrollHeight - element.scrollTop - element.clientHeight > SLACK_PX

export function useContinuesBelow(getScrollers, mountKey) {
  const [more, setMore] = useState(false)
  const getScrollersRef = useRef(getScrollers)
  getScrollersRef.current = getScrollers

  useEffect(() => {
    const scrollers = getScrollersRef.current().filter(Boolean)
    const measure = () => setMore(scrollers.some(continuesBelow))
    measure()
    for (const element of scrollers) element.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const element of scrollers) observer?.observe(element)
    return () => {
      for (const element of scrollers) element.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [mountKey])

  return more
}
