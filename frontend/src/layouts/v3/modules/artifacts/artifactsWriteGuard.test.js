// Guard of the writes of the V3 artifacts surface (ADR-63). The surface writes (remove, rename, import, the
// paste into a terminal, the draft of a chat), so its rule is by owner: the api client, the artifacts api and
// the artifacts hooks may be imported ONLY by the files that own a write. Every other file renders what it is
// handed and calls what it is handed. No component fetches, opens a socket, stores, or asks the browser.
//
// The scanner is exported and a fixture battery proves it goes red (a source-reading test that never fails
// proves nothing). Comments are read out first, so a word in a comment never counts.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// The files that own a write: the tab (remove, paste, draft, the list), the two dialogs that talk to the server.
export const OWNERS = ['ArtifactsTab.jsx', 'RenameArtifactDialog.jsx', 'ImportArtifactsDialog.jsx']

const OWNER_ONLY_IMPORTS = ['services/api', 'services/artifactsApi', 'hooks/useArtifacts', 'hooks/useSaveToArtifacts']
// The tab alone may take the chat session (it queues the draft of a conversation).
const CHAT_SESSION_HOST = 'chat/ChatSessionHost'

const FORBIDDEN_IMPORTS = [
  'services/chatApi',
  'services/chatSocket',
  'services/notifier',
  'services/pushSubscription',
  'hooks/useProjects',
  'hooks/useTasks',
  'hooks/useGlobalTasks',
  'hooks/useCards',
  'hooks/useColumns',
]

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function importSpecifiers(code) {
  const found = []
  for (const match of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g)) found.push(match[1])
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1])
  return found
}

const endsWithModule = (specifier, entry) => specifier.endsWith(entry) || specifier.includes(`${entry}.`)

