import { useEffect, useId, useRef, useState } from 'react'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import Button from '../../components/Button/Button.jsx'
import { columnErrorMessage } from './columnErrors.js'

const FALLBACK = 'Não consegui criar a coluna. Tente de novo.'

// The ghost column at the end of the board: "+ Nova coluna" becomes a field. Enter creates, Escape
// cancels and gives the focus back to the button, an empty name is dropped. The server's refusal (a
// repeated name) stays under the field, which keeps what was typed and takes the focus back when the
// focus was lost with the disabled field, never from a control the person already moved to (a menu
// that is open keeps it). Leaving the field with a name creates the column, as the V2 does, but not
// with the name that was just refused (Enter still sends it again); a different text brings the
// blur back. Leaving it empty goes back to the button.
//   onCreate(label)   Promise<column>; rejects with an Error whose message is the server's
//   onCreated(column) told after it was created (the board scrolls to it)
// `first` is the board with no column at all: the button says so and sits bare, as a primary action.
export default function NewColumn({ onCreate, onCreated, first = false }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const holderRef = useRef(null)
  const inputRef = useRef(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const restoreFocusRef = useRef(false)
  // The name the server just refused: leaving the field does not send it again.
  const refusedRef = useRef('')
  const errorId = useId()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // A refusal re-enables the field: the focus returns to it, or Escape and the next keystroke would
  // go to the page instead of the name that is still there. Only when the focus is on nothing: if the
  // person already went to another control, the error stays under the field and the focus stays there.
  useEffect(() => {
    if (!failure || busy) return
    const active = document.activeElement
    if (!active || active === document.body || active === inputRef.current) inputRef.current?.focus()
  }, [failure, busy])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      holderRef.current?.querySelector('button')?.focus()
    }
  }, [editing])

  const stop = (restoreFocus) => {
    restoreFocusRef.current = restoreFocus
    setName('')
    setFailure('')
    setEditing(false)
  }

  const commit = async () => {
    if (busyRef.current) return
    const label = name.trim()
    if (!label) {
      stop(true)
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure('')
    refusedRef.current = ''
    try {
      const created = await onCreate(label)
      if (!mountedRef.current) return
      stop(false)
      onCreated?.(created)
    } catch (error) {
      refusedRef.current = label
      if (mountedRef.current) setFailure(columnErrorMessage(error, FALLBACK))
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div ref={holderRef} className={`v3-board-newcolumn${first ? ' v3-board-newcolumn--first' : ''}`}>
        <Button variant={first ? 'primary' : 'text'} className="v3-board-newcolumn__button" onClick={() => setEditing(true)}>
          {first ? 'Criar a primeira coluna' : '+ Nova coluna'}
        </Button>
      </div>
    )
  }

  return (
    <div className={`v3-board-newcolumn v3-board-newcolumn--editing${first ? ' v3-board-newcolumn--first' : ''}`}>
      <input
        ref={inputRef}
        className="v3-input"
        value={name}
        placeholder="Nome da coluna"
        aria-label="Nome da nova coluna"
        autoComplete="off"
        disabled={busy}
        aria-busy={busy ? 'true' : undefined}
        aria-invalid={failure ? 'true' : undefined}
        aria-describedby={failure ? errorId : undefined}
        onChange={(event) => {
          setName(event.target.value)
          if (failure) setFailure('')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            stop(true)
          }
        }}
        onBlur={() => {
          if (busyRef.current) return
          const label = name.trim()
          if (!label) stop(false)
          else if (label !== refusedRef.current) commit()
        }}
      />
      {failure && (
        <span className="v3-msg v3-msg--err" id={errorId} role="alert">
          <DialogIcon name="alert" size={16} />
          {failure}
        </span>
      )}
    </div>
  )
}
