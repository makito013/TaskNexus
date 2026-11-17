// Guard of the `position: fixed` invariant for the chat chain (ADR-07, ADR-50, V4-17), the same
// technique as fixedPositioningInvariantV3.test.js (that file is not edited: its list stays the shell's).
//
// The chat is a screen of the v3 shell: a property that creates a containing block (transform, filter,
// will-change, contain, perspective...) on an ancestor of fixed content shifts every `position: fixed`
// descendant. So every file of the chat is scanned. The ONLY exception is ChatLeaf.css: the parts that
// rotate or slide (chevron, spinners, the thumb of a switch) live there, and only leaf components import
// it (ToolChip, StatusBanner, ConnectorsDialog); no container does.
//
// The list is by file and named on purpose, and a completeness test walks the folders of the chat so a
// file added later cannot be forgotten (it fails until the file is listed). The chat declares no
// `position: fixed` of its own: menus, the "/" menu and the strips are `position: absolute` in the
// panel; sheets and dialogs are <dialog> in the top layer.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FORBIDDEN_PROPERTIES,
  declaredPropertyNames,
  readSourceRelativeTo,
  stripComments,
} from '../../test/fixedPositioningScan.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const CHAT_CHAIN_SOURCES = [
  './components/ApprovalCard/ApprovalCard.jsx',
  './components/ApprovalCard/ApprovalCard.css',
  './modules/chat/ChatScreen.jsx',
  './modules/chat/ChatScreen.css',
  './modules/chat/ChatList.jsx',
  './modules/chat/ChatHeader.jsx',
  './modules/chat/MessageList.jsx',
  './modules/chat/bubbles/UserBubble.jsx',
  './modules/chat/bubbles/AgentBubble.jsx',
  './modules/chat/bubbles/SystemRow.jsx',
  './modules/chat/bubbles/ToolChip.jsx',
  './modules/chat/StatusBanner.jsx',
  './modules/chat/PendingStrip.jsx',
  './modules/chat/Composer.jsx',
  './modules/chat/SlashMenu.jsx',
  './modules/chat/cards/CardParts.jsx',
  './modules/chat/cards/QuestionCard.jsx',
  './modules/chat/cards/PlanCard.jsx',
  './modules/chat/cards/ModelCard.jsx',
  './modules/chat/PermissionCard.jsx',
  './modules/chat/ConnectorsDialog.jsx',
  './modules/chat/SwitchEngineDialog.jsx',
  './modules/chat/NewChatDialog.jsx',
  './modules/chat/EndChatDialog.jsx',
  './modules/chat/ActionMenu.jsx',
  './modules/chat/RenameField.jsx',
  './modules/chat/MarkdownBody.jsx',
  './modules/chat/chatMarkdown.js',
  './modules/chat/highlightCode.js',
  './modules/chat/chatLabels.js',
  './modules/chat/slashCommands.js',
  './modules/chat/useChatCommands.js',
  './modules/chat/useChatListActions.js',
  './modules/chat/useFirstMessages.js',
  './modules/chat/useProjectName.js',
  './modules/chat/useChatSession.js',
  './modules/chat/ChatSessionHost.jsx',
  './sessions/ProjectsSessionsProvider.jsx',
  './sessions/useProjectsSessions.js',
  './sessions/sessionsPoll.js',
]

// Outside the chain by design (see the header).
export const CHAT_LEAF_STYLESHEET = './modules/chat/ChatLeaf.css'
export const LEAF_IMPORTERS = [
  './modules/chat/bubbles/ToolChip.jsx',
  './modules/chat/StatusBanner.jsx',
  './modules/chat/ConnectorsDialog.jsx',
]
// Test scaffold with no production code (the name does not match the suite pattern).
const SCAFFOLD = ['./modules/chat/chatTestKit.js']

const CHAT_FOLDERS = ['./modules/chat', './sessions', './components/ApprovalCard']
const isTest = (name) => /\.test\.(js|jsx)$/.test(name)
const isSource = (name) => /\.(js|jsx|css)$/.test(name) && !isTest(name)

