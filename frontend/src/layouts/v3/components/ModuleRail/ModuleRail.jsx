import Pet from '../Pet/Pet.jsx'
import './ModuleRail.css'

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

function MoonIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

// The module navigation of the v3 shell. Modules without a screen stay clickable
// (they lead to the "coming soon" screen) and say so in text, never only by tint.
//   modules:  entries of modules.js
//   activeId: id of the open module, or null when none is open
export default function ModuleRail({ modules, activeId, onSelect, theme, onToggleTheme }) {
  const nextTheme = theme === 'dark' ? 'claro' : 'escuro'

  return (
    <nav className="v3-rail" aria-label="Módulos">
      <span className="v3-rail__mark" aria-hidden="true">T</span>

      {modules.map((module) => {
        const active = module.id === activeId
        return (
          <button
            key={module.id}
            type="button"
            className={`v3-rail__item${active ? ' v3-rail__item--active' : ''}`}
            aria-label={module.ariaLabel}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(module.id)}
          >
            <Pet pet={module.pet} state={module.ready ? 'idle' : 'sleeping'} size="nav" decorative />
            <span className="v3-rail__label" aria-hidden="true">{module.label}</span>
            {!module.ready && <span className="v3-rail__soon" aria-hidden="true">Em breve</span>}
          </button>
        )
      })}

      <button
        type="button"
        className="v3-rail__theme"
        aria-label={`Mudar para tema ${nextTheme}`}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    </nav>
  )
}
