// Pure rules of the project dialog: what a folder row is, which messages it shows,
// when "Salvar" is blocked and how the server's 400/409 land on the right field.
// No React, no I/O. The texts are the pt-BR copy of the plan (Apêndice A).

export const NAME_MAX = 80
export const MAX_FOLDERS = 10

// Errors the client raises by itself (the server's folder errors come with their own
// message in inspect/POST/PATCH and are shown as received).
export const MESSAGES = {
  empty: 'Informe um caminho.',
  duplicate_in_project: 'Esta pasta já está neste projeto.',
  too_many_folders: 'Um projeto pode ter no máximo 10 pastas.',
  invalid_name: 'Informe um nome com 1 a 80 caracteres.',
  no_folders: 'Adicione ao menos uma pasta.',
  multiple_primary: 'Marque só uma pasta como principal.',
}

// Footer line after the first blocked attempt to save.
export const WHY = {
  name: 'Informe o nome do projeto.',
  noFolders: 'Adicione ao menos uma pasta.',
  folderErrors: 'Corrija ou remova as pastas com erro para salvar.',
}

export const LOCK_TITLE = 'A pasta principal está travada.'
export const LOCK_REST = 'A V2 ainda abre as sessões deste projeto nela, e V2 e V3 compartilham a mesma conversa. Ela destrava quando a V3 substituir a V2. Você pode renomear o projeto, adicionar ou tirar pastas extras e arquivar.'
export const LOCK_TEXT = `${LOCK_TITLE} ${LOCK_REST}`

// Not in the plan's copy (inherited item c): a locked primary whose folder is gone
// from the disk. Renaming and archiving never send the folders, so they still work.
export const LOCKED_MISSING_HINT = 'Esta pasta não existe mais nesta máquina e a principal travada não pode ser trocada. Dá para renomear ou arquivar o projeto; adicionar ou tirar pastas só depois que ela voltar.'

export const WORKSPACE_ARCHIVED_TEXT = 'Este workspace está arquivado. Desarquive-o antes de adicionar projetos.'
export const ADOPT_CONFLICT_TEXT = 'Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".'
export const GENERIC_ERROR = 'Não foi possível concluir agora. Nada foi alterado.'

const PROJECT_CONFLICT_TEXT = {
  adopt_conflict: ADOPT_CONFLICT_TEXT,
  primary_locked: LOCK_TEXT,
  workspace_archived: WORKSPACE_ARCHIVED_TEXT,
}

let nextUid = 1

// One folder row. `check` holds what /api/folders/inspect said about the typed path;
// `serverProblems` what the last POST/PATCH said about it.
//   locked:  the primary of a legacy-keyed project (cannot be removed or replaced)
//   exists:  the registry's own "the folder is on the disk" flag (saved rows only)
//   adoptableWorkspaceId: the discover entry says this folder keeps its V2 history
//            when the project is created in that workspace
export function makeFolder({
  path,
  isPrimary = false,
  locked = false,
  exists = true,
  saved = false,
  adoptableWorkspaceId = null,
  usedBy = [],
}) {
  nextUid += 1
  return {
    uid: `f${nextUid}`,
    path,
    isPrimary,
    locked,
    exists,
    saved,
    adoptableWorkspaceId,
    check: usedBy.length > 0 ? checkFromUsedBy(usedBy) : null,
    serverProblems: [],
  }
}

