// Session key of a NEW terminal (PTY) session, in the format the V2 generator uses.
//
// The V2 builds it in components/TerminalContext.jsx (`startNewInstance`): `<projectId>::<agentId>`, plus
// `::<random base36>` (`Math.random().toString(36).slice(2, 8)`) when the bare key is already an open tab. The
// backend treats the key as an opaque string, and the V2 reads it back with `key.split('::')`
// (projectId = part 0, agentId = part 1), so a key in this format is a session the V2 recognises too.
// The V3 never imports components/ (ADR-08): the format is COPIED here, on purpose.
//
// One difference, on purpose: the V3 ALWAYS adds the suffix. The bare key may have a saved session behind it
// (the V2 "reconnects" to it); a new terminal opened from "Novo chat" must be a new conversation, never the
// resume of an old one. The suffix is exactly 6 base36 characters (the V2 one can come out shorter).
const SUFFIX_LENGTH = 6
const BASE36 = 36

export function randomSuffix(random = Math.random) {
  let suffix = ''
  // `|| '0'`: a draw of exactly 0 has no fractional digits and would never fill the suffix.
  while (suffix.length < SUFFIX_LENGTH) suffix += random().toString(BASE36).slice(2) || '0'
  return suffix.slice(0, SUFFIX_LENGTH)
}

export function newPtySessionKey(projectKey, agentId, random = Math.random) {
  return `${projectKey}::${agentId}::${randomSuffix(random)}`
}
