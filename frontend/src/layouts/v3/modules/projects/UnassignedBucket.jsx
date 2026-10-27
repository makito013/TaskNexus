import Button from '../../components/Button/Button.jsx'
import AgentCard from './AgentCard.jsx'

// A client the V2 created after the migration that has no workspace yet, or a
// key the registry does not know at all (variant "unknown"). The history is
// shown, never dropped. A client without a workspace can become one
// ("Criar workspace a partir de X"), which keeps the history under the same key.
const COPY = {
  unassigned: { text: 'Ainda não existe workspace com este nome.', label: (title) => `${title} sem workspace` },
  unknown: { text: 'Esta chave não está no cadastro.', label: (title) => title },
}

export default function UnassignedBucket({ title, paths = [], cards, variant = 'unassigned', actions = null }) {
  const copy = COPY[variant]
  const canCreate = Boolean(actions) && variant === 'unassigned'
  return (
    <div role="group" aria-label={copy.label(title)} className="v3-bucket">
      <div className="v3-bucket__row">
        <div className="v3-bucket__main">
          <h3 className="v3-type-body v3-bucket__title">{title}</h3>
          <p className="v3-type-label v3-bucket__text">{copy.text}</p>
          {paths.length > 0 && <div className="v3-type-mono-sm v3-bucket__path">{paths.join(' · ')}</div>}
        </div>
        {canCreate && (
          <Button size="sm" onClick={(event) => actions.onCreateWorkspaceFrom(title, event.currentTarget)}>
            Criar workspace a partir de {title}
          </Button>
        )}
      </div>
      <div className="v3-projects__cards">
        {cards.map((card) => <AgentCard key={card.id} card={card} />)}
      </div>
    </div>
  )
}
