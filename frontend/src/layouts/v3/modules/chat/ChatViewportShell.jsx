import { useEffect, useLayoutEffect, useState } from 'react'
import { useVisibleViewportShell } from '../../../../hooks/useVisibleViewportShell.js'
import { KEYBOARD_VISIBLE_RATIO } from './viewport.js'

const ROOT_ID = 'root'
const REST_PROPERTIES = ['left', 'top', 'width', 'height']
const FIXED_PROPERTY = 'position'

// Mounted by AppV3 ONLY on the chat route and only while the shell is narrow (<= 1279). It carries
// the one thing the guarded chain cannot do with CSS alone: on an iPad/phone the soft keyboard pans the
// layout viewport, and the only fix is to anchor the shell root to the visual viewport. That is what
// useVisibleViewportShell does, and it needs a `position: fixed` root (decision L7). It is applied HERE,
// as an inline style of #root for exactly as long as this component is mounted (chat route, <= 1279):
// no stylesheet declares it, so no other route or width can ever inherit it, and shellQa.test.jsx
// ("the shell stylesheets never use position: fixed") keeps holding for the CSS.
//
// It also publishes what the stylesheets need and cannot read:
//   data-v3-keyboard="open"   on #root while the visible height is below 75% of the layout height
//                             (Island.css hides the pill so the conversation gets the space back)
//   --v3-visible-height       on #root: the visible height in px (the "/" menu caps itself at 40% of it)
// Everything it writes is removed on unmount (leaving the chat route), so the other routes never see it.
export default function ChatViewportShell() {
  // Resolved once, outside React: #root is the element AppV3 is mounted in. A page without it (a test
  // that renders the app into a bare container) simply gets no behaviour.
  const [shellRef] = useState(() => ({
    current: typeof document === 'undefined' ? null : document.getElementById(ROOT_ID),
  }))

  // Before any passive effect: the rest rectangle must be there when the hook below applies the shrunk
  // one (a keyboard already open at mount), never the other way round.
  useLayoutEffect(() => {
    const root = shellRef.current
    if (!root) return
    root.style.setProperty(FIXED_PROPERTY, 'fixed')
    root.style.setProperty('left', '0px')
    root.style.setProperty('top', '0px')
    root.style.setProperty('width', '100%')
    root.style.setProperty('height', '100%')
  }, [shellRef])

  useVisibleViewportShell(shellRef)

  useEffect(() => {
    const root = shellRef.current
    if (!root) return undefined
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null

    const publish = () => {
      const visible = viewport ? viewport.height : window.innerHeight
      const keyboardOpen = Boolean(viewport) && visible < window.innerHeight * KEYBOARD_VISIBLE_RATIO
      if (keyboardOpen) root.dataset.v3Keyboard = 'open'
      else delete root.dataset.v3Keyboard
      root.style.setProperty('--v3-visible-height', `${visible}px`)
    }

    publish()
    viewport?.addEventListener('resize', publish)
    viewport?.addEventListener('scroll', publish)
    window.addEventListener('resize', publish)
    return () => {
      viewport?.removeEventListener('resize', publish)
      viewport?.removeEventListener('scroll', publish)
      window.removeEventListener('resize', publish)
      delete root.dataset.v3Keyboard
      root.style.removeProperty('--v3-visible-height')
      // useVisibleViewportShell hands the node back at its rest rectangle; outside the chat route
      // the root must not keep a trace of the fixed shell.
      for (const property of REST_PROPERTIES) root.style.removeProperty(property)
      root.style.removeProperty(FIXED_PROPERTY)
    }
  }, [shellRef])

  return null
}
