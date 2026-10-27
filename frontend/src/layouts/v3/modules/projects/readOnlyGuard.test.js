// Layer 3 of the read-only proof of the "Projetos e agentes" screen (the other
// two: useProjectsOverview.test.js - behaviour, ProjectsScreen.test.jsx - every
// network call is a GET). This one reads the SOURCE of every non-test file of
// modules/projects/ and refuses anything that could write, notify or count.
//
// The rules are per file: the registry writes (create/update workspace and
// project, folder inspection) may exist ONLY in useRegistryMutations.js. That
// file arrives with the registration dialogs; its entry is here from the start so
// that phase does not have to edit this guard. The scanner is exported and a
// fixture battery proves it goes red (a source-reading test that never fails
// proves nothing).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const READ_ONLY_API = ['fetchAgents', 'fetchActiveSessions', 'fetchPersistedSessions', 'fetchCards', 'fetchBoardColumns']
const READ_ONLY_WORKSPACES_API = ['fetchWorkspaces']
const WRITE_WORKSPACES_API = [
  'createWorkspace', 'updateWorkspace', 'createProject', 'updateProject',
  'inspectFolders', 'discoverFolders', 'browseFolder',
]

// File name -> extra calls that file (and only it) may make.
const RULES_BY_FILE = {
  'useRegistryMutations.js': { workspacesApi: WRITE_WORKSPACES_API },
}

const FORBIDDEN_IMPORTS = [
  'services/notifier',
  'services/pushSubscription',
  'utils/sessionNotifications',
  'utils/quietHours',
  'hooks/useNotificationSettings',
  'hooks/useCards',
  'hooks/useProjects',
  // Hooks of hooks/ that WRITE through the V2 api (tasks, agents, board columns) or
  // persist to web storage (the storage ban above only sees the word, not an import).
  // Importing one would reach exactly what the rules above forbid by name.
  'hooks/useAgentSettings',
  'hooks/useTasks',
  'hooks/useGlobalTasks',
  'hooks/useColumns',
  'hooks/useFabPosition',
  'hooks/useKeyboardSuppressed',
  'hooks/useNavScope',
  'hooks/useSidebarCollapsed',
]

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CLIENT_MODULE = /(?:^|\/)services\/(?:api|workspacesApi)(?:\.js)?$/

function dynamicImportSpecifiers(code) {
  return [...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
}

function importSpecifiers(code) {
  const found = []
  for (const match of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g)) found.push(match[1])
  return [...found, ...dynamicImportSpecifiers(code)]
}

