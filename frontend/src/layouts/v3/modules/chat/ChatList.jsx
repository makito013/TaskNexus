import { useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Panel from '../../components/Panel/Panel.jsx'
import { chatPath } from '../../sessions/ProjectsSessionsProvider.jsx'
import ActionMenu from './ActionMenu.jsx'
import { chatTitle, orderChats } from './chatLabels.js'
import RenameField from './RenameField.jsx'

const SKELETON_ROWS = 3

// The one engine switch a row can offer: a conversation in the terminal goes to the chat, any other to the terminal.
function engineItems(session, { onOpenTerminal, onOpenChat }) {
  if (session.engine === 'pty') {
    return onOpenChat ? [{ id: 'open-chat', label: 'Abrir no chat', onSelect: () => onOpenChat(session) }] : []
  }
  return onOpenTerminal ? [{ id: 'open-terminal', label: 'Abrir no terminal', onSelect: () => onOpenTerminal(session) }] : []
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  )
}

// List of the chats of a project (R-LISTA): five states in a fixed order, the most recent first
// inside each state, the "importado do terminal" seal, a "⋯" menu per row, inline rename and a
// callback to end a chat (the screen owns the confirmation dialog).
//   chats           rows of GET /api/chat/sessions
//   activeKey       the open chat (aria-current)
//   overrides       { [key]: { pendingCount, running, tool, attentionSeen } } of the open chat
//   fallbackTitles  { [key]: first message } for chats with no name
//   loaded / available   provider flags (loading skeleton, partial and total failure)
//   actions         useChatListActions()
//   onOpenTerminal(chat) / onOpenChat(chat)   when given, a row's menu offers the engine switch that fits its
//                   engine: "Abrir no terminal" for a chat, "Abrir no chat" for a conversation that lives in the
//                   terminal (the screen owns the confirmation dialogs)
//   onLeave         phone only: "Voltar para Projetos" (the shell rail is hidden there, so the list view
//                   is the way out of the chat route)
export default function ChatList({
  chats,
  activeKey = null,
  overrides = {},
  fallbackTitles = {},
  loaded = true,
  available = true,
  actions,
  onOpen,
  onNewChat,
  onEnd,
  onRetry,
  onLeave,
  onOpenTerminal,
  onOpenChat,
}) {
  const [renamingKey, setRenamingKey] = useState(null)
  const ordered = orderChats(chats, overrides)
  const failedTotal = loaded && !available && chats.length === 0
  const partial = loaded && !available && chats.length > 0

  const open = (event, key) => {
    event.preventDefault()
    onOpen(key)
  }

  let body
  if (!loaded) {
    body = (
      <div aria-busy="true">
        <span className="v3-chat-sr-only" role="status">Carregando chats…</span>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="v3-chat-list__skeleton" aria-hidden="true" />
        ))}
      </div>
    )
  } else if (failedTotal) {
    body = (
      <div className="v3-chat-state v3-chat-state--error">
        <p className="v3-chat-state__title">Não foi possível carregar os chats.</p>
        <Button size="sm" onClick={onRetry}>Tentar de novo</Button>
      </div>
    )
  } else if (ordered.length === 0) {
    body = (
      <div className="v3-chat-state">
        <p className="v3-chat-state__title">Nenhum chat neste projeto ainda.</p>
        <Button variant="primary" onClick={onNewChat}>Novo chat</Button>
      </div>
    )
  } else {
    body = (
      <ul className="v3-chat-list__rows" role="list">
        {ordered.map(({ session, info }) => {
          const key = session.session_key
          const title = chatTitle(session, fallbackTitles[key])
          const active = key === activeKey
          return (
            <li key={key} className={`v3-chat-row${active ? ' v3-chat-row--active' : ''}`}>
              {renamingKey === key ? (
                <RenameField
                  initial={session.display_name || ''}
                  label={`Novo nome do chat ${title}`}
                  error={actions.renameError === key}
                  busy={actions.busyKey === key}
                  onSave={(name) => actions.renameChat(key, name)}
                  onCancel={() => {
                    actions.clearRenameError()
                    setRenamingKey(null)
                  }}
                />
              ) : (
                <a
                  className="v3-chat-row__link"
                  href={chatPath(key)}
                  aria-current={active ? 'true' : undefined}
                  onClick={(event) => open(event, key)}
                >
                  <span className="v3-chat-row__title">{title}</span>
                  <span className="v3-chat-row__meta">
                    <Chip tone="state" accent={info.accent} className={info.className}>{info.label}</Chip>
                    <span className="v3-chat-row__detail v3-type-caption">{info.detail}</span>
                  </span>
                  {session.origin === 'imported_from_pty' ? (
                    <span className="v3-chat-row__seal"><Chip>importado do terminal</Chip></span>
                  ) : null}
                </a>
              )}
              <ActionMenu
                label={`Ações do chat ${title}`}
                items={[
                  { id: 'open', label: 'Abrir', onSelect: () => onOpen(key) },
                  { id: 'rename', label: 'Renomear', onSelect: () => setRenamingKey(key) },
                  ...engineItems(session, { onOpenTerminal, onOpenChat }),
                  { id: 'end', label: 'Encerrar', tone: 'danger', separatorBefore: true, onSelect: () => onEnd(session) },
                ]}
              />
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <nav className="v3-chat-list" aria-label="Chats do projeto">
      {onLeave ? (
        <Button variant="text" className="v3-chat-list__leave" onClick={onLeave}>Voltar para Projetos</Button>
      ) : null}
      <div className="v3-chat-list__head">
        <h2 className="v3-chat-list__title" tabIndex={-1}>Chats</h2>
        <Button variant="primary" onClick={onNewChat}>
          <PlusIcon />
          Novo chat
        </Button>
      </div>
      {partial ? <Panel notice="fin">Estado ao vivo indisponível.</Panel> : null}
      {actions.endError ? <p className="v3-msg v3-msg--err" role="alert">Não foi possível encerrar. Tente de novo.</p> : null}
      {body}
    </nav>
  )
}
