// The tab is a lazy chunk with its OWN stylesheets (Artifacts.css, ArtifactMenu.css). jsdom applies no CSS, so
// a class borrowed from a stylesheet that only another lazy chunk loads (Board.css belongs to the Board tab)
// passes every behaviour test and shows up unstyled on a fresh load. This reads the sources instead.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(path.join(HERE, name), 'utf8')
const SOURCES = readdirSync(HERE).filter((name) => /\.jsx$/.test(name) && !/\.test\.|artifactTestKit/.test(name))
const STYLES = `${read('Artifacts.css')}\n${read('ArtifactMenu.css')}`

// The classes of this module: the ones its own stylesheets must define.
const OWN = /\bv3-(?:artifact|artifacts|import|cite-list)[a-z0-9_-]*/g

const classesIn = (source) => new Set(source.match(OWN) ?? [])

describe('the stylesheets of the Artefatos tab', () => {
  it('reads the sources it is supposed to read (positive control)', () => {
    expect(SOURCES).toEqual(expect.arrayContaining(['ArtifactsTab.jsx', 'ArtifactCard.jsx', 'ArtifactMenu.jsx', 'ArtifactsControls.jsx', 'ImportArtifactsDialog.jsx', 'CiteDialog.jsx']))
  })

  it('defines every class its components use', () => {
    const missing = []
    for (const name of SOURCES) {
      for (const className of classesIn(read(name))) {
        // `v3-artifact-card--active` style names built by template pieces end in a dash or a dot
        if (className.endsWith('-') || className.endsWith('__')) continue
        if (!STYLES.includes(`.${className}`)) missing.push(`${name}: ${className}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('borrows no class of the Board stylesheet (it only loads with the Board tab)', () => {
    for (const name of SOURCES) expect(read(name), name).not.toMatch(/\bv3-board-/)
  })

  it('imports its own stylesheets: the tab the tab itself and the menu the menu', () => {
    expect(read('ArtifactsTab.jsx')).toMatch(/import '\.\/Artifacts\.css'/)
    expect(read('ArtifactMenu.jsx')).toMatch(/import '\.\/ArtifactMenu\.css'/)
  })

  it('gives the card the iOS long-press protections, for a finger only', () => {
    const block = STYLES.slice(STYLES.indexOf('@media (pointer: coarse) {'))
    expect(block).toMatch(/-webkit-touch-callout:\s*none/)
    expect(block).toMatch(/user-select:\s*none/)
    expect(STYLES.slice(0, STYLES.indexOf('@media (pointer: coarse) {'))).not.toMatch(/-webkit-touch-callout/)
  })

  it('every control of the bar has a 44 px height by token', () => {
    expect(STYLES).toMatch(/\.v3-artifacts-select \{[^}]*height: var\(--v3-control\)/)
    expect(STYLES).toMatch(/\.v3-artifacts-type \{[^}]*min-height: var\(--v3-control\)/)
    expect(STYLES).toMatch(/\.v3-artifact-menu__item \{[^}]*min-height: var\(--v3-control\)/)
    expect(STYLES).toMatch(/\.v3-artifact-card__more \{[^}]*height: var\(--v3-control\)/)
  })

  it('the card is its own stacking context, so the "⋯" (z-index 1) never paints over the viewer drawer', () => {
    // EVERY rule whose selector is the card itself (media blocks included): a later `isolation: auto` would undo the fix
    const rules = [...STYLES.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1].split(',').some((selector) => selector.trim() === '.v3-artifact-card'))
      .map((match) => match[2])
    expect(rules.length).toBeGreaterThan(0)
    const isolations = rules.flatMap((body) => [...body.matchAll(/isolation:\s*([a-z-]+)/g)].map((match) => match[1]))
    expect(isolations.length).toBeGreaterThan(0)
    expect(isolations.every((value) => value === 'isolate')).toBe(true)
    expect(rules.some((body) => /position:\s*relative/.test(body))).toBe(true)
    expect(STYLES).toMatch(/\.v3-artifact-card__more \{[^}]*z-index:\s*1;/)
  })

  it('uses only --v3-* tokens (no V2 variable, no hard-coded colour)', () => {
    expect(STYLES).not.toMatch(/--v2-|--bg-/)
    expect(STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})
