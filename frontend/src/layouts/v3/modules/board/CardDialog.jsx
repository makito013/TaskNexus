import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { useToast } from '../../components/Toast/toastContext.js'
import { placeOf } from './boardScope.js'
import CardImages from './CardImages.jsx'
import CardQuestions from './CardQuestions.jsx'
import { CardMainFields, CardRailFields } from './CardFields.jsx'
import DeleteCardDialog from './DeleteCardDialog.jsx'
import ImageLightbox from './ImageLightbox.jsx'
import { CARD_SAVE_FALLBACK, buildCreatePayload, buildPatch, cardErrorText } from './cardForm.js'
import { listDestinations } from './destinations.js'
import { formatCardId } from '../../../../utils/cardMeta.js'
import './CardDialog.css'

const DELETE_FALLBACK = 'Não consegui excluir o card. Tente de novo.'
const SAVE_CLOSED_FALLBACK = 'Não consegui salvar o card. Tente de novo.'

const isNowhere = () => !document.activeElement || document.activeElement === document.body

// The dialog of a card, to create one (`mode="create"`) or to read and change one (`mode="edit"`).
//   card          the card as the board knows it NOW (edit); the dialog never replaces what the person touched
//   createDefaults  { projectKey, status } (create)
//   registry, columns, doneSlug
//   leavesView(projectKey)  would a card in that place leave the list that is on screen?
//   onSave(payloadOrPatch) => Promise     onDelete(card) => Promise
//   onUploadImage(file) onDeleteImage(id) onAnswerQuestion(id, text) onDeleteQuestion(id)
//   onClose()  returnFocusTo
//
// Only the fields the person touched are sent when editing (an untouched one follows the card, so a change
// that an agent made meanwhile shows up and is never overwritten); creating sends everything. Saving
// without a change sends nothing. The confirmation, the lightbox and the toast are SIBLINGS of the
// <Dialog> (never inside it): a synthetic Esc or click would otherwise reach this dialog's own handlers.
export default function CardDialog({
  mode,
  card = null,
  createDefaults = null,
  columns,
  doneSlug,
  registry,
  leavesView = () => false,
  onSave,
  onDelete,
  onUploadImage,
  onDeleteImage,
  onAnswerQuestion,
  onDeleteQuestion,
  onClose,
  returnFocusTo = null,
}) {
  const isEdit = mode === 'edit'
  const toast = useToast()
  const titleId = useId()
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const [dirty, setDirty] = useState(() => new Set())
  const [form, setForm] = useState(() => ({
    titulo: card?.titulo ?? '',
    descricao: card?.descricao ?? '',
    status: card?.status ?? createDefaults?.status ?? columns[0]?.slug ?? '',
    tipo: card?.tipo ?? '',
    prazo: card?.prazo ?? '',
    prioridade: card?.prioridade ?? '',
    projectKey: card?.projeto_id ?? createDefaults?.projectKey ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState('')
  const [gone, setGone] = useState(false)
  const [titleError, setTitleError] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // "Este card não existe mais." takes the "Salvar" away: the focus goes to "Fechar", the one button left,
  // but only if it was lost (a person who already moved to another control keeps their place).
  useEffect(() => {
    if (!gone || !isNowhere()) return
    bodyRef.current?.closest('dialog')?.querySelector('[data-card-close]')?.focus()
  }, [gone])

  const busy = saving || deleting
  // What is on screen: the touched fields come from the form, the rest from the card (it may have changed).
  const values = useMemo(() => {
    if (!isEdit || !card) return form
    const pick = (field, cardValue) => (dirty.has(field) ? form[field] : (cardValue ?? ''))
    return {
      titulo: pick('titulo', card.titulo),
      descricao: pick('descricao', card.descricao),
      status: pick('status', card.status),
      tipo: pick('tipo', card.tipo),
      prazo: pick('prazo', card.prazo),
      prioridade: pick('prioridade', card.prioridade),
      projectKey: dirty.has('projeto') ? form.projectKey : card.projeto_id,
    }
  }, [isEdit, card, form, dirty])

  const isSubcard = isEdit && card?.parent_id != null
  const groups = useMemo(
    () => (isSubcard ? null : listDestinations(registry, isEdit ? card?.projeto_id : null)),
    [registry, isEdit, isSubcard, card?.projeto_id],
  )

  const change = (field, value) => {
    if (busyRef.current) return
    const target = field === 'projeto' ? 'projectKey' : field
    setForm((current) => ({ ...current, [target]: value }))
    setDirty((current) => (current.has(field) ? current : new Set(current).add(field)))
    if (field === 'titulo') setTitleError(false)
    if (failure && !gone) setFailure('')
  }

  const failed = (error, fallback) => {
    // The dialog is gone (closed while the request was out): there is no field to tell it in, so it is a toast.
    if (!mountedRef.current) {
      toast.push({ text: cardErrorText(error, fallback === CARD_SAVE_FALLBACK ? SAVE_CLOSED_FALLBACK : fallback), kind: 'error' })
      return
    }
    setFailure(cardErrorText(error, fallback))
    if (error && error.cardGone) setGone(true)
    // The focus only comes back when it was nowhere: a person who already moved on keeps their place.
    if (isNowhere()) bodyRef.current?.closest('dialog')?.querySelector('[data-card-save]')?.focus()
  }

  const save = async () => {
    if (busyRef.current || gone) return
    if (!values.titulo.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }
    // The title was touched or, when creating, always present: build from what is on screen.
    const snapshot = { ...values }
    const body = isEdit ? buildPatch(snapshot, dirty, card) : buildCreatePayload(snapshot)
    if (isEdit && Object.keys(body).length === 0) {
      onClose()
      return
    }
    busyRef.current = true
    setSaving(true)
    setFailure('')
    try {
      await onSave(body)
      // The success is told even if the dialog was closed meanwhile; only the closing needs it to be there.
      if (isEdit) {
        toast.push({ text: 'Card salvo.' })
      } else {
        const place = placeOf(snapshot.projectKey, registry)
        // The root of a workspace is a registered project keyed like the workspace: it is "Do workspace".
        const root = registry.workspaceByKey?.get(snapshot.projectKey)
        const where = root
          ? `Do workspace ${root.name}`
          : (place.project ? `${place.project} (${place.workspace})` : `Do workspace ${place.workspace}`)
        toast.push({ text: `Card criado em ${where}.` })
      }
      if (mountedRef.current) onClose()
    } catch (error) {
      failed(error, CARD_SAVE_FALLBACK)
    } finally {
      busyRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const deleteNow = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setDeleting(true)
    setFailure('')
    try {
      await onDelete(card)
      toast.push({ text: 'Card excluído.' })
      if (mountedRef.current) onClose()
    } catch (error) {
      failed(error, DELETE_FALLBACK)
    } finally {
      busyRef.current = false
      if (mountedRef.current) setDeleting(false)
    }
  }

  const askDelete = () => {
    if (busyRef.current || gone) return
    if ((card?.subcards?.length ?? 0) > 0) setConfirmDelete(true)
    else deleteNow()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      save()
    }
  }

  const leaving = isEdit && dirty.has('projeto') && values.projectKey !== card?.projeto_id && leavesView(values.projectKey)
  const busyProps = (label) => (label ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})

  const footer = gone ? (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="primary" data-card-close onClick={onClose}>Fechar</Button>
    </>
  ) : (
    <>
      {isEdit && (
        <Button variant="secondary" {...busyProps(deleting)} onClick={askDelete}>{deleting ? 'Excluindo…' : 'Excluir card'}</Button>
      )}
      <span className="v3-dialog__footer-spacer" />
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button data-card-save variant="primary" {...busyProps(saving)} onClick={save}>
        {saving ? (isEdit ? 'Salvando…' : 'Criando…') : (isEdit ? 'Salvar' : 'Criar card')}
      </Button>
    </>
  )

  const returnToThumb = (id) => () => bodyRef.current?.querySelector(`[data-image-thumb="${id}"]`)

  const layout = (
    <div
      ref={bodyRef}
      className="v3-card-dialog"
      aria-busy={busy ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      // edit: the panel itself takes the initial focus (no keyboard over a card opened to read); it comes
      // BEFORE every field in the document, which is what the dialog's focus query looks at
      {...(isEdit ? { tabIndex: -1, 'data-autofocus': true } : {})}
    >
      <div className="v3-card-dialog__main">
        {isEdit && (
          <div className="v3-card-dialog__id">
            <Chip tone="id">{formatCardId(card.id)}</Chip>
          </div>
        )}
        {gone && (
          <div className="v3-callout v3-callout--warn" role="alert">
            <DialogIcon name="alert" />
            <p>{failure}</p>
          </div>
        )}
        <CardMainFields
          mode={mode}
          values={values}
          titleError={titleError}
          hasDescription={Boolean(card?.descricao)}
          titleRef={titleRef}
          onChange={change}
        />
        {isEdit && (
          <>
            <CardImages
              images={card.imagens ?? []}
              onUpload={onUploadImage}
              onDelete={onDeleteImage}
              onEnlarge={(image, number, trigger) => setLightbox({ image, number, trigger })}
            />
            <CardQuestions questions={card.questions ?? []} onAnswer={onAnswerQuestion} onDelete={onDeleteQuestion} />
          </>
        )}
      </div>
      <div className="v3-card-dialog__rail">
        <CardRailFields
          mode={mode}
          values={values}
          columns={columns}
          doneSlug={doneSlug}
          card={card}
          groups={groups}
          leaving={leaving}
          onChange={change}
          onPlaceGroup={(key) => change('projeto', key)}
        />
      </div>
      {failure && !gone && (
        <p className="v3-msg v3-msg--err v3-card-dialog__error" role="alert">
          <DialogIcon name="alert" size={16} />
          {failure}
        </p>
      )}
    </div>
  )

  return (
    <>
      <Dialog
        open
        title={isEdit ? card.titulo : 'Novo card'}
        titleId={titleId}
        onClose={onClose}
        footer={footer}
        size="wide"
        returnFocusTo={returnFocusTo}
      >
        {layout}
      </Dialog>
      {lightbox && (
        <ImageLightbox
          image={lightbox.image}
          number={lightbox.number}
          onClose={() => setLightbox(null)}
          returnFocusTo={lightbox.trigger}
        />
      )}
      {confirmDelete && (
        <DeleteCardDialog
          card={card}
          subcount={card.subcards.length}
          onDelete={async () => {
            await onDelete(card)
            toast.push({ text: 'Card excluído.' })
            onClose()
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
