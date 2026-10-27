import Button from '../../components/Button/Button.jsx'
import AgentCard from './AgentCard.jsx'

const ARCHIVED_NOTE = 'Este workspace está arquivado. Desarquive-o antes de adicionar projetos.'

// A folder the V2 discovered after the migration: its history stays here until
// someone registers it. "Cadastrar como projeto" opens the project dialog filled
// from the V2 map (the project keeps the history). In an archived workspace the
// button is inert and says why: the server would answer 409 workspace_archived.
export default function UnregisteredBucket({ bucket, workspace = null, actions = null }) {
  const pathId = `bucket-path-${bucket.key}`
  const noteId = `bucket-note-${bucket.key}`
  const archived = Boolean(workspace && workspace.archived)
  return (
    <div role="group" aria-label={`Pasta ainda não cadastrada: ${bucket.key}`} className="v3-bucket">
      <div className="v3-bucket__row">
        <div className="v3-bucket__main">
          <h3 className="v3-type-body v3-bucket__title">Pasta ainda não cadastrada</h3>
          <p className="v3-type-label v3-bucket__text">
            A V2 descobriu esta pasta depois da migração. O histórico fica aqui até você cadastrar.
          </p>
          <div id={pathId} className="v3-type-mono-sm v3-bucket__path">{bucket.key}</div>
          {actions && archived && <p id={noteId} className="v3-type-caption v3-bucket__note">{ARCHIVED_NOTE}</p>}
        </div>
        {actions && (
          <Button
            size="sm"
            {...(archived
              ? { 'aria-disabled': 'true', 'aria-describedby': noteId }
              : {
                'aria-describedby': pathId,
                onClick: (event) => actions.onRegisterBucket(bucket, workspace, event.currentTarget),
              })}
          >
            Cadastrar como projeto
          </Button>
        )}
      </div>
      <div className="v3-projects__cards">
        {bucket.cards.map((card) => <AgentCard key={card.id} card={card} />)}
      </div>
    </div>
  )
}
