import { useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { agentInitials } from '../projects/AgentCard.jsx'
import ActionMenu from './ActionMenu.jsx'
import { modeLabel } from './chatLabels.js'
import RenameField from './RenameField.jsx'

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
}) {
  const [renaming, setRenaming] = useState(false)

  const items = [
    { id: 'rename', label: 'Renomear chat', onSelect: () => setRenaming(true) },
    ...(onOpenConnectors ? [{ id: 'connectors', label: 'Conectores do agente…', onSelect: onOpenConnectors }] : []),
    { id: 'end', label: 'Encerrar chat', tone: 'danger', separatorBefore: true, onSelect: onEnd },
  ]

  return (
    <header className="v3-chat-header">
      <div className="v3-chat-header__row">
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
          <ActionMenu label="Mais ações do chat" items={items} />
        </div>
      </div>
      <div className="v3-chat-header__chips">
        <Chip className="v3-chat-chip-agent">
          <span className="v3-chat-avatar v3-chat-avatar--mini" aria-hidden="true">{agentInitials(agentName)}</span>
          {agentName}
        </Chip>
        {projectName ? <Chip>{projectName}</Chip> : null}
        {model ? (
          onOpenModel ? (
            <button
              type="button"
              className="v3-chat-model-chip"
              aria-label={`Modelo atual: ${model}. Trocar modelo`}
              aria-disabled={disabled ? 'true' : undefined}
              onClick={() => !disabled && onOpenModel()}
            >
              {model}
            </button>
          ) : (
            <Chip>{model}</Chip>
          )
        ) : null}
        <Chip>{modeLabel(mode)}</Chip>
        {stateInfo ? <Chip tone="state" accent={stateInfo.accent} className={stateInfo.className}>{stateInfo.label}</Chip> : null}
      </div>
    </header>
  )
}