export function pathKey(path) {
  return String(path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function lastSegment(path) {
  const parts = String(path ?? '').trim().split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

// "Se ficar vazio, sugerimos o nome da primeira pasta."
export function suggestProjectName(folders) {
  if (!folders || folders.length === 0) return ''
  return lastSegment(folders[0].path).slice(0, NAME_MAX)
}

// Exactly one primary: keep the first marked one, or mark the first row.
export function ensurePrimary(folders) {
  if (folders.length === 0) return folders
  const first = folders.findIndex((folder) => folder.isPrimary)
  const keep = first === -1 ? 0 : first
  return folders.map((folder, index) => (folder.isPrimary === (index === keep) ? folder : { ...folder, isPrimary: index === keep }))
}

export function setPrimary(folders, index) {
  return folders.map((folder, position) => (folder.isPrimary === (position === index) ? folder : { ...folder, isPrimary: position === index }))
}

// Index (in the list BEFORE the removal) of the row that is primary afterwards, or -1
// when nothing is left. Removing a non-primary row keeps the primary; removing the
// primary hands it to the first row that remains.
export function nextPrimaryIndex(folders, removedIndex) {
  const remaining = folders.map((folder, index) => ({ folder, index })).filter(({ index }) => index !== removedIndex)
  if (remaining.length === 0) return -1
  const current = remaining.find(({ folder }) => folder.isPrimary)
  return (current || remaining[0]).index
}

export function removeFolderAt(folders, index) {
  const primary = nextPrimaryIndex(folders, index)
  return folders
    .map((folder, position) => ({ ...folder, isPrimary: position === primary }))
    .filter((_, position) => position !== index)
}

// Is `path` (or the canonical path the server resolved it to) already in the list?
export function findDuplicate(folders, path, canonicalPath = null) {
  const wanted = [pathKey(path), canonicalPath ? pathKey(canonicalPath) : null].filter(Boolean)
  return folders.findIndex((folder) => {
    const own = [pathKey(folder.path), folder.check?.canonical ? pathKey(folder.check.canonical) : null].filter(Boolean)
    return own.some((key) => wanted.includes(key))
  })
}

function refText(ref) {
  return `${ref.workspace_name} › ${ref.project_name}`
}

function checkFromUsedBy(usedBy) {
  return { errors: [], warns: usedBy.map((ref) => ({ code: 'already_used', text: `já está em ${refText(ref)}` })), infos: [], canonical: null }
}

// One /api/folders/inspect result -> the shape the row renders.
//   ok:false  -> errors (the server's own messages)
//   used_by   -> "já está em W › P" (one per project, never blocking)
//   nested_in -> "dentro de W › P (pastas sobrepostas)" / "contém W › P (pastas sobrepostas)"
// `in_this_project` is deliberately NOT turned into a message: whether a typed path is
// a duplicate is decided against the rows in the dialog, which may differ from the
// saved project (a row the user just removed can be added back).
export function checkFromInspect(result) {
  if (!result.ok) {
    return {
      errors: (result.problems || []).map((problem) => ({ code: problem.code, message: problem.message })),
      warns: [],
      infos: [],
      canonical: null,
    }
  }
  const warns = [
    ...(result.used_by || []).map((ref) => ({ code: 'already_used', text: `já está em ${refText(ref)}` })),
    ...(result.nested_in || []).map((ref) => ({
      code: 'nested',
      text: ref.relation === 'contains'
        ? `contém ${refText(ref)} (pastas sobrepostas)`
        : `dentro de ${refText(ref)} (pastas sobrepostas)`,
    })),
  ]
  return { errors: [], warns, infos: [], canonical: result.path || null }
}

// Attach the inspect results to the rows they were asked for (matched by the typed
// text, which is what `input` echoes). Locked rows are never inspected.
export function mergeInspectResults(folders, results) {
  const byInput = new Map(results.map((result) => [result.input, result]))
  return folders.map((folder) => {
    if (folder.locked) return folder
    const result = byInput.get(folder.path)
    return result ? { ...folder, check: checkFromInspect(result), serverProblems: [] } : folder
  })
}

export function errorsOf(folder) {
  return [...(folder.check?.errors || []), ...(folder.serverProblems || [])]
}

// Only what /inspect said blocks "Salvar". What the server said on the last attempt
// (`serverProblems`) is shown on the row but never blocks: the next attempt clears it
// and asks again, so a folder that came back on disk can be saved without reopening.
export function hasFolderErrors(folders) {
  return folders.some((folder) => (folder.check?.errors || []).length > 0)
}

export function whyBlocked({ name, folders }) {
  if (!String(name ?? '').trim()) return WHY.name
  if (folders.length === 0) return WHY.noFolders
  if (hasFolderErrors(folders)) return WHY.folderErrors
  return ''
}

export function canSave(input) {
  return whyBlocked(input) === ''
}

export function folderPayload(folders) {
  return folders.map((folder) => ({ path: folder.path, isPrimary: folder.isPrimary }))
}

// Did the user change the folder list (paths, order or primary) since it was loaded?
export function foldersChanged(original, current) {
  if (original.length !== current.length) return true
  return original.some((folder, index) => (
    folder.path !== current[index].path || Boolean(folder.isPrimary) !== Boolean(current[index].isPrimary)
  ))
}

// The server's 400 `problems` ([{path, code, message}]) -> where each one is shown.
// path = the exact text the dialog sent, so it picks the row; path null belongs to the
// name (invalid_name) or to the form (no_folders, too_many_folders, multiple_primary).
export function mapServerProblems(problems, folders) {
  const byIndex = new Map()
  const name = []
  const form = []
  for (const problem of problems || []) {
    const entry = { code: problem.code, message: problem.message }
    const index = problem.path == null ? -1 : folders.findIndex((folder) => folder.path === problem.path)
    if (index !== -1) {
      byIndex.set(index, [...(byIndex.get(index) || []), entry])
    } else if (problem.path == null && problem.code === 'invalid_name') {
      name.push(entry.message)
    } else {
      form.push(entry.message)
    }
  }
  return { byIndex, name, form }
}

export function applyServerProblems(folders, byIndex) {
  return folders.map((folder, index) => ({ ...folder, serverProblems: byIndex.get(index) || [] }))
}

// Homonym in the same workspace: a warning, never a block (S-7). The server also
// answers `name_in_use`, but the dialog closes on success, so the check is local.
export function nameInUse(name, workspaceProjects, excludeProjectId = null) {
  const wanted = String(name ?? '').trim().toLocaleLowerCase()
  if (!wanted) return false
  return (workspaceProjects || []).some((project) => (
    !project.archived && project.id !== excludeProjectId && project.name.trim().toLocaleLowerCase() === wanted
  ))
}

// A rejected request -> the sentence shown to the user.
//   400 with problems  -> the first problem's message
//   409 (scope project) -> the plan's copy for adopt_conflict / primary_locked / workspace_archived
//   any other 4xx      -> the server's message (it is already pt-BR)
//   network / 5xx      -> a generic line, since the raw message is English or empty
export function describeRequestError(error, { scope = 'project' } = {}) {
  if (!error) return GENERIC_ERROR
  if (error.status === 400 && error.problems && error.problems.length > 0) return error.problems[0].message
  if (error.status === 409 && scope === 'project' && PROJECT_CONFLICT_TEXT[error.code]) return PROJECT_CONFLICT_TEXT[error.code]
  if (error.status >= 400 && error.status < 500 && error.message && !/^HTTP \d+$/.test(error.message)) return error.message
  return GENERIC_ERROR
}
