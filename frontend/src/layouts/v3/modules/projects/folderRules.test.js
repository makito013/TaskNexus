import { describe, it, expect } from 'vitest'
import {
  LOCK_TEXT,
  GENERIC_ERROR,
  applyServerProblems,
  canSave,
  checkFromInspect,
  describeRequestError,
  ensurePrimary,
  findDuplicate,
  foldersChanged,
  lastSegment,
  makeFolder,
  mapServerProblems,
  mergeInspectResults,
  nameInUse,
  nextPrimaryIndex,
  pathKey,
  removeFolderAt,
  setPrimary,
  suggestProjectName,
  whyBlocked,
  folderPayload,
} from './folderRules.js'

const folder = (path, extra = {}) => makeFolder({ path, ...extra })
const withErrors = (item, errors) => ({ ...item, check: { errors, warns: [], infos: [], canonical: null } })

describe('suggestProjectName', () => {
  it.each([
    [[folder('D:\\projetos\\ymci-docs')], 'ymci-docs'],
    [[folder('D:\\projetos\\ymci-docs\\')], 'ymci-docs'],
    [[folder('/home/bruno/app/')], 'app'],
    [[folder('C:\\a\\first'), folder('C:\\b\\second')], 'first'],
    [[], ''],
    [[folder('C:\\')], 'C:'],
  ])('suggests the last segment of the FIRST folder (%#)', (folders, expected) => {
    expect(suggestProjectName(folders)).toBe(expected)
  })

  it('never suggests more than 80 characters', () => {
    expect(suggestProjectName([folder(`C:\\${'x'.repeat(120)}`)])).toHaveLength(80)
  })

  it('lastSegment tolerates blanks', () => {
    expect(lastSegment('   ')).toBe('')
    expect(lastSegment(undefined)).toBe('')
  })
})

describe('primary folder', () => {
  it('ensurePrimary marks the first row when none is primary and keeps only the first marked one', () => {
    expect(ensurePrimary([folder('a'), folder('b')]).map((f) => f.isPrimary)).toEqual([true, false])
    expect(ensurePrimary([folder('a'), folder('b', { isPrimary: true })]).map((f) => f.isPrimary)).toEqual([false, true])
    expect(ensurePrimary([folder('a', { isPrimary: true }), folder('b', { isPrimary: true })]).map((f) => f.isPrimary)).toEqual([true, false])
    expect(ensurePrimary([])).toEqual([])
  })

  it('setPrimary moves the mark to exactly one row', () => {
    const list = [folder('a', { isPrimary: true }), folder('b'), folder('c')]
    expect(setPrimary(list, 2).map((f) => f.isPrimary)).toEqual([false, false, true])
  })

  it('nextPrimaryIndex keeps the primary when another row goes and hands it to the first remaining one otherwise', () => {
    const list = [folder('a'), folder('b', { isPrimary: true }), folder('c')]
    expect(nextPrimaryIndex(list, 0)).toBe(1)
    expect(nextPrimaryIndex(list, 1)).toBe(0)
    expect(nextPrimaryIndex([folder('only', { isPrimary: true })], 0)).toBe(-1)
  })

  it('removeFolderAt drops the row and leaves exactly one primary', () => {
    const list = [folder('a'), folder('b', { isPrimary: true }), folder('c')]
    expect(removeFolderAt(list, 1).map((f) => [f.path, f.isPrimary])).toEqual([['a', true], ['c', false]])
    expect(removeFolderAt(list, 0).map((f) => [f.path, f.isPrimary])).toEqual([['b', true], ['c', false]])
    expect(removeFolderAt([folder('a', { isPrimary: true })], 0)).toEqual([])
  })
})

describe('duplicates', () => {
  it('pathKey ignores case, slash direction and a trailing separator', () => {
    expect(pathKey('D:\\Projetos\\App\\')).toBe(pathKey('d:/projetos/app'))
  })

  it('findDuplicate compares the typed text and the canonical path the server resolved', () => {
    const resolved = { ...folder('D:\\link'), check: { errors: [], warns: [], infos: [], canonical: 'D:\\real\\app' } }
    const list = [folder('D:\\projetos\\app'), resolved]
    expect(findDuplicate(list, 'd:/projetos/APP/')).toBe(0)
    expect(findDuplicate(list, 'D:\\other', 'D:\\real\\app')).toBe(1)
    expect(findDuplicate(list, 'D:\\other')).toBe(-1)
  })
})

