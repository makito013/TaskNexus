import { useEffect, useRef, useState } from 'react'

// Inline rename of a chat (list row and header): Enter saves, Esc cancels (and stops there, so it
// never reaches the chat's "Esc interrupts"), a failed save keeps the field open with the error.
//   onSave(name) -> Promise<boolean>     onCancel()
export default function RenameField({ initial, label, error = false, busy = false, onSave, onCancel }) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const save = async () => {
    const name = value.trim()
    if (!name || busy) return
    const ok = await onSave(name)
    if (ok) onCancel()
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
  }

  return (
    <div className="v3-chat-rename">
      <input
        ref={inputRef}
        className="v3-input v3-chat-rename__input"
        value={value}
        maxLength={120}
        aria-label={label}
        aria-invalid={error ? 'true' : undefined}
        aria-busy={busy ? 'true' : undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error ? <p className="v3-msg v3-msg--err" role="alert">Não foi possível renomear. Tente de novo.</p> : null}
    </div>
  )
}
