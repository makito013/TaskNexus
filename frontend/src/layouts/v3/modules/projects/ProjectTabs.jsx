import { useRef, useState } from 'react'
import Chip from '../../components/Chip/Chip.jsx'

export const TABPANEL_ID = 'projects-tabpanel'
export const tabId = (id) => `projects-tab-${id}`

const TABS = [
  { id: 'agents', label: 'Agentes' },
  { id: 'sessions', label: 'Sessões' },
  { id: 'board', label: 'Board', soon: true },
  { id: 'artifacts', label: 'Artefatos', soon: true },
]

// WAI-ARIA tabs. "Board" and "Artefatos" are announced as "em breve": they take
// focus (roving tabindex) and are described by the note, but Enter, Space and a
// click do nothing and they never become selected. Arrows, Home and End walk all
// four; the selection follows the focus only on the enabled ones.
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
    if (!target.soon) onSelect(target.id)
  }

  const handleBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
  }

  return (
    <>
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
              aria-disabled={entry.soon ? 'true' : undefined}
              aria-describedby={entry.soon ? 'projects-soon-note' : undefined}
              tabIndex={rovingId === entry.id ? 0 : -1}
              onFocus={() => setFocusedId(entry.id)}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={entry.soon ? undefined : () => onSelect(entry.id)}
            >
              {entry.label}
              {entry.soon && <Chip tone="state" accent="soon">em breve</Chip>}
            </button>
          )
        })}
      </div>
      <span id="projects-soon-note" className="v3-projects__sr-only">Disponível em uma próxima versão.</span>
    </>
  )
}