describe('checkFromInspect', () => {
  it('turns a failed inspection into the server messages', () => {
    const check = checkFromInspect({ input: 'x', ok: false, problems: [{ code: 'system_folder', message: 'Pasta do sistema não pode ser pasta de projeto.' }] })
    expect(check.errors).toEqual([{ code: 'system_folder', message: 'Pasta do sistema não pode ser pasta de projeto.' }])
    expect(check.warns).toEqual([])
  })

  it('words used_by and both nested relations exactly as the plan says, and never blocks', () => {
    const ref = { project_id: 1, project_name: 'qa-a', workspace_id: 2, workspace_name: 'QA A', archived: false }
    const check = checkFromInspect({
      input: 'C:\\a',
      path: 'c:\\a',
      ok: true,
      problems: [],
      used_by: [ref],
      in_this_project: true,
      nested_in: [{ ...ref, relation: 'inside' }, { ...ref, project_name: 'qa-b', relation: 'contains' }],
    })
    expect(check.errors).toEqual([])
    expect(check.canonical).toBe('c:\\a')
    expect(check.warns.map((w) => w.text)).toEqual([
      'já está em QA A › qa-a',
      'dentro de QA A › qa-a (pastas sobrepostas)',
      'contém QA A › qa-b (pastas sobrepostas)',
    ])
  })

  it('mergeInspectResults attaches the results to the rows with the same typed text and skips the locked row', () => {
    const locked = folder('C:\\locked', { locked: true, isPrimary: true })
    const typed = folder('C:\\typed')
    const merged = mergeInspectResults([locked, typed], [
      { input: 'C:\\locked', ok: false, problems: [{ code: 'not_found', message: 'x' }] },
      { input: 'C:\\typed', ok: false, problems: [{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }] },
    ])
    expect(merged[0]).toBe(locked)
    expect(merged[1].check.errors[0].code).toBe('not_found')
  })
})

describe('canSave / whyBlocked', () => {
  const ok = folder('C:\\a', { isPrimary: true })

  it('is ok with a name and clean folders', () => {
    expect(canSave({ name: 'qa-a', folders: [ok] })).toBe(true)
    expect(whyBlocked({ name: 'qa-a', folders: [ok] })).toBe('')
  })

  it('names the first problem with the exact copy, in the order name, folders, errors', () => {
    expect(whyBlocked({ name: '  ', folders: [] })).toBe('Informe o nome do projeto.')
    expect(whyBlocked({ name: 'x', folders: [] })).toBe('Adicione ao menos uma pasta.')
    expect(whyBlocked({ name: 'x', folders: [withErrors(ok, [{ code: 'not_found', message: 'm' }])] }))
      .toBe('Corrija ou remova as pastas com erro para salvar.')
    expect(canSave({ name: 'x', folders: [withErrors(ok, [{ code: 'not_found', message: 'm' }])] })).toBe(false)
  })

  it('warnings never block', () => {
    const warned = { ...ok, check: { errors: [], warns: [{ code: 'already_used', text: 'já está em A › b' }], infos: [], canonical: null } }
    expect(canSave({ name: 'x', folders: [warned] })).toBe(true)
  })

  it('a server problem kept on a row is shown but does not block: the next attempt retries', () => {
    const rejected = { ...ok, serverProblems: [{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }] }
    expect(canSave({ name: 'x', folders: [rejected] })).toBe(true)
  })
})

describe('foldersChanged / folderPayload', () => {
  it('detects added, removed, reordered or re-primaried rows and ignores identical lists', () => {
    const a = [folder('a', { isPrimary: true }), folder('b')]
    expect(foldersChanged(a, a.map((f) => ({ ...f })))).toBe(false)
    expect(foldersChanged(a, [a[0]])).toBe(true)
    expect(foldersChanged(a, [a[1], a[0]])).toBe(true)
    expect(foldersChanged(a, setPrimary(a, 1))).toBe(true)
  })

  it('folderPayload keeps path and isPrimary only', () => {
    expect(folderPayload([folder('a', { isPrimary: true, exists: false })])).toEqual([{ path: 'a', isPrimary: true }])
  })
})

