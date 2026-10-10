import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIN_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.jsx'),
  'utf8',
)

// Strips block and line comments so prose in comments never counts as code.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const LITERAL_MODE_COMPARISON =
  /import\.meta\.env\.MODE\s*===\s*'v3'\s*\?\s*\(\)\s*=>\s*import\(\s*'\.\/layouts\/v3\/bootV3\.jsx'\s*\)/

function hasLiteralBranch(source) {
  return LITERAL_MODE_COMPARISON.test(stripComments(source))
}

function importsBootV3Statically(source) {
  return stripComments(source)
    .split('\n')
    .some((line) => /^\s*(import|export)\b[^(]*bootV3/.test(line))
}

describe('main.jsx v3 branch', () => {
  it('keeps the v3 branch as a literal mode comparison so the v2 build can drop it', () => {
    expect(hasLiteralBranch(MAIN_SOURCE)).toBe(true)
  })

  it('references bootV3 only through a dynamic import', () => {
    expect(importsBootV3Statically(MAIN_SOURCE)).toBe(false)
    expect(stripComments(MAIN_SOURCE)).toMatch(/import\(\s*'\.\/layouts\/v3\/bootV3\.jsx'\s*\)/)
  })

  it('would flag a mode comparison routed through a function', () => {
    const routed =
      "const loadV3 = resolveLayout(import.meta.env.MODE) === 'v3' ? () => import('./layouts/v3/bootV3.jsx') : null"
    expect(hasLiteralBranch(routed)).toBe(false)
    expect(importsBootV3Statically("import { bootV3 } from './layouts/v3/bootV3.jsx'")).toBe(true)
  })
})
