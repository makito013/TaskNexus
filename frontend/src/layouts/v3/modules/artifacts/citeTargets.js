// Pure: where an artifact can be cited (D-05). A target is a conversation of the artifact's project, or a
// live terminal session of it. Nothing here reads the network or the screen.
import { chatTitle } from '../chat/chatLabels.js'
import { parseSessionKey } from '../projects/agentBoard.js'

/**
 * @param {object} artifact          { project_id, ... }
 * @param {{ chats?: object[], liveByKey?: object }} sessions
 *   chats      rows of GET /api/chat/sessions (the ones that were ended are not in it)
 *   liveByKey  GET /api/sessions/active?engine=all
 * @returns {Array<{ sessionKey: string, kind: 'chat' | 'terminal', label: string }>}
 *   chats first (the list order), then the live terminals
 */
export function citeTargetsFor(artifact, { chats = [], liveByKey = {} } = {}) {
  const projectId = artifact?.project_id
  if (!projectId) return []
  const targets = []
  const seen = new Set()
  for (const chat of chats) {
    const key = chat?.session_key
    if (!key || seen.has(key) || chat.project_ref !== projectId) continue
    // A chat that never opened has nothing to type into (a resumable one does).
    if (chat.status === 'failed' && !chat.live_status) continue
    seen.add(key)
    targets.push({ sessionKey: key, kind: 'chat', label: chatTitle(chat) })
  }
  for (const [key, live] of Object.entries(liveByKey || {})) {
    if (seen.has(key) || live?.engine !== 'pty') continue
    const parsed = parseSessionKey(key)
    if (parsed.projectKey !== projectId) continue
    seen.add(key)
    targets.push({ sessionKey: key, kind: 'terminal', label: `Terminal de ${parsed.agentId ?? 'terminal'}` })
  }
  return targets
}
