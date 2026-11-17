import { useEffect, useId, useRef, useState } from 'react'

// "⋯" button with a role="menu" popup (chat header and list rows). Arrows move, Home/End jump,
// Enter/Space activate (native buttons), Esc closes and gives the focus back to the button, a press
// outside or Tab closes. Esc stops propagating so it never reaches the chat's "Esc interrupts".
//   items: [{ id, label, tone: 'danger'?, separatorBefore?: boolean, onSelect() }]
export default function ActionMenu({ label, items, className = '' }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const onPress = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPress)
    return () => document.removeEventListener('mousedown', onPress)
  }, [open])

  const close = (restoreFocus) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const onMenuKeyDown = (event) => {
    const entries = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const index = entries.indexOf(document.activeElement)
    let target = null
    if (event.key === 'ArrowDown') target = entries[(index + 1) % entries.length]
    else if (event.key === 'ArrowUp') target = entries[(index - 1 + entries.length) % entries.length]
    else if (event.key === 'Home') target = entries[0]
    else if (event.key === 'End') target = entries[entries.length - 1]
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false)
      return
    }
    if (target) {
      event.preventDefault()
      target.focus()
    }
  }

  return (
    <div ref={wrapperRef} className={`v3-chat-menu ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className="v3-chat-menu__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="4.5" cy="10" r="1.5" fill="currentColor" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} role="menu" aria-label={label} className="v3-chat-menu__popup" onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <div key={item.id} role="none" className="v3-chat-menu__entry">
              {item.separatorBefore ? <hr className="v3-chat-menu__separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`v3-chat-menu__item${item.tone === 'danger' ? ' v3-chat-menu__item--danger' : ''}`}
                onClick={() => {
                  close(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
