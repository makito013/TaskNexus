import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useChatSession } from './useChatSession.js'

// Mounted by the shell ABOVE <main> (inside the sessions provider), so the conversation socket
// outlives the screen: leaving the chat for another module and coming back reuses the same
// socket and the same state (CA38). It holds the last chat key it was given, so a deep link and
// openChat() both feed it, and it closes the socket only when the key changes or the shell
// unmounts. With no key ever given it is inert: no socket, no timers.
//
// The chat socket is opened ONLY for a key whose screen reported the chat view (reportVision): a key
// shown as the terminal (codex, agy, the plain terminal, a Claude conversation sent to the terminal)
// or still undecided has no /ws/chat reader. The report survives the screen unmounting, so a terminal
// key does not get a reader back when the user leaves the chat module.
const ChatSessionContext = createContext(null)

export function useChatSessionContext() {
  return useContext(ChatSessionContext)
}

export default function ChatSessionHost({ activeKey = null, children }) {
  const [heldKey, setHeldKey] = useState(activeKey)
  // { [key]: 'chat' | 'terminal' }: what the screen of each key last reported.
  const [visions, setVisions] = useState({})
  useEffect(() => {
    if (activeKey) setHeldKey(activeKey)
  }, [activeKey])
  const sessionKey = activeKey || heldKey
  // A key shown as the terminal has no chat socket: its `ack` goes over REST (the hook does it).
  const session = useChatSession(sessionKey, {
    enabled: sessionKey != null && visions[sessionKey] === 'chat',
    terminal: sessionKey != null && visions[sessionKey] === 'terminal',
  })
  const reportVision = useCallback((key, vision) => {
    setVisions((current) => (current[key] === vision ? current : { ...current, [key]: vision }))
  }, [])
  const value = useMemo(() => ({ ...session, reportVision }), [session, reportVision])
  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}
