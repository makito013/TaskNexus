import Dialog from '../../components/Dialog/Dialog.jsx'

// The list of conversations, in a dialog, for when the open viewer folded the list away from the grid. The list
// is passed in as children and mounted ONLY while the dialog is open (one list in the DOM at a time).
export default function ConversationsDialog({ open, onClose, returnFocusTo = null, children }) {
  return (
    <Dialog open={open} title="Conversas" titleId="v3-viewer-conversations-title" size="narrow" onClose={onClose} returnFocusTo={returnFocusTo}>
      {open ? children : null}
    </Dialog>
  )
}
