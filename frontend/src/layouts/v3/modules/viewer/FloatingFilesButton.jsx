import { SURFACE_CHAT, useViewer } from '../../../../hooks/viewerState.jsx'
import { sessionScope } from '../../../../services/viewerApi.js'
import Button from '../../components/Button/Button.jsx'
import { useViewerShell } from './ViewerShell.jsx'

// Phone only: "Arquivos" floats over the conversation (absolute inside the chat panel, which is already the safe
// area) and opens the viewer in full screen. Not `fixed`: the panel is its containing block on purpose.
// Renders nothing without the viewer shell or without a conversation.
export default function FloatingFilesButton({ sessionKey }) {
  const viewer = useViewer()
  const shell = useViewerShell()
  const scope = sessionScope(sessionKey)
  if (!viewer || !scope) return null
  const count = viewer.getScope(scope).items.length
  const unseen = viewer.unseen[scope] || 0
  const label = ['Arquivos', count ? `${count} ${count === 1 ? 'aba' : 'abas'}` : null, unseen ? `${unseen} ${unseen === 1 ? 'nova' : 'novas'}` : null]
    .filter(Boolean)
    .join(', ')
  return (
    <Button
      variant="primary"
      className="v3-viewer-floating"
      aria-label={label}
      onClick={() => {
        shell?.requestPanelFocus()
        // setOpen first: it clears the unseen counter of the conversation.
        viewer.setOpen(SURFACE_CHAT, true)
        viewer.setFullscreen(SURFACE_CHAT, true)
      }}
    >
      Arquivos{count > 0 ? ` ${count}` : ''}
    </Button>
  )
}
