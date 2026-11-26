import { useEffect, useId, useRef, useState } from 'react'
import { COLUMN_DELETE_BLOCKED_TEXT } from './columnErrors.js'

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]'

// A press on the menu is the menu's, not the drag of the column header it sits in.
const stopPress = (event) => event.stopPropagation()

// The "⋯" menu of a column header: rename, mark as done (a radio: exactly one column is done) and
// delete. Its own component because the chat's ActionMenu has neither radio items nor unavailable
// items that stay reachable. The popup is `position: absolute` (a column can be inside a moving
// ancestor, so nothing fixed lives in here).
//
// Unavailable items keep the focus and say why: the done column cannot be deleted (and is the one
// "marked" already), nor can the last column.
//   column        { slug, label, is_done }
//   isLastColumn  the board has only this column
export default function ColumnMenu({ column, isLastColumn, onRename, onMarkDone, onDelete }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()
  const reasonId = useId()
  const label = `Mais ações da coluna ${column.label}`
  const blockedReason = column.is_done
    ? COLUMN_DELETE_BLOCKED_TEXT.done
    : (isLastColumn ? COLUMN_DELETE_BLOCKED_TEXT.last : null)

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector(ITEM_SELECTOR)?.focus()
    // Capture phase: another control may stop the press from bubbling up to the document.
    const onPress = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('touchstart', onPress, true)
    return () => {
      document.removeEventListener('mousedown', onPress, true)
      document.removeEventListener('touchstart', onPress, true)
    }
  }, [open])

  const close = (restoreFocus) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  // The menu closes with the focus back on its button; a dialog that the item opens takes it from there.
  const choose = (action) => () => {
    close(true)
    action()
  }

  const onMenuKeyDown = (event) => {
    const entries = [...menuRef.current.querySelectorAll(ITEM_SELECTOR)]
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
    <div ref={wrapperRef} className="v3-board-menu" onMouseDown={stopPress} onTouchStart={stopPress}>
      <button
        ref={buttonRef}
        type="button"
        className="v3-board-menu__button"
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
      {open && (
        <>
          <div id={menuId} ref={menuRef} role="menu" aria-label={label} className="v3-board-menu__popup" onKeyDown={onMenuKeyDown}>
            <button type="button" role="menuitem" className="v3-board-menu__item" onClick={choose(onRename)}>
              Renomear coluna
            </button>
            {column.is_done ? (
              <button type="button" role="menuitemradio" aria-checked="true" aria-disabled="true" className="v3-board-menu__item">
                Esta é a coluna de concluídos
              </button>
            ) : (
              <button type="button" role="menuitemradio" aria-checked="false" className="v3-board-menu__item" onClick={choose(() => onMarkDone(column.slug))}>
                Marcar como concluída
              </button>
            )}
            <hr className="v3-board-menu__separator" />
            <button
              type="button"
              role="menuitem"
              className="v3-board-menu__item v3-board-menu__item--danger"
              aria-disabled={blockedReason ? 'true' : undefined}
              aria-describedby={blockedReason ? reasonId : undefined}
              onClick={blockedReason ? undefined : choose(onDelete)}
            >
              Excluir coluna
            </button>
          </div>
          {blockedReason && <span id={reasonId} className="v3-projects__sr-only">{blockedReason}</span>}
        </>
      )}
    </div>
  )
}