// Returns the list of violations of a (non-test) source file of modules/projects/.
export function scanProjectsModuleSource(file, source) {
  const problems = []
  const code = stripComments(source)
  const extra = RULES_BY_FILE[path.basename(file)] || {}

  for (const match of code.matchAll(/(?<![\w$/.])api\s*\.\s*(\w+)/g)) {
    if (!READ_ONLY_API.includes(match[1])) problems.push(`api.${match[1]} is not on the read-only allowlist`)
  }
  const workspacesAllowed = [...READ_ONLY_WORKSPACES_API, ...(extra.workspacesApi || [])]
  for (const match of code.matchAll(/(?<![\w$/.])workspacesApi\s*\.\s*(\w+)/g)) {
    if (!workspacesAllowed.includes(match[1])) problems.push(`workspacesApi.${match[1]} is not allowed in ${path.basename(file)}`)
  }
  // Destructuring or aliasing the clients would hide the calls from the rules above.
  if (/\{[^}]*\}\s*=\s*(?:api|workspacesApi)\b/.test(code)) problems.push('destructures api/workspacesApi')
  if (/\b(?:const|let|var)\s+\w+\s*=\s*(?:api|workspacesApi)\s*(?:[;,\n)]|$)/.test(code)) problems.push('aliases api/workspacesApi')
  // Optional chaining and bracket access dodge the `api.name` rules above.
  if (/(?<![\w$/.])(?:api|workspacesApi)\s*(?:\?\.|\[)/.test(code)) problems.push('reaches api/workspacesApi by optional chaining or bracket access')
  // The same hiding through the import itself: the clients may only come in as
  // the plain named import `{ api }` / `{ workspacesApi }` - no `as` rename, no
  // namespace, no default, no dynamic import, no re-export.
  for (const match of code.matchAll(/\bimport\s+([^'"();]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!CLIENT_MODULE.test(match[2])) continue
    const clause = match[1].trim()
    if (/\*\s*as\b/.test(clause)) problems.push(`imports ${match[2]} as a namespace`)
    else if (!clause.startsWith('{')) problems.push(`imports ${match[2]} as a default import`)
    else if (/\bas\b/.test(clause)) problems.push(`renames an import of ${match[2]} (as)`)
  }
  for (const match of code.matchAll(/\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (CLIENT_MODULE.test(match[1])) problems.push(`re-exports ${match[1]}`)
  }
  for (const specifier of dynamicImportSpecifiers(code)) {
    if (CLIENT_MODULE.test(specifier)) problems.push(`dynamically imports ${specifier}`)
  }

  if (/\bfetch\s*\(/.test(code)) problems.push('calls fetch( directly')
  if (/\bnew\s+Notification\b/.test(code)) problems.push('constructs a Notification')
  if (/\bAudioContext\b/.test(code)) problems.push('uses AudioContext')
  if (/\b(?:localStorage|sessionStorage)\b/.test(code)) problems.push('uses web storage')

  for (const match of code.matchAll(/document\.title\s*=\s*([^\n;]*)/g)) {
    const assigned = match[1].trim()
    if (!/^(['"`])[^'"`$()]*\1$/.test(assigned)) problems.push(`sets document.title to a computed or counted value (${assigned})`)
  }

  for (const specifier of importSpecifiers(code)) {
    const hit = FORBIDDEN_IMPORTS.find((entry) => specifier.endsWith(entry) || specifier.includes(`${entry}.`))
    if (hit) problems.push(`imports ${hit}`)
  }
  return problems
}

const isTestFile = (name) => /\.test\.(js|jsx)$/.test(name)
const SOURCE_FILES = readdirSync(HERE).filter((name) => /\.(js|jsx)$/.test(name) && !isTestFile(name))

describe('read-only guard of modules/projects', () => {
  it('scans the real source files (positive control)', () => {
    expect(SOURCE_FILES).toEqual(expect.arrayContaining([
      'agentBoard.js', 'registryIndex.js', 'boardSummary.js', 'useProjectsOverview.js', 'ProjectsScreen.jsx',
    ]))
  })

  it('scans the file that owns the registry writes (positive control)', () => {
    expect(SOURCE_FILES).toEqual(expect.arrayContaining(['useRegistryMutations.js', 'ProjectDialog.jsx', 'WorkspaceDialog.jsx']))
  })

  it.each(SOURCE_FILES)('%s only uses the read-only calls', (name) => {
    const source = readFileSync(path.join(HERE, name), 'utf8')
    expect(scanProjectsModuleSource(name, source), name).toEqual([])
  })
})

describe('scanProjectsModuleSource (fixtures prove the detector goes red)', () => {
  const scan = (source, file = 'Some.jsx') => scanProjectsModuleSource(file, source)

  it.each([
    ['an ack', "api.ackSession(key)", /api\.ackSession/],
    ['the V2 project scan', "const list = await api.fetchProjects()", /api\.fetchProjects/],
    ['a card mutation', "api.moveCard(1, 'feito')", /api\.moveCard/],
    ['a destructured client', "const { ackSession } = api", /destructures/],
    ['an aliased client', "const client = api\nclient.ackSession(key)", /aliases/],
    ['a direct fetch', "await fetch('/api/sessions/x/ack', { method: 'POST' })", /fetch\(/],
    ['a Notification', "new Notification('Espera você')", /Notification/],
    ['web storage', "localStorage.setItem('x', '1')", /web storage/],
    ['the notifier import', "import { notify } from '../../../../services/notifier.js'", /notifier/],
    ['the cards hook import', "import { useCards } from '../../../../hooks/useCards.js'", /useCards/],
    ['a counted document title', "document.title = `(${count}) TaskNexus`", /document\.title/],
    ['a registry write outside useRegistryMutations', "workspacesApi.createProject(1, body)", /workspacesApi\.createProject/],
    ['a renamed api import', "import { api as client } from '../../../../services/api.js'\nclient.ackSession(key)", /renames an import/],
    ['a renamed workspacesApi import', "import { workspacesApi as reg } from '../../../../services/workspacesApi.js'\nreg.createProject(1, body)", /renames an import/],
    ['a renamed import without the .js extension', "import { api as client } from '../../../../services/api'", /renames an import/],
    ['a namespace import of api', "import * as svc from '../../../../services/api.js'\nsvc.api.ackSession(key)", /namespace/],
    ['a namespace import of workspacesApi', "import * as reg from '../../../../services/workspacesApi.js'", /namespace/],
    ['a default import of api', "import client from '../../../../services/api.js'", /default import/],
    ['a default import next to a named one', "import client, { api } from '../../../../services/api.js'", /default import/],
    ['a default-as rename', "import { default as client } from '../../../../services/api.js'", /renames an import/],
    ['a multi-line renamed import', "import {\n  api as client,\n} from '../../../../services/api.js'", /renames an import/],
    ['a dynamic import of the client', "const mod = await import('../../../../services/api.js')", /dynamically imports/],
    ['a re-export of the client', "export { api } from '../../../../services/api.js'", /re-exports/],
    ['optional chaining on api', "api?.ackSession(key)", /optional chaining/],
    ['optional chaining on workspacesApi', "workspacesApi?.createProject(1, body)", /optional chaining/],
    ['bracket access on api', "api['ackSession'](key)", /bracket access/],
    ['bracket access on workspacesApi', "workspacesApi['createProject'](1, body)", /bracket access/],
    ['a call split across lines', "api\n  .ackSession(key)", /api\.ackSession/],
    ['a registry write split across lines', "workspacesApi\n  .createProject(1, body)", /workspacesApi\.createProject/],
  ])('goes red for %s', (_label, source, expected) => {
    const problems = scan(source)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(expected)
  })

  it.each([
    ['useAgentSettings', 'hooks/useAgentSettings.js'],
    ['useTasks', 'hooks/useTasks.js'],
    ['useGlobalTasks', 'hooks/useGlobalTasks.js'],
    ['useColumns', 'hooks/useColumns.js'],
    ['useFabPosition (web storage)', 'hooks/useFabPosition.js'],
    ['useKeyboardSuppressed (web storage)', 'hooks/useKeyboardSuppressed.js'],
    ['useNavScope (web storage)', 'hooks/useNavScope.js'],
    ['useSidebarCollapsed (web storage)', 'hooks/useSidebarCollapsed.js'],
  ])('goes red for importing the writing hook %s', (_label, specifier) => {
    const hookName = specifier.replace('hooks/', '').replace('.js', '')
    const problems = scan(`import { ${hookName} } from '../../../../${specifier}'`)
    expect(problems.join('\n')).toMatch(new RegExp(specifier.replace('.js', '').replace('/', '\\/')))
    // ...also without the extension, and from the file that owns the registry writes
    expect(scan(`import { x } from '../../../../${specifier.replace('.js', '')}'`)).not.toEqual([])
    expect(scan(`import { x } from '../../../../${specifier}'`, 'useRegistryMutations.js')).not.toEqual([])
  })

  it('goes red for a dynamic or re-exported import of a writing hook', () => {
    expect(scan("const mod = await import('../../../../hooks/useTasks.js')")).not.toEqual([])
    expect(scan("export { useColumns } from '../../../../hooks/useColumns.js'")).not.toEqual([])
  })

  it('stays green for the real shape of useRegistryMutations.js and for read-only hooks', () => {
    const source = [
      "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
      "import { workspacesApi } from '../../../../services/workspacesApi.js'",
      "import { useMediaQuery } from '../../../../hooks/useMediaQuery.js'",
      "import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'",
      'const createProject = (workspaceId, input) => workspacesApi.createProject(workspaceId, input)',
      'const inspect = (input) => workspacesApi.inspectFolders(input)',
    ].join('\n')
    expect(scan(source, 'useRegistryMutations.js')).toEqual([])
    // a similarly named identifier is not an import of the hook
    expect(scan("const useTasksLabel = 'x'")).toEqual([])
  })

  it('goes green for the allowed reads, refetch and a plain document title', () => {
    const source = [
      "import { api } from '../../../../services/api.js'",
      "import { workspacesApi } from '../../../../services/workspacesApi.js'",
      'await Promise.allSettled([api.fetchAgents(), api.fetchActiveSessions(), api.fetchPersistedSessions(),',
      '  api.fetchCards(), api.fetchBoardColumns(), workspacesApi.fetchWorkspaces({ includeArchived: true })])',
      'refetch()',
      "document.title = 'Projetos · TaskNexus'",
      '// api.ackSession(key) and localStorage in a comment are ignored',
    ].join('\n')
    expect(scan(source)).toEqual([])
  })

  it('allows the registry writes only inside useRegistryMutations.js', () => {
    const write = "workspacesApi.createProject(workspaceId, { name, folders })"
    expect(scan(write, 'ProjectDialog.jsx')).not.toEqual([])
    expect(scan(write, 'useRegistryMutations.js')).toEqual([])
    // ...and even there, the session and card writes stay forbidden.
    expect(scan('api.ackSession(key)', 'useRegistryMutations.js')).not.toEqual([])
    expect(scan('workspacesApi.deleteProject(1)', 'useRegistryMutations.js')).not.toEqual([])
  })

  it('refuses the renamed client everywhere, useRegistryMutations.js included', () => {
    const renamed = "import { workspacesApi as reg } from '../../../../services/workspacesApi.js'\nreg.createProject(1, body)"
    expect(scan(renamed, 'ProjectDialog.jsx').join('\n')).toMatch(/renames an import/)
    expect(scan(renamed, 'useRegistryMutations.js').join('\n')).toMatch(/renames an import/)
    expect(scan("import * as reg from '../../../../services/workspacesApi.js'", 'useRegistryMutations.js')).not.toEqual([])
  })

  it('does not flag unrelated imports, renames of other modules or similarly named identifiers', () => {
    const source = [
      "import { useState as useLocalState } from 'react'",
      "import { api } from '../../../../services/api.js'",
      "import { workspacesApi, someHelper } from '../../../../services/workspacesApi.js'",
      "import * as sessionLabels from '../../../../utils/sessionLabels.js'",
      "const response = await import('./agentBoard.js')",
      'const rapid = rapi[0]',
      'const x = model.api?.status',
    ].join('\n')
    expect(scan(source)).toEqual([])
  })
})
