// Guard of what the chat may WRITE (ADR-50, D-TL1, CT18). Reads the SOURCE of every non-test file of
// modules/chat/**, sessions/**, components/ApprovalCard/** and (CT18) modules/projects/*, and refuses:
//   - a mutating call of chatApi outside the writer that owns it (the five of D-TL1, below);
//   - any way of hiding such a call (destructuring or aliasing chatApi, bracket / optional access,
//     a renamed, namespace, default or dynamic import);
//   - a direct fetch( (chatApi.js is the one place that calls it), web storage, and the chat socket
//     (`connect(` of chatSocket, the channel of send / interrupt / set_model) outside useChatSession.js.
// Everything else only reads (GET) or receives callbacks. The scanner is exported and a fixture battery
// proves it goes red (a source-reading test that never fails proves nothing).
//
// The five writers of D-TL1 are exactly the files below. The marco A / B1 helper files (ChatSessionHost,
// PermissionCard, ChatScreen...) own no writer: they call the hook or receive callbacks.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatApi } from '../../../../services/chatApi.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const V3 = path.join(HERE, '../..')

export const READERS = [
  'health', 'listSessions', 'listLiveSessions', 'fetchEvents', 'fetchSessionCommands', 'fetchCommands',
  'fetchModels', 'fetchConnectors',
]
export const WRITERS = [
  'createSession', 'openSession', 'closeSession', 'switchEngine', 'decidePermission', 'putCommands', 'putModels',
  'putConnectors', 'refreshConnectors', 'renameSession', 'terminateSession', 'resetSession',
]

// file name -> the mutating calls that file (and only it) may make.
export const WRITERS_BY_FILE = {
  'useChatSession.js': ['decidePermission', 'openSession', 'resetSession'],
  'useChatListActions.js': ['renameSession', 'terminateSession'],
  'NewChatDialog.jsx': ['createSession', 'renameSession'],
  'ConnectorsDialog.jsx': ['putConnectors', 'refreshConnectors'],
  'SwitchEngineDialog.jsx': ['switchEngine'],
}
const SOCKET_OWNER = 'useChatSession.js'

