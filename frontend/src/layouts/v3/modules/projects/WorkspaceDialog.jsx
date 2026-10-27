import { useEffect, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { NAME_MAX, MESSAGES, describeRequestError } from './folderRules.js'

const TITLE_ID = 'dlg-ws-title'

// "Novo workspace". Mount it only while it is open (the form state is born with it).
//
// adoptLegacyKey: turns a client the V2 created after the migration into a
// workspace that keeps its history. The name arrives filled with that client's name
// and the title says where it comes from; the key travels as `adopt_legacy_key`.
//
// mutations: the object of useRegistryMutations (only createWorkspace is used).
// onCreated(workspace) runs once the registry was refetched.
export default function WorkspaceDialog({
  mutations,
  onClose,
  onCreated,
  initialName = '',
  adoptLegacyKey = null,
  returnFocusTo = null,
}) {
  const [name, setName] = useState(initialName)
  const [tried, setTried] = useState(false)
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const inputRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const trimmed = name.trim()
  const invalid = trimmed.length < 1 || trimmed.length > NAME_MAX
  const showInvalid = tried && invalid

  const submit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (invalid) {
      setTried(true)
      inputRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setFailure('')
    try {
      const result = await mutations.createWorkspace({ name: trimmed, adoptLegacyKey })
      if (!mountedRef.current) return
      onCreated?.(result.workspace)
      onClose()
    } catch (error) {
      if (mountedRef.current) setFailure(describeRequestError(error, { scope: 'workspace' }))
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const title = adoptLegacyKey ? `Criar workspace a partir de ${adoptLegacyKey}` : 'Novo workspace'
  const footer = (
    <>
      {failure ? <p className="v3-dialog__why" role="alert">{failure}</p> : <span className="v3-dialog__footer-spacer" />}
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button
        variant="primary"
        type="submit"
        form="ws-form"
        {...(submitting ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}
      >
        {submitting ? 'Criando…' : 'Criar workspace'}
      </Button>
    </>
  )

  return (
    <Dialog open title={title} titleId={TITLE_ID} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      <form id="ws-form" className="v3-field" onSubmit={submit} noValidate>
        <label className="v3-field__label" htmlFor="ws-name">Nome do workspace</label>
        <input
          ref={inputRef}
          id="ws-name"
          className="v3-input"
          maxLength={NAME_MAX}
          value={name}
          placeholder="Ex.: Estudos"
          autoComplete="off"
          aria-required="true"
          aria-invalid={showInvalid ? 'true' : undefined}
          aria-describedby={showInvalid ? 'ws-err' : 'ws-help'}
          onChange={(event) => setName(event.target.value)}
        />
        {showInvalid ? (
          <span className="v3-msg v3-msg--err" id="ws-err">
            <DialogIcon name="alert" size={16} />
            {MESSAGES.invalid_name}
          </span>
        ) : (
          <span className="v3-field__help" id="ws-help">1 a 80 caracteres. Você pode renomear depois.</span>
        )}
      </form>
      <div className="v3-callout v3-callout--info">
        <DialogIcon name="info" />
        <span>Um workspace agrupa projetos, como um cliente. Ele nasce vazio e você adiciona projetos em seguida.</span>
      </div>
    </Dialog>
  )
}
