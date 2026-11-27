// The artifact logic the V3 shares with the V2 moved out of features/artifacts/. The old paths keep
// re-exporting it (the V2 sources and its tests import by them), so both paths must hand out the SAME
// function, constant or class, and the stateful modules (the status cache of "save") must exist once.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as modelOld from '../features/artifacts/artifactModel.js'
import * as modelNew from '../utils/artifactModel.js'
import * as apiOld from '../features/artifacts/artifactsApi.js'
import * as apiNew from './artifactsApi.js'
import * as listOld from '../features/artifacts/useArtifacts.js'
import * as listNew from '../hooks/useArtifacts.js'
import * as saveOld from '../features/artifacts/useSaveToArtifacts.js'
import * as saveNew from '../hooks/useSaveToArtifacts.js'
import * as storageOld from '../features/artifacts/useArtifactTabsStorage.js'
import * as storageNew from '../hooks/useArtifactTabsStorage.js'
import { ViewerProvider, useViewer } from '../hooks/viewerState.jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

const PAIRS = [
  ['artifactModel', modelOld, modelNew],
  ['artifactsApi', apiOld, apiNew],
  ['useArtifacts', listOld, listNew],
  ['useSaveToArtifacts', saveOld, saveNew],
  ['useArtifactTabsStorage', storageOld, storageNew],
]

const OLD_FILES = ['artifactModel.js', 'artifactsApi.js', 'useArtifacts.js', 'useSaveToArtifacts.js', 'useArtifactTabsStorage.js']

describe('artifact extraction by the old and the new path', () => {
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
      const code = readFileSync(path.join(SRC, 'features/artifacts', file), 'utf8')
      const lines = code.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('//'))
      expect(lines, file).toHaveLength(1)
      expect(lines[0], file).toMatch(/^export \* from '\.\.\/\.\.\/(services|hooks|utils)\/[A-Za-z]+\.jsx?';?$/)
    }
  })

  it('the five modules live where the architecture put them', () => {
    for (const file of ['utils/artifactModel.js', 'services/artifactsApi.js', 'hooks/useArtifacts.js', 'hooks/useSaveToArtifacts.js', 'hooks/useArtifactTabsStorage.js']) {
      const code = readFileSync(path.join(SRC, file), 'utf8')
      expect(code.split('\n').length, file).toBeGreaterThan(20)
    }
  })
})

describe('one cache, one storage key', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    saveNew.clearArtifactStatusCache()
    window.sessionStorage.clear()
  })

  it('the status cache of "save" is shared by both paths and cleared by either', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ artifacts: [{ artifact_id: 'a1', project_id: 'P', path: 'docs/a.md' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const item = { source: 'viewer', project_id: 'P', path: 'docs/b.md' }

    const first = renderHook(() => saveOld.useSaveToArtifacts(item))
    await waitFor(() => expect(first.result.current.status).toBe('available'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = renderHook(() => saveNew.useSaveToArtifacts(item))
    await waitFor(() => expect(second.result.current.status).toBe('available'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    saveOld.clearArtifactStatusCache()
    const third = renderHook(() => saveNew.useSaveToArtifacts(item))
    await waitFor(() => expect(third.result.current.status).toBe('available'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the tab storage written by one path is restored by the other', () => {
    storageOld.writeStoredTabs([{ id: 'x', source: 'artifact', artifact_id: 'a1', path: 'a.md' }], 'a1')
    expect(storageNew.readStoredTabs()).toEqual({ items: [{ artifact_id: 'a1', path: 'a.md' }], activeId: 'a1' })
    expect(storageNew.ARTIFACT_TABS_KEY).toBe('escritorio::artefatos_viewer_tabs')
  })

  it('the restoring hook fills the artifacts scope from storage and never opens the panel', () => {
    storageOld.writeStoredTabs([{ id: 'x', source: 'artifact', artifact_id: 'a1', path: 'a.md', title: 'A', kind: 'markdown' }], 'a1')
    const wrapper = ({ children }) => createElement(ViewerProvider, null, children)
    const { result } = renderHook(() => {
      const viewer = useViewer()
      storageNew.useArtifactTabsStorage(viewer)
      return viewer
    }, { wrapper })
    expect(result.current.getScope(modelNew.SCOPE_ARTEFATOS).items.map((item) => item.path)).toEqual(['a.md'])
    expect(result.current.getSurface(modelNew.SCOPE_ARTEFATOS).open).toBe(false)
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

describe('import discipline of the artifact extraction', () => {
  const NEW_PATHS = /(utils\/artifactModel|services\/artifactsApi|hooks\/useArtifacts|hooks\/useSaveToArtifacts|hooks\/useArtifactTabsStorage)(\.jsx?)?['"]/

  it('no V2 source imports the new paths (the old ones stay the entry), except the re-export files', () => {
    const bridges = new Set(OLD_FILES.map((file) => path.join('features', 'artifacts', file)))
    const offenders = []
    for (const root of ['features', 'components', 'layouts/v2', 'views']) {
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

  it('no extracted module imports the V3, the old feature folder or the syntax highlighter', () => {
    for (const file of ['utils/artifactModel.js', 'services/artifactsApi.js', 'hooks/useArtifacts.js', 'hooks/useSaveToArtifacts.js', 'hooks/useArtifactTabsStorage.js']) {
      const code = readFileSync(path.join(SRC, file), 'utf8')
      expect(code, file).not.toMatch(/layouts\/v3|features\/|syntaxHighlight/)
    }
  })

  it('control: the pattern does catch a new-path import', () => {
    expect(NEW_PATHS.test("import x from '../../utils/artifactModel.js'")).toBe(true)
    expect(NEW_PATHS.test("import x from './artifactModel.js'")).toBe(false)
  })
})
