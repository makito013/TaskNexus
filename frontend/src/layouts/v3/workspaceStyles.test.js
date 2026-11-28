// CV-31 (05, section 0.1): the stylesheets the third track added stay on the V3 tokens. No colour,
// radius, shadow or space outside `--v3-*`, no V2 variable, no token that does not exist. jsdom applies no CSS,
// so this reads the sources (the same technique as the other *.css.test.js guards of the V3).
//
// Two sets of files, because the rules are not the same for what predates the track:
//   NEW_FOLDERS    every stylesheet under them gets ALL the rules (they are the track's own);
//   SHARED_FILES   Dialog.css and ProjectsScreen.css keep their pre-existing structural literals, so they
//                  only get the colour, V2-variable and undefined-token rules.
// The folders are walked, not typed by hand: a stylesheet added later is checked without anyone remembering it.
//
// What each rule means:
//   colour     no #hex, rgb()/hsl() or named colour on a colour property
//   v2         no `--v2-*` and no `--bg-*` (the V2 design system must not leak into the V3)
//   token      every `var(--v3-x)` is defined in theme/tokens.css, in the same sheet, or is one of the custom
//              properties a component writes inline (DYNAMIC_PROPERTIES)
//   radius     only `var(--v3-radius-*)`, 0, 50% or inherit
//   shadow     `none`, or built from a token (the focus ring `0 0 0 1px var(--v3-x)` included)
//   space      padding/margin/gap: a literal px above 2 is refused (hairlines and border compensation of 1 or 2 px
//              are structural); a value derived from a token (`calc(var(--v3-space-3) + 2px)`) is fine
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const NEW_FOLDERS = [
  'modules/board',
  'modules/artifacts',
  'modules/viewer',
  'components/Toast',
  'components/LazyBoundary',
  'components/NarrowNotice',
]
const SHARED_FILES = ['components/Dialog/Dialog.css', 'modules/projects/ProjectsScreen.css']
// Custom properties that a component writes in an inline style (so no stylesheet declares them).
export const DYNAMIC_PROPERTIES = ['--v3-viewer-dock-width']

const COLOUR_PROPERTIES = /^(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration-color)$/
const NAMED_COLOURS = /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|cyan|magenta)\b/i

export const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '')

