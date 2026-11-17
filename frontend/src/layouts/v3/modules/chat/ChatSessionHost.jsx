import { createContext, useContext, useEffect, useState } from 'react'
import { useChatSession } from './useChatSession.js'

// Mounted by the shell ABOVE <main> (inside the sessions provider), so the conversation socket
// outlives the screen: leaving the chat for another module and coming back reuses the same
// socket and the same state (CA38). It holds the last chat key it was given, so a deep link and
// openChat() both feed it, and it closes the socket only when the key changes or the shell
// unmounts. With no key ever given it is inert: no socket, no timers.
const ChatSessionContext = createContext(null)

export function useChatSessionContext() {
  return useContext(ChatSessionContext)
}

export default function ChatSessionHost({ activeKey = null, children }) {
  const [heldKey, setHeldKey] = useState(activeKey)
  useEffect(() => {
    if (activeKey) setHeldKey(activeKey)
  }, [activeKey])
  const session = useChatSession(activeKey || heldKey)
  return <ChatSessionContext.Provider value={session}>{children}</ChatSessionContext.Provider>
}
