import { agentInitials } from '../../projects/AgentCard.jsx'
import MarkdownBody from '../MarkdownBody.jsx'
import ToolChip from './ToolChip.jsx'

// Groups the parts of a message in runs: consecutive text parts share a bubble, consecutive tool
// parts share a row of chips. Empty text parts are dropped (a `thinking` block never reaches here:
// the reducer keeps only text and tool_use).
function runsOf(message) {
  const runs = []
  for (const part of message.parts ?? []) {
    if (part.type === 'text') {
      if (!part.text) continue
      const last = runs[runs.length - 1]
      if (last?.type === 'text') last.texts.push(part.text)
      else runs.push({ type: 'text', texts: [part.text] })
    } else if (part.type === 'tool') {
      const last = runs[runs.length - 1]
      if (last?.type === 'tool') last.ids.push(part.toolUseId)
      else runs.push({ type: 'tool', ids: [part.toolUseId] })
    }
  }
  return runs
}

// The agent's message: avatar, markdown bubble(s) and the tool chips of the turn. While it streams
// the bubble is aria-busy / aria-live="off" (no announcement per token) and ends with the cursor.
export default function AgentBubble({ message, agentName, toolsById }) {
  const runs = runsOf(message)
  const streaming = Boolean(message.streaming)
  if (runs.length === 0 && !streaming) return null
  const lastTextRun = [...runs].reverse().find((run) => run.type === 'text')

  return (
    <article
      className="v3-chat-msg v3-chat-msg--agent"
      role="article"
      aria-label={`Mensagem de ${agentName}`}
      aria-busy={streaming ? 'true' : undefined}
      aria-live={streaming ? 'off' : undefined}
    >
      <span className="v3-chat-avatar" aria-hidden="true">{agentInitials(agentName)}</span>
      <div className="v3-chat-msg__body">
        {runs.map((run, index) => {
          if (run.type === 'tool') {
            return (
              <div key={index} className="v3-chat-chips">
                {run.ids.map((id) => (toolsById[id] ? <ToolChip key={id} tool={toolsById[id]} /> : null))}
              </div>
            )
          }
          return (
            <div key={index} className="v3-chat-bubble v3-chat-bubble--agent">
              <MarkdownBody text={run.texts.join('\n\n')} highlight={!streaming} />
              {streaming && run === lastTextRun ? <span className="v3-chat-cursor" aria-hidden="true" /> : null}
            </div>
          )
        })}
        {streaming && !lastTextRun ? (
          <div className="v3-chat-bubble v3-chat-bubble--agent">
            <span className="v3-chat-cursor" aria-hidden="true" />
          </div>
        ) : null}
        {message.interrupted ? <span className="v3-chat-msg__interrupted v3-type-caption">(interrompida)</span> : null}
      </div>
    </article>
  )
}
