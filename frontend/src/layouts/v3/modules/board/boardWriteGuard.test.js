// Guard of the writes of the V3 board (ADR-63). The Projetos screen proves "read only" by reading its own
// sources (readOnlyGuard.test.js); the board is the surface that WRITES, so its rule is by owner instead:
// the shared board hooks (useCards, useColumns) and the api client may be imported ONLY by useBoardData.js.
// Every other file of the folder renders what that hook hands out and calls what it hands out, nothing else.
//
// The scanner is exported and a fixture battery proves it goes red (a source-reading test that never
// fails proves nothing). It reads comments out first, so a word in a comment never counts.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const OWNER = 'useBoardData.js'

const OWNER_ONLY_IMPORTS = ['hooks/useCards', 'hooks/useColumns', 'services/api']
// The drag library stays in the files that make the board draggable.
export const DND_FILES = ['BoardTab.jsx', 'BoardColumn.jsx', 'BoardOverlay.jsx', 'SortableCard.jsx', 'SortableColumn.jsx']

const FORBIDDEN_IMPORTS = [
  'services/notifier',
  'services/pushSubscription',
  'hooks/useProjects',
  'hooks/useTasks',
  'hooks/useGlobalTasks',
  'hooks/useAgentSettings',
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

// Violations of a (non-test) source file of modules/board.
export function scanBoardSource(file, source) {
  const problems = []
  const code = stripComments(source)
  const isOwner = path.basename(file) === OWNER

  for (const specifier of importSpecifiers(code)) {
    const owned = OWNER_ONLY_IMPORTS.find((entry) => endsWithModule(specifier, entry))
    if (owned && !isOwner) problems.push(`imports ${owned}, which only ${OWNER} may use`)
    const banned = FORBIDDEN_IMPORTS.find((entry) => endsWithModule(specifier, entry))
    if (banned) problems.push(`imports ${banned}`)
  }

  const usesDnd = importSpecifiers(code).some((specifier) => specifier.startsWith('@dnd-kit/'))
  if (usesDnd && !DND_FILES.includes(path.basename(file))) problems.push('imports @dnd-kit outside the drag files')

  if (/\bfetch\s*\(/.test(code)) problems.push('calls fetch( directly')
  if (/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/.test(code)) problems.push('opens its own connection')
  if (/(?<![\w$.])alert\s*\(|\bwindow\.alert\b/.test(code)) problems.push('uses alert(')
  if (/(?<![\w$.])confirm\s*\(|\bwindow\.confirm\b|(?<![\w$.])prompt\s*\(/.test(code)) problems.push('uses confirm( or prompt(')
  // The remembered view is written by utils/boardView.js: the word never appears here.
  if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(code)) problems.push('uses web storage')
  if (/\bnew\s+Notification\b|\bAudioContext\b/.test(code)) problems.push('notifies or plays sound')
  // Hiding the client from the rules above.
  if (/\{[^}]*\}\s*=\s*api\b/.test(code) || /\b(?:const|let|var)\s+\w+\s*=\s*api\s*(?:[;,\n)]|$)/.test(code)) {
    problems.push('destructures or aliases api')
  }
  return problems
}

const isTestFile = (name) => /\.test\.(js|jsx)$/.test(name)
const IGNORED_DATA = new Set(['boardFixtures.js'])

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

describe('write guard of modules/board', () => {
  it('scans the real source files, the owner included (positive control)', () => {
    const names = SOURCE_FILES.map((file) => path.basename(file))
    expect(names).toEqual(expect.arrayContaining([OWNER, 'BoardTab.jsx', 'BoardColumn.jsx', 'BoardCardFace.jsx', 'boardScope.js']))
  })

  it.each(SOURCE_FILES.map((file) => [path.relative(HERE, file), file]))('%s respects the owner rule', (_name, file) => {
    expect(scanBoardSource(file, readFileSync(file, 'utf8')), file).toEqual([])
  })

  it('the owner really is the one that uses the shared hooks (the rule has something to guard)', () => {
    const source = readFileSync(path.join(HERE, OWNER), 'utf8')
    expect(source).toMatch(/hooks\/useCards\.js/)
    expect(source).toMatch(/hooks\/useColumns\.js/)
  })
})

describe('scanBoardSource (fixtures prove the detector goes red)', () => {
  const scan = (source, file = 'BoardColumn.jsx') => scanBoardSource(file, source)

  it.each([
    ['the cards hook outside the owner', "import { useCards } from '../../../../hooks/useCards.js'", /useCards/],
    ['the columns hook outside the owner', "import { useColumns } from '../../../../hooks/useColumns'", /useColumns/],
    ['the api client outside the owner', "import { api } from '../../../../services/api.js'", /services\/api/],
    ['a dynamic import of the api client', "const mod = await import('../../../../services/api.js')", /services\/api/],
    ['a re-export of the cards hook', "export { useCards } from '../../../../hooks/useCards.js'", /useCards/],
    ['a direct fetch', "await fetch('/api/cards', { method: 'POST' })", /fetch\(/],
    ['a socket', "new WebSocket('ws://x')", /own connection/],
    ['alert', "alert('Falhou')", /alert\(/],
    ['window.alert', "window.alert('Falhou')", /alert\(/],
    ['confirm', "if (confirm('Excluir?')) remove()", /confirm\(/],
    ['web storage', "localStorage.setItem('x', '1')", /web storage/],
    ['session storage', "sessionStorage.getItem('x')", /web storage/],
    ['a Notification', "new Notification('x')", /notifies/],
    ['an aliased client', "const client = api\nclient.moveCard(1)", /aliases/],
    ['a destructured client', "const { moveCard } = api", /destructures/],
    ['a writing hook of the V2', "import { useTasks } from '../../../../hooks/useTasks.js'", /useTasks/],
  ])('goes red for %s', (_label, source, expected) => {
    const problems = scan(source)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(expected)
  })

  it('lets the drag files import the drag library and nobody else', () => {
    const source = "import { DndContext } from '@dnd-kit/core'"
    for (const file of DND_FILES) expect(scan(source, file)).toEqual([])
    expect(scan(source, 'MoveSelect.jsx')).not.toEqual([])
    expect(scan(source, OWNER)).not.toEqual([])
  })

  it('the drag files listed are real files of the folder (the list has something to guard)', () => {
    const names = SOURCE_FILES.map((file) => path.basename(file))
    for (const file of DND_FILES) expect(names).toContain(file)
  })

  it('lets the owner import what only the owner may', () => {
    const source = [
      "import { useCards } from '../../../../hooks/useCards.js'",
      "import { useColumns } from '../../../../hooks/useColumns.js'",
    ].join('\n')
    expect(scan(source, OWNER)).toEqual([])
    expect(scan(source, 'BoardTab.jsx')).not.toEqual([])
  })

  it('the owner is still refused alert, fetch and storage', () => {
    expect(scan("alert('x')", OWNER)).not.toEqual([])
    expect(scan("fetch('/x')", OWNER)).not.toEqual([])
    expect(scan("localStorage.clear()", OWNER)).not.toEqual([])
  })

  it('does not flag comments, other words or the V3 helpers', () => {
    const source = [
      "import { readBoardView, writeBoardView } from '../../../../utils/boardView.js'",
      "import { copyTextToClipboard } from '../../../../utils/clipboard.js'",
      '// alert(x) and localStorage in a comment are ignored',
      'const rapid = rapi[0]',
      'const confirmed = true',
      'const label = "calert"',
      'toast.push({ text })',
    ].join('\n')
    expect(scan(source)).toEqual([])
  })
})
