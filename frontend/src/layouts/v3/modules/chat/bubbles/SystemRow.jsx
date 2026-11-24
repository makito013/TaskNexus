// Non-message rows of the thread: dividers, system notices and the bubble of a turn that failed.
// Everything is plain text. A `thinking` block never reaches the thread, so nothing here shows it.
function dividerText(item) {
  switch (item.variant) {
    case 'interrupted':
      return 'Turno interrompido.'
    case 'model':
      return item.model ? `Modelo trocado para ${item.model}.` : 'Modelo trocado.'
    case 'reset':
    case 'new_conversation':
      return 'Conversa nova iniciada.'
    case 'history_imported':
      return 'Histórico importado do terminal'
    default:
      return ''
  }
}

export default function SystemRow({ item }) {
  if (item.kind === 'error') {
    return (
      <div className="v3-chat-error" role="group" aria-label="Erro no turno">
        <p className="v3-chat-error__text">{item.text}</p>
        {item.detail ? (
          <details className="v3-chat-error__detail">
            <summary>Detalhe técnico</summary>
            <pre className="v3-type-mono-sm">{item.detail}</pre>
          </details>
        ) : null}
      </div>
    )
  }
  const text = item.kind === 'notice' ? item.text : dividerText(item)
  if (!text) return null
  return (
    <div className="v3-chat-divider v3-type-caption" role="separator" aria-label={text}>
      <span className="v3-chat-divider__text">{text}</span>
    </div>
  )
}
