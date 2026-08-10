// frontend/src/components/RenameableLabel.jsx
// Shared rename affordance for chat labels (04-UI-SPEC.md section 2, D-08) —
// used identically by Sidebar.jsx's "Chats Abertos" row and SessionTabs.jsx's
// tab label. Two independent triggers, both work on touch AND mouse:
//   - Long-press (500ms, cancels on move)
//   - Double-tap/double-click (manual detection via pointerup timestamps —
//     native `dblclick` doesn't reliably synthesize from touch taps, so this
//     single mechanism covers both instead of two divergent code paths)

import { useRef, useState } from 'react'

const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 10
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_MOVE_PX = 20

export function RenameableLabel({ value, onRename, className, style, ariaLabel }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const pressTimer = useRef(null)
  const startPos = useRef(null)
  const lastTap = useRef(null) // { time, x, y }

  const clearTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const beginEdit = () => {
    setDraft(value)
    setEditing(true)
  }

  const onPointerDown = (e) => {
    startPos.current = { x: e.clientX, y: e.clientY }
    clearTimer()
    pressTimer.current = setTimeout(beginEdit, LONG_PRESS_MS)
  }

  const onPointerMove = (e) => {
    if (!pressTimer.current || !startPos.current) return
    const dx = e.clientX - startPos.current.x
    const dy = e.clientY - startPos.current.y
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) clearTimer()
  }

  // Manual double-tap/double-click: native `dblclick` doesn't reliably
  // synthesize from touch taps on iOS, so both mouse and touch go through
  // this single timestamp+distance check instead of two divergent paths. If
  // the long-press timer already fired (beginEdit ran, editing=true), this
  // span isn't mounted anymore, so this handler simply won't run — no
  // double-trigger to guard against.
  const onPointerUp = (e) => {
    clearTimer()
    const now = Date.now()
    const last = lastTap.current
    if (last && now - last.time < DOUBLE_TAP_MS) {
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      if (Math.sqrt(dx * dx + dy * dy) < DOUBLE_TAP_MOVE_PX) {
        lastTap.current = null
        beginEdit()
        return
      }
    }
    lastTap.current = { time: now, x: e.clientX, y: e.clientY }
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    // D-09: nome vazio/só espaços reverte silenciosamente, sem chamar a API.
    if (trimmed && trimmed !== value) onRename(trimmed)
  }

  const cancel = () => setEditing(false)

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        style={{
          ...style,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          padding: '0 2px',
        }}
      />
    )
  }

  return (
    <span
      className={className}
      style={{
        ...style,
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        touchAction: 'manipulation',
      }}
      title={value}
      aria-label={ariaLabel}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={clearTimer}
      onDoubleClick={(e) => { e.stopPropagation(); clearTimer(); beginEdit() }}
    >
      {value}
    </span>
  )
}
