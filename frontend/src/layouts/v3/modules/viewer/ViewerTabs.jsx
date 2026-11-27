import { useEffect, useRef } from 'react'
import { basenameOf } from '../../../../utils/viewerPaths.js'

// The text of a tab: the file name, plus the line a code file was opened at ("main.py:42").
export function tabLabel(item) {
  const title = item.title || basenameOf(item.path)
  return item.line && item.kind === 'code' ? `${title}:${item.line}` : title
}

// One tab per open file, in the order they were opened. The close button is a SIBLING of the tab (a
// button inside a button is invalid and reads badly), and both hang from a wrapper that is not a tab.
// Arrows, Home and End move the selection (WAI-ARIA tabs with automatic activation).
//   items [{ id, path, title, kind, line }]    activeId    onSelect(id)    onClose(id)
export default function ViewerTabs({ items, activeId, onSelect, onClose }) {
  const listRef = useRef(null)

  // The tab that just became active enters the visible part of the strip. The strip scrolls by its own
  // scrollLeft: scrollIntoView would also move every scrollable ancestor (the shell).
  useEffect(() => {
    const list = listRef.current
    const tab = list?.querySelector('[aria-selected="true"]')?.closest('.v3-viewer-tab')
    if (!list || !tab) return
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
  }, [activeId, items.length])

  const move = (event, index) => {
    let target = null
    if (event.key === 'ArrowRight') target = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') target = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = items.length - 1
    if (target === null) return
    event.preventDefault()
    onSelect(items[target].id)
    listRef.current?.querySelectorAll('[role="tab"]')[target]?.focus()
  }

  return (
    <div className="v3-viewer-tabs" role="tablist" aria-label="Arquivos abertos" ref={listRef}>
      {items.map((item, index) => {
        const active = item.id === activeId
        const label = tabLabel(item)
        return (
          <div key={item.id} className={`v3-viewer-tab${active ? ' v3-viewer-tab--active' : ''}`} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className="v3-viewer-tab__label v3-type-mono-sm"
              title={item.path}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => move(event, index)}
            >
              {label}
            </button>
            <button
              type="button"
              className="v3-viewer-tab__close"
              aria-label={`Fechar ${label}`}
              onClick={() => onClose(item.id)}
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
