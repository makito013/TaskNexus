import Button from '../../components/Button/Button.jsx'
import Dialog from '../../components/Dialog/Dialog.jsx'

const TITLE_ID = 'dlg-end-chat-title'

// "Encerrar esta conversa?" (Designer 3.2). The focus starts on Cancelar: ending is the
// destructive choice. The caller owns the request; `failed` shows the reason in the footer.
export default function EndChatDialog({ busy = false, failed = false, onConfirm, onClose }) {
  return (
    <Dialog
      open
      size="narrow"
      title="Encerrar esta conversa?"
      titleId={TITLE_ID}
      onClose={onClose}
      footer={(
        <>
          {failed ? <p className="v3-dialog__why" role="alert">Não foi possível encerrar. Tente de novo.</p> : <span className="v3-dialog__footer-spacer" />}
          <Button data-autofocus onClick={onClose}>Cancelar</Button>
          <Button
            className="v3-chat-danger-button"
            aria-busy={busy ? 'true' : undefined}
            aria-disabled={busy ? 'true' : undefined}
            onClick={() => !busy && onConfirm()}
          >
            {busy ? 'Encerrando…' : 'Encerrar'}
          </Button>
        </>
      )}
    >
      <p className="v3-type-body-sm">O histórico some da lista.</p>
    </Dialog>
  )
}
