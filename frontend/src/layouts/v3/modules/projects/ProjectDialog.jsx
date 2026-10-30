import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import DiscoverPanel from './DiscoverPanel.jsx'
import FolderList from './FolderList.jsx'
import {
  LOCK_REST,
  LOCK_TITLE,
  MAX_FOLDERS,
  MESSAGES,
  NAME_MAX,
  WHY,
  applyServerProblems,
  checkFromInspect,
  describeRequestError,
  ensurePrimary,
  findDuplicate,
  folderPayload,
  foldersChanged,
  hasFolderErrors,
  makeFolder,
  mapServerProblems,
  mergeInspectResults,
  nameInUse,
  removeFolderAt,
  setPrimary,
  suggestProjectName,
  whyBlocked,
} from './folderRules.js'
import WorkspaceDialog from './WorkspaceDialog.jsx'
import './ProjectDialog.css'

const TITLE_ID = 'dlg-proj-title'
const NEW_WORKSPACE_VALUE = '__new'
const PICKER_FAILED = 'Não consegui abrir o seletor de pastas. Digite o caminho.'
const NO_WORKSPACE = 'Escolha o workspace.'

function restOfKey(key) {
  const slash = String(key ?? '').indexOf('/')
  return slash === -1 ? String(key ?? '') : key.slice(slash + 1)
}

// Button is a plain function component (no ref), so the toggle is found by id.
function focusDiscoverButton() {
  document.getElementById('btn-discover')?.focus()
}

