import { useEffect, useRef, useState } from 'react'
import { chatApi } from '../../../../services/chatApi.js'

// The chat list gives no first message, so a chat with no name that is not the open one would read
// "Nova conversa". This reads the start of the event log of such chats (GET .../events, read only)
// once per chat and keeps the first user message, in memory only. The open chat is not asked: its
// own thread already knows the message.
//   chats      rows of the list on screen        openKey   the open conversation
//   -> { [sessionKey]: first user message }
export const MAX_LOOKUPS = 20
const EVENT_PAGE = 30

const hasName = (chat) => typeof chat?.display_name === 'string' && chat.display_name.trim() !== ''

export function useFirstMessages(chats, openKey) {
  const [messages, setMessages] = useState({})
  const asked = useRef(new Set())
  const mounted = useRef(true)

  // The list is polled, so `chats` is a new array every few seconds: an answer must not be dropped
  // just because the effect ran again; only an unmount drops it.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const wanted = (chats ?? [])
      .filter((chat) => chat?.session_key && chat.session_key !== openKey && !hasName(chat) && !asked.current.has(chat.session_key))
      .slice(0, Math.max(0, MAX_LOOKUPS - asked.current.size))
    for (const chat of wanted) {
      const key = chat.session_key
      asked.current.add(key)
      chatApi.fetchEvents(key, { since: 0, limit: EVENT_PAGE }).then(
        (page) => {
          const first = (page?.events ?? []).find((event) => event?.kind === 'message.user' && typeof event.payload?.text === 'string')
          if (mounted.current && first) setMessages((known) => ({ ...known, [key]: first.payload.text }))
        },
        () => {
          // the title stays "Nova conversa"; a failed read is not worth a retry loop
        },
      )
    }
  }, [chats, openKey])

  return messages
}