describe('mapServerProblems', () => {
  const rows = [folder('C:\\a', { isPrimary: true }), folder('C:\\b')]

  it('lands a problem on the row whose typed text it names', () => {
    const mapped = mapServerProblems([{ path: 'C:\\b', code: 'not_found', message: 'A pasta não existe nesta máquina.' }], rows)
    expect([...mapped.byIndex.keys()]).toEqual([1])
    expect(mapped.byIndex.get(1)).toEqual([{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }])
    expect(mapped.name).toEqual([])
    expect(mapped.form).toEqual([])
  })

  it('sends invalid_name to the name and the other project-level problems to the form', () => {
    const mapped = mapServerProblems([
      { path: null, code: 'invalid_name', message: 'Informe um nome com 1 a 80 caracteres.' },
      { path: null, code: 'too_many_folders', message: 'Um projeto pode ter no máximo 10 pastas.' },
      { path: 'C:\\gone', code: 'not_found', message: 'A pasta não existe nesta máquina.' },
    ], rows)
    expect(mapped.name).toEqual(['Informe um nome com 1 a 80 caracteres.'])
    expect(mapped.form).toEqual(['Um projeto pode ter no máximo 10 pastas.', 'A pasta não existe nesta máquina.'])
    expect(mapped.byIndex.size).toBe(0)
  })

  it('applyServerProblems replaces the old problems row by row', () => {
    const stale = [{ ...rows[0], serverProblems: [{ code: 'x', message: 'old' }] }, rows[1]]
    const mapped = mapServerProblems([{ path: 'C:\\b', code: 'not_found', message: 'new' }], stale)
    const applied = applyServerProblems(stale, mapped.byIndex)
    expect(applied[0].serverProblems).toEqual([])
    expect(applied[1].serverProblems).toEqual([{ code: 'not_found', message: 'new' }])
  })
})

describe('nameInUse', () => {
  const projects = [
    { id: 1, name: 'QA-A', archived: false },
    { id: 2, name: 'old', archived: true },
  ]

  it('is a case-insensitive match among the ACTIVE projects of the workspace', () => {
    expect(nameInUse(' qa-a ', projects)).toBe(true)
    expect(nameInUse('old', projects)).toBe(false)
    expect(nameInUse('', projects)).toBe(false)
  })

  it('ignores the project being edited', () => {
    expect(nameInUse('qa-a', projects, 1)).toBe(false)
  })
})

describe('describeRequestError', () => {
  it('uses the first 400 problem', () => {
    const error = Object.assign(new Error('m'), { status: 400, problems: [{ message: 'Informe um nome com 1 a 80 caracteres.' }] })
    expect(describeRequestError(error)).toBe('Informe um nome com 1 a 80 caracteres.')
  })

  it('words the project 409s with the plan copy and the workspace 409 with the server message', () => {
    const conflict = (code, message) => Object.assign(new Error(message), { status: 409, code })
    expect(describeRequestError(conflict('adopt_conflict', 'server text'))).toBe('Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".')
    expect(describeRequestError(conflict('primary_locked', 'server text'))).toBe(LOCK_TEXT)
    expect(describeRequestError(conflict('workspace_archived', 'server text'))).toBe('Este workspace está arquivado. Desarquive-o antes de adicionar projetos.')
    expect(describeRequestError(conflict('adopt_conflict', 'Esse workspace já existe arquivado. Desarquive-o em "Mostrar arquivados".'), { scope: 'workspace' }))
      .toBe('Esse workspace já existe arquivado. Desarquive-o em "Mostrar arquivados".')
  })

  it('falls back to the generic line for network failures, 5xx and bare HTTP statuses', () => {
    expect(describeRequestError(new TypeError('Failed to fetch'))).toBe(GENERIC_ERROR)
    expect(describeRequestError(Object.assign(new Error('boom'), { status: 500 }))).toBe(GENERIC_ERROR)
    expect(describeRequestError(Object.assign(new Error('HTTP 404'), { status: 404 }))).toBe(GENERIC_ERROR)
    expect(describeRequestError(null)).toBe(GENERIC_ERROR)
  })
})
