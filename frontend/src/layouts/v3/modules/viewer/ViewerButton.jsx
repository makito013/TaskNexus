import { useId } from 'react'
import { SURFACE_CHAT, useViewer } from '../../../../hooks/viewerState.jsx'
import { sessionScope } from '../../../../services/viewerApi.js'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import { NO_CONVERSATION_MESSAGE, useViewerShell } from './ViewerShell.jsx'
import './ViewerButton.css'

function FilesIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5.5 3.5h6l3 3v10h-9z" />
      <path d="M11.5 3.5v3h3" />
    </svg>
  )
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// "Visualizador" in the header of the chat: opens and closes the panel, shows how many files the
// conversation has open and, in the "fin" accent WITH text, how many arrived while it was out of view.
// Without the viewer shell it renders nothing (an isolated ChatHeader). Without a conversation it is
// aria-disabled (not disabled: a keyboard user still reaches the explanation).
export default function ViewerButton({ scope: scopeProp = null, sessionKey = null, disabled = false }) {
  const viewer = useViewer()
  const shell = useViewerShell()
  const hintId = useId()
  if (!viewer) return null

  const scope = scopeProp ?? sessionScope(sessionKey)
  const inactive = disabled || !scope
  const count = scope ? viewer.getScope(scope).items.length : 0
  const unseen = scope ? viewer.unseen[scope] || 0 : 0
  const open = viewer.getSurface(SURFACE_CHAT).open && !inactive

  const label = ['Visualizador de arquivos']
  if (count) label.push(plural(count, 'aba', 'abas'))
  if (unseen) label.push(plural(unseen, 'nova', 'novas'))

  const toggle = () => {
    if (inactive) return
    if (!open) shell?.requestPanelFocus()
    viewer.setOpen(SURFACE_CHAT, !open)
  }

  return (
    <>
      <Button
        size="sm"
        className="v3-viewer-button"
        aria-label={label.join(', ')}
        aria-pressed={inactive ? undefined : open}
        aria-disabled={inactive ? 'true' : undefined}
        aria-describedby={inactive ? hintId : undefined}
        data-viewer-button=""
        onClick={toggle}
      >
        <FilesIcon />
        <span className="v3-viewer-button__label">Visualizador</span>
        {unseen > 0 ? (
          <Chip tone="state" accent="fin" className="v3-viewer-button__seal">{plural(unseen, 'novo', 'novos')}</Chip>
        ) : count > 0 ? (
          <Chip className="v3-viewer-button__seal">{count}</Chip>
        ) : null}
      </Button>
      {inactive ? <span id={hintId} className="v3-viewer-sr-only">{NO_CONVERSATION_MESSAGE}</span> : null}
    </>
  )
}
