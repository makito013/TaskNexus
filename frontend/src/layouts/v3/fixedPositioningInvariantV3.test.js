// Guard of the `position: fixed` invariant for the v3 layout chain (ADR-07).
//
// Any property in FORBIDDEN_PROPERTIES (transform, filter, will-change, contain, ...)
// declared on an ancestor of fixed content creates a containing block and silently
// shifts every `position: fixed` descendant. The v3 shell has no fixed element yet,
// but the Kan module will bring the terminal panel, so the chain is guarded from
// the start. The scanner and the fixture battery that proves it catches the bad
// cases live in src/test/fixedPositioningScan.js and
// layouts/v2/fixedPositioningInvariant.test.js.
//
// The list is by FILE and named on purpose. Pet/*, Button/* and Chip/* are left out
// deliberately: they are leaves, never ancestors of fixed content, and the pet uses
// SMIL <animateTransform> attributes (which the scanner does not flag) plus config
// objects whose keys could look like style declarations. Inside the files below an
// object key named scale/rotate/translate/filter is forbidden (known false positive:
// rename the key instead of adding an exception).
import { describe, it, expect } from 'vitest'
import {
  FORBIDDEN_PROPERTIES,
  declaredPropertyNames,
  readSourceRelativeTo,
} from '../../test/fixedPositioningScan.js'

const V3_CHAIN_SOURCES = [
  './bootV3.jsx',
  './AppV3.jsx',
  './AppV3.css',
  './theme/base.css',
  './theme/tokens.css',
  './theme/fonts.css',
  './components/Panel/Panel.css',
  './components/Panel/Panel.jsx',
  './components/Island/Island.css',
  './components/Island/Island.jsx',
  './components/ModuleRail/ModuleRail.css',
  './components/ModuleRail/ModuleRail.jsx',
  './components/ComingSoon/ComingSoon.css',
  './components/ComingSoon/ComingSoon.jsx',
  './IslandContext.jsx',
  './theme/prose.css',
  './modules/tasks/TasksScreen.jsx',
  './modules/tasks/TasksScreen.css',
  './modules/tasks/TaskRow.jsx',
  './modules/tasks/TaskDetail.jsx',
  './modules/tasks/SituationFilters.jsx',
]

const offendersIn = (source) =>
  declaredPropertyNames(source).filter((name) => FORBIDDEN_PROPERTIES.has(name))

// Stylesheets imported by the shell files themselves (the components import their own).
function importedStylesheets(source) {
  return [...source.matchAll(/import\s+['"](\.[^'"]+\.css)['"]/g)].map((match) => match[1])
}

describe('fixed-positioning invariant on the v3 chain', () => {
  it.each(V3_CHAIN_SOURCES)('declares no containing-block-creating property in %s', (relativePath) => {
    const offenders = offendersIn(readSourceRelativeTo(import.meta.url, relativePath))
    expect(
      offenders,
      `${relativePath} declares ${offenders.join(', ')}: it creates a containing block and would shift `
        + 'every position: fixed descendant. Animate opacity/box-shadow or move the effect to a leaf.',
    ).toEqual([])
  })

  it('the v3 chain list names every stylesheet imported by the shell', () => {
    const missing = []
    for (const shellFile of ['./AppV3.jsx', './bootV3.jsx']) {
      const source = readSourceRelativeTo(import.meta.url, shellFile)
      for (const stylesheet of importedStylesheets(source)) {
        const listed = V3_CHAIN_SOURCES.includes(stylesheet)
        const isLeaf = /\/components\/(Pet|Button|Chip)\//.test(stylesheet)
        if (!listed && !isLeaf) missing.push(`${shellFile} imports ${stylesheet}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('would flag a forbidden property, a forgotten stylesheet and ignore leaf animation', () => {
    expect(offendersIn('.island { transform: translateY(-4px); }')).toEqual(['transform'])
    expect(offendersIn('.panel { contain: layout; }')).toEqual(['contain'])
    expect(offendersIn('const geometry = { scale: 1 }')).toEqual(['scale'])
    expect(importedStylesheets("import './Island/Island.css'\nimport './theme/base.css'")).toEqual([
      './Island/Island.css',
      './theme/base.css',
    ])
    // Legitimate: keyframes, transition lists and SMIL attributes.
    expect(offendersIn('@keyframes in { from { transform: scale(0.9); } }')).toEqual([])
    expect(offendersIn('.a { transition: opacity 120ms, transform 120ms; }')).toEqual([])
    expect(offendersIn('<animateTransform attributeName="transform" type="translate" />')).toEqual([])
  })
})
