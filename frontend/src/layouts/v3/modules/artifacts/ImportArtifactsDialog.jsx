import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { importArtifacts, listCandidates } from '../../../../services/artifactsApi.js'
import { KIND_LABEL, formatModified, splitCandidatesBySince } from '../../../../utils/artifactModel.js'
import { formatBytes } from '../../../../utils/viewerPaths.js'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { localizeViewerMessage } from '../viewer/ViewerShell.jsx'
import { placeLabel } from './artifactScope.js'

export const RECENT_WINDOW_DAYS = 5
const SKELETON_ROWS = 6
const OLDER_SKELETON_ROWS = 3
const LOAD_FAILED = 'Não consegui listar os arquivos do projeto.'
const IMPORT_FAILED = 'Não consegui importar. Tente de novo.'

const EMPTY_LIST = { status: 'idle', candidates: [], truncated: false, since: null, hasOlder: false, error: '' }

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

function SkeletonRows({ count }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="v3-import__row v3-import__row--skeleton" aria-hidden="true"><i /><i /></div>
  ))
}

function CandidateRow({ candidate, checked, disabled, reason, onToggle }) {
  const when = formatModified(candidate.mtime)
  const size = Number.isFinite(candidate.size) ? formatBytes(candidate.size) : ''
  return (
    <label className={`v3-import__row${reason ? ' v3-import__row--failed' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(candidate.path)} />
      <span className="v3-import__text">
        <span className="v3-import__name v3-type-mono-sm">{candidate.path.split('/').pop()}</span>
        <span className="v3-import__path v3-type-mono-sm" title={candidate.path}>{candidate.path}</span>
        <span className="v3-import__meta v3-type-mono-sm">
          <Chip tone="badge">{KIND_LABEL[candidate.kind] || candidate.kind}</Chip>
          {when ? <time dateTime={new Date(candidate.mtime * 1000).toISOString()}>{when}</time> : null}
          {size ? <span>{size}</span> : null}
        </span>
        {reason ? <span className="v3-msg v3-msg--err">{reason}</span> : null}
      </span>
    </label>
  )
}

// "Importar do projeto": the recent .md/.html/.pdf files of ONE project (the main folder), to turn into
// artifacts. The select offers only registered, not archived projects of the scope (K10).
//   projects           [{ key, name, workspaceName, folders }] (registry projects)
//   registry           the registry index (the labels of the places)
//   initialProjectKey  the project to start on (falls back to the first one)
//   onImported(result) { created, artifacts, errors } of the last request, also when some files failed
export default function ImportArtifactsDialog({ projects, registry, initialProjectKey = null, onClose, onImported, returnFocusTo = null }) {
  const ids = useId()
  const controllerRef = useRef(null)
  const olderInFlightRef = useRef(false)
  const importingRef = useRef(false)
  const mountedRef = useRef(true)
  const selectAllRef = useRef(null)
  const summaryRef = useRef(null)
  const olderHeadingRef = useRef(null)
  const options = useMemo(
    () => projects.map((project) => ({ project, label: placeLabel(project.key, registry) })),
    [projects, registry],
  )
  const [projectKey, setProjectKey] = useState(
    () => (options.some((option) => option.project.key === initialProjectKey) ? initialProjectKey : options[0]?.project.key ?? null),
  )
  const [list, setList] = useState(EMPTY_LIST)
  const [older, setOlder] = useState({ status: 'idle' })
  const [selected, setSelected] = useState(() => new Set())
  const [importing, setImporting] = useState(false)
  const [failures, setFailures] = useState({})
  const [generalError, setGeneralError] = useState('')
  const [summary, setSummary] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const project = options.find((option) => option.project.key === projectKey)?.project ?? null

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!projectKey) return undefined
    const controller = new AbortController()
    controllerRef.current = controller
    olderInFlightRef.current = false
    setList({ ...EMPTY_LIST, status: 'loading' })
    setOlder({ status: 'idle' })
    setSelected(new Set())
    setFailures({})
    setGeneralError('')
    setSummary(null)
    setAnnouncement('')
    listCandidates(projectKey, { windowDays: RECENT_WINDOW_DAYS, signal: controller.signal })
      .then(({ candidates, truncated, since, hasOlder }) => {
        if (!controller.signal.aborted) setList({ status: 'ready', candidates, truncated, since, hasOlder, error: '' })
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setList({ ...EMPTY_LIST, status: 'error', error: localizeViewerMessage(error?.message, LOAD_FAILED) })
      })
    return () => controller.abort()
  }, [projectKey, reloadToken])

  useEffect(() => {
    if (older.status === 'loaded') olderHeadingRef.current?.focus()
  }, [older.status])
  useEffect(() => {
    if (summary) summaryRef.current?.focus()
  }, [summary])

  // "Buscar mais antigos" REPLACES the list (the server answers with everything up to 300); what was
  // selected and is gone from the new answer is dropped, so it never reaches the POST.
  const loadOlder = () => {
    if (olderInFlightRef.current || importingRef.current || !projectKey) return
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted) return
    olderInFlightRef.current = true
    setOlder({ status: 'loading' })
    listCandidates(projectKey, { signal: controller.signal })
      .then(({ candidates, truncated }) => {
        if (controller.signal.aborted) return
        olderInFlightRef.current = false
        const { older: olderItems } = splitCandidatesBySince(candidates, list.since)
        setList((previous) => ({ ...previous, candidates, truncated }))
        const present = new Set(candidates.map((candidate) => candidate.path))
        setSelected((previous) => new Set([...previous].filter((path) => present.has(path))))
        setOlder({ status: 'loaded' })
        setAnnouncement(
          olderItems.length > 0
            ? `${plural(olderItems.length, 'arquivo mais antigo adicionado', 'arquivos mais antigos adicionados')}.`
            : 'Nada mais antigo neste projeto.',
        )
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        olderInFlightRef.current = false
        setOlder({ status: 'error' })
      })
  }

  const toggle = (path) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const { candidates } = list
  const ready = list.status === 'ready'
  const loading = list.status === 'idle' || list.status === 'loading'
  const hasItems = ready && candidates.length > 0
  const allSelected = hasItems && selected.size === candidates.length
  const someSelected = hasItems && selected.size > 0 && !allSelected
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected, hasItems])

  const olderLoaded = older.status === 'loaded'
  const searchingOlder = older.status === 'loading'
  const showLoadOlder = ready && list.hasOlder && !list.truncated && !olderLoaded
  const windowEmptyWithOlder = ready && candidates.length === 0 && showLoadOlder
  const { recent, older: olderItems } = splitCandidatesBySince(candidates, olderLoaded ? list.since : null)
  const extraFolders = project ? project.folders.length > 1 : false

  const submit = async () => {
    if (!projectKey || selected.size === 0 || searchingOlder || importingRef.current) return
    const sent = selected.size
    importingRef.current = true
    setImporting(true)
    setFailures({})
    setGeneralError('')
    setSummary(null)
    try {
      const result = await importArtifacts(projectKey, [...selected])
      onImported(result)
      if (!mountedRef.current) return
      if (result.errors.length === 0) {
        onClose()
        return
      }
      // Partial success: what worked leaves the list; what failed stays marked, with the reason.
      const reasons = Object.fromEntries(result.errors.map((entry) => [entry.caminho, localizeViewerMessage(entry.erro, IMPORT_FAILED)]))
      setList((previous) => ({ ...previous, candidates: previous.candidates.filter((candidate) => candidate.path in reasons) }))
      setSelected(new Set(Object.keys(reasons)))
      setFailures(reasons)
      setSummary({ ok: Math.max(0, sent - result.errors.length), failed: result.errors.length })
    } catch (error) {
      if (mountedRef.current) setGeneralError(localizeViewerMessage(error?.message, IMPORT_FAILED))
    } finally {
      importingRef.current = false
      if (mountedRef.current) setImporting(false)
    }
  }

  const olderButton = (
    <Button
      variant="text"
      aria-disabled={searchingOlder || importing ? 'true' : undefined}
      aria-busy={searchingOlder ? 'true' : undefined}
      onClick={loadOlder}
    >
      {searchingOlder ? 'Buscando…' : older.status === 'error' ? 'Tentar de novo' : 'Buscar mais antigos'}
    </Button>
  )
  const olderError = older.status === 'error' ? (
    <span className="v3-msg v3-msg--err" role="alert">Não consegui buscar os mais antigos.</span>
  ) : null
  const truncatedHint = list.truncated ? (
    <span className="v3-msg v3-msg--info">Mostrando os 300 arquivos mais recentes. Há mais arquivos além desse limite.</span>
  ) : null

  const rows = (items) => items.map((candidate) => (
    <CandidateRow
      key={candidate.path}
      candidate={candidate}
      checked={selected.has(candidate.path)}
      disabled={importing}
      reason={failures[candidate.path]}
      onToggle={toggle}
    />
  ))

  let body
  if (!projectKey) {
    body = <p className="v3-msg v3-msg--info">Não há projeto cadastrado para importar.</p>
  } else if (loading) {
    body = (
      <div aria-busy="true">
        <p className="v3-msg v3-msg--info" role="status">Procurando arquivos recentes…</p>
        <SkeletonRows count={SKELETON_ROWS} />
      </div>
    )
  } else if (list.status === 'error') {
    body = (
      <div role="alert" className="v3-import__empty">
        <p className="v3-msg v3-msg--err"><DialogIcon name="alert" size={16} />{list.error}</p>
        <Button variant="secondary" size="sm" onClick={() => setReloadToken((count) => count + 1)}>Tentar de novo</Button>
      </div>
    )
  } else if (windowEmptyWithOlder) {
    body = (
      <div className="v3-import__empty">
        <p className="v3-type-body">Nenhum arquivo novo nos últimos {RECENT_WINDOW_DAYS} dias.</p>
        {olderButton}
        {olderError}
      </div>
    )
  } else if (candidates.length === 0) {
    body = (
      <div className="v3-import__empty">
        <p className="v3-type-body">Nenhum arquivo para importar neste projeto.</p>
        <div className="v3-callout v3-callout--info">
          <p>Os .md, .html e .pdf daqui já estavam em Artefatos, ou ficam em pastas ocultas ou ignoradas.</p>
        </div>
      </div>
    )
  } else {
    body = (
      <div aria-busy={importing || searchingOlder ? 'true' : undefined}>
        <div className="v3-import__bar">
          <label className="v3-import__all">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              disabled={importing}
              onChange={() => setSelected(allSelected ? new Set() : new Set(candidates.map((candidate) => candidate.path)))}
            />
            <span>Selecionar todos ({candidates.length})</span>
          </label>
          <span className="v3-import__count v3-type-mono-sm">{plural(selected.size, 'selecionado', 'selecionados')}</span>
        </div>
        <div role="group" aria-label={`Últimos ${RECENT_WINDOW_DAYS} dias`} data-testid="import-group-recent">
          {rows(recent)}
        </div>
        {!olderLoaded ? (
          <div className="v3-import__more">
            {showLoadOlder ? olderButton : null}
            {olderError}
            {truncatedHint}
          </div>
        ) : null}
        {searchingOlder ? (
          <div>
            <p className="v3-msg v3-msg--info" role="status">Procurando arquivos mais antigos… isso pode demorar.</p>
            <SkeletonRows count={OLDER_SKELETON_ROWS} />
          </div>
        ) : null}
        {olderLoaded && olderItems.length > 0 ? (
          <div role="group" aria-labelledby={`${ids}-older`} data-testid="import-group-older">
            <h3 id={`${ids}-older`} ref={olderHeadingRef} tabIndex={-1} className="v3-type-eyebrow v3-import__heading">
              Mais antigos ({olderItems.length})
            </h3>
            {rows(olderItems)}
          </div>
        ) : null}
        {olderLoaded ? (
          <div className="v3-import__more">
            {olderItems.length === 0 ? <span className="v3-msg v3-msg--info">Nada mais antigo neste projeto.</span> : null}
            {truncatedHint}
          </div>
        ) : null}
      </div>
    )
  }

  const footer = (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button
        variant="primary"
        disabled={selected.size === 0 || importing || searchingOlder}
        {...(importing ? { 'aria-busy': 'true' } : {})}
        onClick={submit}
      >
        {importing ? 'Importando…' : `Importar ${plural(selected.size, 'arquivo', 'arquivos')}`}
      </Button>
    </>
  )

  return (
    <Dialog open title="Importar do projeto" titleId={`${ids}-title`} onClose={onClose} footer={footer} size="md" returnFocusTo={returnFocusTo}>
      <div className="v3-import" data-testid="import-artifacts-dialog">
        <div className="v3-field">
          <label className="v3-field__label" htmlFor={`${ids}-project`}>Projeto</label>
          <select
            id={`${ids}-project`}
            className="v3-input"
            value={projectKey ?? ''}
            disabled={importing || options.length === 0}
            onChange={(event) => setProjectKey(event.target.value || null)}
          >
            {options.map((option) => <option key={option.project.key} value={option.project.key}>{option.label}</option>)}
          </select>
        </div>
        {extraFolders ? (
          <div className="v3-callout v3-callout--warn">
            <p>Este projeto tem pastas adicionais; só a pasta principal pode ser importada.</p>
          </div>
        ) : null}
        {body}
        {summary ? (
          <div role="alert" className="v3-msg v3-msg--err">
            <span ref={summaryRef} tabIndex={-1}>
              {summary.ok} importado(s). Não consegui importar {summary.failed === 1 ? 'este' : `estes ${summary.failed}`}:
            </span>
          </div>
        ) : null}
        {generalError ? <p className="v3-msg v3-msg--err" role="alert"><DialogIcon name="alert" size={16} />{generalError}</p> : null}
        <span className="v3-import__sr" role="status" data-testid="import-announcement">{announcement}</span>
      </div>
    </Dialog>
  )
}
