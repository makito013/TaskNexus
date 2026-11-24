import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import AgentBubble from './bubbles/AgentBubble.jsx'
import SystemRow from './bubbles/SystemRow.jsx'
import UserBubble from './bubbles/UserBubble.jsx'
import { elapsedLabel, turnMeta } from './chatLabels.js'

const STICK_DISTANCE_PX = 80

// "Respondendo · turno 0:42" / "Usando Bash · turno 0:42": a ticking clock, so it is NOT a live
// region (the end of the answer is announced once, by MessageList).
function TurnIndicator({ turn }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const what = turn.tool ? `Usando ${turn.tool}` : 'Respondendo'
  return (
    <div className="v3-chat-turn v3-type-caption">
      <span className="v3-chat-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{what} · turno {elapsedLabel(turn.startedAt, now)}</span>
    </div>
  )
}

// A card sits right after the agent message that holds its tool; one with no such message
// (a question, a plan) goes to the end of the thread.
function placeCards(messages, cards) {
  const byMessage = new Map()
  const trailing = []
  for (const card of cards) {
    const owner = card.toolUseId
      ? messages.find((item) => item.kind === 'agent' && item.parts?.some((part) => part.type === 'tool' && part.toolUseId === card.toolUseId))
      : null
    if (owner) byMessage.set(owner.id, [...(byMessage.get(owner.id) ?? []), card])
    else trailing.push(card)
  }
  return { byMessage, trailing }
}

// The thread: a role="log" region that follows the end while the reader is near it and offers
// "Novas mensagens ↓" when they are reading above. Nothing is animated on arrival.
//   renderCard(card) -> node: the screen decides how a permission card looks
//   live: the replay is over (only then is a finished turn announced)
export default function MessageList({
  messages,
  toolsById,
  cards,
  turn,
  lastTurn,
  agentName,
  renderCard,
  onResend,
  logRef,
  live = true,
}) {
  const ownRef = useRef(null)
  const scrollRef = logRef ?? ownRef
  const stuckRef = useRef(true)
  const [hasNew, setHasNew] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const lastTurnRef = useRef(lastTurn)
  const { byMessage, trailing } = useMemo(() => placeCards(messages, cards), [messages, cards])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (stuckRef.current) element.scrollTop = element.scrollHeight
    else setHasNew(true)
  }, [messages, cards, turn.running, scrollRef])

  // The end of a reply is announced once: a NEW finished turn seen after the replay (a turn read back
  // from the log while the conversation opens is history, not news).
  useEffect(() => {
    if (live && lastTurn && lastTurn !== lastTurnRef.current && !lastTurn.isError) {
      setAnnouncement(`Resposta de ${agentName} concluída.`)
    }
    lastTurnRef.current = lastTurn
  }, [lastTurn, live, agentName])

  useEffect(() => {
    if (turn.running) setAnnouncement('')
  }, [turn.running])

  const onScroll = () => {
    const element = scrollRef.current
    stuckRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_DISTANCE_PX
    if (stuckRef.current) setHasNew(false)
  }

  const jumpToEnd = () => {
    const element = scrollRef.current
    stuckRef.current = true
    element.scrollTop = element.scrollHeight
    setHasNew(false)
  }

  const last = messages[messages.length - 1]
  const showIndicator = turn.running && !(last?.kind === 'agent' && last.streaming)
  const meta = !turn.running && last?.kind === 'agent' ? turnMeta(lastTurn) : ''

  const cardNode = (card) => (
    <div
      key={`card-${card.id}`}
      className="v3-chat-card"
      data-card-id={card.id}
      data-pending={card.status === 'pending' ? 'true' : undefined}
      tabIndex={-1}
    >
      {renderCard(card)}
    </div>
  )

  return (
    <div className="v3-chat-thread-wrap">
      <div
        ref={scrollRef}
        className="v3-chat-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensagens do chat"
        tabIndex={0}
        onScroll={onScroll}
      >
        {messages.map((item) => {
          if (item.kind === 'user') return <UserBubble key={item.id} message={item} onResend={onResend} />
          if (item.kind === 'agent') {
            return (
              <div key={item.id} className="v3-chat-turnblock">
                <AgentBubble message={item} agentName={agentName} toolsById={toolsById} />
                {(byMessage.get(item.id) ?? []).map(cardNode)}
              </div>
            )
          }
          return <SystemRow key={item.id} item={item} />
        })}
        {trailing.map(cardNode)}
        {showIndicator ? <TurnIndicator turn={turn} /> : null}
        {meta ? <p className="v3-chat-turnmeta v3-type-mono-sm">{meta}</p> : null}
      </div>
      <div className="v3-chat-sr-only" role="status">{announcement}</div>
      {hasNew ? (
        <button type="button" className="v3-chat-jump" onClick={jumpToEnd}>Novas mensagens ↓</button>
      ) : null}
    </div>
  )
}
