import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { cardErrorText } from './cardForm.js'

const FALLBACK = 'Não consegui excluir o card. Tente de novo.'

// "Excluir card", asked only when the card has subtasks (without them it is deleted straight away).
// No field in the body and "Cancelar" present from the first render, so the focus starts on it.
//   subcount   how many subtasks go with it
//   onDelete   () => Promise
export default function DeleteCardDialog({ card, subcount, onDelete, onClose, returnFocusTo = null }) {
  const [failure, setFailure] = useState('')
  const [gone, setGone] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const mountedRef = useRef(true)
  const titleId = useId()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const confirm = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setFailure('')
    try {
      await onDelete(card)
      if (mountedRef.current) onClose()
    } catch (error) {
      if (!mountedRef.current) return
      setFailure(cardErrorText(error, FALLBACK))
      if (error && error.cardGone) setGone(true)
    } finally {
      deletingRef.current = false
      if (mountedRef.current) setDeleting(false)
    }
  }

  const footer = gone ? (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="primary" data-autofocus onClick={onClose}>Fechar</Button>
    </>
  ) : (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="secondary" data-autofocus onClick={onClose}>Cancelar</Button>
      <Button
        variant="primary"
        {...(deleting ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}
        onClick={confirm}
      >
        {deleting ? 'Excluindo…' : 'Excluir'}
      </Button>
    </>
  )

  return (
    <Dialog open title="Excluir card" titleId={titleId} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      {!gone && (
        <div className="v3-callout v3-callout--warn">
          <DialogIcon name="alert" />
          <p>
            Excluir este card? Apagar o card também apaga {subcount === 1 ? 'a 1 subtarefa' : `as ${subcount} subtarefas`}.
          </p>
        </div>
      )}
      {failure && (
        <span className="v3-msg v3-msg--err" role="alert">
          <DialogIcon name="alert" size={16} />
          {failure}
        </span>
      )}
    </Dialog>
  )
}