function walk(folder) {
  const found = []
  for (const entry of readdirSync(path.join(HERE, folder), { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walk(`${folder}/${entry.name}`))
    else if (isSource(entry.name)) found.push(`${folder}/${entry.name}`)
  }
  return found
}

export const offendersIn = (source) =>
  declaredPropertyNames(source).filter((name) => FORBIDDEN_PROPERTIES.has(name))

export const declaresFixed = (source) => /position\s*:\s*['"`]?fixed\b/.test(stripComments(source))

// Files of the chat folders that are neither listed, nor the leaf stylesheet, nor scaffold.
export function unlistedFiles(listed, onDisk) {
  return onDisk.filter((file) => !listed.includes(file) && file !== CHAT_LEAF_STYLESHEET && !SCAFFOLD.includes(file))
}

export function importedStylesheets(source) {
  return [...source.matchAll(/import\s+['"](\.[^'"]+\.css)['"]/g)].map((match) => match[1])
}

const resolveFrom = (importer, specifier) =>
  `./${path.posix.normalize(path.posix.join(path.posix.dirname(importer.slice(2)), specifier))}`

describe('fixed-positioning invariant on the chat chain', () => {
  it.each(CHAT_CHAIN_SOURCES)('declares no containing-block-creating property and no position: fixed in %s', (relativePath) => {
    const source = readSourceRelativeTo(import.meta.url, relativePath)
    const offenders = offendersIn(source)
    expect(
      offenders,
      `${relativePath} declares ${offenders.join(', ')}: it creates a containing block and would shift `
        + 'every position: fixed descendant. Put a rotation or slide in ChatLeaf.css, or animate opacity.',
    ).toEqual([])
    expect(declaresFixed(source), `${relativePath} declares position: fixed`).toBe(false)
  })

  it('the list names every file of the chat folders (positive control: the walk finds the known ones)', () => {
    const onDisk = CHAT_FOLDERS.flatMap(walk)
    expect(onDisk).toEqual(expect.arrayContaining([
      './modules/chat/ChatScreen.jsx', './modules/chat/cards/ModelCard.jsx', './sessions/ProjectsSessionsProvider.jsx',
      './components/ApprovalCard/ApprovalCard.css', CHAT_LEAF_STYLESHEET,
    ]))
    expect(unlistedFiles(CHAT_CHAIN_SOURCES, onDisk)).toEqual([])
  })

  it('every listed file exists', () => {
    for (const file of CHAT_CHAIN_SOURCES) {
      expect(() => readFileSync(path.join(HERE, file), 'utf8'), file).not.toThrow()
    }
  })

  it('every stylesheet a listed file imports is listed, or is ChatLeaf.css', () => {
    const missing = []
    for (const file of CHAT_CHAIN_SOURCES.filter((name) => /\.(jsx|js)$/.test(name))) {
      for (const stylesheet of importedStylesheets(readSourceRelativeTo(import.meta.url, file))) {
        const resolved = resolveFrom(file, stylesheet)
        if (resolved !== CHAT_LEAF_STYLESHEET && !CHAT_CHAIN_SOURCES.includes(resolved)) missing.push(`${file} imports ${stylesheet}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('ChatLeaf.css is imported only by the leaf components and holds the rotations', () => {
    const importers = CHAT_FOLDERS.flatMap(walk)
      .filter((file) => /\.(jsx|js)$/.test(file))
      .filter((file) => importedStylesheets(readSourceRelativeTo(import.meta.url, file)).some((s) => resolveFrom(file, s) === CHAT_LEAF_STYLESHEET))
    expect(importers.sort()).toEqual([...LEAF_IMPORTERS].sort())
    expect(offendersIn(readSourceRelativeTo(import.meta.url, CHAT_LEAF_STYLESHEET))).toContain('transform')
  })

  it('the shell does not import any chat stylesheet itself (the screen does)', () => {
    for (const shellFile of ['./AppV3.jsx', './bootV3.jsx']) {
      const stylesheets = importedStylesheets(readSourceRelativeTo(import.meta.url, shellFile))
      expect(stylesheets.filter((s) => /modules\/chat|ApprovalCard/.test(s)), shellFile).toEqual([])
    }
  })
})

describe('the detectors go red (fixtures)', () => {
  it('flags a forbidden property in CSS and in a style object of a component', () => {
    expect(offendersIn('.thread { transform: translateY(2px); }')).toEqual(['transform'])
    expect(offendersIn('.thread { will-change: scroll-position; }')).toEqual(['will-change'])
    expect(offendersIn('.panel { contain: layout; }')).toEqual(['contain'])
    expect(offendersIn('.panel { backdrop-filter: blur(2px); }')).toEqual(['backdrop-filter'])
    expect(offendersIn("const style = { transform: 'rotate(3deg)' }")).toEqual(['transform'])
  })

  it('does not flag keyframes, transition lists or comments', () => {
    expect(offendersIn('@keyframes spin { to { transform: rotate(360deg); } }')).toEqual([])
    expect(offendersIn('.a { transition: opacity 120ms, transform 120ms; }')).toEqual([])
    expect(offendersIn('/* transform: none; */ .a { color: red; }')).toEqual([])
  })

  it('flags position: fixed in CSS and in inline styles, and ignores comments and absolute', () => {
    expect(declaresFixed('.menu { position: fixed; inset: 0; }')).toBe(true)
    expect(declaresFixed("const s = { position: 'fixed' }")).toBe(true)
    expect(declaresFixed('.menu { position: absolute; }')).toBe(false)
    expect(declaresFixed('/* position: fixed was removed */ .a { color: red; }')).toBe(false)
  })

  it('the completeness check names a file that is missing from the list', () => {
    const onDisk = ['./modules/chat/ChatScreen.jsx', './modules/chat/NewPanel.jsx', CHAT_LEAF_STYLESHEET, './modules/chat/chatTestKit.js']
    expect(unlistedFiles(['./modules/chat/ChatScreen.jsx'], onDisk)).toEqual(['./modules/chat/NewPanel.jsx'])
  })

  it('finds a stylesheet import, including a nested path', () => {
    expect(importedStylesheets("import './ChatScreen.css'\nimport '../x/y.css'")).toEqual(['./ChatScreen.css', '../x/y.css'])
    expect(resolveFrom('./modules/chat/cards/CardParts.jsx', '../../../components/ApprovalCard/ApprovalCard.css'))
      .toBe('./components/ApprovalCard/ApprovalCard.css')
  })
})
