import { useRef, useState } from 'react'

export const TABPANEL_ID = 'projects-tabpanel'
export const tabId = (id) => `projects-tab-${id}`

const TABS = [
  { id: 'agents', label: 'Agentes' },
  { id: 'sessions', label: 'Sessões' },
  { id: 'board', label: 'Board' },
  { id: 'artifacts', label: 'Artefatos' },
]

// WAI-ARIA tabs, all four enabled. Arrows, Home and End walk them and the
// selection follows the focus; Enter and Space select the focused one (a native
// button already does on a real keyboard, the handler makes it explicit).
export default function ProjectTabs({ tab, onSelect }) {
  const [focusedId, setFocusedId] = useState(null)
  const buttonRefs = useRef({})
  const rovingId = focusedId ?? tab

  const moveFocus = (event, index) => {
    const keyTarget = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }[event.key]
    if (keyTarget === undefined) return
    event.preventDefault()
    const target = TABS[keyTarget]
    buttonRefs.current[target.id]?.focus()
    onSelect(target.id)
  }

  const handleKeyDown = (event, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(TABS[index].id)
      return
    }
    moveFocus(event, index)
  }

  const handleBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
  }

  return (
    <div role="tablist" aria-label="Seções" className="v3-projects-tabs" onBlur={handleBlur}>
      {TABS.map((entry, index) => {
        const selected = tab === entry.id
        return (
          <button
            key={entry.id}
            ref={(node) => { buttonRefs.current[entry.id] = node }}
            type="button"
            role="tab"
            id={tabId(entry.id)}
            className="v3-projects-tab v3-type-body-sm"
            aria-selected={selected}
            aria-controls={selected ? TABPANEL_ID : undefined}
            tabIndex={rovingId === entry.id ? 0 : -1}
            onFocus={() => setFocusedId(entry.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => onSelect(entry.id)}
          >
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}
