import { useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { agentInitials } from '../projects/AgentCard.jsx'
import ViewerButton from '../viewer/ViewerButton.jsx'
import ActionMenu from './ActionMenu.jsx'
import { modeLabel } from './chatLabels.js'
import RenameField from './RenameField.jsx'

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4.5L6.5 10l5.5 5.5" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 5.5l4.5 4.5L4 14.5M10.5 14.5H16" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  )
}

// Header of the open conversation (Designer 4.1): the title (the page's only h1), the chips that say
// where this chat stands and the actions. "Interromper" only exists while a turn runs.
//   stateInfo       result of chatStateOf()
//   onOpenModel     when given, the model chip is a button (the screen opens the model card);
//                   otherwise it is a plain chip
//   onOpenConnectors  when given, the menu offers "Conectores do agente…"
//   onRename(name) -> Promise<boolean>      onEnd()      onInterrupt()
//   terminal       the header of a terminal view (codex, agy, the plain terminal, a claude conversation that was
//                  sent to the terminal): no mode chip, no rename or connectors, no state chip
//   onOpenTerminal when given (a chat of a Claude agent): the "Abrir no terminal" button and its menu item
//   onOpenChat     when given (a Claude conversation that lives in the terminal): the "Abrir no chat" menu item
//   sessionKey     when given, the "Visualizador" button of the file viewer (it renders nothing without the viewer shell)
//   onOpenConversations  when given (the list of chats is folded away beside the open viewer): "Conversas" opens it
//   onBack         phone only (the screen passes it below 768): "Voltar" to the list of chats, 44x44. The
//                  stylesheet keeps only the agent and the state chips on a phone and shrinks "Interromper"
//                  to its icon below 1280 (the button keeps its aria-label either way).
export default function ChatHeader({
  title,
  agentName,
  projectName,
  model,
  mode,
  stateInfo,
  running,
  interrupting,
  disabled = false,
  renameError = false,
  renameBusy = false,
  onRename,
  onEnd,
  onInterrupt,
  onOpenModel,
  onOpenConnectors,
  onBack,
  terminal = false,
  onOpenTerminal,
  onOpenChat,
  sessionKey = null,
  onOpenConversations,
}) {
  const [renaming, setRenaming] = useState(false)

  const engineItems = [
    ...(onOpenTerminal ? [{ id: 'open-terminal', label: 'Abrir no terminal', onSelect: onOpenTerminal }] : []),
    ...(onOpenChat ? [{ id: 'open-chat', label: 'Abrir no chat', onSelect: onOpenChat }] : []),
  ]
  const items = [
    ...(terminal ? [] : [{ id: 'rename', label: 'Renomear chat', onSelect: () => setRenaming(true) }]),
    ...engineItems,
    ...(onOpenConnectors ? [{ id: 'connectors', label: 'Conectores do agente…', onSelect: onOpenConnectors }] : []),
    { id: 'end', label: 'Encerrar chat', tone: 'danger', separatorBefore: true, onSelect: onEnd },
  ]

  return (
    <header className="v3-chat-header">
      <div className="v3-chat-header__row">
        {onBack ? (
          <button type="button" className="v3-chat-back" aria-label="Voltar para a lista de chats" onClick={onBack}>
            <BackIcon />
          </button>
        ) : null}
        {renaming ? (
          <RenameField
            initial={title}
            label="Novo nome do chat"
            error={renameError}
            busy={renameBusy}
            onSave={onRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h1 className="v3-chat-header__title" tabIndex={-1}>{title}</h1>
        )}
        <div className="v3-chat-header__actions">
          {running ? (
            <Button
              size="sm"
              className="v3-chat-stop"
              aria-label={interrupting ? 'Interrompendo turno' : 'Interromper turno'}
              aria-busy={interrupting ? 'true' : undefined}
              aria-disabled={interrupting ? 'true' : undefined}
              onClick={() => !interrupting && onInterrupt()}
            >
              <StopIcon />
              <span className="v3-chat-stop__label">{interrupting ? 'Interrompendo…' : 'Interromper'}</span>
              {interrupting ? null : <kbd className="v3-chat-kbd">Esc</kbd>}
            </Button>
          ) : null}
          {onOpenTerminal ? (
            <Button
              size="sm"
              className="v3-chat-terminal-button"
              aria-label="Abrir no terminal"
              onClick={onOpenTerminal}
            >
              <TerminalIcon />
              <span className="v3-chat-terminal-button__label">Abrir no terminal</span>
            </Button>
          ) : null}
          {onOpenConversations ? (
            <Button size="sm" className="v3-chat-conversations-button" onClick={onOpenConversations}>Conversas</Button>
          ) : null}
          {sessionKey ? <ViewerButton sessionKey={sessionKey} /> : null}
          <ActionMenu label="Mais ações do chat" items={items} />
        </div>
      </div>
      <div className="v3-chat-header__chips">
        <Chip className="v3-chat-chip-agent">
          <span className="v3-chat-avatar v3-chat-avatar--mini" aria-hidden="true">{agentInitials(agentName)}</span>
          {agentName}
        </Chip>
        {projectName ? <Chip className="v3-chat-chip-secondary">{projectName}</Chip> : null}
        {model ? (
          onOpenModel ? (
            <button
              type="button"
              className="v3-chat-model-chip v3-chat-chip-secondary"
              aria-label={`Modelo atual: ${model}. Trocar modelo`}
              aria-disabled={disabled ? 'true' : undefined}
              onClick={() => !disabled && onOpenModel()}
            >
              {model}
            </button>
          ) : (
            <Chip className="v3-chat-chip-secondary">{model}</Chip>
          )
        ) : null}
        {terminal ? null : <Chip className="v3-chat-chip-secondary">{modeLabel(mode)}</Chip>}
        {stateInfo ? <Chip tone="state" accent={stateInfo.accent} className={`v3-chat-chip-state ${stateInfo.className}`.trim()}>{stateInfo.label}</Chip> : null}
      </div>
    </header>
  )
}
