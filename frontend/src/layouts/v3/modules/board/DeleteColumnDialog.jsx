import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { COLUMN_DELETE_REFUSAL_TEXT, columnDeleteRefusal } from './columnErrors.js'

// "Excluir coluna". Opens as the question and, if the server refuses, turns into the explanation
// (same dialog, only "Entendi"): the board cannot count the cards of a column on its own (it may
// show a filtered subset, and other workspaces count too), so the answer of the server is the only
// one to trust. The refusal is told by its reason, never by the server's words.
// There is no danger variant of the button, so the risk is stated in a warning callout.
//   column     { slug, label }
//   onDelete   (slug) => Promise; rejects with an Error carrying `reason` and `cards` on a refusal
export default function DeleteColumnDialog({ column, onDelete, onClose, returnFocusTo = null }) {
  const [refusal, setRefusal] = useState(null)
  const [failed, setFailed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const mountedRef = useRef(true)
  const titleId = useId()
  const understoodId = `${titleId}-understood`

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // "Excluir" leaves with the question: the focus goes to the button that closes the explanation.
  useEffect(() => {
    if (refusal) document.getElementById(understoodId)?.focus()
  }, [refusal, understoodId])

  const confirm = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setFailed(false)
    try {
      await onDelete(column.slug)
      if (mountedRef.current) onClose()
    } catch (error) {
      if (!mountedRef.current) return
      const reason = columnDeleteRefusal(error)
      if (reason) setRefusal({ reason, cards: error.cards || 0 })
      else setFailed(true)
    } finally {
      deletingRef.current = false
      if (mountedRef.current) setDeleting(false)
    }
  }

  const footer = refusal ? (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="primary" id={understoodId} data-autofocus onClick={onClose}>Entendi</Button>
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
    <Dialog open title="Excluir coluna" titleId={titleId} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      {refusal ? (
        <div className="v3-callout v3-callout--info">
          <DialogIcon name="info" />
          <div>
            <p>{COLUMN_DELETE_REFUSAL_TEXT[refusal.reason]}</p>
            {refusal.reason === 'coluna_com_cards' && refusal.cards > 0 && (
              <p>São {refusal.cards} cards, em todos os workspaces.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="v3-callout v3-callout--warn">
            <DialogIcon name="alert" />
            <p>
              Excluir a coluna <b>{column.label}</b>? Ela some de todos os workspaces.
            </p>
          </div>
          {failed && (
            <span className="v3-msg v3-msg--err" role="alert">
              <DialogIcon name="alert" size={16} />
              Não consegui excluir. Tente de novo.
            </span>
          )}
        </>
      )}
    </Dialog>
  )
}
