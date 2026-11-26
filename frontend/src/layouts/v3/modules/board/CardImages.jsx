import { useEffect, useId, useRef, useState } from 'react'
import { useToast } from '../../components/Toast/toastContext.js'
import { cardErrorText } from './cardForm.js'

export const MAX_IMAGES = 5
// The limit of the server (5 MiB). The client says it first, because the client of the API loses the
// server's message.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const UPLOAD_FALLBACK = 'Não consegui enviar a imagem.'
const REMOVE_FALLBACK = 'Não consegui remover a imagem.'
const TOO_BIG_TEXT = 'A imagem passa de 5 MB.'

// The images of a card: thumbnails, "+" to add (up to 5), "×" to remove. The thumbnail asks the parent to
// enlarge it (the lightbox is a sibling of the card dialog, never a child).
//   images     [{ id, url }]
//   onUpload   (file) => Promise            onDelete  (imageId) => Promise
//   onEnlarge  (image, number, triggerElement)
// Nothing is `disabled` while a request is out (that would drop the focus): the controls say aria-busy
// or aria-disabled and ignore the press. The file input is fed one file at a time.
export default function CardImages({ images, onUpload, onDelete, onEnlarge }) {
  const headingId = useId()
  const toast = useToast()
  const inputRef = useRef(null)
  const addRef = useRef(null)
  const uploadingRef = useRef(false)
  const removingRef = useRef(new Set())
  const mountedRef = useRef(true)
  const [uploading, setUploading] = useState(false)
  const [failure, setFailure] = useState('')
  const [refocusAdd, setRefocusAdd] = useState(false)
  const atLimit = images.length >= MAX_IMAGES

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
    if (!active || active === document.body) addRef.current?.focus()
  }, [refocusAdd, images.length])

  const openPicker = () => {
    if (atLimit || uploadingRef.current) return
    inputRef.current?.click()
  }

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    // Cleared at once, so the same file can be chosen again after a refusal.
    event.target.value = ''
    if (!file || uploadingRef.current || atLimit) return
    if (file.size > MAX_IMAGE_BYTES) {
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

  const remove = async (image) => {
    if (removingRef.current.has(image.id)) return
    removingRef.current.add(image.id)
    setFailure('')
    try {
      await onDelete(image.id)
      if (mountedRef.current) setRefocusAdd(true)
    } catch (error) {
      if (mountedRef.current) setFailure(cardErrorText(error, REMOVE_FALLBACK))
    } finally {
      removingRef.current.delete(image.id)
    }
  }

  return (
    <section className="v3-card-images" role="region" aria-labelledby={headingId}>
      <h3 id={headingId} className="v3-card-section__title v3-type-label">Imagens ({images.length}/{MAX_IMAGES})</h3>
      <div className="v3-card-images__grid">
        {images.map((image, index) => (
          <div key={image.id} className="v3-card-images__item">
            <button
              type="button"
              className="v3-card-images__thumb"
              data-image-thumb={image.id}
              aria-label={`Ampliar imagem ${index + 1}`}
              onClick={(event) => onEnlarge(image, index + 1, event.currentTarget)}
            >
              <img src={image.url} alt="" />
            </button>
            <button
              type="button"
              className="v3-card-images__remove"
              aria-label={`Remover imagem ${index + 1}`}
              onClick={() => remove(image)}
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
        <button
          ref={addRef}
          type="button"
          className="v3-card-images__add"
          aria-label="Adicionar imagem"
          aria-disabled={atLimit || uploading ? 'true' : undefined}
          aria-busy={uploading ? 'true' : undefined}
          onClick={openPicker}
        >
          {uploading ? '…' : '+'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="v3-projects__sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
      </div>
      {atLimit && <p className="v3-card-images__hint v3-type-caption">5/5 imagens</p>}
      {failure && <p className="v3-msg v3-msg--err" role="alert">{failure}</p>}
    </section>
  )
}
