import { useCallback, useEffect, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog from '../../components/Dialog/Dialog.jsx'
import { api } from '../../../../services/api.js'
import { chatApi } from '../../../../services/chatApi.js'
import { newPtySessionKey } from './terminal/ptySessionKey.js'

const TITLE_ID = 'dlg-new-chat-title'
const EMPTY_HINT_ID = 'new-chat-empty'

// "Novo chat" (Designer 3.3): the project is fixed (the chat opens inside it), the agent is any registered
// agent, the title is optional. A Claude agent opens in a chat (POST /api/chat/sessions); every other one opens
// in the terminal view (C6): there is nothing to create on the server, the PTY is spawned by the first
// /ws/pty connection, so the dialog only mints the session key (ptySessionKey.js) and has no title to keep.
// Mount it only while it is open: its form starts clean every time.
//   projectRef / projectName   the project the chat belongs to
//   onCreated(sessionKey)      after POST /api/chat/sessions, or with the new key of a terminal session (the screen
//                              registers the grace window and navigates)
//   onClose()                  Esc, "Cancelar", the backdrop
export default function NewChatDialog({ projectRef, projectName, onClose, onCreated, returnFocusTo = null }) {
  const [agents, setAgents] = useState({ status: 'loading', list: [] })
  const [agentId, setAgentId] = useState('')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const loadAgents = useCallback(() => {
    setAgents({ status: 'loading', list: [] })
    api.fetchAgents().then(
      (all) => {
        const list = Array.isArray(all) ? all : []
        setAgents({ status: 'ready', list })
        setAgentId((current) => current || (list.find((agent) => agent.ia === 'claude') ?? list[0])?.id || '')
      },
      () => setAgents({ status: 'error', list: [] }),
    )
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const noAgents = agents.status === 'ready' && agents.list.length === 0
  const blocked = agents.status !== 'ready' || noAgents || !agentId
  // A terminal session: any agent that is not Claude.
  const terminal = agents.list.some((agent) => agent.id === agentId && agent.ia !== 'claude')

  const submit = async (event) => {
    event?.preventDefault()
    if (blocked || submitting) return
    setSubmitting(true)
    setFailed(false)
    if (terminal) {
      onCreated(newPtySessionKey(projectRef, agentId))
      return
    }
    try {
      const created = await chatApi.createSession({ projectRef, agentId })
      const name = title.trim()
      if (name) {
        // The chat already exists: a refused title must not undo it, the list shows "Nova conversa".
        await chatApi.renameSession(created.session_key, name).catch(() => null)
      }
      onCreated(created.session_key)
    } catch {
      setFailed(true)
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      size="narrow"
      title="Novo chat"
      titleId={TITLE_ID}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      footer={(
        <>
          {failed ? <p className="v3-dialog__why" role="alert">Não foi possível criar o chat. Tente de novo.</p> : <span className="v3-dialog__footer-spacer" />}
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            aria-disabled={blocked ? 'true' : undefined}
            aria-busy={submitting ? 'true' : undefined}
            aria-describedby={noAgents ? EMPTY_HINT_ID : undefined}
            onClick={submit}
          >
            {submitting ? 'Iniciando…' : terminal ? 'Abrir terminal' : 'Iniciar chat'}
          </Button>
        </>
      )}
    >
      <form className="v3-chat-new" onSubmit={submit}>
        <div className="v3-field">
          <span className="v3-field__label">Projeto</span>
          <p className="v3-chat-new__project">{projectName}</p>
        </div>

        <div className="v3-field">
          <label className="v3-field__label" htmlFor="new-chat-agent">Agente</label>
          {noAgents ? (
            <p id={EMPTY_HINT_ID} className="v3-msg v3-msg--warn">Nenhum agente cadastrado.</p>
          ) : (
            // Never `disabled`: the dialog's initial focus goes to this field and a disabled field cannot take it.
            <select
              id="new-chat-agent"
              className="v3-input"
              data-autofocus
              value={agentId}
              aria-busy={agents.status === 'loading' ? 'true' : undefined}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.status === 'loading' ? <option value="">Carregando agentes…</option> : null}
              {agents.status === 'error' ? <option value="">Não foi possível carregar os agentes.</option> : null}
              {agents.list.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.nome || agent.id}</option>
              ))}
            </select>
          )}
          {agents.status === 'error' ? (
            <Button size="sm" variant="text" onClick={loadAgents}>Tentar de novo</Button>
          ) : (
            <span className="v3-field__help">Só agentes Claude abrem em chat. Os outros abrem em terminal.</span>
          )}
        </div>

        <div className="v3-field">
          <label className="v3-field__label" htmlFor="new-chat-title">Título (opcional)</label>
          <input
            id="new-chat-title"
            className="v3-input"
            value={title}
            maxLength={120}
            disabled={terminal}
            placeholder="Sem título"
            onChange={(event) => setTitle(event.target.value)}
          />
          <span className="v3-field__help">
            {terminal ? 'O terminal não guarda título.' : 'Se vazio, usamos a sua primeira mensagem.'}
          </span>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
