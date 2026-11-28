import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import { useToast } from '../../components/Toast/toastContext.js'
import { cardAttachmentItem, fileUrl } from '../../../../services/viewerApi.js'
import { MAX_ATTACHMENTS, isPreviewable } from '../../../../utils/cardAttachments.js'
import { formatBytes } from '../../../../utils/viewerPaths.js'
import { cardErrorText } from './cardForm.js'

export { MAX_ATTACHMENTS }
// The limit of the server (25 MiB). The client checks it first, so the person gets the message before the
// upload is sent.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const UPLOAD_FALLBACK = 'Não consegui enviar o anexo.'
const REMOVE_FALLBACK = 'Não consegui remover o anexo.'
const TOO_BIG_TEXT = 'O arquivo passa de 25 MB.'

const extensionLabel = (filename) => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename || ''))
  return match ? match[1].toUpperCase() : 'ARQ'
}

// The files attached to a card: a row per file with "Ver" (only when the type has a preview and a viewer
// exists), "Baixar" (a real link, never fetch + blob: on the iPad only a link tapped by the person saves a
// file) and "Remover"; "Anexar arquivo" up to 10.
//   attachments  [{ id, filename, size_bytes, created_at }]
//   onUpload     (file) => Promise            onDelete  (attachmentId) => Promise
//   onView       (attachment, triggerElement) or null: no viewer here, so only "Baixar" is offered
// Nothing is `disabled` while a request is out (that would drop the focus): the controls say aria-busy
// or aria-disabled and ignore the press. The file input is fed one file at a time.
export default function CardAttachments({ attachments, onUpload, onDelete, onView = null }) {
  const headingId = useId()
  const toast = useToast()
  const inputRef = useRef(null)
  const sectionRef = useRef(null)
  const uploadingRef = useRef(false)
  const removingRef = useRef(new Set())
  const mountedRef = useRef(true)
  const [uploading, setUploading] = useState(false)
  const [failure, setFailure] = useState('')
  const [refocusAdd, setRefocusAdd] = useState(false)
  const atLimit = attachments.length >= MAX_ATTACHMENTS

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // The file picker's native `cancel` bubbles up to the <dialog> around this section and would close the
  // card (its onCancel is the Esc route). It is stopped on the input itself.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined
    const stop = (event) => event.stopPropagation()
    input.addEventListener('cancel', stop)
    return () => input.removeEventListener('cancel', stop)
  }, [])

  // After a removal the pressed button is gone: the focus goes to the add button, but only if it was lost.
  useEffect(() => {
    if (!refocusAdd) return
    setRefocusAdd(false)
    const active = document.activeElement
    if (!active || active === document.body) sectionRef.current?.querySelector('[data-attachment-add]')?.focus()
  }, [refocusAdd, attachments.length])

  const openPicker = () => {
    if (atLimit || uploadingRef.current) return
    inputRef.current?.click()
  }

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    // Cleared at once, so the same file can be chosen again after a refusal.
    event.target.value = ''
    if (!file || uploadingRef.current || atLimit) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setFailure(TOO_BIG_TEXT)
      return
    }
    uploadingRef.current = true
    setUploading(true)
    setFailure('')
    try {
      await onUpload(file)
    } catch (error) {
      // after the dialog is gone there is no place to tell it but a toast
      if (mountedRef.current) setFailure(cardErrorText(error, UPLOAD_FALLBACK))
      else toast.push({ text: cardErrorText(error, UPLOAD_FALLBACK), kind: 'error' })
    } finally {
      uploadingRef.current = false
      if (mountedRef.current) setUploading(false)
    }
  }

  const remove = async (attachment) => {
    if (removingRef.current.has(attachment.id)) return
    removingRef.current.add(attachment.id)
    setFailure('')
    try {
      await onDelete(attachment.id)
      if (mountedRef.current) setRefocusAdd(true)
    } catch (error) {
      if (mountedRef.current) setFailure(cardErrorText(error, REMOVE_FALLBACK))
      else toast.push({ text: cardErrorText(error, REMOVE_FALLBACK), kind: 'error' })
    } finally {
      removingRef.current.delete(attachment.id)
    }
  }

  return (
    <section ref={sectionRef} className="v3-card-attachments" role="region" aria-labelledby={headingId}>
      <h3 id={headingId} className="v3-card-section__title v3-type-label">Anexos ({attachments.length}/{MAX_ATTACHMENTS})</h3>
      {attachments.length > 0 && (
        <ul className="v3-card-attachments__list">
          {attachments.map((attachment) => {
            const downloadHref = fileUrl(cardAttachmentItem(attachment), attachment.filename, { download: true })
            return (
              <li key={attachment.id} className="v3-card-attachments__row" data-attachment-id={attachment.id}>
                <span className="v3-card-attachments__ext v3-type-caption" aria-hidden="true">{extensionLabel(attachment.filename)}</span>
                <span className="v3-card-attachments__name" title={attachment.filename}>{attachment.filename}</span>
                <span className="v3-card-attachments__size v3-type-caption">{formatBytes(attachment.size_bytes)}</span>
                {onView && isPreviewable(attachment.filename) && (
                  <Button
                    variant="text"
                    data-attachment-view={attachment.id}
                    aria-label={`Ver ${attachment.filename}`}
                    onClick={(event) => onView(attachment, event.currentTarget)}
                  >
                    Ver
                  </Button>
                )}
                <a
                  className="v3-button v3-button--text v3-button--md"
                  href={downloadHref}
                  download={attachment.filename}
                  aria-label={`Baixar ${attachment.filename}`}
                >
                  Baixar
                </a>
                <Button variant="text" aria-label={`Remover ${attachment.filename}`} onClick={() => remove(attachment)}>
                  Remover
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <Button
        data-attachment-add=""
        variant="secondary"
        className="v3-card-attachments__add"
        aria-disabled={atLimit || uploading ? 'true' : undefined}
        aria-busy={uploading ? 'true' : undefined}
        onClick={openPicker}
      >
        {uploading ? 'Enviando…' : 'Anexar arquivo'}
      </Button>
      <input ref={inputRef} type="file" className="v3-projects__sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
      {atLimit && <p className="v3-card-images__hint v3-type-caption">{MAX_ATTACHMENTS}/{MAX_ATTACHMENTS} anexos</p>}
      {failure && <p className="v3-msg v3-msg--err" role="alert">{failure}</p>}
    </section>
  )
}
