import Button from '../Button/Button.jsx'
import Pet from '../Pet/Pet.jsx'
import { PET_NAMES } from '../Pet/petShapes.js'
import './Island.css'

// The team island at the top of the content column: the pet of the open module
// speaks, offers actions and lists its colleagues.
//   pet / state: the speaking pet (front size)
//   name:        pet name shown in the eyebrow, tinted by --v3-island-name-<pet>
//   message:     the phrase; announced politely when it changes (role="status")
//   actions:     [{ label, onClick }]; an entry without a handler is not rendered.
//                The first action uses the module variant, the others the island one.
//   colleagues:  [{ id, pet, label }]; each is a button that opens that module
export default function Island({
  pet,
  state = 'idle',
  name = PET_NAMES[pet],
  message,
  actions = [],
  colleagues = [],
  onColleagueSelect,
}) {
  const visibleActions = actions.filter((action) => typeof action.onClick === 'function')

  return (
    <section className="v3-island" aria-label="Equipe">
      <Pet pet={pet} state={state} size="front" decorative />

      <div className="v3-island__text">
        <span className={`v3-island__name v3-island__name--${pet} v3-type-eyebrow`}>{name}</span>
        <p className="v3-island__message" role="status">{message}</p>
      </div>

      {visibleActions.length > 0 && (
        <div className="v3-island__actions">
          {visibleActions.map((action, index) => (
            <Button
              key={action.label}
              variant={index === 0 ? 'module' : 'island'}
              module={index === 0 ? pet : undefined}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {colleagues.length > 0 && (
        <>
          <span className="v3-island__divider" aria-hidden="true" />
          <div className="v3-island__colleagues">
            {colleagues.map((colleague) => (
              <button
                key={colleague.id}
                type="button"
                className="v3-island__colleague"
                aria-label={`Abrir ${colleague.label} com ${PET_NAMES[colleague.pet]}`}
                onClick={() => onColleagueSelect?.(colleague.id)}
              >
                <Pet pet={colleague.pet} state="idle" size="side" decorative />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
