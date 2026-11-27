import { KIND_LABEL, footerText } from '../../../../utils/artifactModel.js'
import Chip from '../../components/Chip/Chip.jsx'
import useLongPress from './useLongPress.js'

// The card of one artifact: type, title, path, excerpt and who/when/size. The TITLE is the button that
// opens it (stretched over the whole card by a pseudo-element); the "⋯" sits above that area. The menu opens
// by the "⋯", by the right button and by a long press (500 ms, 10 px).
//   artifact   a row of GET /api/artifacts
//   active     open in the panel now (a border AND aria-current, never colour alone)
//   onOpen(artifact)
//   onMenu(artifact, { rect, trigger, viaLongPress })   rect = where the menu anchors, trigger = what gets the focus back,
//                                                       viaLongPress = the finger is still down (or just left) on the card
export default function ArtifactCard({ artifact, active = false, onOpen, onMenu }) {
  const missing = artifact.exists === false
  const kindLabel = KIND_LABEL[artifact.kind] || String(artifact.kind || '').toUpperCase()
  const { handlers, consumeClick } = useLongPress((target, point) => {
    onMenu(artifact, { rect: pointRect(point), trigger: target.querySelector('[data-artifact-open]'), viaLongPress: true })
  })

  const className = ['v3-artifact-card', active ? 'v3-artifact-card--active' : '', missing ? 'v3-artifact-card--missing' : '']
    .filter(Boolean).join(' ')

  return (
    <article
      className={className}
      data-artifact-id={artifact.artifact_id}
      data-active={active ? 'true' : undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(artifact, {
          rect: pointRect({ x: event.clientX, y: event.clientY }),
          trigger: event.currentTarget.querySelector('[data-artifact-open]'),
        })
      }}
      {...handlers}
    >
      <div className="v3-artifact-card__head">
        <Chip tone="badge" className="v3-type-mono-sm">{kindLabel}</Chip>
        {missing ? <Chip tone="state" accent="danger">arquivo não encontrado</Chip> : null}
      </div>
      <p className="v3-artifact-card__title v3-type-body">
        <button
          type="button"
          className="v3-artifact-card__open"
          data-artifact-open=""
          aria-current={active ? 'true' : undefined}
          aria-label={`${artifact.title} (${kindLabel})${missing ? ', arquivo não encontrado' : ''}`}
          onClick={() => {
            // The click that follows a long press belongs to the menu that just opened.
            if (consumeClick()) return
            onOpen(artifact)
          }}
        >
          {artifact.title}
        </button>
      </p>
      <p className="v3-artifact-card__path v3-type-mono-sm" title={artifact.path}>{artifact.path}</p>
      {!missing && artifact.excerpt ? <p className="v3-artifact-card__excerpt v3-type-body-sm">{artifact.excerpt}</p> : null}
      <p className="v3-artifact-card__foot v3-type-caption">{footerText(artifact)}</p>
      <button
        type="button"
        className="v3-artifact-card__more"
        aria-label={`Ações de ${artifact.title}`}
        aria-haspopup="menu"
        // The "⋯" is not the start of a long press nor the click of the card.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onMenu(artifact, { rect: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="4.5" cy="10" r="1.5" fill="currentColor" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </article>
  )
}

function pointRect({ x, y }) {
  return { top: y, bottom: y, left: x, right: x }
}

// Still placeholder of a card while the list loads.
export function ArtifactCardSkeleton() {
  return (
    <div className="v3-artifact-card v3-artifact-card--skeleton" aria-hidden="true">
      <i /><i /><i /><i />
    </div>
  )
}
