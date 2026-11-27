// The viewer logic the V3 shares with the V2 moved out of features/viewer/. The old paths keep
// re-exporting it (the V2 sources and its tests import by them, and five of them vi.mock
// features/viewer/highlight.js), so both paths must hand out the SAME function, constant, class or
// context, and the stateful modules must exist once.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as apiOld from '../features/viewer/viewerApi.js'
import * as apiNew from './viewerApi.js'
import * as pathsOld from '../features/viewer/viewerPaths.js'
import * as pathsNew from '../utils/viewerPaths.js'
import * as stateOld from '../features/viewer/ViewerContext.jsx'
import * as stateNew from '../hooks/viewerState.jsx'
import * as contentOld from '../features/viewer/useViewerContent.js'
import * as contentNew from '../hooks/useViewerContent.js'
import * as dockOld from '../features/viewer/useDockWidth.js'
import * as dockNew from '../hooks/useDockWidth.js'
import * as highlightOld from '../features/viewer/highlight.js'
import * as highlightNew from '../utils/syntaxHighlight.js'
import * as linksOld from '../features/viewer/terminalLinks.js'
import * as linksNew from '../utils/filePathLinks.js'
import * as escapeOld from '../features/viewer/escape.js'
import * as escapeNew from '../utils/plainEscape.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

const PAIRS = [
  ['viewerApi', apiOld, apiNew],
  ['viewerPaths', pathsOld, pathsNew],
  ['ViewerContext', stateOld, stateNew],
  ['useViewerContent', contentOld, contentNew],
  ['useDockWidth', dockOld, dockNew],
  ['highlight', highlightOld, highlightNew],
  ['terminalLinks', linksOld, linksNew],
  ['escape', escapeOld, escapeNew],
]

const OLD_FILES = [
  'viewerApi.js', 'viewerPaths.js', 'ViewerContext.jsx', 'useViewerContent.js',
  'useDockWidth.js', 'highlight.js', 'terminalLinks.js', 'escape.js',
]

describe('extraction by the old and the new path', () => {
  for (const [name, oldModule, newModule] of PAIRS) {
    it(`${name}: same export names and the same values`, () => {
      const names = Object.keys(newModule).sort()
      expect(names.length).toBeGreaterThan(0)
      expect(Object.keys(oldModule).sort()).toEqual(names)
      for (const key of names) expect(oldModule[key], key).toBe(newModule[key])
    })
  }

  it('the old files only re-export (no logic stays behind)', () => {
    for (const file of OLD_FILES) {
      const code = readFileSync(path.join(SRC, 'features/viewer', file), 'utf8')
      const lines = code.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'))
      expect(lines, file).toHaveLength(1)
      expect(lines[0], file).toMatch(/^export \* from '\.\.\/\.\.\/(services|hooks|utils)\/[A-Za-z]+\.jsx?';?$/)
    }
  })
})

describe('one state, one cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    contentNew.clearViewerContentCache()
  })

  it('a provider mounted by the old path feeds a consumer imported by the new one', () => {
    const wrapper = ({ children }) => createElement(stateOld.ViewerProvider, null, children)
    const { result } = renderHook(() => stateNew.useViewer(), { wrapper })
    expect(result.current).not.toBeNull()
    expect(result.current.artifactsSignal).toBe(0)
    expect(renderHook(() => stateNew.useViewer()).result.current).toBeNull()
  })

  it('the content cache is shared by both paths and cleared by either', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ kind: 'text', content: 'hello' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const item = apiNew.normalizeItem({ id: 7, path: 'docs/a.md', title: 'a.md' })

    const first = renderHook(() => contentOld.useViewerContent(item))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = renderHook(() => contentNew.useViewerContent(item))
    expect(second.result.current.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    contentOld.clearViewerContentCache()
    const third = renderHook(() => contentNew.useViewerContent(item))
    await waitFor(() => expect(third.result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function sourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (/\.(js|jsx)$/.test(entry) && !/\.test\./.test(entry)) found.push(full)
  }
  return found
}

describe('import discipline of the extraction', () => {
  const NEW_PATHS = /(services\/viewerApi|utils\/viewerPaths|hooks\/viewerState|hooks\/useViewerContent|hooks\/useDockWidth|utils\/syntaxHighlight|utils\/filePathLinks|utils\/plainEscape)(\.jsx?)?['"]/

  it('no V2 source imports the new paths (the old ones stay the entry), except the re-export files', () => {
    const bridges = new Set()
    for (const file of OLD_FILES) bridges.add(path.join('features', 'viewer', file))
    const roots = ['features', 'components', 'layouts/v2', 'views']
    const offenders = []
    for (const root of roots) {
      let files = []
      try { files = sourceFiles(path.join(SRC, root)) } catch { continue }
      for (const file of files) {
        const relative = path.relative(SRC, file)
        if (bridges.has(relative)) continue
        if (NEW_PATHS.test(readFileSync(file, 'utf8'))) offenders.push(relative)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no extracted module imports utils/syntaxHighlight (it would escape the vi.mock of the old path)', () => {
    const extracted = [
      'services/viewerApi.js', 'utils/viewerPaths.js', 'hooks/viewerState.jsx',
      'hooks/useViewerContent.js', 'hooks/useDockWidth.js', 'utils/filePathLinks.js', 'utils/plainEscape.js',
    ]
    for (const file of extracted) {
      expect(readFileSync(path.join(SRC, file), 'utf8'), file).not.toMatch(/syntaxHighlight/)
    }
  })

  it('control: the pattern does catch a new-path import', () => {
    expect(NEW_PATHS.test("import x from '../../services/viewerApi.js'")).toBe(true)
    expect(NEW_PATHS.test("import x from './viewerApi.js'")).toBe(false)
  })
})
