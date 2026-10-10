import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V3_DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(V3_DIR, '..', '..')
const PACKAGE_JSON = JSON.parse(
  readFileSync(path.resolve(SRC_DIR, '..', 'package.json'), 'utf8'),
)
const RUNTIME_DEPENDENCIES = Object.keys(PACKAGE_JSON.dependencies)
// Test files inside layouts/v3 may also use the test toolchain.
const TEST_ONLY_PACKAGES = ['vitest', '@testing-library/react', '@testing-library/dom']
// Directories of src/ that layouts/v3 may reach into (besides itself).
const ALLOWED_SRC_DIRS = ['services', 'hooks', 'utils']
const FORBIDDEN_SRC_ENTRIES = ['layouts/v2', 'components', 'views', 'features', 'index.css']

const SOURCE_EXTENSIONS = /\.(js|jsx|mjs)$/

function listSourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full))
    else if (SOURCE_EXTENSIONS.test(entry)) files.push(full)
  }
  return files
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Returns { specifier, dynamic } for every import/export-from/import() in a source.
export function extractImports(source) {
  const code = stripComments(source)
  const found = []
  const staticPattern = /(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of code.matchAll(staticPattern)) found.push({ specifier: match[1], dynamic: false })
  for (const match of code.matchAll(dynamicPattern)) found.push({ specifier: match[1], dynamic: true })
  return found
}

function toSrcRelative(fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), specifier)
  return path.relative(SRC_DIR, resolved).split(path.sep).join('/')
}

function isInsideV3(srcRelative) {
  return srcRelative === 'layouts/v3' || srcRelative.startsWith('layouts/v3/')
}

function isTestFile(file) {
  return /\.test\.(js|jsx)$/.test(file)
}

// Violations of the rules for a file that lives inside layouts/v3.
export function violationsForV3File(file, source) {
  const problems = []
  for (const { specifier } of extractImports(source)) {
    if (specifier.startsWith('.')) {
      const target = toSrcRelative(file, specifier)
      const forbidden = FORBIDDEN_SRC_ENTRIES.find(
        (entry) => target === entry || target.startsWith(`${entry}/`),
      )
      if (forbidden) {
        problems.push(`${specifier} reaches into forbidden ${forbidden}`)
        continue
      }
      const topDir = target.split('/')[0]
      if (!isInsideV3(target) && !ALLOWED_SRC_DIRS.includes(topDir)) {
        problems.push(`${specifier} is outside the allowed directories`)
      }
    } else {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      const allowed =
        RUNTIME_DEPENDENCIES.includes(packageName) ||
        (isTestFile(file) && TEST_ONLY_PACKAGES.includes(packageName)) ||
        (isTestFile(file) && specifier.startsWith('node:'))
      if (!allowed) problems.push(`${specifier} is not a listed dependency`)
    }
  }
  return problems
}

const ALL_SOURCE_FILES = listSourceFiles(SRC_DIR)
const V3_FILES = ALL_SOURCE_FILES.filter((file) => isInsideV3(path.relative(SRC_DIR, file).split(path.sep).join('/')))
const OUTSIDE_FILES = ALL_SOURCE_FILES.filter((file) => !V3_FILES.includes(file))

describe('layouts/v3 boundaries', () => {
  it('no file outside layouts/v3 imports layouts/v3 statically', () => {
    const offenders = []
    for (const file of OUTSIDE_FILES) {
      for (const { specifier, dynamic } of extractImports(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.') || dynamic) continue
        if (isInsideV3(toSrcRelative(file, specifier))) offenders.push(`${path.relative(SRC_DIR, file)} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('main.jsx is the only dynamic importer of bootV3', () => {
    const importers = []
    for (const file of ALL_SOURCE_FILES) {
      const dynamicHit = extractImports(readFileSync(file, 'utf8')).some(
        ({ specifier, dynamic }) => dynamic && /(^|\/)bootV3(\.jsx)?$/.test(specifier),
      )
      if (dynamicHit && !isTestFile(file)) importers.push(path.relative(SRC_DIR, file).split(path.sep).join('/'))
    }
    expect(importers).toEqual(['main.jsx'])
  })

  it('files inside layouts/v3 import only react, listed dependencies, layouts/v3, services, hooks and utils', () => {
    const offenders = []
    for (const file of V3_FILES) {
      for (const problem of violationsForV3File(file, readFileSync(file, 'utf8'))) {
        if (problem.includes('forbidden')) continue
        offenders.push(`${path.relative(SRC_DIR, file)}: ${problem}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('files inside layouts/v3 never import layouts/v2, components, views, features or index.css', () => {
    const offenders = []
    for (const file of V3_FILES) {
      for (const problem of violationsForV3File(file, readFileSync(file, 'utf8'))) {
        if (problem.includes('forbidden')) offenders.push(`${path.relative(SRC_DIR, file)}: ${problem}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('would flag a forbidden import', () => {
    const file = path.join(V3_DIR, 'Fake.jsx')
    const source = [
      "import { Sidebar } from '../../components/Sidebar.jsx'",
      "import { AppV2 } from '../v2/AppV2.jsx'",
      "import '../../index.css'",
      "import lodash from 'lodash'",
      "import { api } from '../../services/api.js'",
      "import React from 'react'",
    ].join('\n')
    const problems = violationsForV3File(file, source)
    expect(problems).toEqual([
      '../../components/Sidebar.jsx reaches into forbidden components',
      '../v2/AppV2.jsx reaches into forbidden layouts/v2',
      '../../index.css reaches into forbidden index.css',
      'lodash is not a listed dependency',
    ])
  })
})