const declarations = (css) => [...css.matchAll(/(?:^|[;{}\s])([a-z-]+|--[a-z0-9-]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((match) => [match[1], match[2].trim()])

// The value without the calc() expressions that are derived from a token (balanced, so nested parentheses count).
function withoutDerived(value) {
  let out = ''
  let index = 0
  while (index < value.length) {
    const start = value.indexOf('calc(', index)
    if (start === -1) {
      out += value.slice(index)
      break
    }
    out += value.slice(index, start)
    let depth = 0
    let end = start + 4
    for (; end < value.length; end += 1) {
      if (value[end] === '(') depth += 1
      else if (value[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const expression = value.slice(start, end + 1)
    if (!expression.includes('var(')) out += expression
    index = end + 1
  }
  return out
}

const definedIn = (css) => new Set([...css.matchAll(/(--v3-[a-z0-9-]+)\s*:/g)].map((match) => match[1]))

const TOKENS = definedIn(readFileSync(path.join(HERE, 'theme/tokens.css'), 'utf8'))

// Problems of one stylesheet. `strict` = the rules of the track's own folders.
export function scanStyle(source, { strict = true, tokens = TOKENS } = {}) {
  const css = stripComments(source)
  const problems = []
  const known = new Set([...tokens, ...definedIn(css), ...DYNAMIC_PROPERTIES])

  for (const match of css.matchAll(/var\(\s*(--v3-[a-z0-9-]+)/g)) {
    if (!known.has(match[1])) problems.push(`token ${match[1]} is not defined`)
  }
  if (/--v2-|--bg-/.test(css)) problems.push('uses a V2 variable (--v2-* or --bg-*)')

  for (const [property, value] of declarations(css)) {
    const withoutVars = value.replace(/var\([^)]*\)/g, '')
    if (COLOUR_PROPERTIES.test(property)) {
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bcolor-mix\(\s*in\s+\w+\s*,\s*#/i.test(value) || NAMED_COLOURS.test(withoutVars)) {
        problems.push(`${property}: ${value} is a colour outside the tokens`)
      }
    } else if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(value)) {
      problems.push(`${property}: ${value} carries a colour literal`)
    }
    if (!strict) continue

    if (/^border(?:-[a-z]+)*-radius$/.test(property)) {
      const ok = /^(?:0|50%|inherit|var\(--v3-radius-[a-z0-9-]+\))(?:\s+(?:0|50%|inherit|var\(--v3-radius-[a-z0-9-]+\)))*$/.test(value)
      if (!ok) problems.push(`${property}: ${value} is a radius outside the tokens`)
    }
    if (property === 'box-shadow' && value !== 'none' && !value.includes('var(--v3-')) {
      problems.push(`box-shadow: ${value} is a shadow outside the tokens`)
    }
    if (/^(?:padding|margin)(?:-[a-z]+)?$|^(?:row-|column-)?gap$/.test(property)) {
      // what is derived from a token (calc with a var) or from the platform (env) is not a literal
      const literal = withoutDerived(value).replace(/env\([^)]*\)/g, '').replace(/var\([^)]*\)/g, '')
      for (const px of literal.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        if (Math.abs(Number(px[1])) > 2) problems.push(`${property}: ${value} has a literal space of ${px[0]}`)
      }
    }
  }
  return problems
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.css')) files.push(full)
  }
  return files
}

const relative = (file) => path.relative(HERE, file).split(path.sep).join('/')
const OWN_SHEETS = NEW_FOLDERS.filter((folder) => existsSync(path.join(HERE, folder))).flatMap((folder) => walk(path.join(HERE, folder)))
const SHARED_SHEETS = SHARED_FILES.map((file) => path.join(HERE, file))

describe('the stylesheets of the third track (CV-31)', () => {
  it('walks the stylesheets it is supposed to guard (positive control)', () => {
    const names = OWN_SHEETS.map(relative)
    expect(names).toEqual(expect.arrayContaining([
      'modules/board/Board.css',
      'modules/board/CardDialog.css',
      'modules/artifacts/Artifacts.css',
      'modules/artifacts/ArtifactMenu.css',
      'modules/viewer/Viewer.css',
      'modules/viewer/renderers/renderers.css',
      'components/Toast/Toast.css',
    ]))
    for (const file of SHARED_SHEETS) expect(existsSync(file), file).toBe(true)
  })

  it.each(OWN_SHEETS.map((file) => [relative(file), file]))('%s uses only V3 tokens (colour, radius, shadow, space)', (_name, file) => {
    expect(scanStyle(readFileSync(file, 'utf8'), { strict: true }), file).toEqual([])
  })

  it.each(SHARED_SHEETS.map((file) => [relative(file), file]))('%s keeps to V3 colours and variables', (_name, file) => {
    expect(scanStyle(readFileSync(file, 'utf8'), { strict: false }), file).toEqual([])
  })

  it('the token list it checks against is the real one (positive control)', () => {
    expect(TOKENS.has('--v3-space-3')).toBe(true)
    expect(TOKENS.has('--v3-radius-lg')).toBe(true)
    expect(TOKENS.has('--v3-kan')).toBe(true)
    expect(TOKENS.size).toBeGreaterThan(100)
  })
})

describe('scanStyle (fixtures prove the detector goes red)', () => {
  const scan = (css, options) => scanStyle(css, options)

  it.each([
    ['a hex colour', '.a { color: #fff; }', /colour/],
    ['a short hex in a background', '.a { background: #0a0; }', /colour/],
    ['an rgb colour', '.a { border: 1px solid rgb(0 0 0); }', /colour/],
    ['an rgba colour in a shadow', '.a { box-shadow: 0 1px 2px rgba(0,0,0,.2); }', /colour literal/],
    ['a named colour', '.a { background-color: white; }', /colour/],
    ['a V2 variable', '.a { color: var(--v2-text); }', /V2 variable/],
    ['a --bg variable', '.a { background: var(--bg-surface); }', /V2 variable/],
    ['an undefined token', '.a { color: var(--v3-not-a-token); }', /not defined/],
    ['a literal radius', '.a { border-radius: 8px; }', /radius/],
    ['a literal corner radius', '.a { border-top-left-radius: 4px; }', /radius/],
    ['a literal shadow', '.a { box-shadow: 0 4px 12px black; }', /shadow/],
    ['a literal padding', '.a { padding: 10px; }', /space of 10px/],
    ['a literal gap', '.a { gap: 14px; }', /space of 14px/],
    ['a literal margin on one side', '.a { margin-left: 12px; }', /space of 12px/],
    ['a literal inside a padding shorthand', '.a { padding: 2px 8px; }', /space of 8px/],
  ])('goes red for %s', (_label, css, expected) => {
    expect(scan(css).join('\n')).toMatch(expected)
  })

  it.each([
    ['tokens only', '.a { color: var(--v3-ink); padding: var(--v3-space-2) var(--v3-space-3); border-radius: var(--v3-radius-lg); }'],
    ['a hairline and a border compensation', '.a { margin: -1px; gap: 2px; padding: 0 2px; }'],
    ['a value derived from a token', '.a { gap: calc(var(--v3-space-3) + 2px); padding: 0 calc(var(--v3-space-1) + 2px) 0 2px; }'],
    ['the platform safe areas', '.a { padding: env(safe-area-inset-top, 0px) env(safe-area-inset-left, 0px); }'],
    ['a focus ring built from a token', '.a { box-shadow: 0 0 0 1px var(--v3-kan); }'],
    ['no shadow and no radius', '.a { box-shadow: none; border-radius: 0; }'],
    ['a token a sheet declares itself', '.a { --v3-local-gap: 1px; } .b { margin: var(--v3-local-gap); }'],
    ['a custom property a component writes inline', '.a { width: var(--v3-viewer-dock-width); }'],
    ['a word in a comment', '/* #fff and rgb(0 0 0) and --v2-x */ .a { color: var(--v3-ink); }'],
    ['currentColor and transparent', '.a { border-color: transparent; fill: currentColor; }'],
  ])('lets through %s', (_label, css) => {
    expect(scan(css)).toEqual([])
  })

  it('the shared sheets are only held to colours and variables, not to their structural literals', () => {
    expect(scan('.a { padding: 12px 14px; border-radius: 22px; box-shadow: 0 0 0 1px var(--v3-danger-ink); }', { strict: false })).toEqual([])
    expect(scan('.a { color: #fff; }', { strict: false }).length).toBeGreaterThan(0)
    expect(scan('.a { color: var(--v2-text); }', { strict: false }).length).toBeGreaterThan(0)
  })
})
