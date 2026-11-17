import Button from '../../components/Button/Button.jsx'

// What the strip says about the pending requests (Designer 5.6).
export function pendingText(count, firstKind) {
  if (count > 1) return `${count} aprovações pendentes`
  if (firstKind === 'question') return 'Pergunta pendente'
  if (firstKind === 'plan') return 'Plano para aprovar'
  return '1 aprovação pendente'
}

// The strip over the composer while something waits for the user. "Ver pedido" is the keyboard and
// phone way to the card: the screen scrolls to it and focuses it.
export default function PendingStrip({ count, firstKind, onView }) {
  if (!count) return null
  return (
    <div className="v3-chat-pending" role="status">
      <span className="v3-chat-pending__dot" aria-hidden="true" />
      <span className="v3-chat-pending__text">{pendingText(count, firstKind)}</span>
      <Button variant="text" onClick={onView}>Ver pedido</Button>
    </div>
  )
}
