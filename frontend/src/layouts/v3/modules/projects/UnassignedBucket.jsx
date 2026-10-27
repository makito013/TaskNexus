import AgentCard from './AgentCard.jsx'

// A client the V2 created after the migration that has no workspace yet, or a
// key the registry does not know at all (variant "unknown"). The history is
// shown, never dropped.
const COPY = {
  unassigned: { text: 'Ainda não existe workspace com este nome.', label: (title) => `${title} sem workspace` },
  unknown: { text: 'Esta chave não está no cadastro.', label: (title) => title },
}

export default function UnassignedBucket({ title, paths = [], cards, variant = 'unassigned' }) {
  const copy = COPY[variant]
  return (
    <div role="group" aria-label={copy.label(title)} className="v3-bucket">
      <h3 className="v3-type-body v3-bucket__title">{title}</h3>
      <p className="v3-type-label v3-bucket__text">{copy.text}</p>
      {paths.length > 0 && <div className="v3-type-mono-sm v3-bucket__path">{paths.join(' · ')}</div>}
      <div className="v3-projects__cards">
        {cards.map((card) => <AgentCard key={card.id} card={card} />)}
      </div>
    </div>
  )
}