const CHAT_API_MODULE = /(?:^|\/)services\/chatApi(?:\.js)?$/
const CHAT_SOCKET_MODULE = /(?:^|\/)services\/chatSocket(?:\.js)?$/

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function dynamicImports(code) {
  return [...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
}

// -> the list of violations of one (non-test) source file.
export function scanChatSource(file, source) {
  const problems = []
  const code = stripComments(source)
  const name = path.basename(file)
  const allowed = WRITERS_BY_FILE[name] ?? []

  for (const match of code.matchAll(/(?<![\w$/.])chatApi\s*\.\s*(\w+)/g)) {
    const method = match[1]
    if (WRITERS.includes(method)) {
      if (!allowed.includes(method)) problems.push(`chatApi.${method} is a writer and ${name} does not own it`)
    } else if (!READERS.includes(method)) {
      problems.push(`chatApi.${method} is on neither list (classify it as reader or writer)`)
    }
  }
  if (/\{[^}]*\}\s*=\s*chatApi\b/.test(code)) problems.push('destructures chatApi')
  if (/\b(?:const|let|var)\s+\w+\s*=\s*chatApi\s*(?:[;,\n)]|$)/.test(code)) problems.push('aliases chatApi')
  if (/(?<![\w$/.])chatApi\s*(?:\?\.|\[)/.test(code)) problems.push('reaches chatApi by optional chaining or bracket access')
  for (const match of code.matchAll(/\bimport\s+([^'"();]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!CHAT_API_MODULE.test(match[2])) continue
    const clause = match[1].trim()
    if (/\*\s*as\b/.test(clause)) problems.push('imports chatApi as a namespace')
    else if (!clause.startsWith('{')) problems.push('imports chatApi as a default import')
    else if (/\bas\b/.test(clause)) problems.push('renames an import of chatApi (as)')
  }
  for (const match of code.matchAll(/\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (CHAT_API_MODULE.test(match[1])) problems.push('re-exports chatApi')
  }
  for (const specifier of dynamicImports(code)) {
    if (CHAT_API_MODULE.test(specifier)) problems.push('dynamically imports chatApi')
  }

  if (/\bfetch\s*\(/.test(code)) problems.push('calls fetch( directly')
  if (/\b(?:localStorage|sessionStorage)\b/.test(code)) problems.push('uses web storage')

  const usesSocket = [...code.matchAll(/\bimport\s+[^'"();]*?\s*from\s*['"]([^'"]+)['"]/g)].some((match) => CHAT_SOCKET_MODULE.test(match[1]))
    || dynamicImports(code).some((specifier) => CHAT_SOCKET_MODULE.test(specifier))
  if (usesSocket && name !== SOCKET_OWNER) problems.push(`imports chatSocket (only ${SOCKET_OWNER} owns the socket)`)
  return problems
}

const isTest = (name) => /\.test\.(js|jsx)$/.test(name)
const isCode = (name) => /\.(js|jsx)$/.test(name) && !isTest(name)
// The test scaffold (no production code) is not a writer and is not scanned.
const SCAFFOLD = new Set(['chatTestKit.js'])

function walk(folder) {
  const found = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) found.push(...walk(full))
    else if (isCode(entry.name) && !SCAFFOLD.has(entry.name)) found.push(full)
  }
  return found
}

const SCANNED_FOLDERS = ['modules/chat', 'sessions', 'components/ApprovalCard']
const SOURCE_FILES = [
  ...SCANNED_FOLDERS.flatMap((folder) => walk(path.join(V3, folder))),
  // CT18: modules/projects/ (no recursion needed: it is flat) has no mutating chatApi call at all.
  ...readdirSync(path.join(V3, 'modules/projects')).filter(isCode).map((name) => path.join(V3, 'modules/projects', name)),
]
const relative = (file) => path.relative(V3, file).replaceAll('\\', '/')

describe('chat write guard', () => {
  it('scans the real files (positive control: the five writers and a helper are in the set)', () => {
    const names = SOURCE_FILES.map((file) => path.basename(file))
    expect(names).toEqual(expect.arrayContaining([
      ...Object.keys(WRITERS_BY_FILE), 'ChatSessionHost.jsx', 'PermissionCard.jsx', 'ChatScreen.jsx', 'ApprovalCard.jsx',
      'ProjectsSessionsProvider.jsx', 'ProjectsScreen.jsx', 'ModelCard.jsx',
    ]))
  })

  it('every function of chatApi is classified as a reader or a writer', () => {
    expect(Object.keys(chatApi).sort()).toEqual([...READERS, ...WRITERS].sort())
  })

  it('each of the five writers really makes the calls it owns (positive control)', () => {
    for (const [name, methods] of Object.entries(WRITERS_BY_FILE)) {
      const file = SOURCE_FILES.find((candidate) => path.basename(candidate) === name)
      const code = readFileSync(file, 'utf8')
      for (const method of methods) expect(code, `${name} should call chatApi.${method}`).toMatch(new RegExp(`chatApi\\.${method}\\b`))
    }
  })

  it.each(SOURCE_FILES.map((file) => [relative(file), file]))('%s only makes the calls it owns', (_label, file) => {
    expect(scanChatSource(file, readFileSync(file, 'utf8'))).toEqual([])
  })
})

describe('scanChatSource (fixtures prove the detector goes red)', () => {
  const scan = (source, file = 'Some.jsx') => scanChatSource(file, source)

  it.each([
    ['a decision outside useChatSession', 'chatApi.decidePermission(id, {})', /decidePermission is a writer/],
    ['a rename in a component that is not a writer', 'await chatApi.renameSession(key, name)', /renameSession is a writer/],
    ['a writer of ANOTHER writer file', 'chatApi.putConnectors(a, [])', /putConnectors is a writer/],
    ['a terminate in the chat screen', 'chatApi.terminateSession(key)', /terminateSession/],
    ['a switch of engine outside its dialog', 'chatApi.switchEngine(key, {})', /switchEngine/],
    ['a creation outside the new chat dialog', 'chatApi.createSession({})', /createSession/],
    ['a call that is on no list', 'chatApi.dropEverything()', /neither list/],
    ['a destructured client', 'const { decidePermission } = chatApi', /destructures/],
    ['an aliased client', 'const client = chatApi\nclient.openSession(key)', /aliases/],
    ['optional chaining', 'chatApi?.openSession(key)', /optional chaining/],
    ['bracket access', "chatApi['openSession'](key)", /bracket access/],
    ['a split call', 'chatApi\n  .resetSession(key)', /resetSession is a writer/],
    ['a renamed import', "import { chatApi as api2 } from '../../../../services/chatApi.js'", /renames an import/],
    ['a renamed import without extension', "import { chatApi as api2 } from '../../../../services/chatApi'", /renames an import/],
    ['a namespace import', "import * as svc from '../../../../services/chatApi.js'", /namespace/],
    ['a default import', "import client from '../../../../services/chatApi.js'", /default import/],
    ['a multi-line renamed import', "import {\n  chatApi as api2,\n} from '../../../../services/chatApi.js'", /renames an import/],
    ['a dynamic import', "const mod = await import('../../../../services/chatApi.js')", /dynamically imports/],
    ['a re-export', "export { chatApi } from '../../../../services/chatApi.js'", /re-exports/],
    ['a direct fetch', "await fetch('/api/chat/sessions', { method: 'POST' })", /fetch\(/],
    ['web storage', "localStorage.setItem('draft', text)", /web storage/],
    ['session storage', "sessionStorage.getItem('x')", /web storage/],
    ['the chat socket outside its owner', "import { connect } from '../../../../services/chatSocket.js'", /chatSocket/],
    ['the chat socket by dynamic import', "const m = await import('../../../../services/chatSocket')", /chatSocket/],
  ])('goes red for %s', (_label, source, expected) => {
    const problems = scan(source)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(expected)
  })

  it('goes red when a writer file makes a call it does not own', () => {
    expect(scan('chatApi.terminateSession(key)', 'useChatSession.js').join()).toMatch(/terminateSession/)
    expect(scan('chatApi.openSession(key)', 'useChatListActions.js').join()).toMatch(/openSession/)
    expect(scan('chatApi.switchEngine(key, {})', 'ConnectorsDialog.jsx').join()).toMatch(/switchEngine/)
  })

  it('lets each writer make exactly its own calls, reads anywhere, and the socket in its owner', () => {
    for (const [name, methods] of Object.entries(WRITERS_BY_FILE)) {
      expect(scan(methods.map((method) => `chatApi.${method}(x)`).join('\n'), name)).toEqual([])
    }
    expect(scan('const list = await chatApi.fetchModels()\nchatApi.health()', 'ModelCard.jsx')).toEqual([])
    expect(scan("import { connect } from '../../../../services/chatSocket.js'", 'useChatSession.js')).toEqual([])
    expect(scan("import { chatApi } from '../../../../services/chatApi.js'", 'ModelCard.jsx')).toEqual([])
  })

  it('ignores a forbidden word that is only in a comment', () => {
    expect(scan('// chatApi.decidePermission(x) and fetch( and localStorage\n/* chatApi.resetSession */')).toEqual([])
  })
})
