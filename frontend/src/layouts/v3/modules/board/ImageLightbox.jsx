import { useId, useState } from 'react'
import Dialog from '../../components/Dialog/Dialog.jsx'

// An image of the card at full size, in its own modal <dialog> (a SIBLING of the card dialog: Esc and the
// backdrop close only this one). Esc, "Fechar" and a click that began and ended on the backdrop close it.
//   image   { id, url }      number  the 1-based position shown in the title
//   returnFocusTo            the thumbnail that opened it
export default function ImageLightbox({ image, number, onClose, returnFocusTo = null }) {
  const titleId = useId()
  const [broken, setBroken] = useState(false)
  return (
    <Dialog open title={`Imagem ${number}`} titleId={titleId} onClose={onClose} returnFocusTo={returnFocusTo}>
      {broken ? (
        <p className="v3-msg v3-msg--err" role="alert">Não consegui carregar a imagem.</p>
      ) : (
        <img className="v3-card-lightbox__image" src={image.url} alt="" onError={() => setBroken(true)} />
      )}
    </Dialog>
  )
}
