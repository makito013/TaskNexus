// Guard of the `position: fixed` invariant for the board, artifacts and viewer surfaces and the
// shared pieces they bring (toast, lazy boundary, narrow notice, modal stack, view context). Same
// technique as fixedPositioningInvariantV3.test.js and fixedPositioningInvariantChat.test.js, which
// are not edited: this one covers what the third track adds.
//
// A property that creates a containing block (transform, filter, will-change, contain, perspective...)
// on an ancestor of fixed content shifts every `position: fixed` descendant. So every file of these
// folders is scanned, and a walk of the folders keeps a file added later from being forgotten: the
// list below is built FROM the folders, not typed by hand.
//
// Named exceptions, each one a leaf, each one with a positive control (the exception must stay true):
//   FIXED_FILES      files that may declare `position: fixed` (the toast region, today)
//   TRANSFORM_FILES  files that may declare a containing-block property (none yet; the drag-and-drop
//                    leaves of the board will be named here when they exist)
// A folder that does not exist yet (viewer, until its phase) is skipped, never silently: the test
// that lists the scanned folders says which ones were found.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORBIDDEN_PROPERTIES, declaredPropertyNames, stripComments } from '../../test/fixedPositioningScan.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const SCANNED_FOLDERS = [
  'modules/board',
  'modules/artifacts',
  'modules/viewer',
  'components/Toast',
  'components/LazyBoundary',
  'components/NarrowNotice',
]
const SCANNED_FILES = ['components/Dialog/modalStack.js', 'ProjectsViewContext.jsx']
// Folders that must exist already in this phase (the others arrive with their phase).
const REQUIRED_FOLDERS = ['modules/board', 'modules/artifacts', 'components/Toast', 'components/LazyBoundary', 'components/NarrowNotice']

export const FIXED_FILES = ['components/Toast/Toast.css']
export const TRANSFORM_FILES = []

const SOURCE = /\.(js|jsx|css)$/
const TEST_FILE = /\.test\.(js|jsx)$/

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (SOURCE.test(entry) && !TEST_FILE.test(entry)) files.push(full)
  }
  return files
}

const relative = (file) => path.relative(HERE, file).split(path.sep).join('/')

const FOUND_FOLDERS = SCANNED_FOLDERS.filter((folder) => existsSync(path.join(HERE, folder)))
// Fixtures of the board tests are data, not styles: they are not a surface.
const IGNORED = new Set(['modules/board/boardFixtures.js'])
const SCANNED = [
  ...FOUND_FOLDERS.flatMap((folder) => walk(path.join(HERE, folder)).map(relative)),
  ...SCANNED_FILES,
].filter((file) => !IGNORED.has(file))

export const offendersIn = (source) =>
  declaredPropertyNames(source).filter((name) => FORBIDDEN_PROPERTIES.has(name))

// `position: fixed` as a CSS declaration, as a style-object entry, or written by script.
export function declaresFixed(source) {
  const code = stripComments(source)
  return /position\s*:\s*['"]?fixed\b/.test(code) || /setProperty\(\s*['"]position['"]\s*,\s*['"]fixed['"]/.test(code)
}

const read = (file) => readFileSync(path.join(HERE, file), 'utf8')

describe('fixed-positioning invariant on the workspace surfaces', () => {
  it('walks the folders it is supposed to walk (positive control)', () => {
    for (const folder of REQUIRED_FOLDERS) expect(FOUND_FOLDERS, folder).toContain(folder)
    expect(SCANNED).toEqual(expect.arrayContaining([
      'modules/board/Board.css',
      'modules/board/BoardTab.jsx',
      'modules/artifacts/ArtifactsTab.jsx',
      'components/Toast/Toast.css',
      'components/Toast/ToastHost.jsx',
      'components/LazyBoundary/LazyBoundary.jsx',
      'components/NarrowNotice/NarrowNotice.jsx',
      'components/Dialog/modalStack.js',
      'ProjectsViewContext.jsx',
    ]))
    for (const file of SCANNED_FILES) expect(existsSync(path.join(HERE, file)), file).toBe(true)
  })

  it.each(SCANNED)('declares no containing-block-creating property in %s', (file) => {
    if (TRANSFORM_FILES.includes(file)) return
    const offenders = offendersIn(read(file))
    expect(
      offenders,
      `${file} declares ${offenders.join(', ')}: it creates a containing block and would shift every `
        + 'position: fixed descendant. Rename the key, animate opacity, or move the effect to a leaf.',
    ).toEqual([])
  })

  it.each(SCANNED)('declares position: fixed only where it is a named exception: %s', (file) => {
    if (FIXED_FILES.includes(file)) return
    expect(declaresFixed(read(file)), `${file} declares position: fixed`).toBe(false)
  })

  it('the named exceptions are not obsolete', () => {
    for (const file of FIXED_FILES) {
      expect(SCANNED, file).toContain(file)
      expect(declaresFixed(read(file)), `${file} no longer declares position: fixed: drop it from FIXED_FILES`).toBe(true)
    }
    for (const file of TRANSFORM_FILES) {
      expect(offendersIn(read(file)).length, `${file} no longer needs its exception`).toBeGreaterThan(0)
    }
  })

  it('goes red for the fixtures it exists to catch', () => {
    expect(offendersIn('.column { transform: translate3d(0, 0, 0); }')).toEqual(['transform'])
    expect(offendersIn('.card { filter: drop-shadow(0 0 1px red); }')).toEqual(['filter'])
    expect(offendersIn('.scroller { contain: layout; }')).toEqual(['contain'])
    expect(offendersIn('.scroller { will-change: transform; }')).toEqual(['will-change'])
    expect(offendersIn('const state = { filter: view }')).toEqual(['filter'])
    expect(offendersIn('const geometry = { scale: 1 }')).toEqual(['scale'])
    expect(declaresFixed('.toast { position: fixed; bottom: 0; }')).toBe(true)
    expect(declaresFixed("const style = { position: 'fixed' }")).toBe(true)
    expect(declaresFixed("root.style.setProperty('position', 'fixed')")).toBe(true)
  })

  it('stays green for what is legitimate', () => {
    expect(offendersIn('.a { transition: opacity 120ms, transform 120ms; }')).toEqual([])
    expect(offendersIn('@keyframes in { from { transform: scale(0.9); } }')).toEqual([])
    expect(offendersIn('.t { text-transform: uppercase; }')).toEqual([])
    expect(declaresFixed('.a { position: absolute; }')).toBe(false)
    expect(declaresFixed('/* position: fixed in a comment */ .a { position: relative; }')).toBe(false)
  })
})
