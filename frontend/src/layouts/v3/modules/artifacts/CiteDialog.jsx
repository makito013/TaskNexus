import { useId } from 'react'
import Button from '../../components/Button/Button.jsx'
import Chip from '../../components/Chip/Chip.jsx'
import Dialog from '../../components/Dialog/Dialog.jsx'

const KIND_LABEL = { chat: 'Chat', terminal: 'Terminal' }

// "Citar no chat" when the project has more than one conversation: which one gets the path. It only
// chooses; the screen that owns the writes does the rest and re-checks that the choice is still there.
//   targets   [{ sessionKey, kind, label }] from citeTargetsFor
//   onPick(target)
export default function CiteDialog({ artifact, targets, onPick, onClose, returnFocusTo = null }) {
  const ids = useId()
  const footer = (
    <>
      <span className="v3-dialog__footer-spacer" />
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
    </>
  )
  return (
    <Dialog open title="Citar em qual conversa?" titleId={`${ids}-title`} onClose={onClose} footer={footer} size="narrow" returnFocusTo={returnFocusTo}>
      <p className="v3-field__help" id={`${ids}-help`}>
        O caminho de {artifact.title} entra no campo da conversa, sem enviar.
      </p>
      <ul className="v3-cite-list" aria-labelledby={`${ids}-title`}>
        {targets.map((target, index) => (
          <li key={target.sessionKey}>
            <button
              type="button"
              className="v3-cite-list__item"
              data-autofocus={index === 0 ? '' : undefined}
              onClick={() => onPick(target)}
            >
              <span className="v3-cite-list__label v3-type-body">{target.label}</span>
              <Chip>{KIND_LABEL[target.kind] ?? target.kind}</Chip>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
