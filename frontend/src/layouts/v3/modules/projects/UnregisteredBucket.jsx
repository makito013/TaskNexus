import AgentCard from './AgentCard.jsx'

// A folder the V2 discovered after the migration: its history stays here until
// someone registers it (the "Cadastrar como projeto" button arrives with the
// registration dialogs).
export default function UnregisteredBucket({ bucket }) {
  return (
    <div role="group" aria-label={`Pasta ainda não cadastrada: ${bucket.key}`} className="v3-bucket">
      <h3 className="v3-type-body v3-bucket__title">Pasta ainda não cadastrada</h3>
      <p className="v3-type-label v3-bucket__text">
        A V2 descobriu esta pasta depois da migração. O histórico fica aqui até você cadastrar.
      </p>
      <div className="v3-type-mono-sm v3-bucket__path">{bucket.key}</div>
      <div className="v3-projects__cards">
        {bucket.cards.map((card) => <AgentCard key={card.id} card={card} />)}
      </div>
    </div>
  )
}
