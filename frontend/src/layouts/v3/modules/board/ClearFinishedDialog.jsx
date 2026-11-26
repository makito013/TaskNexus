import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { cardErrorText } from './cardForm.js'

const PREVIEW_FALLBACK = 'Não consegui contar os cards concluídos. Tente de novo.'
const EXECUTE_FALLBACK = 'Não consegui limpar os concluídos. Tente de novo.'
const plural = (count) => (count === 1 ? '1 card' : `${count} cards`)
const pluralImages = (count) => (count === 1 ? '1 imagem' : `${count} imagens`)

// "Limpar concluídos" for ONE exact target (a project, or the root of a workspace). It reads how many cards
// would go, asks, runs. Phases: loading, empty, ready, executing (a flag over ready), error (of the preview
// or of the run). "Cancelar" is there from the first render (the initial focus) and the body has no field.
// `imagens_com_falha` never gets here: the hook drops it.
//   targetLabel  the name shown        onPreview () => Promise<{ cards, imagens }>     onExecute () => Promise<{ cards }>
//   onDone(count)  told after a successful run; the caller closes and says it
export default function ClearFinishedDialog({ targetLabel, onPreview, onExecute, onDone, onClose, returnFocusTo = null }) {
  const [phase, setPhase] = useState('loading')
  const [count, setCount] = useState(0)
  const [imageCount, setImageCount] = useState(0)
  const [failure, setFailure] = useState('')
  const [failedStep, setFailedStep] = useState(null)
  const [executing, setExecuting] = useState(false)
  const executingRef = useRef(false)
  const bodyRef = useRef(null)
  const retriedRef = useRef(false)
  const mountedRef = useRef(true)
  const titleId = useId()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const preview = useCallback(async () => {
    setPhase('loading')
    setFailure('')
    try {
      const result = await onPreview()
      if (!mountedRef.current) return
      setCount(result.cards)
      setImageCount(result.imagens ?? 0)
      setPhase(result.cards === 0 ? 'empty' : 'ready')
    } catch (error) {
      if (!mountedRef.current) return
      setFailedStep('preview')
      setFailure(cardErrorText(error, PREVIEW_FALLBACK))
      setPhase('error')
    }
  }, [onPreview])

  // Read once on opening (the target is fixed for the life of the dialog).
  useEffect(() => {
    preview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const execute = async () => {
    if (executingRef.current || phase === 'loading' || phase === 'empty') return
    executingRef.current = true
    setExecuting(true)
    setFailure('')
    try {
      const result = await onExecute()
      if (!mountedRef.current) return
      onDone(result.cards)
      onClose()
    } catch (error) {
      if (!mountedRef.current) return
      setFailedStep('execute')
      setFailure(cardErrorText(error, EXECUTE_FALLBACK))
    } finally {
      executingRef.current = false
      if (mountedRef.current) setExecuting(false)
    }
  }

  // "Tentar de novo" leaves with the failure it answered: if the focus was lost with it, it goes to the first
  // button of the footer ("Cancelar", or "Fechar" when there is nothing to clear). A focus that is elsewhere stays.
  useEffect(() => {
    if (!retriedRef.current) return
    const active = document.activeElement
    if (!active || active === document.body) {
      bodyRef.current?.closest('dialog')?.querySelector('[data-autofocus]')?.focus()
    }
    if (phase !== 'loading' && !executing) retriedRef.current = false
  }, [phase, failure, executing])

  const retry = () => {
    retriedRef.current = true
    return failedStep === 'preview' ? preview() : execute()
  }
  const showRetry = Boolean(failure)

  let body
  if (phase === 'loading') {
    body = (
      <div aria-busy="true">
        <p className="v3-type-body-sm">Contando os cards concluídos…</p>
        <div className="v3-board-skeleton"><i className="v3-board-skeleton__bar v3-board-skeleton__bar--wide" /><i className="v3-board-skeleton__bar" /></div>
      </div>
    )
  } else if (phase === 'empty') {
    body = <p className="v3-type-body-sm">Nenhum card concluído em {targetLabel}.</p>
  } else if (phase === 'error') {
    body = null
  } else {
    body = (
      <div className="v3-callout v3-callout--warn">
        <DialogIcon name="alert" />
        <p>Vão ser excluídos <b>{plural(count)}</b> {count === 1 ? 'concluído' : 'concluídos'}{imageCount > 0 && <> e <b>{pluralImages(imageCount)}</b></>} de <b>{targetLabel}</b>. Isso não pode ser desfeito.</p>
      </div>
    )
  }

  const actionable = phase === 'ready' || (phase === 'error' && failedStep === 'execute')
  const footer = phase === 'empty' ? (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="primary" data-autofocus onClick={onClose}>Fechar</Button>
    </>
  ) : (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button
        variant="secondary"
        data-autofocus
        {...(executing ? { 'aria-disabled': 'true' } : {})}
        onClick={() => { if (!executing) onClose() }}
      >
        Cancelar
      </Button>
      {showRetry && <Button variant="secondary" onClick={retry}>Tentar de novo</Button>}
      {!(phase === 'error' && failedStep === 'preview') && (
        <Button
          variant="primary"
          {...(executing ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}
          {...(!actionable && !executing ? { 'aria-disabled': 'true' } : {})}
          onClick={execute}
        >
          {executing ? 'Excluindo…' : (phase === 'loading' ? 'Excluir' : `Excluir ${plural(count)}`)}
        </Button>
      )}
    </>
  )

  return (
    <Dialog open title="Limpar concluídos" titleId={titleId} onClose={() => { if (!executing) onClose() }} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      <div ref={bodyRef}>{body}</div>
      {failure && (
        <span className="v3-msg v3-msg--err" role="alert">
          <DialogIcon name="alert" size={16} />
          {failure}
        </span>
      )}
    </Dialog>
  )
}
