import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { columnErrorMessage } from './columnErrors.js'

const FALLBACK = 'Não consegui renomear. Tente de novo.'

// "Renomear coluna". Mount it only while it is open (the field is born with it).
//   column     { slug, label }
//   onRename   (slug, label) => Promise; rejects with an Error whose message is the server's
//              (an empty or repeated name), shown inside without closing
// The same name closes with no request: there is nothing to say.
export default function RenameColumnDialog({ column, onRename, onClose, returnFocusTo = null }) {
  const [name, setName] = useState(column.label)
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const inputRef = useRef(null)
  const ids = useId()
  const formId = `${ids}-form`
  const fieldId = `${ids}-field`
  const helpId = `${ids}-help`
  const errorId = `${ids}-error`

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (savingRef.current) return
    const next = name.trim()
    if (next === column.label.trim()) {
      onClose()
      return
    }
    savingRef.current = true
    setSaving(true)
    setFailure('')
    try {
      await onRename(column.slug, next)
      if (mountedRef.current) onClose()
    } catch (error) {
      if (mountedRef.current) {
        setFailure(columnErrorMessage(error, FALLBACK))
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
    <Dialog open title="Renomear coluna" titleId={`${ids}-title`} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      <form id={formId} className="v3-field" onSubmit={submit} noValidate>
        <label className="v3-field__label" htmlFor={fieldId}>Nome da coluna</label>
        <input
          ref={inputRef}
          id={fieldId}
          className="v3-input"
          value={name}
          autoComplete="off"
          aria-invalid={failure ? 'true' : undefined}
          aria-describedby={failure ? `${helpId} ${errorId}` : helpId}
          onChange={(event) => {
            setName(event.target.value)
            if (failure) setFailure('')
          }}
        />
        <span className="v3-field__help" id={helpId}>A coluna vale para todos os workspaces.</span>
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
