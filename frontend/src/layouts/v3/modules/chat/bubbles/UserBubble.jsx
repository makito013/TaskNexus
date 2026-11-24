import { clockTime } from '../chatLabels.js'

// The user's message (right-aligned). The text is ALWAYS a text node (white-space: pre-wrap in the
// CSS keeps the line breaks): nothing the user typed is ever interpreted as markup.
//   message: { text, status: 'sending' | 'sent' | 'failed', ts }
//   onResend(text): "Enviar de novo" of a message the server refused
export default function UserBubble({ message, onResend }) {
  const failed = message.status === 'failed'
  const time = clockTime(message.ts)
  let meta = time ? `Você · ${time}` : 'Você'
  if (message.status === 'sending') meta = 'Você · Enviando…'
  return (
    <article className="v3-chat-msg v3-chat-msg--user" role="article" aria-label="Mensagem de Você">
      <div className="v3-chat-bubble v3-chat-bubble--user">{message.text}</div>
      <div className="v3-chat-msg__meta v3-type-caption">
        {failed ? (
          <>
            <span className="v3-chat-msg__failed">Não enviada</span>
            {onResend ? (
              <button type="button" className="v3-chat-link-button" onClick={() => onResend(message.text)}>
                Enviar de novo
              </button>
            ) : null}
          </>
        ) : (
          <span>{meta}</span>
        )}
      </div>
    </article>
  )
}
