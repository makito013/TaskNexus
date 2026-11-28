import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileUrl } from '../../../../services/viewerApi.js'
import { basenameOf } from '../../../../utils/viewerPaths.js'
import './ArtifactMenu.css'

export const CONFIRM_SECONDS = 3
const MENU_WIDTH = 240
const MARGIN = 8

// Where the menu goes: under the anchor and aligned to its right edge; above it when it does not fit
// below; always inside the window.
export function placeMenu(rect, menuHeight, viewport) {
  const width = Math.min(MENU_WIDTH, viewport.width - MARGIN * 2)
  const left = Math.max(MARGIN, Math.min(rect.right - width, viewport.width - width - MARGIN))
  let top = rect.bottom + 6
  if (top + menuHeight > viewport.height - MARGIN) top = Math.max(MARGIN, rect.top - menuHeight - 6)
  return { left, top, width }
}

// The menu of one artifact card, in a portal on <body> (one of the three named `position: fixed` leaves of
// the V3: no ancestor of it creates a containing block). Items: Abrir, Baixar (absent when the file is
// gone), Copiar caminho, Citar no chat (absent when the file is gone; focusable and explained when it
// cannot act), Renomear…, and "Remover da lista", which asks for a second tap within 3 s.
//   artifact       the row
//   viaLongPress   opened by a long press: the click the browser sends when the finger lifts lands on the scrim
//                  (it did not start there), so the scrim ignores a click that no press of its own began
//   anchorRect     { top, bottom, left, right } taken when it opened (the list may scroll after)
//   cite           { enabled, reason }
//   onClose(restoreFocus)   restoreFocus is true when the focus should go back to where the menu came from
//   onOpen / onCopyPath / onCite / onRename / onRemove (artifact)
export default function ArtifactMenu({ artifact, anchorRect, viaLongPress = false, cite, onClose, onOpen, onCopyPath, onCite, onRename, onRemove }) {
  const menuRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const scrimPressed = useRef(false)
  const reasonId = useId()
  const [position, setPosition] = useState(() => placeMenu(anchorRect, 0, { width: window.innerWidth, height: window.innerHeight }))
  const [remaining, setRemaining] = useState(0)
  const missing = artifact.exists === false

  // The real height is known before the paint, so it opens below or above without a frame in the wrong place.
  useLayoutEffect(() => {
    const height = menuRef.current?.offsetHeight || 0
    setPosition(placeMenu(anchorRect, height, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchorRect])

  useEffect(() => {
    menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [])

  // Esc is the menu's (it never reaches the Esc that closes a panel behind it).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current(true)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // "Toque de novo para remover": three seconds, counted in words, then it goes back to normal.
  useEffect(() => {
    if (remaining <= 0) return undefined
    const timer = setTimeout(() => setRemaining((current) => current - 1), 1000)
    return () => clearTimeout(timer)
  }, [remaining])

  const onMenuKeyDown = (event) => {
    const entries = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const index = entries.indexOf(document.activeElement)
    let target = null
    if (event.key === 'ArrowDown') target = entries[(index + 1) % entries.length]
    else if (event.key === 'ArrowUp') target = entries[(index - 1 + entries.length) % entries.length]
    else if (event.key === 'Home') target = entries[0]
    else if (event.key === 'End') target = entries[entries.length - 1]
    else if (event.key === 'Tab') {
      onCloseRef.current(false)
      return
    }
    if (target) {
      event.preventDefault()
      target.focus()
    }
  }

  const choose = (action) => () => {
    onCloseRef.current(true)
    action(artifact)
  }

  const remove = () => {
    if (remaining === 0) {
      setRemaining(CONFIRM_SECONDS)
      return
    }
    onCloseRef.current(true)
    onRemove(artifact)
  }

  const downloadHref = fileUrl({ ...artifact, source: 'artifact', id: artifact.artifact_id }, artifact.path, { download: true })

  return createPortal(
    <>
      <div
        className="v3-artifact-menu__scrim"
        data-testid="artifact-menu-scrim"
        onPointerDown={() => { scrimPressed.current = true }}
        onClick={() => {
          // Residual click of the long press that opened this menu: the press began on the card, not here.
          if (viaLongPress && !scrimPressed.current) return
          scrimPressed.current = false
          onClose(true)
        }}
      />
      <div
        ref={menuRef}
        className="v3-artifact-menu"
        role="menu"
        aria-label={`Ações de ${artifact.title}`}
        style={{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }}
        onKeyDown={onMenuKeyDown}
      >
        <button type="button" role="menuitem" className="v3-artifact-menu__item" onClick={choose(onOpen)}>Abrir</button>
        {missing ? null : (
          // A real link: Safari on the iPad only saves a link the person tapped.
          <a
            role="menuitem"
            className="v3-artifact-menu__item"
            href={downloadHref}
            download={basenameOf(artifact.path)}
            onClick={() => setTimeout(() => onCloseRef.current(false), 0)}
          >
            Baixar
          </a>
        )}
        <button type="button" role="menuitem" className="v3-artifact-menu__item" onClick={choose(onCopyPath)}>Copiar caminho</button>
        {missing ? null : (
          <button
            type="button"
            role="menuitem"
            className="v3-artifact-menu__item"
            aria-label="Citar no chat"
            aria-disabled={cite.enabled ? undefined : 'true'}
            aria-describedby={cite.enabled ? undefined : reasonId}
            onClick={() => {
              if (!cite.enabled) return
              choose(onCite)()
            }}
          >
            Citar no chat
            {cite.enabled ? null : <span id={reasonId} className="v3-artifact-menu__reason v3-type-caption">{cite.reason}</span>}
          </button>
        )}
        <button type="button" role="menuitem" className="v3-artifact-menu__item" onClick={choose(onRename)}>Renomear…</button>
        <div className="v3-artifact-menu__separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          className={`v3-artifact-menu__item v3-artifact-menu__item--danger${remaining > 0 ? ' v3-artifact-menu__item--confirm' : ''}`}
          onClick={remove}
        >
          {remaining > 0 ? `Toque de novo para remover (${remaining} s)` : 'Remover da lista'}
        </button>
        <span className="v3-artifact-menu__sr" role="status">
          {remaining === CONFIRM_SECONDS ? `Toque de novo em até ${CONFIRM_SECONDS} segundos para remover da lista.` : ''}
        </span>
      </div>
    </>,
    document.body,
  )
}
