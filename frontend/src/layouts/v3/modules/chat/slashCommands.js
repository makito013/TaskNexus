// Pure helpers of the "/" menu of the composer (Designer 7.2). No React, no I/O. The items are the
// ones of GET /api/chat/sessions/{key}/commands:
//   { name, description, argument_hint, source: project|user|plugin|builtin|session,
//     handling: dispatch|ui|hidden, disable_model_invocation }
// Every string of an item (a description written by a project, a plugin or a user) is shown as TEXT.

// The `handling: "ui"` commands the screen has a card for. Any other `ui` command would only be
// refused by the server (a "/name" the app handles itself is never sent), so it is not offered.
export const UI_COMMAND_CARDS = { model: 'model' }

export const GROUPS = [
  { key: 'project', label: 'Do projeto' },
  { key: 'user', label: 'Seus comandos' },
  { key: 'plugin', label: 'Plugins' },
  { key: 'builtin', label: 'Internos do chat' },
  { key: 'session', label: 'Da sessão' },
]
const GROUP_RANK = Object.fromEntries(GROUPS.map((group, index) => [group.key, index]))

function normalize(item) {
  return {
    name: String(item?.name ?? '').replace(/^\//, ''),
    description: String(item?.description ?? ''),
    argumentHint: String(item?.argument_hint ?? ''),
    source: GROUP_RANK[item?.source] !== undefined ? item.source : 'session',
    handling: item?.handling === 'ui' ? 'ui' : 'dispatch',
    hidden: item?.handling === 'hidden',
  }
}

// What the menu may offer: no hidden ones, no `ui` command without a card, no repeated name.
export function selectableCommands(items) {
  const seen = new Set()
  const result = []
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalize(raw)
    if (!item.name || item.hidden || seen.has(item.name)) continue
    if (item.handling === 'ui' && !UI_COMMAND_CARDS[item.name]) continue
    seen.add(item.name)
    result.push(item)
  }
  return result
}

// The origin seal of a row: "projeto", "usuário", "plugin:{name}", "interno", "sessão".
export function originLabel(item) {
  switch (item.source) {
    case 'project':
      return 'projeto'
    case 'user':
      return 'usuário'
    case 'plugin': {
      const prefix = item.name.includes(':') ? item.name.split(':')[0] : ''
      return prefix ? `plugin:${prefix}` : 'plugin'
    }
    case 'builtin':
      return 'interno'
    default:
      return 'sessão'
  }
}

// `text` is what is typed after the slash. Empty: grouped, in the order of GROUPS (by name inside).
// Typed: a flat list by relevance (name starts with, name contains, description contains).
// -> { flat, groups }  (`groups` is null for a typed query); the arrow keys walk `flat`.
export function matchCommands(items, text) {
  const query = String(text ?? '').toLowerCase()
  const byName = (a, b) => a.name.localeCompare(b.name)
  if (query === '') {
    const groups = GROUPS
      .map((group) => ({ ...group, items: items.filter((item) => item.source === group.key).sort(byName) }))
      .filter((group) => group.items.length > 0)
    return { flat: groups.flatMap((group) => group.items), groups }
  }
  const rank = (item) => {
    const name = item.name.toLowerCase()
    if (name.startsWith(query)) return 0
    if (name.includes(query)) return 1
    if (item.description.toLowerCase().includes(query)) return 2
    return -1
  }
  const flat = items
    .map((item) => ({ item, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || byName(a.item, b.item))
    .map((entry) => entry.item)
  return { flat, groups: null }
}

// "/model", "/model sonnet" -> "model"; anything else -> null. Only the first word counts.
export function commandNameOf(text) {
  const match = String(text ?? '').trim().match(/^\/(\S+)(?:\s|$)/)
  return match ? match[1] : null
}