// Violations of a (non-test) source file of modules/artifacts.
export function scanArtifactsSource(file, source) {
  const problems = []
  const code = stripComments(source)
  const isOwner = OWNERS.includes(path.basename(file))

  for (const specifier of importSpecifiers(code)) {
    const owned = OWNER_ONLY_IMPORTS.find((entry) => endsWithModule(specifier, entry))
      ?? (endsWithModule(specifier, CHAT_SESSION_HOST) ? CHAT_SESSION_HOST : null)
    if (owned && !isOwner) problems.push(`imports ${owned}, which only the owners may use`)
    if (owned === CHAT_SESSION_HOST && isOwner && path.basename(file) !== 'ArtifactsTab.jsx') problems.push('only the tab takes the chat session')
    const banned = FORBIDDEN_IMPORTS.find((entry) => endsWithModule(specifier, entry))
    if (banned) problems.push(`imports ${banned}`)
  }

  if (/\bfetch\s*\(/.test(code)) problems.push('calls fetch( directly')
  if (/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/.test(code)) problems.push('opens its own connection')
  if (/(?<![\w$.])alert\s*\(|\bwindow\.alert\b/.test(code)) problems.push('uses alert(')
  if (/(?<![\w$.])confirm\s*\(|\bwindow\.confirm\b|(?<![\w$.])prompt\s*\(/.test(code)) problems.push('uses confirm( or prompt(')
  // The tabs of the panel are remembered by hooks/useArtifactTabsStorage.js: the word never appears here.
  if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(code)) problems.push('uses web storage')
  if (/\bnew\s+Notification\b|\bAudioContext\b/.test(code)) problems.push('notifies or plays sound')
  // Nothing in the gallery deletes a file: the only DELETE is the one of removeArtifact (the row, not the file).
  if (/method\s*:\s*['"](?:DELETE|PUT)['"]/i.test(code)) problems.push('writes with its own HTTP method')
  if (/\bdelete(?:File|Path|Artifact)\w*\s*\(/.test(code)) problems.push('deletes a file')
  // Hiding the client from the rules above.
  if (/\{[^}]*\}\s*=\s*api\b/.test(code) || /\b(?:const|let|var)\s+\w+\s*=\s*api\s*(?:[;,\n)]|$)/.test(code)) {
    problems.push('destructures or aliases api')
  }
  // The viewer opens things through viewerState; a component never builds a file URL by hand.
  if (/['"`]\/api\/(?:artifacts|viewer|projects)\b/.test(code)) problems.push('builds an API URL by hand')
  return problems
}

const isTestFile = (name) => /\.test\.(js|jsx)$/.test(name)
// Data and scaffolding of the tests are not the surface (the kit mounts the real tab, owner imports and all).
const IGNORED_DATA = new Set(['artifactFixtures.js', 'artifactTestKit.jsx'])

function listSources(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...listSources(full))
    else if (/\.(js|jsx)$/.test(entry) && !isTestFile(entry) && !IGNORED_DATA.has(entry)) files.push(full)
  }
  return files
}

const SOURCE_FILES = listSources(HERE)

describe('write guard of modules/artifacts', () => {
  it('scans the real source files, the owners included (positive control)', () => {
    const names = SOURCE_FILES.map((file) => path.basename(file))
    expect(names).toEqual(expect.arrayContaining([...OWNERS, 'ArtifactCard.jsx', 'ArtifactGallery.jsx', 'ArtifactMenu.jsx', 'CiteDialog.jsx', 'artifactScope.js', 'citeTargets.js']))
  })

  it.each(SOURCE_FILES.map((file) => [path.relative(HERE, file), file]))('%s respects the owner rule', (_name, file) => {
    expect(scanArtifactsSource(file, readFileSync(file, 'utf8')), file).toEqual([])
  })

  it('the owners really are the ones that use what only they may (the rule has something to guard)', () => {
    const tab = readFileSync(path.join(HERE, 'ArtifactsTab.jsx'), 'utf8')
    expect(tab).toMatch(/hooks\/useArtifacts\.js/)
    expect(tab).toMatch(/services\/api\.js/)
    expect(tab).toMatch(/services\/artifactsApi\.js/)
    expect(readFileSync(path.join(HERE, 'RenameArtifactDialog.jsx'), 'utf8')).toMatch(/services\/artifactsApi\.js/)
    expect(readFileSync(path.join(HERE, 'ImportArtifactsDialog.jsx'), 'utf8')).toMatch(/services\/artifactsApi\.js/)
  })
})

describe('scanArtifactsSource (fixtures prove the detector goes red)', () => {
  const scan = (source, file = 'ArtifactCard.jsx') => scanArtifactsSource(file, source)

  it.each([
    ['the api client outside the owners', "import { api } from '../../../../services/api.js'", /services\/api/],
    ['the artifacts api outside the owners', "import { removeArtifact } from '../../../../services/artifactsApi.js'", /artifactsApi/],
    ['a dynamic import of the artifacts api', "const mod = await import('../../../../services/artifactsApi.js')", /artifactsApi/],
    ['the list hook outside the owners', "import { useArtifacts } from '../../../../hooks/useArtifacts.js'", /useArtifacts/],
    ['the save hook', "import { useSaveToArtifacts } from '../../../../hooks/useSaveToArtifacts.js'", /useSaveToArtifacts/],
    ['a re-export of the artifacts api', "export { removeArtifact } from '../../../../services/artifactsApi.js'", /artifactsApi/],
    ['the chat session outside the owners', "import { useChatSessionContext } from '../chat/ChatSessionHost.jsx'", /ChatSessionHost/],
    ['the chat api', "import { chatApi } from '../../../../services/chatApi.js'", /chatApi/],
    ['the chat socket', "import { connect } from '../../../../services/chatSocket.js'", /chatSocket/],
    ['a direct fetch', "await fetch('/api/artifacts/1', { method: 'POST' })", /fetch\(/],
    ['a socket', "new WebSocket('ws://x')", /own connection/],
    ['alert', "alert('Falhou')", /alert\(/],
    ['window.alert', "window.alert('Falhou')", /alert\(/],
    ['confirm', "if (confirm('Remover?')) remove()", /confirm\(/],
    ['prompt', "const name = prompt('Título')", /prompt\(/],
    ['web storage', "localStorage.setItem('x', '1')", /web storage/],
    ['session storage', "sessionStorage.getItem('x')", /web storage/],
    ['a Notification', "new Notification('x')", /notifies/],
    ['an HTTP DELETE of its own', "const init = { method: 'DELETE' }", /HTTP method/],
    ['a call that deletes a file', 'await deleteFile(path)', /deletes a file/],
    ['an aliased client', "const client = api\nclient.pasteToSession(1)", /aliases/],
    ['a destructured client', "const { pasteToSession } = api", /destructures/],
    ['an API URL built by hand', "const url = `/api/artifacts/${id}/f/${path}`", /URL by hand/],
    ['a writing hook of the V2', "import { useTasks } from '../../../../hooks/useTasks.js'", /useTasks/],
  ])('goes red for %s', (_label, source, expected) => {
    const problems = scan(source)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(expected)
  })

  it('lets the owners import what only they may, and the tab alone the chat session', () => {
    const source = [
      "import { removeArtifact } from '../../../../services/artifactsApi.js'",
      "import { api } from '../../../../services/api.js'",
      "import { useArtifacts } from '../../../../hooks/useArtifacts.js'",
    ].join('\n')
    for (const owner of OWNERS) expect(scan(source, owner)).toEqual([])
    expect(scan(source, 'ArtifactGallery.jsx')).not.toEqual([])
    const session = "import { useChatSessionContext } from '../chat/ChatSessionHost.jsx'"
    expect(scan(session, 'ArtifactsTab.jsx')).toEqual([])
    expect(scan(session, 'RenameArtifactDialog.jsx')).not.toEqual([])
    expect(scan(session, 'ArtifactMenu.jsx')).not.toEqual([])
  })

  it('the owners are still refused alert, fetch and storage', () => {
    expect(scan("alert('x')", 'ArtifactsTab.jsx')).not.toEqual([])
    expect(scan("fetch('/x')", 'ImportArtifactsDialog.jsx')).not.toEqual([])
    expect(scan('localStorage.clear()', 'RenameArtifactDialog.jsx')).not.toEqual([])
  })

  it('does not flag comments, other words or the V3 helpers', () => {
    const source = [
      "import { copyTextToClipboard } from '../../../../utils/clipboard.js'",
      "import { fileUrl } from '../../../../services/viewerApi.js'",
      '// alert(x), fetch(x) and localStorage in a comment are ignored',
      'const rapid = rapi[0]',
      'const confirmed = true',
      'const label = "calert"',
      'toast.push({ text })',
    ].join('\n')
    expect(scan(source)).toEqual([])
  })
})
