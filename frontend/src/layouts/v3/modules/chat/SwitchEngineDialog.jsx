import { useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { chatApi } from '../../../../services/chatApi.js'

const TITLE_ID = 'dlg-switch-engine-title'

// R-AV (Designer 8.1): "Abrir esta conversa no chat?", only for a conversation that lives in the
// terminal (pty -> chat). The text is the product's, verbatim. The focus starts on Cancelar: opening is
// the choice that takes the conversation out of the V2. It is one of the writers of chatApi
// (chatWriteGuard): POST switch-engine { engine: 'chat', confirm: true }. A failure keeps everything
// where it was; "already a chat" (engine_conflict) means the goal is reached, so it counts as success.
// The opposite direction (chat -> terminal) arrives with the terminal view and is NOT in this dialog.
//   sessionKey
//   onCancel()           Cancelar, Esc, the close button
//   onSwitched(result)   the server answered { engine: 'chat', history: { imported } | { failed } }
export default function SwitchEngineDialog({ sessionKey, onCancel, onSwitched }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await chatApi.switchEngine(sessionKey, { engine: 'chat', confirm: true })
      onSwitched(result)
    } catch (error) {
      if (error?.code === 'engine_conflict') {
        onSwitched({ engine: 'chat', history: null })
        return
      }
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      size="narrow"
      title="Abrir esta conversa no chat?"
      titleId={TITLE_ID}
      onClose={() => !busy && onCancel()}
      footer={(
        <>
          {failed ? (
            <p className="v3-dialog__why" role="alert">Não foi possível abrir no chat. A conversa continua onde estava.</p>
          ) : <span className="v3-dialog__footer-spacer" />}
          <Button data-autofocus onClick={() => !busy && onCancel()}>Cancelar</Button>
          <Button
            variant="primary"
            aria-busy={busy ? 'true' : undefined}
            aria-disabled={busy ? 'true' : undefined}
            onClick={confirm}
          >
            {busy ? 'Abrindo…' : 'Abrir no chat'}
          </Button>
        </>
      )}
    >
      <p className="v3-chat-switch v3-type-body-sm">
        <DialogIcon name="alert" />
        <span>
          Ao abrir no chat, esta conversa deixa de aparecer na V2 (versão atual do TaskNexus). Você pode voltar com “Abrir no terminal”. Continuar?
        </span>
      </p>
    </Dialog>
  )
}
