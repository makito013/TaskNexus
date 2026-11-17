import { useCallback, useState } from 'react'
import { chatApi } from '../../../../services/chatApi.js'

// The write actions of the chat list and header: rename and end a conversation. One of the five
// writers of chatApi (chatWriteGuard). `onChanged` runs after a successful write (the screen
// refreshes the provider so the list shows the new state at once).
//   renameChat(key, name) -> true | false     (false = the server refused; `renameError` says so)
//   endChat(key)          -> true | false     ("terminate": a 404 is already a success)
export function useChatListActions({ onChanged } = {}) {
  const [busyKey, setBusyKey] = useState(null)
  const [renameError, setRenameError] = useState(null)
  const [endError, setEndError] = useState(null)

  const renameChat = useCallback(async (sessionKey, name) => {
    setBusyKey(sessionKey)
    setRenameError(null)
    try {
      await chatApi.renameSession(sessionKey, name)
      onChanged?.()
      return true
    } catch {
      setRenameError(sessionKey)
      return false
    } finally {
      setBusyKey(null)
    }
  }, [onChanged])

  const endChat = useCallback(async (sessionKey) => {
    setBusyKey(sessionKey)
    setEndError(null)
    try {
      await chatApi.terminateSession(sessionKey)
      onChanged?.()
      return true
    } catch {
      setEndError(sessionKey)
      return false
    } finally {
      setBusyKey(null)
    }
  }, [onChanged])

  const clearRenameError = useCallback(() => setRenameError(null), [])

  return { busyKey, renameError, endError, renameChat, endChat, clearRenameError }
}
