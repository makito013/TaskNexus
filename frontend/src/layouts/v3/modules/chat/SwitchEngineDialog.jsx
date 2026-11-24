import { useEffect, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog, { DialogIcon } from '../../components/Dialog/Dialog.jsx'
import { chatApi } from '../../../../services/chatApi.js'
import { workspacesApi } from '../../../../services/workspacesApi.js'
import { buildRegistryIndex, resolveKey } from '../projects/registryIndex.js'

const TITLE_ID = 'dlg-switch-engine-title'

// Two directions of the one-engine-at-a-time switch (CA47). Both are the product's text, verbatim; the dialog is
// the ONLY writer of POST switch-engine (chatWriteGuard). A failure keeps everything where it was.
//
// direction 'chat' (default), R-AV (Designer 8.1): "Abrir esta conversa no chat?", only for a conversation that
// lives in the terminal (pty -> chat). The focus starts on Cancelar: opening is the choice that takes the
// conversation out of the V2. POST { engine: 'chat', confirm: true }. "Already a chat" (engine_conflict) means the
// goal is reached, so it counts as success.
//
// direction 'pty' (Designer 8.2): "Abrir no terminal?" (chat -> pty). Reversible, so the focus starts on the
// primary button. POST { engine: 'pty' }. A running turn is interrupted by the switch (the text says so); a project
// with extra folders loses them in the terminal (D-TL3.5: the PTY has one cwd and no add_dirs). "Not a chat"
// (engine_conflict) means it is already in the terminal: success.
//   sessionKey
//   direction            'chat' | 'pty'
//   turnRunning          pty only: a turn is running (adds the sentence about the interruption)
//   projectRef           pty only: the project, to tell whether it has extra folders (read from the registry:
//                        the chat rows carry no add_dirs and chatApi has no reader of one session)
//   onCancel()           Cancelar, Esc, the close button
//   onSwitched(result)   the server answered { engine, history }
export default function SwitchEngineDialog({ sessionKey, direction = 'chat', turnRunning = false, projectRef = null, onCancel, onSwitched }) {
  const toTerminal = direction === 'pty'
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [extraFolders, setExtraFolders] = useState(false)

  useEffect(() => {
    if (!toTerminal || !projectRef) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => workspacesApi.fetchWorkspaces({ includeArchived: true }))
      .then(
        (response) => {
          if (cancelled) return
          const resolved = resolveKey(projectRef, buildRegistryIndex(response))
          const folders = resolved.kind === 'project' ? resolved.project.folders : []
          setExtraFolders(folders.some((folder) => !folder.is_primary))
        },
        () => {},
      )
    return () => {
      cancelled = true
    }
  }, [toTerminal, projectRef])

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await chatApi.switchEngine(sessionKey, toTerminal ? { engine: 'pty' } : { engine: 'chat', confirm: true })
      onSwitched(result)
    } catch (error) {
      if (error?.code === 'engine_conflict') {
        onSwitched({ engine: toTerminal ? 'pty' : 'chat', history: null })
        return
      }
      setFailed(true)
      setBusy(false)
    }
  }

  const title = toTerminal ? 'Abrir no terminal?' : 'Abrir esta conversa no chat?'
  const actionLabel = toTerminal ? 'Abrir no terminal' : 'Abrir no chat'
  const failure = toTerminal
    ? 'Não foi possível abrir no terminal. A conversa continua no chat.'
    : 'Não foi possível abrir no chat. A conversa continua onde estava.'
  const text = toTerminal
    ? [
      'O chat será fechado e a conversa continua no terminal.',
      turnRunning ? 'O turno em andamento será interrompido.' : null,
      extraFolders ? 'As pastas extras do projeto não acompanham o terminal.' : null,
    ].filter(Boolean).join(' ')
    : 'Ao abrir no chat, esta conversa deixa de aparecer na V2 (versão atual do TaskNexus). Você pode voltar com “Abrir no terminal”. Continuar?'
  const cancel = () => !busy && onCancel()

  return (
    <Dialog
      open
      size="narrow"
      title={title}
      titleId={TITLE_ID}
      onClose={cancel}
      footer={(
        <>
          {failed ? (
            <p className="v3-dialog__why" role="alert">{failure}</p>
          ) : <span className="v3-dialog__footer-spacer" />}
          <Button data-autofocus={toTerminal ? undefined : true} onClick={cancel}>Cancelar</Button>
          <Button
            variant="primary"
            data-autofocus={toTerminal ? true : undefined}
            aria-busy={busy ? 'true' : undefined}
            aria-disabled={busy ? 'true' : undefined}
            onClick={confirm}
          >
            {busy ? 'Abrindo…' : actionLabel}
          </Button>
        </>
      )}
    >
      <p className="v3-chat-switch v3-type-body-sm">
        <DialogIcon name="alert" />
        <span>{text}</span>
      </p>
    </Dialog>
  )
}