function savedFolders(project) {
  const sorted = [...(project.folders || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return ensurePrimary(sorted.map((folder) => makeFolder({
    path: folder.path,
    isPrimary: Boolean(folder.is_primary),
    locked: project.primaryLocked && Boolean(folder.is_primary),
    exists: folder.exists !== false,
    saved: true,
  })))
}

// Add / edit / "Cadastrar como projeto" dialog. Mount it only while it is open.
//   mode 'create'   - empty form; `workspaceId` preselects the workspace
//   mode 'register' - a legacy folder the V2 found: the name comes from its key and
//                     the folder from the discover map, so the project keeps the V2
//                     history (the server adopts the legacy key by itself)
//   mode 'edit'     - `project` (a registry index project); the workspace is fixed
// mutations: the object of useRegistryMutations. onSaved(project) runs after a
// successful write (the registry was already refetched).
export default function ProjectDialog({
  mode = 'create',
  mutations,
  workspaces,
  project = null,
  workspaceId: initialWorkspaceId = null,
  bucketKey = null,
  onClose,
  onSaved,
  returnFocusTo = null,
}) {
  const edit = mode === 'edit'
  const register = mode === 'register'

  const originalFolders = useMemo(() => (edit ? savedFolders(project) : []), [edit, project])
  const [name, setName] = useState(() => {
    if (edit) return project.name
    if (register) return restOfKey(bucketKey).slice(0, NAME_MAX)
    return ''
  })
  const [folders, setFolders] = useState(originalFolders)
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (edit) return project.workspaceId
    const wanted = workspaces.find((workspace) => workspace.id === initialWorkspaceId && !workspace.archived)
    return wanted ? wanted.id : (workspaces.find((workspace) => !workspace.archived)?.id ?? null)
  })
  const [createdWorkspaces, setCreatedWorkspaces] = useState([])
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)

  const [adding, setAdding] = useState('')
  const [addPreview, setAddPreview] = useState(null) // { text, check, failure } for the text in the field
  const [browsing, setBrowsing] = useState(false)

  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [discovery, setDiscovery] = useState({ status: 'idle', data: null })
  const [registerLookup, setRegisterLookup] = useState(register ? 'loading' : 'idle')

  const [tried, setTried] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [nameServerError, setNameServerError] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)

  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const mountedRef = useRef(true)
  const submittingRef = useRef(false)
  const previewSeqRef = useRef(0)
  const previewRef = useRef(null) // { text, promise } of the inspect in flight or just done
  const skipArchiveFocus = useRef(true)
  const workspaceSelectRef = useRef(null)
  const nameRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const { inspectFolders, discoverFolders, browseFolder } = mutations

  // ---- workspace -----------------------------------------------------------
  const workspaceOptions = useMemo(() => {
    const list = workspaces.filter((workspace) => !workspace.archived).map((workspace) => ({ id: workspace.id, name: workspace.name }))
    for (const created of createdWorkspaces) {
      if (!list.some((option) => option.id === created.id)) list.push({ id: created.id, name: created.name })
    }
    return list
  }, [workspaces, createdWorkspaces])
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) || null
  // Adoption of a V2 folder only happens when a project is CREATED in an active workspace.
  const adoptableFor = !edit && workspaceId != null && !selectedWorkspace?.archived ? workspaceId : null

  const onWorkspaceChange = (event) => {
    if (event.target.value === NEW_WORKSPACE_VALUE) {
      setWorkspaceDialogOpen(true) // the select stays on the previous workspace
      return
    }
    setWorkspaceId(Number(event.target.value))
  }

  // ---- folders -------------------------------------------------------------
  const commitFolders = useCallback((next) => {
    foldersRef.current = next
    setFolders(next)
  }, [])

  const suggestNameFor = useCallback((next) => {
    setName((current) => (current.trim() ? current : suggestProjectName(next)))
  }, [])

  // "Se ficar vazio, sugerimos o nome da primeira pasta."
  const appendFolders = useCallback((additions) => {
    const merged = ensurePrimary([...foldersRef.current, ...additions])
    commitFolders(merged)
    suggestNameFor(merged)
    return merged
  }, [commitFolders, suggestNameFor])

  // register: look the folder of the legacy key up in the V2 map once.
  useEffect(() => {
    if (!register) return
    let cancelled = false
    discoverFolders()
      .then((data) => {
        if (cancelled || !mountedRef.current) return
        setDiscovery({ status: 'ready', data })
        const entry = (data.entries || []).find((candidate) => candidate.legacy_key === bucketKey)
        if (entry) {
          appendFolders([makeFolder({
            path: entry.path,
            isPrimary: true,
            adoptableWorkspaceId: entry.adoptable_into_workspace_id,
            usedBy: entry.used_by || [],
          })])
          setName((current) => (current.trim() ? current : entry.name))
        }
        setRegisterLookup('done')
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setRegisterLookup('failed')
      })
    return () => {
      cancelled = true
    }
  }, [register, bucketKey, discoverFolders, appendFolders])

  const excludeProjectId = edit ? project.id : null

  // The archive trigger is swapped for the confirmation (and back): keep the focus
  // inside the dialog, on the button that replaced it.
  useEffect(() => {
    if (skipArchiveFocus.current) {
      skipArchiveFocus.current = false
      return
    }
    document.getElementById(confirmArchive ? 'btn-archive-confirm' : 'btn-archive-ask')?.focus()
  }, [confirmArchive])

  // Inspect the typed path (does not add it). Returns the check, or null when stale.
  // Leaving the field and clicking "Adicionar" ask about the same text: the second
  // one reuses the first (see addTyped), so the server is asked once.
  const runInspect = useCallback(async (text) => {
    previewSeqRef.current += 1
    const seq = previewSeqRef.current
    try {
      const response = await inspectFolders({ paths: [text], excludeProjectId })
      if (!mountedRef.current || seq !== previewSeqRef.current) return null
      const result = response.results[0]
      const check = checkFromInspect(result)
      const duplicate = check.errors.length === 0 ? findDuplicate(foldersRef.current, text, check.canonical) : -1
      const finalCheck = duplicate === -1
        ? check
        : { ...check, errors: [{ code: 'duplicate_in_project', message: MESSAGES.duplicate_in_project }] }
      setAddPreview({ text, check: finalCheck, failure: '' })
      return finalCheck
    } catch (error) {
      if (!mountedRef.current || seq !== previewSeqRef.current) return null
      setAddPreview({ text, check: null, failure: describeRequestError(error) })
      previewRef.current = null
      return null
    }
  }, [inspectFolders, excludeProjectId])

  // `claimed` marks an inspect already owned by an "Adicionar" call, so a second
  // call (double Enter, double click) while it is in flight does not reuse it.
  const inspectTyped = useCallback((text, claimed = false) => {
    const promise = runInspect(text)
    previewRef.current = { text, promise, claimed }
    return promise
  }, [runInspect])

  const onAddBlur = () => {
    const text = adding.trim()
    if (text && addPreview?.text !== text) inspectTyped(text)
  }

  const addTyped = async () => {
    const text = adding.trim()
    if (!text) {
      setAddPreview({ text: '', check: { errors: [{ code: 'empty', message: MESSAGES.empty }], warns: [], infos: [], canonical: null }, failure: '' })
      return
    }
    if (foldersRef.current.length >= MAX_FOLDERS) {
      setAddPreview({ text, check: { errors: [{ code: 'too_many_folders', message: MESSAGES.too_many_folders }], warns: [], infos: [], canonical: null }, failure: '' })
      return
    }
    // One-shot reuse of the inspect of the same text (leaving the field); a later
    // click inspects again, so a folder fixed on disk is seen.
    const pending = previewRef.current
    previewRef.current = null
    if (pending && pending.text === text && pending.claimed) return
    let check
    if (pending && pending.text === text) {
      pending.claimed = true
      check = await pending.promise
    } else {
      check = await inspectTyped(text, true)
    }
    if (check && check.errors.length === 0 && findDuplicate(foldersRef.current, text, check.canonical) !== -1) {
      check = { ...check, errors: [{ code: 'duplicate_in_project', message: MESSAGES.duplicate_in_project }] }
      setAddPreview({ text, check, failure: '' })
    }
    if (!check || check.errors.length > 0) return
    const folder = { ...makeFolder({ path: text }), check }
    appendFolders([folder])
    setAdding('')
    setAddPreview(null)
  }

  const browse = async () => {
    if (browsing) return
    setBrowsing(true)
    try {
      const picked = await browseFolder()
      if (!mountedRef.current) return
      if (picked && picked.path) {
        setAdding(picked.path)
        inspectTyped(picked.path)
      }
    } catch {
      if (mountedRef.current) setAddPreview({ text: adding.trim(), check: null, failure: PICKER_FAILED })
    } finally {
      if (mountedRef.current) setBrowsing(false)
    }
  }

  const loadDiscovery = useCallback(async () => {
    setDiscovery({ status: 'loading', data: null })
    try {
      const data = await discoverFolders()
      if (mountedRef.current) setDiscovery({ status: 'ready', data })
    } catch (error) {
      if (mountedRef.current) setDiscovery({ status: 'error', data: null, error })
    }
  }, [discoverFolders])

  const toggleDiscover = () => {
    if (discoverOpen) {
      setDiscoverOpen(false)
      return
    }
    setDiscoverOpen(true)
    if (discovery.status === 'idle' || discovery.status === 'error') loadDiscovery()
  }

  const useDiscovered = (entries) => {
    const additions = []
    let count = foldersRef.current.length
    for (const entry of entries) {
      if (count >= MAX_FOLDERS) break
      if (findDuplicate([...foldersRef.current, ...additions], entry.path) !== -1) continue
      additions.push(makeFolder({
        path: entry.path,
        adoptableWorkspaceId: entry.adoptable_into_workspace_id,
        usedBy: (entry.used_by || []).filter((ref) => ref.project_id !== excludeProjectId),
      }))
      count += 1
    }
    setDiscoverOpen(false)
    focusDiscoverButton()
    if (additions.length === 0) return
    appendFolders(additions)
    // Nested folders and the policy are only known to /inspect: ask now so the row
    // shows them; a failure here is not lost, "Salvar" inspects every row again.
    inspectFolders({ paths: additions.map((folder) => folder.path), excludeProjectId })
      .then((response) => {
        if (!mountedRef.current) return
        commitFolders(foldersRef.current.map((folder) => {
          const result = response.results.find((candidate) => candidate.input === folder.path)
          if (!result || !additions.some((added) => added.uid === folder.uid)) return folder
          const check = checkFromInspect(result)
          const used = folder.check?.warns || []
          return { ...folder, check: { ...check, warns: [...used.filter((warn) => !check.warns.some((other) => other.text === warn.text)), ...check.warns] } }
        }))
      })
      .catch(() => {})
  }

  const changePrimary = (index) => commitFolders(setPrimary(foldersRef.current, index))
  const removeFolder = (index) => commitFolders(removeFolderAt(foldersRef.current, index))

  // ---- save ----------------------------------------------------------------
  const trimmedName = name.trim()
  const clientWhy = (() => {
    const base = whyBlocked({ name, folders })
    if (base) return base
    if (!edit && workspaceId == null) return NO_WORKSPACE
    return ''
  })()
  const nameBad = tried && !trimmedName
  const footerMessage = submitError || (tried ? clientWhy : '')
  const saveBlocked = tried && clientWhy !== ''
  const homonym = !nameBad && nameInUse(name, selectedWorkspace?.projects, excludeProjectId)

  const fail = (error) => {
    if (error.status === 400 && error.problems?.length > 0) {
      const mapped = mapServerProblems(error.problems, foldersRef.current)
      commitFolders(applyServerProblems(foldersRef.current, mapped.byIndex))
      setNameServerError(mapped.name[0] || '')
      if (mapped.form.length > 0) setSubmitError(mapped.form[0])
      else if (mapped.byIndex.size > 0) setSubmitError(WHY.folderErrors)
      else if (mapped.name.length === 0) setSubmitError(describeRequestError(error))
      return
    }
    setSubmitError(describeRequestError(error))
  }

  // Ask /inspect about every row the user typed (the locked primary is never asked:
  // it would block a rename when its folder is gone). Returns false when a row fails.
  const inspectRowsBeforeSave = async () => {
    const asked = foldersRef.current.filter((folder) => !folder.locked)
    if (asked.length === 0) return true
    const response = await inspectFolders({ paths: asked.map((folder) => folder.path), excludeProjectId })
    if (!mountedRef.current) return false
    const merged = mergeInspectResults(foldersRef.current, response.results)
    commitFolders(merged)
    return !hasFolderErrors(merged)
  }

  const clearServerState = () => {
    setSubmitError('')
    setNameServerError('')
    commitFolders(foldersRef.current.map((folder) => (folder.serverProblems.length > 0 ? { ...folder, serverProblems: [] } : folder)))
  }

  const save = async () => {
    if (submittingRef.current) return
    if (clientWhy) {
      setTried(true)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    clearServerState()
    try {
      let result = null
      if (edit) {
        const nameChanged = trimmedName !== project.name
        const changedFolders = foldersChanged(originalFolders, foldersRef.current)
        if (!nameChanged && !changedFolders) {
          onClose()
          return
        }
        if (changedFolders && !(await inspectRowsBeforeSave())) {
          setTried(true)
          if (mountedRef.current) setSubmitError(WHY.folderErrors)
          return
        }
        // Only what changed goes out: a rename never resends (and so never revalidates)
        // the folders, which keeps it working when the locked primary left the disk.
        result = await mutations.updateProject(project.id, {
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(changedFolders ? { folders: folderPayload(foldersRef.current) } : {}),
        })
      } else {
        if (!(await inspectRowsBeforeSave())) {
          setTried(true)
          if (mountedRef.current) setSubmitError(WHY.folderErrors)
          return
        }
        result = await mutations.createProject(workspaceId, { name: trimmedName, folders: folderPayload(foldersRef.current) })
      }
      if (!mountedRef.current) return
      onSaved?.(result.project)
      onClose()
    } catch (error) {
      if (mountedRef.current) fail(error)
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const archive = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await mutations.updateProject(project.id, { archived: true })
      if (!mountedRef.current) return
      onSaved?.(result.project)
      onClose()
    } catch (error) {
      if (mountedRef.current) {
        setConfirmArchive(false)
        setSubmitError(describeRequestError(error))
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  // ---- render --------------------------------------------------------------
  const lockedRow = folders.find((folder) => folder.locked)
  const addCheck = addPreview?.check
  const addInvalid = Boolean(addCheck && addCheck.errors.length > 0) || Boolean(addPreview?.failure)

  const body = (
    <>
      {!edit && (
        <div className="v3-field">
          <span className="v3-field__label" id="origin-lbl">Origem</span>
          <div className="v3-seg" role="radiogroup" aria-labelledby="origin-lbl">
            <button type="button" role="radio" aria-checked="true" className="v3-seg__option">
              <DialogIcon name="folder" size={16} />Pasta local
            </button>
            <button type="button" role="radio" aria-checked="false" aria-disabled="true" aria-describedby="origin-note" className="v3-seg__option">
              Clonar repositório <Chip tone="state" accent="soon">em breve</Chip>
            </button>
            <button type="button" role="radio" aria-checked="false" aria-disabled="true" aria-describedby="origin-note" className="v3-seg__option">
              Só terminal <Chip tone="state" accent="soon">em breve</Chip>
            </button>
          </div>
          <span className="v3-field__help" id="origin-note">
            Clonar repositório e Só terminal chegam depois. Por enquanto, o projeto aponta para pastas que já existem.
          </span>
        </div>
      )}

      <div className="v3-two">
        <div className="v3-field">
          <label className="v3-field__label" htmlFor="p-name">Nome do projeto</label>
          <input
            ref={nameRef}
            id="p-name"
            className="v3-input"
            maxLength={NAME_MAX}
            value={name}
            placeholder="Ex.: ymci-docs"
            autoComplete="off"
            aria-required="true"
            aria-invalid={nameBad || nameServerError ? 'true' : undefined}
            aria-describedby={nameBad || nameServerError ? 'p-name-err' : (homonym ? 'p-name-warn' : 'p-name-help')}
            onChange={(event) => { setName(event.target.value); setNameServerError('') }}
          />
          {(nameBad || nameServerError) && (
            <span className="v3-msg v3-msg--err" id="p-name-err">
              <DialogIcon name="alert" size={16} />{nameServerError || MESSAGES.invalid_name}
            </span>
          )}
          {!nameBad && !nameServerError && homonym && (
            <span className="v3-msg v3-msg--warn" id="p-name-warn">
              <DialogIcon name="alert" size={16} />já existe um projeto com este nome neste workspace
            </span>
          )}
          {!nameBad && !nameServerError && !homonym && (
            <span className="v3-field__help" id="p-name-help">{name ? '' : 'Se ficar vazio, sugerimos o nome da primeira pasta.'}</span>
          )}
        </div>
        <div className="v3-field">
          <label className="v3-field__label" htmlFor="p-ws">Workspace</label>
          <select
            ref={workspaceSelectRef}
            id="p-ws"
            className="v3-input"
            value={workspaceId ?? ''}
            disabled={edit}
            aria-describedby={edit ? 'ws-fixed' : undefined}
            onChange={onWorkspaceChange}
          >
            {edit ? (
              <option value={workspaceId}>{project.workspaceName}</option>
            ) : (
              <>
                {workspaceId == null && <option value="" disabled>Escolha…</option>}
                {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                <option value={NEW_WORKSPACE_VALUE}>+ Novo workspace…</option>
              </>
            )}
          </select>
          {edit
            ? <span className="v3-field__help" id="ws-fixed">O workspace não muda depois que o projeto é criado.</span>
            : <span className="v3-field__help">Escolha onde o projeto aparece na tela.</span>}
        </div>
      </div>

      <div className="v3-field">
        <span className="v3-field__label" id="folders-lbl">Pastas</span>
        <span className="v3-field__help">A pasta principal é onde os agentes abrem. As outras ficam acessíveis como pastas adicionais.</span>
        {lockedRow && (
          <div className="v3-callout v3-callout--warn" id="lock-note">
            <DialogIcon name="lock" />
            <span><b>{LOCK_TITLE}</b> {LOCK_REST}</span>
          </div>
        )}
        {register && registerLookup === 'loading' && (
          <p className="v3-msg v3-msg--info" role="status">Procurando a pasta no mapa da V2…</p>
        )}
        {register && registerLookup === 'failed' && (
          <p className="v3-msg v3-msg--err" role="alert">
            <DialogIcon name="alert" size={16} />Não consegui ler o mapa de pastas da V2. Digite o caminho ou use Procurar.
          </p>
        )}
        {folders.length > 0 ? (
          <FolderList
            folders={folders}
            adoptableFor={adoptableFor}
            onPrimaryChange={changePrimary}
            onRemove={removeFolder}
          />
        ) : (
          <div className="v3-callout v3-callout--info">
            <DialogIcon name="info" />
            <span>Nenhuma pasta ainda. Digite um caminho, use Procurar ou Analisar automático.</span>
          </div>
        )}
      </div>

      <div className="v3-field">
        <label className="v3-field__label" htmlFor="p-add">Adicionar pasta</label>
        <div className="v3-addrow">
          <input
            id="p-add"
            className="v3-input v3-input--mono"
            value={adding}
            placeholder="D:\projetos\meu-app"
            autoComplete="off"
            aria-invalid={addInvalid ? 'true' : undefined}
            aria-describedby={addPreview ? 'add-msgs' : undefined}
            onChange={(event) => { setAdding(event.target.value); setAddPreview(null); previewRef.current = null }}
            onBlur={onAddBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTyped()
              }
            }}
          />
          <Button onClick={browse} {...(browsing ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}>Procurar…</Button>
          <Button onClick={addTyped}><DialogIcon name="plus" size={16} />Adicionar</Button>
          <Button id="btn-discover" aria-expanded={discoverOpen} onClick={toggleDiscover}>
            <DialogIcon name="search" size={16} />Analisar automático
          </Button>
        </div>
        <div id="add-msgs" className="v3-add-msgs">
          {addCheck?.errors.map((error) => (
            <div key={error.code} className="v3-msg v3-msg--err" role="alert" data-code={error.code}>
              <DialogIcon name="alert" size={16} /><span><b>Erro:</b> {error.message}</span>
            </div>
          ))}
          {addCheck?.warns.map((warn) => (
            <div key={warn.text} className="v3-msg v3-msg--warn">
              <DialogIcon name="alert" size={16} /><span>{warn.text}</span>
            </div>
          ))}
          {addPreview?.failure && (
            <div className="v3-msg v3-msg--err" role="alert"><DialogIcon name="alert" size={16} /><span>{addPreview.failure}</span></div>
          )}
        </div>
        <span className="v3-field__help">
          &quot;Procurar…&quot; abre o seletor de pastas do computador onde o servidor roda. De outro aparelho, digite o caminho ou use o Analisar automático.
        </span>
      </div>

      {discoverOpen && (
        <DiscoverPanel
          discovery={discovery}
          folders={folders}
          ownProjectId={excludeProjectId}
          workspaceId={workspaceId}
          allowAdoption={!edit}
          workspaces={workspaces}
          onRetry={loadDiscovery}
          onUse={useDiscovered}
          onClose={() => { setDiscoverOpen(false); focusDiscoverButton() }}
        />
      )}

      {edit && !project.archived && (
        <div className="v3-danger-zone">
          <h3 className="v3-danger-zone__title">Arquivar projeto</h3>
          <p className="v3-danger-zone__text">
            O projeto sai da lista (dá para ver de novo em &quot;Mostrar arquivados&quot;). Sessões, cards e artefatos continuam guardados e a pasta no disco não é apagada.
          </p>
          {confirmArchive ? (
            <div className="v3-danger-zone__confirm">
              <span className="v3-danger-zone__ask">Arquivar &quot;{project.name}&quot;?</span>
              <Button id="btn-archive-confirm" size="sm" className="v3-button--danger-outline" onClick={archive}>Sim, arquivar</Button>
              <Button size="sm" onClick={() => setConfirmArchive(false)}>Voltar</Button>
            </div>
          ) : (
            <Button id="btn-archive-ask" className="v3-button--danger-outline v3-danger-zone__ask-button" onClick={() => setConfirmArchive(true)}>
              <DialogIcon name="folder" size={16} />Arquivar projeto
            </Button>
          )}
        </div>
      )}

      <div className="v3-callout v3-callout--info">
        <DialogIcon name="info" />
        <span>Remover um projeto ou pasta daqui não apaga nada no disco.</span>
      </div>
    </>
  )

  const footer = (
    <>
      {footerMessage ? <p className="v3-dialog__why" id="save-why" role="alert">{footerMessage}</p> : <span className="v3-dialog__footer-spacer" />}
      <Button onClick={onClose}>Cancelar</Button>
      <Button
        variant="primary"
        {...(submitting
          ? { 'aria-busy': 'true', 'aria-disabled': 'true' }
          : saveBlocked
            ? { 'aria-disabled': 'true', 'aria-describedby': 'save-why' }
            : { onClick: save })}
      >
        {submitting ? 'Salvando…' : (edit ? 'Salvar alterações' : 'Adicionar projeto')}
      </Button>
    </>
  )

  return (
    <>
      <Dialog
        open
        title={edit ? 'Editar projeto' : 'Adicionar projeto'}
        titleId={TITLE_ID}
        onClose={onClose}
        footer={footer}
        returnFocusTo={returnFocusTo}
      >
        {body}
      </Dialog>
      {workspaceDialogOpen && (
        <WorkspaceDialog
          mutations={mutations}
          returnFocusTo={workspaceSelectRef}
          onClose={() => setWorkspaceDialogOpen(false)}
          onCreated={(created) => {
            setCreatedWorkspaces((previous) => [...previous, created])
            setWorkspaceId(created.id)
          }}
        />
      )}
    </>
  )
}
