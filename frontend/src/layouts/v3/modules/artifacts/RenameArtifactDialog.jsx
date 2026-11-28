import { useEffect, useId, useRef, useState } from 'react'
import { renameArtifact } from '../../../../services/artifactsApi.js'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { localizeViewerMessage } from '../viewer/ViewerShell.jsx'

const EMPTY_TITLE = 'Dê um título ao artefato.'
const FALLBACK = 'Não consegui renomear. Tente de novo.'

// "Renomear artefato". Mount it only while it is open (the field is born with it).
//   artifact      the row
//   onRenamed     (updatedArtifact) => void, called once the server answered
// An empty title is refused here (no request). The same title closes without one. A title chosen here
// becomes the explicit one on the server: the agent opening the file again does not overwrite it.
export default function RenameArtifactDialog({ artifact, onClose, onRenamed, returnFocusTo = null }) {
  const [title, setTitle] = useState(artifact.title || '')
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const inputRef = useRef(null)
  const ids = useId()
  const formId = `${ids}-form`
  const fieldId = `${ids}-field`
  const errorId = `${ids}-error`

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (savingRef.current) return
    const next = title.trim()
    if (!next) {
      setFailure(EMPTY_TITLE)
      inputRef.current?.focus()
      return
    }
    if (next === (artifact.title || '').trim()) {
      onClose()
      return
    }
    savingRef.current = true
    setSaving(true)
    setFailure('')
    try {
      const updated = await renameArtifact(artifact.artifact_id, next)
      if (mountedRef.current) {
        onRenamed(updated)
        onClose()
      }
    } catch (error) {
      if (mountedRef.current) {
        setFailure(localizeViewerMessage(error?.message, FALLBACK))
        inputRef.current?.focus()
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const footer = (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button
        variant="primary"
        type="submit"
        form={formId}
        {...(saving ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}
      >
        {saving ? 'Renomeando…' : 'Renomear'}
      </Button>
    </>
  )

  return (
    <Dialog open title="Renomear artefato" titleId={`${ids}-title`} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      <form id={formId} className="v3-field" onSubmit={submit} noValidate>
        <label className="v3-field__label" htmlFor={fieldId}>Título</label>
        <input
          ref={inputRef}
          id={fieldId}
          className="v3-input"
          value={title}
          maxLength={200}
          autoComplete="off"
          data-autofocus=""
          aria-invalid={failure ? 'true' : undefined}
          aria-describedby={failure ? errorId : undefined}
          onChange={(event) => {
            setTitle(event.target.value)
            if (failure) setFailure('')
          }}
        />
        <span className="v3-field__help">O arquivo {artifact.path} continua com o mesmo nome.</span>
        {failure && (
          <span className="v3-msg v3-msg--err" id={errorId} role="alert">
            <DialogIcon name="alert" size={16} />
            {failure}
          </span>
        )}
      </form>
    </Dialog>
  )
}
